'use strict';

const http = require('http');
const { createApp } = require('../services/http-server');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const app = createApp();
  const server = http.createServer(app.callback());

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log(`[test] server started on ${base}`);

  // Helper for JSON requests
  async function jsonRequest(path, options = {}) {
    const res = await fetch(base + path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      throw new Error(`Invalid JSON response from ${path}: ${text}`);
    }
    return { status: res.status, body };
  }

  // 1) Create task
  console.log('[test] creating task...');
  const createRes = await jsonRequest('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      focus: 'agent http test',
      mode: 'transcript',
      force: 1,
      output_lang: 'zh-CN'
    })
  });

  if (createRes.status !== 201) {
    console.error('[test] create task failed:', createRes);
    throw new Error('create task did not return 201');
  }

  const taskId = createRes.body.task_id;
  if (!taskId) {
    throw new Error('create task response missing task_id');
  }
  console.log('[test] task created:', taskId);

  // 2) Poll status a few times to ensure API is responsive
  for (let i = 0; i < 5; i++) {
    await sleep(5000);
    const statusRes = await jsonRequest(`/api/tasks/${taskId}`);
    if (statusRes.status !== 200) {
      throw new Error(`get task failed with status ${statusRes.status}`);
    }
    if (!statusRes.body || !statusRes.body.meta) {
      throw new Error('get task response missing meta');
    }
    console.log(`[test] poll #${i + 1}: status=${statusRes.body.status}`);
  }

  // 3) Get steps list
  const stepsRes = await jsonRequest(`/api/tasks/${taskId}/steps`);
  if (stepsRes.status !== 200 || !Array.isArray(stepsRes.body) || stepsRes.body.length === 0) {
    throw new Error('steps API did not return a non-empty array');
  }
  console.log('[test] steps count:', stepsRes.body.length);

  // 4) Try re-running summary step with a new focus (even if it fails, API should respond)
  const runStepRes = await jsonRequest(`/api/tasks/${taskId}/steps/summary/run`, {
    method: 'POST',
    body: JSON.stringify({ focus: '只关注行动项和实践建议', force: true })
  });
  if (![202, 400].includes(runStepRes.status)) {
    throw new Error(`run summary step returned unexpected status ${runStepRes.status}`);
  }
  console.log('[test] summary step run status:', runStepRes.status, runStepRes.body);

  // 5) Get result shape
  const resultRes = await jsonRequest(`/api/tasks/${taskId}/result`);
  if (resultRes.status !== 200 || !resultRes.body.outputs) {
    throw new Error('result API missing outputs');
  }
  console.log('[test] result outputs:', resultRes.body.outputs);

  server.close();
  console.log('[test] agent-http.test.js completed successfully');
}

run().catch((err) => {
  console.error('[test] agent-http.test.js failed:', err);
  process.exit(1);
});

