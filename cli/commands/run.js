// cli/commands/run.js
'use strict';
const readline = require('readline');
const path = require('path');
const server = require('../lib/server');
const client = require('../lib/client');
const fmt = require('../lib/format');

function parseArgs(args) {
  const opts = {
    url: null, focus: '', mode: 'media', lang: 'zh-CN',
    force: false, json: false, timeout_scale: 1,
  };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--focus')            { opts.focus  = args[++i]; }
    else if (a === '--mode')        { opts.mode   = args[++i]; }
    else if (a === '--lang')        { opts.lang   = args[++i]; }
    else if (a === '--force')       { opts.force  = true; }
    else if (a === '--json')        { opts.json   = true; }
    else if (a === '--long')        { opts.timeout_scale = 3; }   // ×3 all step timeouts
    else if (a === '--ultra-long')  { opts.timeout_scale = 6; }   // ×6 all step timeouts
    else if (a === '--timeout-scale') {
      const n = Number(args[++i]);
      if (Number.isFinite(n) && n > 0) opts.timeout_scale = n;
    }
    else if (!opts.url && a.startsWith('http')) { opts.url = a; }
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

  while (true) {
    await new Promise(r => setTimeout(r, INTERVAL));
    let task;
    try { task = await client.getTask(taskId); }
    catch (err) { throw new Error(`poll failed: ${err.message}`); }

    const status = task.status;
    const steps = task.steps || {};
    const title = (task.meta && task.meta.title) || taskId;

    if (fmt.isTTY) {
      fmt.renderProgress(title, steps);
    } else {
      for (const [name, info] of Object.entries(steps)) {
        if (!info) continue;
        const prev = stepStatus[name];
        if (prev !== info.status) {
          stepStatus[name] = info.status;
          fmt.logStepLine(name, info.status);
        }
      }
    }

    if (status === 'done') {
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
  if (!opts.url) { fmt.printError('URL required. Usage: vdl <url> [options]'); process.exit(1); }

  if (!opts.focus) {
    opts.focus = await askFocus();
  }

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

  const workDir = path.resolve(__dirname, '../../work', taskId);
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
