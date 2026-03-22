'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../services/http-server');
const { createDb } = require('../core/orchestrator/db');
const orchestrator = require('../core/orchestrator');

async function jsonRequest(base, reqPath, options = {}) {
  const res = await fetch(base + reqPath, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error(`Invalid JSON from ${reqPath}: ${text}`);
  }
  return { status: res.status, body };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-rscope-http-'));
  const app = createApp({ rootDir: tmp });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const { task_id: taskId } = await orchestrator.createTask({
      url: 'https://example.com/watch?v=rscope-http',
      focus: '',
      mode: 'transcript',
      force: 0,
      output_lang: 'zh-CN',
      rootDir: tmp
    });
    const id = taskId;

    const bad = await jsonRequest(base, `/api/tasks/${id}/steps/fetch/run`, {
      method: 'POST',
      body: JSON.stringify({ reset_scope: 'bogus' })
    });
    assert.strictEqual(bad.status, 400);
    assert.ok(String(bad.body.error || '').includes('reset_scope'));

    const db = createDb(tmp);
    for (const s of orchestrator.STEPS) {
      db.writeStepState(id, s, { status: 'completed', attempts: 1, error: null });
    }
    orchestrator._dropTaskFromMemory(id);

    const down = await jsonRequest(base, `/api/tasks/${id}/steps/article/run`, {
      method: 'POST',
      body: JSON.stringify({ reset_scope: 'downstream' })
    });
    assert.strictEqual(down.status, 202);
    assert.strictEqual(down.body.accepted, true);
    assert.strictEqual(down.body.reset_scope, 'downstream');
    assert.ok(Array.isArray(down.body.reset_steps));
    assert.ok(down.body.reset_steps.includes('article'));
    assert.ok(down.body.reset_steps.includes('summary'));

    console.log('reset-scope-http.test.js: PASS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      // ignore
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
