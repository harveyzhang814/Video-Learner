'use strict';

/**
 * E2E parallel timing monitor.
 * Runs a full DAG task with timed stub scripts, captures step.started/finished
 * events, validates priority ordering, and emits a Mermaid gantt diagram.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const orchestrator = require('../core/orchestrator');

// ─── stub durations (ms) ────────────────────────────────────────────────────
// Chosen to make parallelism visible:
//   fetch is instant; subs+video overlap after fetch;
//   vtt2md starts as soon as subs finishes;
//   translate+article overlap after vtt2md;
//   md2vtt follows translate, summary follows article.
const DURATIONS = {
  'fetch_info.sh':       0,
  'download_video.sh':   800,
  'download_audio.sh':   700,
  'download_subs.sh':    600,
  'asr_transcribe.sh':   500,
  'convert_vtt_md.sh':   300,
  'translate_subs.sh':   700,
  'convert_md_vtt.sh':   400,
  'generate_article.sh': 800,
  'generate_summary.sh': 400,
};

function makeTempDir(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-e2e-timing-'));
  const scriptsDir = path.join(dir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });

  // Each stub sleeps for its duration then creates the artifact(s) its downstream
  // steps depend on (A-layer validateStepArtifacts checks these files).
  // The task id is derived from the URL: sha1(url + '\n').slice(0,12).
  // We pass the work dir root via WORK_DIR env var (set in the stub preamble).
  // Instead of knowing the task id in advance, stubs use a glob to find the work subdir.

  const stubs = {
    'fetch_info.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['fetch_info.sh']/1000).toFixed(3)}
exit 0
`,
    'download_subs.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['download_subs.sh']/1000).toFixed(3)}
# $1=url $2=taskDir $3=id — create VTT so vtt2md A-layer validation passes
mkdir -p "$2/transcript/subs"
printf 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello world\n' > "$2/transcript/subs/video.en.vtt"
exit 0
`,
    'download_video.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['download_video.sh']/1000).toFixed(3)}
mkdir -p "$2/media"
exit 0
`,
    'download_audio.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['download_audio.sh']/1000).toFixed(3)}
mkdir -p "$2/media"
exit 0
`,
    'asr_transcribe.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['asr_transcribe.sh']/1000).toFixed(3)}
exit 0
`,
    'convert_vtt_md.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['convert_vtt_md.sh']/1000).toFixed(3)}
# $1=input vtt, $2=output md
mkdir -p "$(dirname "$2")"
echo "# Transcript\n\nHello world" > "$2"
exit 0
`,
    'translate_subs.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['translate_subs.sh']/1000).toFixed(3)}
exit 0
`,
    'convert_md_vtt.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['convert_md_vtt.sh']/1000).toFixed(3)}
exit 0
`,
    'generate_article.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['generate_article.sh']/1000).toFixed(3)}
# $1=transcript, $2=output article
mkdir -p "$(dirname "$2")"
echo "# Article\n\nContent here." > "$2"
exit 0
`,
    'generate_summary.sh': `#!/usr/bin/env bash
sleep ${(DURATIONS['generate_summary.sh']/1000).toFixed(3)}
exit 0
`,
  };

  for (const [name, content] of Object.entries(stubs)) {
    const p = path.join(scriptsDir, name);
    fs.writeFileSync(p, content);
    fs.chmodSync(p, '755');
  }

  return dir;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Map script filename → step name
const SCRIPT_TO_STEP = {
  'fetch_info.sh':       'fetch',
  'download_video.sh':   'video',
  'download_audio.sh':   'audio',
  'download_subs.sh':    'subs',
  'asr_transcribe.sh':   'asr',
  'convert_vtt_md.sh':   'vtt2md',
  'translate_subs.sh':   'translate',
  'convert_md_vtt.sh':   'md2vtt',
  'generate_article.sh': 'article',
  'generate_summary.sh': 'summary',
};

// Mermaid gantt needs labels without special chars
function ganttLabel(step) {
  return step;
}

function buildGantt(stepTimings, mode, maxConcurrent) {
  const totalMs = Math.max(...Object.values(stepTimings).map(v => v.end || v.start || 0));

  const lines = [
    '```mermaid',
    'gantt',
    `    title DAG 并发执行时序 (mode=${mode}, N=3, max_concurrent=${maxConcurrent})`,
    '    dateFormat x',
    '    axisFormat %Lms',
    '',
    '    section Steps',
  ];

  const sorted = Object.entries(stepTimings).sort((a, b) => (a[1].start || 0) - (b[1].start || 0));
  for (const [step, { start, end }] of sorted) {
    if (start === undefined || end === undefined) continue;
    const dur = Math.max(1, end - start);
    lines.push(`    ${step} :${start}, ${dur}`);
  }

  lines.push('```');
  lines.push('');
  const serialTotal = Object.values(DURATIONS).reduce((a, b) => a + b, 0);
  lines.push(`**总耗时**: ${totalMs}ms  |  **理论串行耗时**: ${serialTotal}ms  |  **加速比**: ${(serialTotal/totalMs).toFixed(1)}x`);
  lines.push('');

  return lines.join('\n');
}

async function runAndCapture(mode, maxN) {
  process.env.VL_MAX_PARALLEL_STEPS = String(maxN);
  const rootDir = makeTempDir(mode);
  const t0      = Date.now();

  // stepTimings[name] = { start: ms, end: ms }
  const stepTimings = {};
  // Ordered event log for the table
  const events = [];

  // Events fire synchronously — gives us true scheduling order and precise start timestamps
  const eventStartOrder = []; // ordered by actual scheduler dispatch
  const unsub = orchestrator.onEvent((ev) => {
    const ts = Date.now() - t0;
    const { type, payload } = ev;
    if (type === 'step.started') {
      stepTimings[payload.stepName] = { start: ts };
      eventStartOrder.push(payload.stepName);
    }
  });

  try {
    const { task_id } = await orchestrator.createTask({
      url:   `https://www.youtube.com/watch?v=e2e-timing-${mode}-n${maxN}`,
      mode,
      force: 1,
      rootDir,
    });

    // Poll for state while runTask runs — gives us correct concurrent counts
    // and end timestamps regardless of which steps emit step.finished.
    let maxConcurrent = 0;
    const prevStatuses = {};
    const runPromise = orchestrator.runTask(task_id, { rootDir });

    const pollLoop = (async () => {
      while (true) {
        const t = await orchestrator.getTask(task_id, { rootDir }).catch(() => null);
        if (!t) break;
        const ts = Date.now() - t0;

        const runningNow = [];
        for (const [name, info] of Object.entries(t.steps)) {
          const prev = prevStatuses[name];
          const cur  = info.status;
          if (cur !== prev) {
            if (cur === 'running') {
              events.push({ type: 'started', step: name, ts });
              // Overwrite with poll timestamp only if event didn't already set it
              if (!stepTimings[name]) stepTimings[name] = { start: ts };
            }
            if ((cur === 'completed' || cur === 'failed' || cur === 'skipped') && prev === 'running') {
              events.push({ type: 'finished', step: name, ts });
              if (stepTimings[name]) stepTimings[name].end = ts;
            }
            prevStatuses[name] = cur;
          }
          if (cur === 'running') runningNow.push(name);
        }
        if (runningNow.length > maxConcurrent) maxConcurrent = runningNow.length;

        if (t.status !== 'running' && t.status !== 'pending') break;
        await sleep(20);
      }
    })();

    await Promise.all([runPromise, pollLoop]);
    const task = await orchestrator.getTask(task_id, { rootDir });
    return { events, stepTimings, eventStartOrder, t0, mode, maxN, maxConcurrent, task, rootDir };
  } finally {
    unsub();
    delete process.env.VL_MAX_PARALLEL_STEPS;
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

function validatePriorityOrdering(eventStartOrder) {
  // Events fire synchronously in dispatch order — reflects true scheduler priority.
  // After fetch, subs (PRIMARY_CHAIN) must be dispatched before video (SECONDARY_CHAIN).
  const afterFetch = eventStartOrder.slice(eventStartOrder.indexOf('fetch') + 1);
  const firstAfterFetch = afterFetch[0];
  return {
    ok: firstAfterFetch === 'subs',
    firstAfterFetch,
    startOrder: eventStartOrder,
  };
}

function printTable(events) {
  console.log('\n步骤执行时序：');
  console.log('─'.repeat(56));
  console.log(('步骤').padEnd(12) + ('事件').padEnd(10) + ('相对时间(ms)').padEnd(16) + '并发快照');
  console.log('─'.repeat(56));
  const running = new Set();
  for (const e of events) {
    if (e.type === 'started') running.add(e.step);
    else running.delete(e.step);
    const rel = String(e.ts).padStart(6);
    const snapshot = [...running].join('+') || '(idle)';
    console.log(`${e.step.padEnd(12)}${e.type.padEnd(10)}${rel}ms       [${snapshot}]`);
  }
  console.log('─'.repeat(56));
}

async function run() {
  console.log('=== E2E 并发时序测试 ===\n');

  // ── Scenario 1: media mode N=3 (default) ─────────────────────────────────
  console.log('▶ Scenario 1: media 模式, N=3');
  const r1 = await runAndCapture('media', 3);
  printTable(r1.events);
  const p1 = validatePriorityOrdering(r1.eventStartOrder);
  console.log(`\n最大并发数: ${r1.maxConcurrent}`);
  console.log(`主链优先 (fetch 后第一个启动的是 subs): ${p1.ok ? '✅' : '❌ ' + p1.firstAfterFetch}`);
  console.log(`启动顺序: ${p1.startOrder.join(' → ')}`);

  if (r1.maxConcurrent < 2) {
    throw new Error(`Scenario 1: 期望最大并发 ≥ 2，实际 ${r1.maxConcurrent}`);
  }
  if (!p1.ok) {
    throw new Error(`Scenario 1: 主链优先失败，fetch 后第一个启动的是 ${p1.firstAfterFetch}，期望 subs`);
  }

  // ── Scenario 2: full 模式 N=3 (video+audio+subs 三路并发) ────────────────
  console.log('\n▶ Scenario 2: full 模式, N=3 (video+audio+subs 三路并发)');
  const r2 = await runAndCapture('full', 3);
  printTable(r2.events);
  const afterFetch2 = r2.eventStartOrder.slice(r2.eventStartOrder.indexOf('fetch') + 1);
  // In full mode: after fetch, subs (main) + video + audio all ready → 3 concurrent
  const hasTriple = r2.maxConcurrent >= 3;
  console.log(`\n最大并发数: ${r2.maxConcurrent}`);
  console.log(`fetch 后就绪步骤: ${afterFetch2.slice(0, 3).join(', ')}...`);
  console.log(`三路并发 (video+audio+subs): ${hasTriple ? '✅' : '⚠️  ' + r2.maxConcurrent + ' < 3'}`);

  // ── Scenario 3: N=1 串行回退 ──────────────────────────────────────────────
  console.log('\n▶ Scenario 3: N=1 串行回退');
  const r3 = await runAndCapture('media', 1);
  const p3 = validatePriorityOrdering(r3.events);
  console.log(`最大并发数: ${r3.maxConcurrent} (期望 1)`);
  if (r3.maxConcurrent !== 1) {
    throw new Error(`Scenario 3: N=1 时期望串行，实际并发 ${r3.maxConcurrent}`);
  }
  console.log('串行回退: ✅');

  // ── Mermaid gantt 输出 ────────────────────────────────────────────────────
  const gantt1 = buildGantt(r1.stepTimings, 'media', r1.maxConcurrent);
  const gantt2 = buildGantt(r2.stepTimings, 'full', r2.maxConcurrent);

  console.log('\n' + '═'.repeat(60));
  console.log('时序图 — Scenario 1 (media, N=3):');
  console.log('═'.repeat(60));
  console.log(gantt1);

  console.log('\n' + '═'.repeat(60));
  console.log('时序图 — Scenario 2 (full, N=3):');
  console.log('═'.repeat(60));
  console.log(gantt2);

  console.log('\ne2e-parallel-timing.js: PASS');
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ E2E 测试失败:', err.message);
  process.exit(1);
});
