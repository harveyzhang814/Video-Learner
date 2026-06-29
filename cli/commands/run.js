// cli/commands/run.js
'use strict';
const readline = require('readline');
const path = require('path');
const { getWorkRoot } = require('../../core/paths');
const server = require('../lib/server');
const client = require('../lib/client');
const fmt = require('../lib/format');

function parseArgs(args) {
  const opts = {
    url: null, filePath: null, focus: '', mode: 'media', modeExplicit: false,
    srcLang: 'en', lang: 'zh-CN',
    force: false, json: false, timeout_scale: 1, workRoot: null,
  };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--focus')            { opts.focus  = args[++i]; }
    else if (a === '--mode')        { opts.mode   = args[++i]; opts.modeExplicit = true; }
    else if (a === '--lang')        { opts.lang   = args[++i]; }
    else if (a === '--src-lang')    { opts.srcLang = args[++i]; }
    else if (a === '--force')       { opts.force  = true; }
    else if (a === '--json')        { opts.json   = true; }
    else if (a === '--long')        { opts.timeout_scale = 3; }
    else if (a === '--ultra-long')  { opts.timeout_scale = 6; }
    else if (a === '--timeout-scale') {
      const n = Number(args[++i]);
      if (Number.isFinite(n) && n > 0) opts.timeout_scale = n;
    }
    else if (a === '--work-root')   { opts.workRoot = args[++i]; }
    else if (!opts.url && a.startsWith('http')) { opts.url = a; }
    else if (!opts.filePath && (a.startsWith('/') || a.startsWith('./') || a.startsWith('../'))) {
      opts.filePath = a;
    }
    i++;
  }
  return opts;
}

async function askFocus() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('? 你想了解这个视频的哪些方面？> ', answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function poll(taskId, startedAt) {
  const INTERVAL = 2000;
  const stepStatus = {};
  const stepProgress = {};   // last-printed progress JSON key per step
  let titleShown = false;

  while (true) {
    await new Promise(r => setTimeout(r, INTERVAL));
    let task;
    try { task = await client.getTask(taskId); }
    catch (err) { throw new Error(`poll failed: ${err.message}`); }

    const status = task.status;
    const steps  = task.steps || {};
    const title  = (task.meta && task.meta.title) || '';

    if (fmt.isTTY) {
      fmt.renderProgress(title || taskId, steps);
    } else {
      if (!titleShown && title) {
        process.stdout.write(`Title: ${title}\n`);
        titleShown = true;
      }

      for (const [name, info] of Object.entries(steps)) {
        if (!info) continue;

        // Status change line
        if (stepStatus[name] !== info.status) {
          stepStatus[name] = info.status;
          let elapsedS = null;
          if (info.started_at && info.completed_at) {
            elapsedS = Math.round(
              (new Date(info.completed_at) - new Date(info.started_at)) / 1000
            );
          }
          fmt.logStepLine(name, info.status, elapsedS);
        }

        // Progress line for running steps
        if (info.status === 'running' && info.progress) {
          const progKey = JSON.stringify(info.progress);
          if (stepProgress[name] !== progKey) {
            stepProgress[name] = progKey;
            const elapsedS = info.started_at
              ? Math.round((Date.now() - new Date(info.started_at)) / 1000)
              : null;
            fmt.logProgressLine(name, info.progress, elapsedS);
          }
        }
      }
    }

    if (status === 'done' || status === 'completed') {
      return { elapsed: Math.round((Date.now() - startedAt) / 1000), task };
    }

    if (status === 'failed') {
      const entries = Object.entries(steps);
      const failedEntry = entries.find(([, s]) => s && s.status === 'failed');
      const stepName = failedEntry ? fmt.displayName(failedEntry[0]) : 'unknown';
      const errMsg = failedEntry && failedEntry[1].error ? failedEntry[1].error : '';
      throw new Error(`Step ${stepName} failed${errMsg ? ': ' + errMsg : ''}`);
    }
  }
}

async function run(args) {
  const opts = parseArgs(args);

  if (!opts.url && !opts.filePath) {
    fmt.printError('URL or local file required. Usage: vdl <url|file> [options]');
    process.exit(1);
  }

  if (opts.workRoot) process.env.WORK_ROOT = opts.workRoot;

  if (!opts.focus) opts.focus = await askFocus();

  // ── Local file path ──────────────────────────────────────────────────────
  if (opts.filePath) {
    const { ingestLocalFile } = require('../lib/ingest');
    let taskId;
    try {
      taskId = await ingestLocalFile(opts.filePath, {
        focus: opts.focus,
        srcLang: opts.srcLang,
        outputLang: opts.lang,
        mode: opts.modeExplicit ? opts.mode : null,
        timeoutScale: opts.timeout_scale,
      });
    } catch (err) {
      fmt.printError(err.message);
      process.exit(1);
    }

    process.stdout.write(`Task: ${taskId}\n`);

    const token = await server.ensureServer();
    server.registerShutdown();
    client.init('http://127.0.0.1:3000', token);

    const r = await client.runStep(taskId, 'asr', { reset_scope: 'downstream' });
    if (r && r.status === 409) {
      fmt.printError('Task is currently running. Wait for it to finish.');
      process.exit(1);
    }

    const startedAt = Date.now();
    const { elapsed } = await poll(taskId, startedAt);

    const workDir = path.join(getWorkRoot(path.resolve(__dirname, '../..')), taskId);
    const paths = {
      transcript: `${workDir}/transcript/original.md`,
      article:    `${workDir}/writing/article.md`,
      summary:    `${workDir}/writing/summary.md`,
    };
    if (opts.json) {
      process.stdout.write(JSON.stringify({ task_id: taskId, elapsed, ...paths }) + '\n');
    } else {
      fmt.printDone(elapsed, paths);
    }
    return;
  }

  // ── YouTube / remote URL ─────────────────────────────────────────────────
  const token = await server.ensureServer();
  server.registerShutdown();
  client.init('http://127.0.0.1:3000', token);

  const taskId = await client.createTask({
    url: opts.url,
    focus: opts.focus,
    mode: opts.mode,
    output_lang: opts.lang,
    force: opts.force,
    timeout_scale: opts.timeout_scale,
  });

  process.stdout.write(`Task: ${taskId}\n`);

  const startedAt = Date.now();
  const { elapsed } = await poll(taskId, startedAt);

  const workDir = path.join(getWorkRoot(path.resolve(__dirname, '../..')), taskId);
  const paths = {
    transcript: `${workDir}/transcript/original.md`,
    article:    `${workDir}/writing/article.md`,
    summary:    `${workDir}/writing/summary.md`,
  };
  if (opts.json) {
    process.stdout.write(JSON.stringify({ task_id: taskId, elapsed, ...paths }) + '\n');
  } else {
    fmt.printDone(elapsed, paths);
  }
}

module.exports = { run, parseArgs };
