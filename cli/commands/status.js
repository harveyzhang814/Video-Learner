// cli/commands/status.js
'use strict';
const server = require('../lib/server');
const client = require('../lib/client');
const fmt = require('../lib/format');

async function run(args) {
  const taskId = args[0];
  if (!taskId) { fmt.printError('Usage: vdl status <task_id>'); process.exit(1); }

  const token = await server.ensureServer();
  server.registerShutdown();
  client.init('http://127.0.0.1:3000', token);

  const task = await client.getTask(taskId);
  const steps = task.steps || {};

  process.stdout.write(`Task:   ${task.task_id || taskId}\n`);
  process.stdout.write(`Status: ${task.status}\n`);
  if (task.meta && task.meta.title) {
    process.stdout.write(`Title:  ${task.meta.title}\n`);
  }
  process.stdout.write('\nSteps:\n');
  for (const [name, info] of Object.entries(steps)) {
    if (!info) continue;
    const icon = fmt.statusIcon(info.status);
    const label = fmt.displayName(name).padEnd(22);
    const err = info.status === 'failed' && info.error ? `  ${info.error}` : '';
    process.stdout.write(`  ${icon} ${label} ${info.status}${err}\n`);
  }
}

module.exports = { run };
