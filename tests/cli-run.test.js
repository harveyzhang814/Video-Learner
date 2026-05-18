// tests/cli-run.test.js
'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');
const client = require('../cli/lib/client');

const TOKEN = 'cli-run-test-token';
let srv;
let taskId;

(async () => {
  const app = createApp({ token: TOKEN });
  await new Promise(r => { srv = http.createServer(app.callback()).listen(0, '127.0.0.1', r); });
  const port = srv.address().port;
  const BASE = `http://127.0.0.1:${port}`;

  client.init(BASE, TOKEN);

  // createTask — checks HTTP layer returns a task_id string
  taskId = await client.createTask({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    focus: 'cli run test',
    mode: 'transcript',
  });
  assert.ok(typeof taskId === 'string' && taskId.length > 0, `expected task_id string, got ${taskId}`);

  // getTask — task was just created, should exist with a status
  const task = await client.getTask(taskId);
  assert.ok(task.task_id || task.id, 'task should have an id');
  assert.ok(typeof task.status === 'string', 'task should have status');
  assert.ok(task.steps !== undefined, 'task should have steps');

  // getTask throws on unknown id
  try {
    await client.getTask('notexist000000');
    assert.fail('should throw');
  } catch (e) {
    assert.ok(/task not found/i.test(e.message), `unexpected error: ${e.message}`);
  }

  await client.deleteTask(taskId);
  srv.close();
  console.log('cli-run: PASS');
})().catch(async err => {
  try { if (taskId) await client.deleteTask(taskId); } catch {}
  srv && srv.close();
  console.error(err);
  process.exit(1);
});
