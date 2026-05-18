'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');
const client = require('../cli/lib/client');

const TOKEN = 'cli-client-test-token';
let server;
let taskId;

(async () => {
  const app = createApp({ token: TOKEN });
  await new Promise(r => { server = http.createServer(app.callback()).listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;

  client.init(BASE, TOKEN);

  // createTask — checks HTTP layer returns a task_id string
  taskId = await client.createTask({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    focus: 'cli client test',
    mode: 'transcript',
  });
  assert.ok(typeof taskId === 'string' && taskId.length > 0, `expected task_id string, got ${taskId}`);

  // getTask — task was just created, should exist with a status
  const task = await client.getTask(taskId);
  assert.ok(task.task_id || task.id, 'task should have an id');
  assert.ok(typeof task.status === 'string', 'task should have status');

  // getTask throws on unknown id
  try {
    await client.getTask('notfound000000');
    assert.fail('should throw');
  } catch (err) {
    assert.ok(/task not found/i.test(err.message), `unexpected error: ${err.message}`);
  }

  await client.deleteTask(taskId);
  server.close();
  console.log('cli-client: PASS');
  process.exit(0);
})().catch(async err => {
  try { if (taskId) await client.deleteTask(taskId); } catch {}
  server && server.close();
  console.error(err);
  process.exit(1);
});
