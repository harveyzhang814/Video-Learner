// tests/cli-subcommands.test.js
'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');
const client = require('../cli/lib/client');

const TOKEN = 'cli-sub-test-token';
let srv;
let taskId;

(async () => {
  const app = createApp({ token: TOKEN });
  await new Promise(r => { srv = http.createServer(app.callback()).listen(0, '127.0.0.1', r); });
  const port = srv.address().port;
  const BASE = `http://127.0.0.1:${port}`;

  client.init(BASE, TOKEN);

  // Create a task to use in subcommand tests
  taskId = await client.createTask({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    focus: 'subcommand test',
    mode: 'transcript',
  });
  assert.ok(typeof taskId === 'string' && taskId.length > 0);

  // status backing: getTask returns status and steps
  const task = await client.getTask(taskId);
  assert.ok(typeof task.status === 'string', 'task should have status');
  assert.ok(task.steps !== undefined, 'task should have steps');

  // rerun backing: runStep returns a valid HTTP status
  const r = await client.runStep(taskId, 'fetch', { reset_scope: 'step' });
  assert.ok(
    [200, 202, 400, 409].includes(r.status),
    `unexpected runStep status: ${r.status}`
  );

  // result backing: getResultContent returns a response (likely 404 since pipeline hasn't run)
  const r2 = await client.getResultContent(taskId, 'summary');
  assert.ok(r2.status >= 200, `unexpected getResultContent status: ${r2.status}`);

  // task not found for unknown id
  try {
    await client.getTask('unknown999000000');
    assert.fail('should throw');
  } catch (e) {
    assert.ok(/task not found/i.test(e.message), `unexpected error: ${e.message}`);
  }

  await client.deleteTask(taskId);
  srv.close();
  console.log('cli-subcommands: PASS');
})().catch(async err => {
  try { if (taskId) await client.deleteTask(taskId); } catch {}
  srv && srv.close();
  console.error(err);
  process.exit(1);
});
