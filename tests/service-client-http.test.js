'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { createApp } = require('../services/http-server');

async function run() {
  const token = 'test-gui-client-token';
  const app = createApp({ token });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const modulePath = pathToFileURL(path.join(__dirname, '..', 'electron', 'src', 'renderer', 'service-client.js')).href;
  const { ServiceClient } = await import(modulePath);

  try {
    // R1: init
    const client = new ServiceClient({ baseUrl, token });
    assert.strictEqual(client.baseUrl, baseUrl);
    assert.strictEqual(client.token, token);
    console.log('R1: ok');

    // R2: listTasks (may be empty)
    const list = await client.listTasks({ limit: 10 });
    assert.ok(Array.isArray(list));
    console.log('R2: ok');

    // R3: createTask
    const created = await client.createTask({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      focus: 'gui http test',
      mode: 'transcript',
      force: false,
      output_lang: 'zh-CN'
    });
    assert.ok(created && created.task_id);
    assert.ok(created.meta && created.meta.url);
    const taskId = created.task_id;
    console.log('R3: ok');

    // listTasks again (may or may not include new task immediately depending on impl)
    const listAfter = await client.listTasks({ limit: 10 });
    assert.ok(Array.isArray(listAfter));
    assert.ok(listAfter.length >= 0);
    console.log('R2 (after create): ok');

    // R4: getTask (steps may be object keyed by step name or array depending on API)
    const task = await client.getTask(taskId);
    assert.strictEqual(task.task_id, taskId);
    assert.ok(task.meta && typeof task.meta.url === 'string');
    assert.ok(task.steps && typeof task.steps === 'object');
    const stepEntries = Array.isArray(task.steps) ? task.steps : Object.entries(task.steps || {}).map(([name, s]) => ({ name, ...s }));
    assert.ok(stepEntries.length >= 1);
    console.log('R4: ok');

    console.log('service-client-http.test.js: all passed');
  } finally {
    server.close();
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
