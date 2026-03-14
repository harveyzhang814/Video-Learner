'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { createApp } = require('../services/http-server');
const { reduceTaskState } = require('../electron/src/renderer/client-state');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  // ----- Pure reduceTaskState unit tests -----
  let state = {};
  state = reduceTaskState(state, { type: 'task.created', taskId: 't1', payload: { status: 'running' } });
  assert.ok(state.tasks && state.tasks.t1);
  state = reduceTaskState(state, { type: 'step.started', taskId: 't1', payload: { stepName: 'fetch' } });
  assert.strictEqual(state.tasks.t1.steps.fetch.status, 'running');
  state = reduceTaskState(state, { type: 'step.finished', taskId: 't1', payload: { stepName: 'fetch' } });
  assert.strictEqual(state.tasks.t1.steps.fetch.status, 'completed');
  state = reduceTaskState(state, { type: 'stream.resync_required' });
  assert.strictEqual(state.needsResync, true);
  console.log('reduceTaskState (step flow + resync): ok');

  state = {};
  state = reduceTaskState(state, { type: 'task.created', taskId: 't2', payload: {} });
  state = reduceTaskState(state, { type: 'log.appended', taskId: 't2', payload: { seq: 1, line: 'first' } });
  state = reduceTaskState(state, { type: 'log.appended', taskId: 't2', payload: { seq: 2, line: 'second' } });
  state = reduceTaskState(state, { type: 'log.appended', taskId: 't2', payload: { seq: 1, line: 'dup' } });
  assert.strictEqual(state.tasks.t2.logs.length, 2);
  assert.strictEqual(state.tasks.t2.logs[0].line, 'first');
  assert.strictEqual(state.tasks.t2.logs[1].line, 'second');
  console.log('reduceTaskState (logs dedup by seq): ok');

  // ----- Real SSE (R5): connect, create task, collect events -----
  const token = 'test-sse-token';
  const app = createApp({ token });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const sseFrames = [];
  const sseReq = http.get(`${baseUrl}/api/events?token=${token}`, (res) => {
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const p of parts) {
        if (p.trim()) sseFrames.push(p);
      }
    });
  });
  sseReq.on('error', (e) => {
    console.error('SSE error:', e);
  });

  await sleep(800);
  const hasConnected = sseFrames.some((f) => f.startsWith(': connected'));
  assert.ok(hasConnected, 'should receive : connected');
  console.log('R5 (connected): ok');

  const createRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      focus: 'sse test',
      mode: 'transcript',
      force: false,
      output_lang: 'zh-CN'
    })
  });
  assert.strictEqual(createRes.status, 201);
  const createBody = await createRes.json();
  const taskId = createBody.task_id;
  assert.ok(taskId);

  await sleep(2500);
  const joined = sseFrames.join('\n\n');
  const hasTaskEvent = /event:\s*(task\.created|task\.updated)/.test(joined);
  assert.ok(hasTaskEvent, 'should receive task.created or task.updated');

  let sseState = {};
  for (const frame of sseFrames) {
    const eventMatch = frame.match(/event:\s*(\S+)/);
    const dataMatch = frame.match(/data:\s*(.+)/);
    if (eventMatch && dataMatch) {
      const type = eventMatch[1];
      let data = {};
      try {
        data = JSON.parse(dataMatch[1].replace(/\\n/g, '\n'));
      } catch (_) {
        data = {};
      }
      const taskIdFromData = data.taskId || (data.payload && data.payload.taskId);
      const payload = data.payload || data;
      sseState = reduceTaskState(sseState, { type, taskId: taskIdFromData, payload });
    }
  }
  assert.ok(sseState.tasks && sseState.tasks[taskId], 'state should contain task');
  console.log('R5 (events + state): ok');

  sseReq.destroy();
  server.close();
  console.log('service-client-sse.test.js: all passed');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
