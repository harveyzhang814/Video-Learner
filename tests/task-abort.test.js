'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const orchestrator = require('../core/orchestrator');
const { createApp } = require('../services/http-server');

const SLEEP_SCRIPT = `#!/usr/bin/env bash
sleep 30
exit 0
`;

const EXIT0_SCRIPT = `#!/usr/bin/env bash
exit 0
`;

// All step scripts needed by the orchestrator.
const DEFAULT_STUBS = {
  'fetch_info.sh':       SLEEP_SCRIPT,
  'download_video.sh':   EXIT0_SCRIPT,
  'download_audio.sh':   EXIT0_SCRIPT,
  'download_subs.sh':    EXIT0_SCRIPT,
  'asr_transcribe.sh':   EXIT0_SCRIPT,
  'convert_vtt_md.sh':   EXIT0_SCRIPT,
  'convert_md_vtt.sh':   EXIT0_SCRIPT,
  'generate_article.sh': EXIT0_SCRIPT,
  'generate_summary.sh': EXIT0_SCRIPT,
};

/**
 * Create a temp rootDir with stub scripts.
 * @param {Object} overrides  script-filename → content; merged over DEFAULT_STUBS
 */
function makeTempDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-abort-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });

  const scripts = Object.assign({}, DEFAULT_STUBS, overrides);
  for (const [name, content] of Object.entries(scripts)) {
    const p = path.join(dir, 'scripts', name);
    fs.writeFileSync(p, content);
    fs.chmodSync(p, '755');
  }
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

