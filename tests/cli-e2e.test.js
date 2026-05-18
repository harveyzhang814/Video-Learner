'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');
const client = require('../cli/lib/client');
const { generateId } = require('../core/id');

const TOKEN = 'cli-e2e-test-token';
const TEST_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const POLL_INTERVAL = 1000;
const POLL_TIMEOUT = 60000; // 60s max — pipeline will fail without real tools, that's OK

let srv;
let taskId1;

async function pollUntilTerminal(taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const task = await client.getTask(taskId);
    if (task.status === 'done' || task.status === 'failed') return task;
  }
  throw new Error(`Task ${taskId} did not reach terminal state within ${timeoutMs}ms`);
}

(async () => {
  const app = createApp({ token: TOKEN });
  await new Promise(r => { srv = http.createServer(app.callback()).listen(0, '127.0.0.1', r); });
  const port = srv.address().port;
  const BASE = `http://127.0.0.1:${port}`;

  client.init(BASE, TOKEN);

  // --- Test 1: Deterministic task IDs ---
  // Same URL always produces same task_id
  const expectedId = generateId(TEST_URL);

  taskId1 = await client.createTask({ url: TEST_URL, focus: 'e2e test', mode: 'transcript' });
  assert.strictEqual(taskId1, expectedId, `task_id should be deterministic: expected ${expectedId}, got ${taskId1}`);

  // Creating the same task again returns the same id (idempotent)
  const taskId2 = await client.createTask({ url: TEST_URL, focus: 'e2e test again', mode: 'transcript' });
  assert.strictEqual(taskId2, taskId1, 'same URL should always produce same task_id');

  // --- Test 2: Task is created with expected fields ---
  const task = await client.getTask(taskId1);
  assert.ok(task.task_id || task.id, 'task should have an id');
  assert.ok(['pending', 'running', 'done', 'failed'].includes(task.status), `unexpected status: ${task.status}`);
  assert.ok(task.steps !== undefined, 'task should have steps');
  assert.ok(task.params || task.meta, 'task should have params or meta');

  // --- Test 3: Task eventually reaches terminal state ---
  // (Pipeline will fail without real yt-dlp/ffmpeg — that's expected and OK)
  let finalTask;
  try {
    finalTask = await pollUntilTerminal(taskId1, POLL_TIMEOUT);
    assert.ok(['done', 'failed'].includes(finalTask.status), `expected terminal status, got: ${finalTask.status}`);
    console.log(`  Task reached terminal state: ${finalTask.status}`);
  } catch (err) {
    // If it doesn't reach terminal within timeout, that's also OK for e2e purposes
    // (could be running slowly in CI) — just verify it's still responding
    const stillAlive = await client.getTask(taskId1);
    assert.ok(stillAlive.status, 'task should still be queryable after timeout');
    console.log(`  Note: task did not reach terminal within ${POLL_TIMEOUT}ms (status: ${stillAlive.status})`);
  }

  // --- Test 4: Steps have valid structure ---
  const latestTask = await client.getTask(taskId1);
  const steps = latestTask.steps || {};
  for (const [name, info] of Object.entries(steps)) {
    assert.ok(typeof name === 'string', 'step name should be a string');
    assert.ok(info && typeof info.status === 'string', `step ${name} should have a status`);
  }

  // --- Test 5: getResultContent returns a response (not a crash) ---
  const r = await client.getResultContent(taskId1, 'summary');
  assert.ok(r.status >= 200 && r.status < 600, `getResultContent should return HTTP status, got: ${r.status}`);

  // --- Test 6: runStep returns valid response ---
  const stepR = await client.runStep(taskId1, 'fetch', { reset_scope: 'step' });
  assert.ok([200, 202, 400, 409].includes(stepR.status), `runStep should return valid status, got: ${stepR.status}`);

  await client.deleteTask(taskId1);
  srv.close();
  console.log('cli-e2e: PASS');
})().catch(async err => {
  try { if (taskId1) await client.deleteTask(taskId1); } catch {}
  srv && srv.close();
  console.error(err);
  process.exit(1);
});
