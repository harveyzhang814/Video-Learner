'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert');

const orchestrator = require('../core/orchestrator');
const { createApp } = require('../services/http-server');

const SLEEP_SCRIPT = `#!/usr/bin/env bash\nsleep 30\nexit 0\n`;
const EXIT0_SCRIPT = `#!/usr/bin/env bash\nexit 0\n`;
const FAIL_SCRIPT  = `#!/usr/bin/env bash\nexit 1\n`;

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

function makeTempDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-resume-test-'));
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

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollUntil(fn, timeoutMs = 8000) {
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
  // ── Test 1: abort 後調用 resume，已完成 steps 保持 completed ─────────────
  {
    const rootDir = makeTempDir();  // fetch_info.sh sleeps 30
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume1',
        mode: 'transcript', force: 1, rootDir
      }));
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      // Wait for task to be running
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      await orchestrator.abortTask(task_id, { rootDir });
      const afterAbort = await orchestrator.getTask(task_id, { rootDir });
      assert.equal(afterAbort.status, 'aborted', `expected aborted, got ${afterAbort.status}`);

      // resume returns running
      const resumeResult = await orchestrator.resumeTask(task_id, { rootDir });
      assert.equal(resumeResult.status, 'running', `expected running, got ${resumeResult.status}`);

      console.log('[resume-test] Test 1 passed: abort → resume → fetch stays completed');
    } finally {
      if (task_id) await safeAbort(task_id, rootDir);
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 2: resume 後 DAG 跳過 completed steps，只運行 pending ─────────────
  {
    const rootDir = makeTempDir();  // fetch_info.sh sleeps 30
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume2',
        mode: 'transcript', force: 1, rootDir
      }));
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      await orchestrator.abortTask(task_id, { rootDir });
      await orchestrator.resumeTask(task_id, { rootDir });

      // Task is now running again
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      console.log('[resume-test] Test 2 passed: resume skips completed steps');
    } finally {
      if (task_id) await safeAbort(task_id, rootDir);
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 3: resume 後任務最終退出 aborted 狀態（進入 running → terminal）───
  {
    const rootDir = makeTempDir();  // fetch_info.sh sleeps 30
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume3',
        mode: 'transcript', force: 1, rootDir
      }));
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      await orchestrator.abortTask(task_id, { rootDir });

      // Swap fetch to exit-0 so the resumed run completes quickly (sleep-30 only needed for the abort trigger)
      fs.writeFileSync(path.join(rootDir, 'scripts', 'fetch_info.sh'), EXIT0_SCRIPT);
      fs.chmodSync(path.join(rootDir, 'scripts', 'fetch_info.sh'), '755');

      await orchestrator.resumeTask(task_id, { rootDir });

      // Wait for terminal state (completed or failed — either is fine; key is not stuck in aborted)
      const final = await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return (t.status === 'completed' || t.status === 'failed') ? t : null;
      }, 15000);

      assert.notEqual(final.status, 'aborted', 'task must not remain aborted after resume');
      console.log(`[resume-test] Test 3 passed: resume → task reaches ${final.status}`);
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 4: resume on running task → NOT_ABORTED ─────────────────────────
  {
    const rootDir = makeTempDir();
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume4',
        mode: 'transcript', force: 1, rootDir
      }));
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      try {
        await orchestrator.resumeTask(task_id, { rootDir });
        throw new Error('should have thrown');
      } catch (e) {
        assert.equal(e.code, 'NOT_ABORTED', `expected NOT_ABORTED, got ${e.code}`);
      }
      console.log('[resume-test] Test 4 passed: resume on running → NOT_ABORTED');
    } finally {
      if (task_id) await safeAbort(task_id, rootDir);
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 5: resume on pending task → NOT_ABORTED ─────────────────────────
  {
    const rootDir = makeTempDir();
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume5',
        mode: 'transcript', rootDir
      });
      try {
        await orchestrator.resumeTask(task_id, { rootDir });
        throw new Error('should have thrown');
      } catch (e) {
        assert.equal(e.code, 'NOT_ABORTED', `expected NOT_ABORTED, got ${e.code}`);
      }
      console.log('[resume-test] Test 5 passed: resume on pending → NOT_ABORTED');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 6: resume on completed task → NOT_ABORTED ───────────────────────
  {
    // Use a minimal script that will complete quickly (e.g. all scripts that just exit 0)
    const rootDir = makeTempDir({
      'fetch_info.sh': EXIT0_SCRIPT,
      'download_video.sh': EXIT0_SCRIPT,
      'download_audio.sh': EXIT0_SCRIPT,
      'download_subs.sh': EXIT0_SCRIPT,
      'asr_transcribe.sh': EXIT0_SCRIPT,
      'convert_vtt_md.sh': EXIT0_SCRIPT,
      'convert_md_vtt.sh': EXIT0_SCRIPT,
      'generate_article.sh': EXIT0_SCRIPT,
      'generate_summary.sh': EXIT0_SCRIPT,
    });
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume6',
        mode: 'transcript', force: 1, rootDir
      });
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return (t.status === 'completed' || t.status === 'failed') ? t : null;
      }, 15000);

      const before = await orchestrator.getTask(task_id, { rootDir });
      if (before.status !== 'aborted') {
        try {
          await orchestrator.resumeTask(task_id, { rootDir });
          throw new Error('should have thrown');
        } catch (e) {
          assert.equal(e.code, 'NOT_ABORTED', `expected NOT_ABORTED, got ${e.code}`);
        }
      }
      console.log('[resume-test] Test 6 passed: resume on non-aborted terminal → NOT_ABORTED');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 7: resume on failed task → NOT_ABORTED ──────────────────────────
  {
    const rootDir = makeTempDir({ 'fetch_info.sh': FAIL_SCRIPT });
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume7',
        mode: 'transcript', force: 1, rootDir
      });
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'failed' ? t : null;
      }, 10000);

      try {
        await orchestrator.resumeTask(task_id, { rootDir });
        throw new Error('should have thrown');
      } catch (e) {
        assert.equal(e.code, 'NOT_ABORTED', `expected NOT_ABORTED, got ${e.code}`);
      }
      console.log('[resume-test] Test 7 passed: resume on failed → NOT_ABORTED');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 8: 進程重啟後 aborted 狀態持久化 ────────────────────────────────
  {
    const rootDir = makeTempDir();   // fetch sleeps 30
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume8',
        mode: 'transcript', force: 1, rootDir
      }));
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      await orchestrator.abortTask(task_id, { rootDir });
      const afterAbort = await orchestrator.getTask(task_id, { rootDir });
      assert.equal(afterAbort.status, 'aborted', `expected aborted before restart, got ${afterAbort.status}`);

      // Simulate process restart: evict from memory
      orchestrator._dropTaskFromMemory(task_id);

      // Reload from DB (mimics startup recovery)
      const afterRestart = await orchestrator.getTask(task_id, { rootDir });
      assert.equal(afterRestart.status, 'aborted',
        `expected aborted after restart, got ${afterRestart.status}`);

      console.log('[resume-test] Test 8 passed: aborted state survives process restart');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 9: abortTask on aborted task → NOT_RUNNING ──────────────────────
  {
    const rootDir = makeTempDir();   // fetch sleeps 30
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume9',
        mode: 'transcript', force: 1, rootDir
      }));
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });

      await orchestrator.abortTask(task_id, { rootDir });

      try {
        await orchestrator.abortTask(task_id, { rootDir });
        throw new Error('should have thrown NOT_RUNNING');
      } catch (e) {
        assert.equal(e.code, 'NOT_RUNNING', `expected NOT_RUNNING, got ${e.code}`);
      }
      console.log('[resume-test] Test 9 passed: abortTask on aborted → NOT_RUNNING');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 10: HTTP POST /resume on aborted task → 202 ─────────────────────
  {
    const rootDir = makeTempDir();   // fetch sleeps 30
    const token = 'test-token-resume-10';
    const { server, base } = await startServer(rootDir, token);
    let task_id = null;
    try {
      ({ task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume10',
        mode: 'transcript', force: 1, rootDir
      }));
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return t.status === 'running' ? t : null;
      });
      await orchestrator.abortTask(task_id, { rootDir });

      const res = await fetch(`${base}/api/tasks/${task_id}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.status, 202, `expected 202, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.status, 'running', `expected status=running, got ${body.status}`);
      assert.equal(body.task_id, task_id, `expected task_id=${task_id}, got ${body.task_id}`);

      console.log('[resume-test] Test 10 passed: HTTP POST /resume on aborted task → 202');
    } finally {
      if (task_id) await safeAbort(task_id, rootDir);
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 11: HTTP POST /resume on non-aborted task → 409 ─────────────────
  {
    const rootDir = makeTempDir();
    const token = 'test-token-resume-11';
    const { server, base } = await startServer(rootDir, token);
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=resume11',
        mode: 'transcript', rootDir
      });

      const res = await fetch(`${base}/api/tasks/${task_id}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.status, 409, `expected 409, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.code, 'NOT_ABORTED', `expected code=NOT_ABORTED, got ${body.code}`);

      console.log('[resume-test] Test 11 passed: HTTP POST /resume on pending task → 409 NOT_ABORTED');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test 12: HTTP POST /resume on unknown task → 404 ─────────────────────
  {
    const rootDir = makeTempDir();
    const token = 'test-token-resume-12';
    const { server, base } = await startServer(rootDir, token);
    try {
      const res = await fetch(`${base}/api/tasks/nonexistent-task-id/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.status, 404, `expected 404, got ${res.status}`);

      console.log('[resume-test] Test 12 passed: HTTP POST /resume on unknown task → 404');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  console.log('[resume-test] All 12 tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