async function startServer(rootDir, token) {
  const app = createApp({ token, rootDir });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function safeAbort(task_id, rootDir) {
  try {
    const t = await orchestrator.getTask(task_id, { rootDir });
    if (t && t.status === 'running') await orchestrator.abortTask(task_id, { rootDir });
  } catch (_) {}
}

async function run() {
  // ── Test 1: abortTask resets running task to pending ──────────────────────
  {
    const rootDir = makeTempDir(); // fetch_info.sh sleeps 30
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        focus: 'abort-test',
        mode: 'transcript',
        force: 1,
        rootDir
      });

      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      const result = await orchestrator.abortTask(task_id, { rootDir });
      if (result.status !== 'aborted') throw new Error(`expected aborted, got ${result.status}`);

      const taskAfter = await orchestrator.getTask(task_id, { rootDir });
      if (taskAfter.status !== 'aborted') {
        throw new Error(`task.status should be aborted, got ${taskAfter.status}`);
      }
      for (const [name, info] of Object.entries(taskAfter.steps)) {
        if (info.status === 'running') throw new Error(`step ${name} still running after abort`);
      }

      console.log('[abort-test] Test 1 passed: abortTask sets status to aborted');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 2 & 3: HTTP task cancel error responses ──────────────────────────
  {
    const rootDir = makeTempDir();
    const token = 'test-token-23';
    const { server, base } = await startServer(rootDir, token);
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=test2',
        mode: 'transcript',
        rootDir
      });

      const res = await fetch(`${base}/api/tasks/${task_id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
      console.log('[abort-test] Test 2 passed: cancel non-running task returns 409');

      const res2 = await fetch(`${base}/api/tasks/nonexistent-id/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res2.status !== 404) throw new Error(`expected 404, got ${res2.status}`);
      console.log('[abort-test] Test 3 passed: cancel unknown task returns 404');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 4: abortStep resets step to pending; task keeps running ──────────
  {
    const rootDir = makeTempDir(); // fetch_info.sh sleeps 30
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=stepabort1',
        mode: 'transcript',
        force: 1,
        rootDir
      }));

      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.steps && t.steps.fetch && t.steps.fetch.status === 'running' ? t : null;
      });

      const result = await orchestrator.abortStep(task_id, 'fetch', { rootDir });
      if (result.status !== 'pending') throw new Error(`expected pending, got ${result.status}`);
      if (result.step !== 'fetch') throw new Error(`expected step=fetch, got ${result.step}`);

      // abortStep return value confirms the step was reset to pending.
      // Do not re-check step status via getTask — the DAG retries fetch
      // immediately, so it may already be 'running' by the time we query.
      const snap = await orchestrator.getTask(task_id, { rootDir });
      // Task must still be alive: _abortFlag was not set, DAG retried fetch.
      if (snap.status !== 'running') {
        throw new Error(`task should still be running after step abort, got ${snap.status}`);
      }

      console.log('[abort-test] Test 4 passed: abortStep resets step to pending, task keeps running');
    } finally {
      if (task_id) await safeAbort(task_id, rootDir);
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 5: abortStep on non-running step → STEP_NOT_RUNNING ─────────────
  {
    const rootDir = makeTempDir();
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=stepabort2',
        mode: 'transcript',
        rootDir
      });

      let threw = false;
      try {
        await orchestrator.abortStep(task_id, 'fetch', { rootDir });
      } catch (e) {
        if (e.code !== 'STEP_NOT_RUNNING') throw e;
        threw = true;
      }
      if (!threw) throw new Error('expected STEP_NOT_RUNNING error to be thrown');

      console.log('[abort-test] Test 5 passed: abortStep on non-running step throws STEP_NOT_RUNNING');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 6: HTTP step cancel - running step → 200 ────────────────────────
  {
    const rootDir = makeTempDir(); // fetch_info.sh sleeps 30
    const token = 'test-token-6';
    const { server, base } = await startServer(rootDir, token);
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=stephttp1',
        mode: 'transcript',
        force: 1,
        rootDir
      }));

      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.steps && t.steps.fetch && t.steps.fetch.status === 'running' ? t : null;
      });

      const res = await fetch(`${base}/api/tasks/${task_id}/steps/fetch/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      const body = await res.json();
      if (body.status !== 'pending') throw new Error(`expected status=pending, got ${body.status}`);
      if (body.step !== 'fetch') throw new Error(`expected step=fetch, got ${body.step}`);

      console.log('[abort-test] Test 6 passed: HTTP step cancel returns 200 with pending status');
    } finally {
      if (task_id) await safeAbort(task_id, rootDir);
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 7: HTTP step cancel - non-running step → 409 ────────────────────
  {
    const rootDir = makeTempDir();
    const token = 'test-token-7';
    const { server, base } = await startServer(rootDir, token);
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=stephttp2',
        mode: 'transcript',
        rootDir
      });

      const res = await fetch(`${base}/api/tasks/${task_id}/steps/fetch/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
      const body = await res.json();
      if (body.code !== 'STEP_NOT_RUNNING') {
        throw new Error(`expected code=STEP_NOT_RUNNING, got ${body.code}`);
      }

      console.log('[abort-test] Test 7 passed: HTTP step cancel non-running step returns 409');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 8: article.md deleted when article step is aborted ──────────────
  //
  // Pipeline (transcript mode): fetch → subs → vtt2md → article(sleep) → …
  // fetch and subs exit 0 instantly; vtt2md requires a pre-existing .vtt file
  // (A-layer check) and its stub exits 0; article requires original_*.md
  // (A-layer check) and sleeps 30 so we can abort it.
  //
  // Pre-created artifacts satisfy both A-layer checks without real scripts.
  {
    const rootDir = makeTempDir({
      'fetch_info.sh':       EXIT0_SCRIPT,   // override: exits instantly
      'generate_article.sh': SLEEP_SCRIPT,   // override: sleeps so we can abort
    });
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=articleclean1',
        mode: 'transcript',
        force: 1,
        rootDir
      }));

      // Create A-layer prerequisites before starting the pipeline.
      const workDir = path.join(rootDir, 'work', task_id);
      fs.mkdirSync(path.join(workDir, 'transcript', 'subs'), { recursive: true });
      // vtt2md A-layer: needs at least one .vtt file in transcript/subs/
      fs.writeFileSync(path.join(workDir, 'transcript', 'subs', 'dummy.en.vtt'), 'WEBVTT\n');
      // article A-layer: needs original_*.md in transcript/
      fs.writeFileSync(path.join(workDir, 'transcript', 'original_en.md'), '# transcript\n');

      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      // Wait up to 8 s for fetch → subs → vtt2md to complete and article to start.
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.steps && t.steps.article && t.steps.article.status === 'running' ? t : null;
      }, 8000);

      // Simulate a partial write by the article script.
      const writingDir = path.join(workDir, 'writing');
      fs.mkdirSync(writingDir, { recursive: true });
      const articlePath = path.join(writingDir, 'article.md');
      fs.writeFileSync(articlePath, '# incomplete article\n');

      await orchestrator.abortTask(task_id, { rootDir });

      if (fs.existsSync(articlePath)) {
        throw new Error('article.md should have been deleted after task abort');
      }
      const taskAfter = await orchestrator.getTask(task_id, { rootDir });
      if (taskAfter.status !== 'aborted') {
        throw new Error(`task should be aborted after abort, got ${taskAfter.status}`);
      }

      console.log('[abort-test] Test 8 passed: article.md deleted on task abort, status=aborted');
    } finally {
      if (task_id) await safeAbort(task_id, rootDir);
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // Not covered: STEP_ABORT_IN_PROGRESS (requires precise concurrent scheduling),
  // summary.md cleanup (same code path as article), SSE event payloads.

  console.log('[abort-test] All tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('[abort-test] FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
