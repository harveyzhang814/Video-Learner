// cli/commands/result.js
'use strict';
const server = require('../lib/server');
const client = require('../lib/client');
const fmt = require('../lib/format');

async function run(args) {
  let taskId = null;
  let type = 'summary';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type') { type = args[++i]; }
    else if (!taskId) { taskId = args[i]; }
  }
  if (!taskId) { fmt.printError('Usage: vdl result <task_id> [--type summary|article]'); process.exit(1); }
  if (type !== 'summary' && type !== 'article') {
    fmt.printError('--type must be summary or article');
    process.exit(1);
  }

  const token = await server.ensureServer();
  server.registerShutdown();
  client.init('http://127.0.0.1:3000', token);

  const r = await client.getResultContent(taskId, type);
  if (r.status === 404) { fmt.printError(`No ${type} found for task ${taskId}`); process.exit(1); }
  if (r.status !== 200) { fmt.printError(`HTTP ${r.status}`); process.exit(1); }
  process.stdout.write(r.body);
}

module.exports = { run };
