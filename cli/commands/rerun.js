'use strict';
const server = require('../lib/server');
const client = require('../lib/client');
const fmt = require('../lib/format');

const RESET_MAP = { downstream: 'downstream', step: 'step', off: 'off' };

async function pollUntilDone(taskId, startedAt) {
  const INTERVAL = 2000;
  const stepStatus = {};
  while (true) {
    await new Promise(r => setTimeout(r, INTERVAL));
    const task = await client.getTask(taskId);
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

    if (task.status === 'done') {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      process.stdout.write(`\nDone in ${elapsed}s\n`);
      return;
    }
    if (task.status === 'failed') {
      const failedEntry = Object.entries(steps).find(([, s]) => s && s.status === 'failed');
      const name = failedEntry ? fmt.displayName(failedEntry[0]) : 'unknown';
      throw new Error(`Step ${name} failed`);
    }
  }
}

async function run(args) {
  let taskId = null;
  let stepName = null;
  let reset = 'downstream';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reset') { reset = args[++i]; }
    else if (!taskId) { taskId = args[i]; }
    else if (!stepName) { stepName = args[i]; }
  }

  if (!taskId || !stepName) {
    fmt.printError('Usage: vdl rerun <task_id> <step> [--reset downstream|step|off]');
    process.exit(1);
  }
  if (!RESET_MAP[reset]) {
    fmt.printError(`--reset must be downstream, step, or off`);
    process.exit(1);
  }

  const token = await server.ensureServer();
  server.registerShutdown();
  client.init('http://127.0.0.1:3000', token);

  const r = await client.runStep(taskId, stepName, { reset_scope: RESET_MAP[reset] });

  if (r.status === 400) {
    fmt.printError(r.body?.error?.message || r.body?.error || 'Invalid step or mode');
    process.exit(1);
  }
  if (r.status === 409) {
    fmt.printError('Task is currently running. Wait for it to finish first.');
    process.exit(1);
  }

  process.stdout.write(`Rerunning from ${stepName} (reset=${reset})...\n`);
  await pollUntilDone(taskId, Date.now());
}

module.exports = { run };
