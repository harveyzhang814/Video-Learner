'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const orchestrator = require('../core/orchestrator');
const { createApp } = require('../services/http-server');

const STUB_SCRIPT = `#!/usr/bin/env bash
sleep 30
exit 0
`;

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-abort-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
  // Write stub fetch_info.sh that sleeps so we can abort it.
  const stubPath = path.join(dir, 'scripts', 'fetch_info.sh');
  fs.writeFileSync(stubPath, STUB_SCRIPT);
  fs.chmodSync(stubPath, '755');
  return dir;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntil(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(100);
  }
  throw new Error('pollUntil timed out');
}

async function run() {
  // ── Test 1: abortTask resets running task to pending ──
  {
    const rootDir = makeTempDir();
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        focus: 'abort-test',
        mode: 'transcript',
        force: 1,
        rootDir
      });

      // Fire pipeline in background (fetch_info.sh will sleep 30s).
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      // Wait until task is running.
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });
      console.log('[abort-test] task is running, aborting...');

      const result = await orchestrator.abortTask(task_id, { rootDir });

      if (result.status !== 'pending') {
        throw new Error(`expected pending after abort, got ${result.status}`);
      }

      const taskAfter = await orchestrator.getTask(task_id, { rootDir });
      if (taskAfter.status !== 'pending') {
        throw new Error(`task.status should be pending after abort, got ${taskAfter.status}`);
      }

      // Verify no step is stuck in 'running'.
      const steps = taskAfter.steps;
      for (const [name, info] of Object.entries(steps)) {
        if (info.status === 'running') {
          throw new Error(`step ${name} still running after abort`);
        }
      }

      console.log('[abort-test] Test 1 passed: abortTask resets to pending');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 2: abortTask on non-running task returns 409 via HTTP ──
  {
    const rootDir = makeTempDir();
    const token = 'abort-test-token';
    const app = createApp({ token, rootDir });
    const server = http.createServer(app.callback());
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=test409',
        mode: 'transcript',
        rootDir
      });

      // Task is pending (not running) — cancel should 409.
      const res = await fetch(`${base}/api/tasks/${task_id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status !== 409) {
        throw new Error(`expected 409 for non-running task, got ${res.status}`);
      }
      console.log('[abort-test] Test 2 passed: cancel non-running task returns 409');

      // Cancel unknown task should 404.
      const res2 = await fetch(`${base}/api/tasks/nonexistent-id/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res2.status !== 404) {
        throw new Error(`expected 404 for unknown task, got ${res2.status}`);
      }
      console.log('[abort-test] Test 3 passed: cancel unknown task returns 404');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  console.log('[abort-test] All tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('[abort-test] FAILED:', err.message);
  process.exit(1);
});
