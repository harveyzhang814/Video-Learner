'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const orchestrator = require('../core/orchestrator');

const SLEEP_SCRIPT = `#!/usr/bin/env bash
sleep 1.5
exit 0
`;
const EXIT0_SCRIPT = `#!/usr/bin/env bash
exit 0
`;

// fetch is instant; subs and video both sleep so they can overlap after fetch.
const STUBS = {
  'fetch_info.sh':       EXIT0_SCRIPT,
  'download_video.sh':   SLEEP_SCRIPT,
  'download_audio.sh':   EXIT0_SCRIPT,
  'download_subs.sh':    SLEEP_SCRIPT,
  'asr_transcribe.sh':   EXIT0_SCRIPT,
  'convert_vtt_md.sh':   EXIT0_SCRIPT,
  'convert_md_vtt.sh':   EXIT0_SCRIPT,
  'generate_article.sh': EXIT0_SCRIPT,
  'generate_summary.sh': EXIT0_SCRIPT,
};

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-parallel-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
  for (const [name, content] of Object.entries(STUBS)) {
    const p = path.join(dir, 'scripts', name);
    fs.writeFileSync(p, content);
    fs.chmodSync(p, '755');
  }
  return dir;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Run a task to completion while sampling how many steps are 'running' at once.
async function measureMaxConcurrency(rootDir, urlSuffix) {
  const { task_id } = await orchestrator.createTask({
    url: `https://www.youtube.com/watch?v=${urlSuffix}`,
    mode: 'media',
    force: 1,
    rootDir,
  });
  const done = orchestrator.runTask(task_id, { rootDir }).catch(() => {});
  let maxConcurrent = 0;
  const poll = (async () => {
    for (let i = 0; i < 80; i++) {
      const t = await orchestrator.getTask(task_id, { rootDir });
      const running = Object.values(t.steps).filter((s) => s.status === 'running').length;
      if (running > maxConcurrent) maxConcurrent = running;
      if (t.status !== 'running' && t.status !== 'pending') break;
      await sleep(50);
    }
  })();
  await Promise.all([done, poll]);
  return maxConcurrent;
}

async function run() {
  // Test 1: default N (3) lets subs + video run concurrently after fetch.
  {
    const rootDir = makeTempDir();
    try {
      delete process.env.VL_MAX_PARALLEL_STEPS;
      const maxC = await measureMaxConcurrency(rootDir, 'parallel-default');
      if (maxC < 2) throw new Error(`expected >=2 concurrent steps, got ${maxC}`);
      console.log(`[parallel-test] Test 1 passed: max concurrency ${maxC} (>=2)`);
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // Test 2: N=1 degrades to serial (max concurrency 1).
  {
    const rootDir = makeTempDir();
    try {
      process.env.VL_MAX_PARALLEL_STEPS = '1';
      const maxC = await measureMaxConcurrency(rootDir, 'parallel-serial');
      if (maxC !== 1) throw new Error(`expected exactly 1 concurrent step at N=1, got ${maxC}`);
      console.log('[parallel-test] Test 2 passed: N=1 serial (max concurrency 1)');
    } finally {
      delete process.env.VL_MAX_PARALLEL_STEPS;
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  console.log('task-parallel.test.js: PASS');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
