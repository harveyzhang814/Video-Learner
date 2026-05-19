# Task Resume 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为任务流水线添加 `aborted` 状态和 Resume 功能，让用户能从中断处继续执行任务。

**Architecture:** 在 DB 层新增 `status` 列持久化 abort 状态；orchestrator abort finally 块改写 `'aborted'`；新增 `resumeTask()` 入口函数调用现有 `runTask()`（DAG 调度器天然跳过已完成 steps）；GUI 添加 Resume 按钮与 Cancel 互斥显示。

**Tech Stack:** Node.js (no framework), better-sqlite3, Koa HTTP server, Electron renderer HTML

---

## 文件清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `core/orchestrator/db.js` | 修改 | 新增 status 列迁移 |
| `core/orchestrator/index.js` | 修改 | abort→'aborted'，loadTaskFromDb 更新，resumeTask() |
| `services/http-server/index.js` | 修改 | POST /tasks/:id/resume 路由 |
| `electron/src/renderer/service-client.js` | 修改 | resumeTask() 方法 |
| `electron/src/renderer/client-state.js` | 修改 | step.finished aborted:true 修复 |
| `electron/src/renderer/index.html` | 修改 | resumeBtn HTML + CSS + syncActionButtons |
| `tests/task-abort.test.js` | 修改 | 断言从 'pending' 改为 'aborted'（5 处） |
| `tests/task-resume.test.js` | 创建 | 9 个测试用例 |
| `package.json` | 修改 | 新增 test:resume 脚本 |

---

## Task 1: 更新 task-abort.test.js（TDD 第一步：让测试先失败）

**Files:**
- Modify: `tests/task-abort.test.js:101,104,111,329,333`

- [ ] **Step 1: 修改 5 处断言和日志**

  在 `tests/task-abort.test.js` 中做以下替换：

  **Line 101：**
  ```js
  // 旧
  if (result.status !== 'pending') throw new Error(`expected pending, got ${result.status}`);
  // 新
  if (result.status !== 'aborted') throw new Error(`expected aborted, got ${result.status}`);
  ```

  **Line 104：**
  ```js
  // 旧
  if (taskAfter.status !== 'pending') {
    throw new Error(`task.status should be pending, got ${taskAfter.status}`);
  }
  // 新
  if (taskAfter.status !== 'aborted') {
    throw new Error(`task.status should be aborted, got ${taskAfter.status}`);
  }
  ```

  **Line 111：**
  ```js
  // 旧
  console.log('[abort-test] Test 1 passed: abortTask resets to pending');
  // 新
  console.log('[abort-test] Test 1 passed: abortTask sets status to aborted');
  ```

  **Line 329：**
  ```js
  // 旧
  if (taskAfter.status !== 'pending') {
    throw new Error(`task should be pending after abort, got ${taskAfter.status}`);
  }
  // 新
  if (taskAfter.status !== 'aborted') {
    throw new Error(`task should be aborted after abort, got ${taskAfter.status}`);
  }
  ```

  **Line 333：**
  ```js
  // 旧
  console.log('[abort-test] Test 8 passed: article.md deleted on task abort');
  // 新
  console.log('[abort-test] Test 8 passed: article.md deleted on task abort, status=aborted');
  ```

  注意：第 168 行 `abortStep` 返回的是 step 的 status（`'pending'`），不是 task status，**不需要修改**。
  注意：第 239 行同样是 step cancel HTTP 测试，**不需要修改**。

- [ ] **Step 2: 运行测试，确认失败**

  ```bash
  npm run test:abort
  ```

  预期输出：
  ```
  Error: expected aborted, got pending
  ```

  这证明测试有效——当前实现返回 'pending'，测试正确捕获了它。

---

## Task 2: DB 迁移 + Orchestrator abort → 'aborted'（让 Task 1 测试通过）

**Files:**
- Modify: `core/orchestrator/db.js:62`（在 mode 迁移块之后）
- Modify: `core/orchestrator/index.js:1003–1020`（abort finally 块）
- Modify: `core/orchestrator/index.js:193–198`（loadTaskFromDb）
- Modify: `core/orchestrator/index.js:1262`（abortTask 返回值）

- [ ] **Step 1: db.js — 新增 status 列迁移**

  在 `core/orchestrator/db.js` 中，找到 `mode` 列的迁移块（约 55–63 行）：
  ```js
  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    if (!cols.some((c) => c.name === 'mode')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN mode TEXT DEFAULT 'both'`);
    }
  } catch (_) {
  }
  ```

  在该块之后（`initTables` 函数内，`db.exec(CREATE TABLE steps ...)` 之前）新增：
  ```js
  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all();
    if (!cols.some((c) => c.name === 'status')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN status TEXT`);
      // NULL default: existing rows use computed status from steps, behavior unchanged
    }
  } catch (_) {
  }
  ```

- [ ] **Step 2: index.js — loadTaskFromDb 更新**

  在 `core/orchestrator/index.js` 第 193–198 行，将状态推断逻辑改为优先尊重 DB 中的 `aborted` 值：

  ```js
  // 旧
  const statusList = Object.values(steps).map((s) => s.status);
  const tempTask = { params: { mode: normalizeMode(row.mode) }, steps };
  let status = 'pending';
  if (statusList.some((s) => s === 'running')) status = 'running';
  else if (isTaskFailed(tempTask))    status = 'failed';
  else if (isTaskCompleted(tempTask)) status = 'completed';

  // 新
  const statusList = Object.values(steps).map((s) => s.status);
  const tempTask = { params: { mode: normalizeMode(row.mode) }, steps };
  let status = 'pending';
  if (row.status === 'aborted') {
    status = 'aborted'; // restore abort state across process restarts; do not auto-resume
  } else if (statusList.some((s) => s === 'running')) status = 'running';
  else if (isTaskFailed(tempTask))    status = 'failed';
  else if (isTaskCompleted(tempTask)) status = 'completed';
  ```

- [ ] **Step 3: index.js — abort finally 块写入 DB + 改状态**

  在 `core/orchestrator/index.js` 的 `if (task._abortFlag)` 块内（约第 1000–1025 行），找到 `if (_rootDir && _id)` 块中的步骤循环结束处：

  ```js
  if (_rootDir && _id) {
    const db = ensureDb(_rootDir);
    const workDir = getWorkDir(_rootDir, _id);
    for (const stepName of STEPS) {
      const s = task.steps && task.steps[stepName];
      if (s && s.status === 'running') {
        if (stepName === 'article') tryDeleteFile(path.join(workDir, 'writing', 'article.md'));
        if (stepName === 'summary') tryDeleteFile(path.join(workDir, 'writing', 'summary.md'));
        task.steps[stepName] = { status: 'pending', attempts: s.attempts, error: null };
        db.updateStep(_id, stepName, 'pending');
      }
    }
    // ADD THIS LINE ↓
    db.updateTask(_id, { status: 'aborted' });
  }
  // 旧
  task.status = 'pending';
  task.updated_at = new Date().toISOString();
  emitOrchestratorEvent('task.updated', taskId, { status: 'pending' });
  // 新
  task.status = 'aborted';
  task.updated_at = new Date().toISOString();
  emitOrchestratorEvent('task.updated', taskId, { status: 'aborted' });
  ```

- [ ] **Step 4: index.js — abortTask 返回值**

  在 `core/orchestrator/index.js` 约第 1262 行：

  ```js
  // 旧
  return { task_id: taskId, status: 'pending' };

  // 新
  return { task_id: taskId, status: 'aborted' };
  ```

- [ ] **Step 5: 运行 task-abort.test.js，确认全部通过**

  ```bash
  npm run test:abort
  ```

  预期输出（末尾）：
  ```
  [abort-test] All tests passed
  ```

- [ ] **Step 6: 提交**

  ```bash
  git add core/orchestrator/db.js core/orchestrator/index.js tests/task-abort.test.js
  git commit -m "feat: abort task sets status to aborted, persist to DB"
  ```

---

## Task 3: 新建 task-resume.test.js（TDD 第一步）

**Files:**
- Create: `tests/task-resume.test.js`
- Modify: `package.json`

- [ ] **Step 1: 新建 tests/task-resume.test.js**

  ```js
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
    // ── Test 1: abort 后调用 resume，已完成 steps 保持 completed ─────────────
    {
      const rootDir = makeTempDir({ 'fetch_info.sh': EXIT0_SCRIPT });
      let task_id = null;
      try {
        ({ task_id } = await orchestrator.createTask({
          url: 'https://www.youtube.com/watch?v=resume1',
          mode: 'transcript', force: 1, rootDir
        }));
        orchestrator.runTask(task_id, { rootDir }).catch(() => {});

        // Wait for fetch to complete
        await pollUntil(async () => {
          const t = await orchestrator.getTask(task_id, { rootDir });
          return t.steps && t.steps.fetch && t.steps.fetch.status === 'completed' ? t : null;
        });

        await orchestrator.abortTask(task_id, { rootDir });
        const afterAbort = await orchestrator.getTask(task_id, { rootDir });
        assert.equal(afterAbort.status, 'aborted', `expected aborted, got ${afterAbort.status}`);
        assert.equal(afterAbort.steps.fetch.status, 'completed', 'fetch should remain completed');

        // resume returns running
        const resumeResult = await orchestrator.resumeTask(task_id, { rootDir });
        assert.equal(resumeResult.status, 'running', `expected running, got ${resumeResult.status}`);

        console.log('[resume-test] Test 1 passed: abort → resume → fetch stays completed');
      } finally {
        if (task_id) await safeAbort(task_id, rootDir);
        fs.rmSync(rootDir, { recursive: true });
      }
    }

    // ── Test 2: resume 后 DAG 跳过 completed steps，只运行 pending ─────────────
    {
      const rootDir = makeTempDir({ 'fetch_info.sh': EXIT0_SCRIPT });
      let task_id = null;
      try {
        ({ task_id } = await orchestrator.createTask({
          url: 'https://www.youtube.com/watch?v=resume2',
          mode: 'transcript', force: 1, rootDir
        }));
        orchestrator.runTask(task_id, { rootDir }).catch(() => {});

        await pollUntil(async () => {
          const t = await orchestrator.getTask(task_id, { rootDir });
          return t.steps && t.steps.fetch && t.steps.fetch.status === 'completed' ? t : null;
        });
        await orchestrator.abortTask(task_id, { rootDir });
        await orchestrator.resumeTask(task_id, { rootDir });

        // Task is now running
        await pollUntil(async () => {
          const t = await orchestrator.getTask(task_id, { rootDir });
          return t.status === 'running' ? t : null;
        });

        // fetch must still be completed (not re-run by resume)
        const snap = await orchestrator.getTask(task_id, { rootDir });
        assert.equal(snap.steps.fetch.status, 'completed', 'fetch must not be re-run after resume');

        console.log('[resume-test] Test 2 passed: resume skips completed steps');
      } finally {
        if (task_id) await safeAbort(task_id, rootDir);
        fs.rmSync(rootDir, { recursive: true });
      }
    }

    // ── Test 3: resume 后任务最终退出 aborted 状态（进入 running → terminal）───
    {
      const rootDir = makeTempDir({ 'fetch_info.sh': EXIT0_SCRIPT });
      let task_id = null;
      try {
        ({ task_id } = await orchestrator.createTask({
          url: 'https://www.youtube.com/watch?v=resume3',
          mode: 'transcript', force: 1, rootDir
        }));
        orchestrator.runTask(task_id, { rootDir }).catch(() => {});

        await pollUntil(async () => {
          const t = await orchestrator.getTask(task_id, { rootDir });
          return t.steps && t.steps.fetch && t.steps.fetch.status === 'completed' ? t : null;
        });
        await orchestrator.abortTask(task_id, { rootDir });
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
      const rootDir = makeTempDir({ 'fetch_info.sh': EXIT0_SCRIPT });
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

    // ── Test 8: 进程重启后 aborted 状态持久化 ────────────────────────────────
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

    console.log('[resume-test] All 9 tests passed');
    process.exit(0);
  }

  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  ```

- [ ] **Step 2: package.json 新增 test:resume**

  在 `package.json` 的 `"scripts"` 对象中，在 `"test:abort"` 行之后新增：

  ```json
  "test:resume": "node tests/task-resume.test.js",
  ```

- [ ] **Step 3: 运行测试，确认失败（resumeTask 未定义）**

  ```bash
  npm run test:resume
  ```

  预期输出（类似）：
  ```
  TypeError: orchestrator.resumeTask is not a function
  ```

---

## Task 4: 实现 resumeTask()（让 Task 3 测试通过）

**Files:**
- Modify: `core/orchestrator/index.js`（在 `module.exports` 之前）

- [ ] **Step 1: 在 index.js 中添加 resumeTask 函数**

  在 `core/orchestrator/index.js` 中，找到约第 1299 行的 `function _dropTaskFromMemory(taskId)` 前，插入：

  ```js
  async function resumeTask(taskId, options = {}) {
    const task = ensureTask(taskId, options);
    if (task.status !== 'aborted') {
      const e = new Error('task is not aborted');
      e.code = 'NOT_ABORTED';
      throw e;
    }
    // runTask sets status='running' synchronously before any async ops; no race condition
    runTask(taskId).catch((err) => console.error(`[resume] ${err.message}`));
    return { task_id: taskId, status: 'running' };
  }
  ```

- [ ] **Step 2: 在 module.exports 中导出 resumeTask**

  在 `core/orchestrator/index.js` 的 `module.exports` 对象（约第 1305 行）中加入 `resumeTask`：

  ```js
  module.exports = {
    createTask,
    listTasks,
    runTask,
    runStep,
    abortTask,
    abortStep,
    resumeTask,          // 新增
    applyResetScope,
    skipStep,
    deleteTask,
    getTask,
    getTaskResult,
    // ... 其余已有导出
  };
  ```

- [ ] **Step 3: 运行 task-resume.test.js，确认通过**

  ```bash
  npm run test:resume
  ```

  预期输出（末尾）：
  ```
  [resume-test] All 9 tests passed
  ```

- [ ] **Step 4: 同时运行 task-abort.test.js 确认无回归**

  ```bash
  npm run test:abort
  ```

  预期输出：
  ```
  [abort-test] All tests passed
  ```

- [ ] **Step 5: 提交**

  ```bash
  git add core/orchestrator/index.js tests/task-resume.test.js package.json
  git commit -m "feat: add resumeTask() orchestrator function with 9 tests"
  ```

---

## Task 5: HTTP API — 新增 /resume 路由

**Files:**
- Modify: `services/http-server/index.js`（在 `/cancel` 路由之后，约第 270 行）

- [ ] **Step 1: 在 /cancel 路由之后插入 /resume 路由**

  在 `services/http-server/index.js` 中，找到 `/cancel` 路由结束处（约第 270 行 `});`），在其后插入：

  ```js
  router.post('/tasks/:taskId/resume', async (ctx) => {
    const { taskId } = ctx.params;
    try {
      const result = await orchestrator.resumeTask(taskId, { rootDir: ROOT_DIR });
      ctx.status = 202;
      ctx.body = result; // { task_id, status: 'running' }
    } catch (err) {
      if (/task not found/.test(err.message)) {
        ctx.status = 404;
        ctx.body = { error: err.message };
      } else if (err.code === 'NOT_ABORTED') {
        ctx.status = 409;
        ctx.body = { error: err.message, code: 'NOT_ABORTED' };
      } else {
        ctx.status = 500;
        ctx.body = { error: err.message || 'resume failed' };
      }
    }
  });
  ```

- [ ] **Step 2: 通过 HTTP 测试 /resume 端点**

  临时用 curl 验证（需要后端在运行，或使用 test 方式）：

  运行已有集成测试，确认 HTTP server 无回归：
  ```bash
  node tests/agent-http.test.js
  ```

  预期：所有已有测试通过（无 resume 专项 HTTP 测试，依赖 Task 3 的 orchestrator 测试覆盖）

- [ ] **Step 3: 提交**

  ```bash
  git add services/http-server/index.js
  git commit -m "feat: add POST /api/tasks/:id/resume HTTP endpoint"
  ```

---

## Task 6: 修复 client-state.js step.finished 处理

**Files:**
- Modify: `electron/src/renderer/client-state.js:41`

- [ ] **Step 1: 确认现有 GUI 状态测试**

  ```bash
  npm run test:gui:state
  ```

  预期：`gui-logic-state.test.js: all passed`

- [ ] **Step 2: 修改 client-state.js 第 41 行**

  在 `electron/src/renderer/client-state.js` 中，找到 `step.finished` 处理（约第 39–50 行）：

  ```js
  if (type === 'step.finished' || type === 'step.failed') {
    const stepName = payload.stepName || payload.name;
    const status = type === 'step.failed' ? 'failed' : 'completed';  // ← 改这行
  ```

  改为：

  ```js
  if (type === 'step.finished' || type === 'step.failed') {
    const stepName = payload.stepName || payload.name;
    const status = type === 'step.failed' ? 'failed'
      : (payload.aborted ? 'pending' : 'completed');
  ```

- [ ] **Step 3: 运行 GUI 状态测试，确认无回归**

  ```bash
  npm run test:gui:state
  ```

  预期：`gui-logic-state.test.js: all passed`

- [ ] **Step 4: 提交**

  ```bash
  git add electron/src/renderer/client-state.js
  git commit -m "fix: client-state step.finished correctly handles aborted:true flag"
  ```

---

## Task 7: Electron GUI — service-client.js + index.html

**Files:**
- Modify: `electron/src/renderer/service-client.js:110`（cancelTask 之后）
- Modify: `electron/src/renderer/index.html`（多处）

### 7a: service-client.js

- [ ] **Step 1: 在 cancelTask 之后添加 resumeTask 方法**

  在 `electron/src/renderer/service-client.js` 中，找到 `cancelTask` 方法（约第 108–110 行）：

  ```js
  cancelTask(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
  }
  ```

  在其后插入：

  ```js
  resumeTask(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/resume`, { method: 'POST' });
  }
  ```

### 7b: index.html — CSS

- [ ] **Step 2: 在 aborted 状态点样式（CSS 约第 187 行）**

  在 `electron/src/renderer/index.html` 中，找到：
  ```css
  .history-item .status-dot.unknown { background: #999999; }
  ```

  在其后新增：
  ```css
  .history-item .status-dot.aborted { background: #F97316; }
  ```

### 7c: index.html — resumeBtn HTML

- [ ] **Step 3: 在 cancelBtn 旁边新增 resumeBtn**

  在 `electron/src/renderer/index.html` 中，找到（约第 1461 行）：
  ```html
  <button class="btn danger" id="cancelBtn" style="display:none">中止</button>
  ```

  改为：
  ```html
  <button class="btn danger"  id="cancelBtn"  style="display:none">中止</button>
  <button class="btn primary" id="resumeBtn"  style="display:none">继续</button>
  ```

### 7d: index.html — 获取 resumeBtn 引用

- [ ] **Step 4: 获取 resumeBtn DOM 引用**

  在 `electron/src/renderer/index.html` 中，找到（约第 1771 行）：
  ```js
  const cancelBtn = document.getElementById('cancelBtn');
  ```

  在其后新增：
  ```js
  const resumeBtn = document.getElementById('resumeBtn');
  ```

### 7e: index.html — 将 syncCancelBtn 改为 syncActionButtons

- [ ] **Step 5: 重命名并更新函数（约第 1774 行）**

  找到：
  ```js
  function syncCancelBtn(taskStatus) {
    if (cancelBtn) {
      cancelBtn.style.display = taskStatus === 'running' ? '' : 'none';
    }
  }
  ```

  替换为：
  ```js
  function syncActionButtons(taskStatus) {
    if (cancelBtn) cancelBtn.style.display = taskStatus === 'running' ? '' : 'none';
    if (resumeBtn) resumeBtn.style.display = taskStatus === 'aborted' ? '' : 'none';
  }
  ```

- [ ] **Step 6: 更新所有调用处（3 处）**

  全局搜索 `syncCancelBtn(`，共 3 处，全部替换为 `syncActionButtons(`：

  - 约第 2304 行：`syncCancelBtn(task.status)` → `syncActionButtons(task.status)`
  - 约第 2734 行：`syncCancelBtn(snap.status)` → `syncActionButtons(snap.status)`
  - 约第 2754 行：`syncCancelBtn(snap.status)` → `syncActionButtons(snap.status)`

- [ ] **Step 7: 更新直接操作 cancelBtn 的两处（约第 2997、3021 行）**

  找到并更新（删除任务后的 cleanup 和 init）：
  ```js
  // 旧（约第 2997 行）
  if (cancelBtn) cancelBtn.style.display = 'none';

  // 新
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (resumeBtn) resumeBtn.style.display = 'none';
  ```

  ```js
  // 旧（约第 3021 行）
  if (cancelBtn) cancelBtn.style.display = 'none';

  // 新
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (resumeBtn) resumeBtn.style.display = 'none';
  ```

### 7f: index.html — resumeBtn 点击处理器

- [ ] **Step 8: 添加 resumeBtn click handler（在 cancelBtn click handler 之后）**

  在 `electron/src/renderer/index.html` 中，找到 cancelBtn 的 click 事件（约第 2940 行）：
  ```js
  cancelBtn.addEventListener('click', async () => {
    // ...
  });
  ```

  在其后插入：
  ```js
  resumeBtn.addEventListener('click', async () => {
    if (!currentTaskId) return;
    resumeBtn.disabled = true;
    try {
      await client.resumeTask(currentTaskId);
    } catch (e) {
      console.error('resume failed:', e);
      alert(e.message || '继续失败');
    } finally {
      resumeBtn.disabled = false;
    }
  });
  ```

- [ ] **Step 9: 运行 GUI 测试套件，确认无回归**

  ```bash
  npm run test:gui
  ```

  预期：所有 GUI 测试通过。

- [ ] **Step 10: 启动 Electron 手动验证 Resume 按钮**

  ```bash
  bash start-electron.sh
  ```

  验证清单：
  1. 创建任务并启动 → 点击"中止" → 任务显示 "aborted" 状态，"继续"按钮出现
  2. 点击"继续" → 任务继续运行，"继续"按钮消失，"中止"按钮出现
  3. 关闭并重启 Electron → 中止过的任务仍显示"继续"按钮

- [ ] **Step 11: 提交**

  ```bash
  git add electron/src/renderer/service-client.js electron/src/renderer/index.html
  git commit -m "feat: add Resume button to GUI, sync with aborted task state"
  ```

---

## Task 8: 回归测试 + 最终验证

- [ ] **Step 1: 运行全量相关测试**

  ```bash
  npm run test:abort && npm run test:resume && npm run test:agent:core && npm run test:gui
  ```

  预期：全部通过。

- [ ] **Step 2: 运行 orchestrator schedule 测试（DAG 无变更验证）**

  ```bash
  npm run test:schedule
  ```

  预期：通过。

- [ ] **Step 3: 最终提交确认**

  ```bash
  git log --oneline -6
  ```

  应看到：
  ```
  feat: add Resume button to GUI, sync with aborted task state
  fix: client-state step.finished correctly handles aborted:true flag
  feat: add POST /api/tasks/:id/resume HTTP endpoint
  feat: add resumeTask() orchestrator function with 9 tests
  feat: abort task sets status to aborted, persist to DB
  ```
