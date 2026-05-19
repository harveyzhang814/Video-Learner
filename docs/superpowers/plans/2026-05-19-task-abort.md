# Task Abort Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Video Learner 添加任务级和步骤级中止能力，中止后状态重置为 `pending`，支持直接重跑。

**Architecture:** Task 对象挂载运行时标志（`_abortFlag`、`_currentProc`、`_abortResolvers`、`_stepAbortResolve`）；`runStepScript` 改用 `detached: true` spawn 获取独立进程组；`runStep` 在脚本完成后检查中止标志；`runTask` finally 块统一清理中止状态并通知等待方；HTTP 层新增两个 POST 端点；ServiceClient 和 renderer 按现有模式扩展。

**Tech Stack:** Node.js `child_process`（`detached: true` spawn），Koa router，`electron/src/renderer/service-client.js`，`index.html` toolbar

---

## File Map

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `core/orchestrator/index.js` | 中止标志字段、runStepScript、runStep、runTask、abortTask、abortStep |
| Modify | `services/http-server/index.js` | 两个 cancel HTTP 路由 |
| Modify | `electron/src/renderer/service-client.js` | cancelTask / cancelStep 方法 |
| Modify | `electron/src/renderer/index.html` | toolbar 中止按钮 |
| Create | `tests/task-abort.test.js` | 行为测试 |

---

## Task 1: runStepScript 进程组基础设施

**Files:**
- Modify: `core/orchestrator/index.js` (lines ~285–295 createTask, ~200–233 loadTaskFromDb, ~397–425 runStepScript)

在 `createTask` 和 `loadTaskFromDb` 中的 task 对象里添加四个运行时字段；修改 `runStepScript` 使 bash 进程独立于 Node.js 进程组。

- [ ] **Step 1: 在 `createTask`（line ~285）的 task 对象字面量里添加四个字段**

在 `task = { task_id: taskId, status: 'pending', ...` 对象的 `processInfo: null` 行后追加：

```js
    _abortFlag: false,
    _currentProc: null,
    _abortResolvers: [],
    _stepAbortResolve: null,
```

- [ ] **Step 2: 在 `loadTaskFromDb`（line ~200）的 task 对象字面量里做同样追加**

在 `processInfo: null` 行后追加：

```js
    _abortFlag: false,
    _currentProc: null,
    _abortResolvers: [],
    _stepAbortResolve: null,
```

- [ ] **Step 3: 修改 `runStepScript`（line ~397）—— 改用 `detached: true` + 增加 `opts.onProc` 回调**

将：
```js
const proc = spawn('bash', [script, ...args], { cwd: rootDir, env: spawnEnv() });
```
替换为：
```js
const proc = spawn('bash', [script, ...args], { cwd: rootDir, env: spawnEnv(), detached: true });
if (opts.onProc) opts.onProc(proc);
```

- [ ] **Step 4: 在文件顶部附近（`runStepScript` 之前）添加 helper 函数**

```js
function tryDeleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}
```

- [ ] **Step 5: 验证语法无误**

```bash
node --check core/orchestrator/index.js
```

期望：无输出（无语法错误）

- [ ] **Step 6: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): add abort runtime fields and detached spawn infrastructure"
```

---

## Task 2: runStep 中止感知

**Files:**
- Modify: `core/orchestrator/index.js` (lines ~714–784 runStep 主体)

在 `runStepScript` 调用处传入 `onProc` 回调；调用后清除 `_currentProc`；新增步骤级和任务级中止检查。

- [ ] **Step 1: 在 `runStep` 主体的 `if (args.length > 0)` 块内，找到 `const result = await runStepScript(...)` 那一行（line ~759），修改调用传入 `onProc`**

将：
```js
    const result = await runStepScript(rootDir, stepName, args, { onOutput, onStdout, onStderr });
```
替换为：
```js
    const result = await runStepScript(rootDir, stepName, args, {
      onOutput,
      onStdout,
      onStderr,
      onProc: (proc) => { task._currentProc = proc; }
    });
    task._currentProc = null;
```

- [ ] **Step 2: 紧接在 `task._currentProc = null;` 之后、`if (result.code === 0)` 之前，插入步骤级中止检查**

```js
    // Step-level abort: runStep resets step to pending and notifies abortStep.
    if (task._stepAbortResolve) {
      const resolve = task._stepAbortResolve;
      task._stepAbortResolve = null;
      if (stepName === 'article') tryDeleteFile(path.join(dir, 'writing', 'article.md'));
      if (stepName === 'summary') tryDeleteFile(path.join(dir, 'writing', 'summary.md'));
      stepState.status = 'pending';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'pending');
      finishLogs();
      emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
      emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'pending' });
      resolve();
      return { success: false, error: 'aborted' };
    }
    // Task-level abort: runTask's finally block handles state cleanup.
    if (task._abortFlag) {
      finishLogs();
      return { success: false, error: 'aborted' };
    }
```

- [ ] **Step 3: 在 `vtt2md` case 的循环内（line ~637），每次 `runStepScript` 调用后加同样的 `onProc` 并在循环末检查中止标志**

找到 `case 'vtt2md':` 里的 `runStepScript` 调用：
```js
          const result = await runStepScript(rootDir, 'vtt2md', [path.join(subsDir, vtt), outPath], { onOutput: options.onOutput, onStdout, onStderr });
```
替换为：
```js
          const result = await runStepScript(rootDir, 'vtt2md', [path.join(subsDir, vtt), outPath], {
            onOutput: options.onOutput,
            onStdout,
            onStderr,
            onProc: (proc) => { task._currentProc = proc; }
          });
          task._currentProc = null;
          if (task._abortFlag || task._stepAbortResolve) break;
```

- [ ] **Step 4: 在 `vtt2md` case 的 for 循环结束之后（`if (errors.length > 0)` 之前）添加中止检查**

```js
      // Abort check after loop (covers both task-level and step-level abort).
      if (task._stepAbortResolve) {
        const resolve = task._stepAbortResolve;
        task._stepAbortResolve = null;
        stepState.status = 'pending';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'pending');
        finishLogs();
        emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
        resolve();
        return { success: false, error: 'aborted' };
      }
      if (task._abortFlag) {
        finishLogs();
        return { success: false, error: 'aborted' };
      }
```

- [ ] **Step 5: 同样修改 `md2vtt` case 的循环内 `runStepScript` 调用**

找到 `case 'md2vtt':` 里的 `runStepScript` 调用：
```js
          const result = await runStepScript(rootDir, 'md2vtt', [mdPath, mdPath.replace('.md', '.vtt')], {
            onOutput: options.onOutput,
            onStdout,
            onStderr
          });
```
替换为：
```js
          const result = await runStepScript(rootDir, 'md2vtt', [mdPath, mdPath.replace('.md', '.vtt')], {
            onOutput: options.onOutput,
            onStdout,
            onStderr,
            onProc: (proc) => { task._currentProc = proc; }
          });
          task._currentProc = null;
          if (task._abortFlag || task._stepAbortResolve) break;
```

- [ ] **Step 6: 在 `md2vtt` case 的 for 循环结束之后（`if (errors.length > 0)` 之前）同样添加中止检查**

```js
      if (task._stepAbortResolve) {
        const resolve = task._stepAbortResolve;
        task._stepAbortResolve = null;
        stepState.status = 'pending';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'pending');
        finishLogs();
        emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
        resolve();
        return { success: false, error: 'aborted' };
      }
      if (task._abortFlag) {
        finishLogs();
        return { success: false, error: 'aborted' };
      }
```

- [ ] **Step 5: 验证语法**

```bash
node --check core/orchestrator/index.js
```

期望：无输出

- [ ] **Step 6: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): wire abort signals in runStep"
```

---

## Task 3: abortTask 函数 + runTask DAG 中止检查

**Files:**
- Modify: `core/orchestrator/index.js` (runTask 函数 ~line 864–985，module.exports)

- [ ] **Step 1: 修改 `runTask` 的 DAG 循环，在 `pickNextStep` 之后、`await runStep` 之前插入中止检查**

找到 `runTask` 内的 `for (let guard = 0; guard < 64; guard++)` 循环（line ~879），在 `if (!next) break;` 之后插入：

```js
      if (task._abortFlag) break;
```

- [ ] **Step 2: 修改 `runTask` 的 `finally` 块，将现有 `try { ... } catch (_) {}` 整块包裹进 `else` 分支**

找到 `finally {` 块（line ~906），把整个 finally 块的内容改为：

```js
  } finally {
    activeRunTasks = Math.max(0, activeRunTasks - 1);

    if (task._abortFlag) {
      try {
        const _rootDir = task.params && task.params.rootDir;
        const _id = task.meta && task.meta.id;
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
        }
        task.status = 'pending';
        task.updated_at = new Date().toISOString();
        task._abortFlag = false;
        task._currentProc = null;
        emitOrchestratorEvent('task.updated', taskId, { status: 'pending' });
      } catch (_) {}
      const resolvers = task._abortResolvers.splice(0);
      resolvers.forEach((r) => r());
    } else {
      try {
        // ── 现有 finalize 代码保持原样，整体挪入此 else 块 ──
        updateTaskMetaFromFilesystem(task);
        // ... （原有的所有 reconcile 逻辑）
      } catch (_) {
        // ignore finalize errors
      }
    }
  }
```

> **注意：** 把原有 `try { updateTaskMetaFromFilesystem... } catch (_) {}` 整个作为 `else` 的内容即可，原内容不变。

- [ ] **Step 3: 在 `deleteTask` 之后添加 `abortTask` 函数**

```js
async function abortTask(taskId, options = {}) {
  const task = ensureTask(taskId, options);
  if (task.status !== 'running') {
    const e = new Error('task is not running');
    e.code = 'NOT_RUNNING';
    throw e;
  }

  const waitDone = new Promise((resolve) => task._abortResolvers.push(resolve));

  task._abortFlag = true;

  const proc = task._currentProc;
  if (proc && proc.pid) {
    const sigkillTimer = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
    }, 5000);
    waitDone.then(() => clearTimeout(sigkillTimer));
    try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}
  } else {
    // No proc running (between steps): DAG loop will see _abortFlag and break,
    // then the finally block calls resolvers. Nothing extra needed here.
  }

  await waitDone;
  return { task_id: taskId, status: 'pending' };
}
```

- [ ] **Step 4: 在 `module.exports` 中加入 `abortTask`**

```js
module.exports = {
  createTask,
  listTasks,
  runTask,
  runStep,
  abortTask,       // <-- 新增
  applyResetScope,
  skipStep,
  deleteTask,
  getTask,
  getTaskResult,
  getTaskSteps,
  onEvent,
  STEPS,
  _dropTaskFromMemory,
  validateStepArtifacts
};
```

- [ ] **Step 5: 验证语法**

```bash
node --check core/orchestrator/index.js
```

期望：无输出

- [ ] **Step 6: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): add abortTask function and DAG abort check in runTask"
```

---

## Task 4: abortStep 函数

**Files:**
- Modify: `core/orchestrator/index.js`

- [ ] **Step 1: 在 `abortTask` 函数之后添加 `abortStep` 函数**

```js
async function abortStep(taskId, stepName, options = {}) {
  const task = ensureTask(taskId, options);
  if (!STEPS.includes(stepName)) {
    const e = new Error(`unknown step: ${stepName}`);
    e.code = 'BAD_STEP';
    throw e;
  }
  const s = task.steps && task.steps[stepName];
  if (!s || s.status !== 'running') {
    const e = new Error('step is not running');
    e.code = 'STEP_NOT_RUNNING';
    throw e;
  }

  const waitDone = new Promise((resolve) => { task._stepAbortResolve = resolve; });

  const proc = task._currentProc;
  if (proc && proc.pid) {
    const sigkillTimer = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
    }, 5000);
    waitDone.then(() => clearTimeout(sigkillTimer));
    try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}
  }

  await waitDone;
  return { task_id: taskId, step: stepName, status: 'pending' };
}
```

- [ ] **Step 2: 在 `module.exports` 中加入 `abortStep`**

```js
module.exports = {
  createTask,
  listTasks,
  runTask,
  runStep,
  abortTask,
  abortStep,       // <-- 新增
  applyResetScope,
  skipStep,
  deleteTask,
  getTask,
  getTaskResult,
  getTaskSteps,
  onEvent,
  STEPS,
  _dropTaskFromMemory,
  validateStepArtifacts
};
```

- [ ] **Step 3: 验证语法**

```bash
node --check core/orchestrator/index.js
```

期望：无输出

- [ ] **Step 4: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): add abortStep function"
```

---

## Task 5: HTTP cancel 路由

**Files:**
- Modify: `services/http-server/index.js`

在现有 `router.delete('/tasks/:taskId', ...)` 路由之后添加两个 cancel 路由。

- [ ] **Step 1: 在 `router.delete('/tasks/:taskId', ...)` 路由结束处（line ~250）之后添加任务级 cancel 路由**

```js
  router.post('/tasks/:taskId/cancel', async (ctx) => {
    const { taskId } = ctx.params;
    try {
      const result = await orchestrator.abortTask(taskId, { rootDir: ROOT_DIR });
      ctx.status = 200;
      ctx.body = result;
    } catch (err) {
      if (/task not found/.test(err.message)) {
        ctx.status = 404;
        ctx.body = { error: err.message };
      } else if (err.code === 'NOT_RUNNING') {
        ctx.status = 409;
        ctx.body = { error: err.message, code: err.code };
      } else {
        ctx.status = 500;
        ctx.body = { error: err.message || 'cancel failed' };
      }
    }
  });
```

- [ ] **Step 2: 紧接其后添加步骤级 cancel 路由**

```js
  router.post('/tasks/:taskId/steps/:stepName/cancel', async (ctx) => {
    const { taskId, stepName } = ctx.params;
    try {
      const result = await orchestrator.abortStep(taskId, stepName, { rootDir: ROOT_DIR });
      ctx.status = 200;
      ctx.body = result;
    } catch (err) {
      if (/task not found/.test(err.message) || err.code === 'BAD_STEP') {
        ctx.status = 404;
        ctx.body = { error: err.message };
      } else if (err.code === 'STEP_NOT_RUNNING') {
        ctx.status = 409;
        ctx.body = { error: err.message, code: err.code };
      } else {
        ctx.status = 500;
        ctx.body = { error: err.message || 'cancel step failed' };
      }
    }
  });
```

- [ ] **Step 3: 验证语法**

```bash
node --check services/http-server/index.js
```

期望：无输出

- [ ] **Step 4: Commit**

```bash
git add services/http-server/index.js
git commit -m "feat(http): add POST /api/tasks/:taskId/cancel and /steps/:stepName/cancel endpoints"
```

---

## Task 6: ServiceClient 新方法

**Files:**
- Modify: `electron/src/renderer/service-client.js`

在 `deleteTask` 方法之后添加两个方法，与现有模式完全一致。

- [ ] **Step 1: 在 `deleteTask` 方法之后（line ~106）添加两个 cancel 方法**

```js
  cancelTask(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
  }

  cancelStep(taskId, stepName) {
    return this._fetchJson(
      `/api/tasks/${encodeURIComponent(taskId)}/steps/${encodeURIComponent(stepName)}/cancel`,
      { method: 'POST' }
    );
  }
```

- [ ] **Step 2: 验证文件结构无误**

```bash
node --input-type=module <<'EOF'
import { ServiceClient } from './electron/src/renderer/service-client.js';
const c = new ServiceClient({ baseUrl: 'http://x', token: 'y' });
console.log(typeof c.cancelTask, typeof c.cancelStep);
EOF
```

期望输出：`function function`

- [ ] **Step 3: Commit**

```bash
git add electron/src/renderer/service-client.js
git commit -m "feat(service-client): add cancelTask and cancelStep methods"
```

---

## Task 7: Renderer 中止按钮

**Files:**
- Modify: `electron/src/renderer/index.html`

在 toolbar 添加「中止」按钮，仅当选中任务状态为 `running` 时显示并可用。

- [ ] **Step 1: 在 toolbar HTML 中（line ~1459）添加中止按钮**

找到：
```html
        <button class="btn" id="openBtn">Open</button>
        <button class="btn" id="deleteBtn">Delete</button>
        <button class="btn" id="manageBtn">Manage</button>
```
替换为：
```html
        <button class="btn" id="openBtn">Open</button>
        <button class="btn" id="deleteBtn">Delete</button>
        <button class="btn danger" id="cancelBtn" style="display:none">中止</button>
        <button class="btn" id="manageBtn">Manage</button>
```

- [ ] **Step 2: 在 JS 顶部变量声明区（line ~1768 附近），添加 cancelBtn 引用**

在 `const deleteBtn = document.getElementById('deleteBtn');` 之后添加：
```js
    const cancelBtn = document.getElementById('cancelBtn');
```

- [ ] **Step 3: 在 `selectTask` 函数或 SSE 事件处理中，根据任务状态切换 cancelBtn 显示**

找到 `currentTaskId = taskId;` 附近（line ~2288）的任务选中逻辑，在 `toolbar.classList.remove('hidden');` 之后添加：

```js
      // Update cancelBtn visibility based on task status
      function syncCancelBtn(taskStatus) {
        if (cancelBtn) {
          cancelBtn.style.display = taskStatus === 'running' ? '' : 'none';
        }
      }
```

然后在获取 task 后（`client.getTask(taskId).then((task) => { ... })`）调用 `syncCancelBtn(task.status)`。

同样在 SSE `task.updated` 事件处理里（line ~2013 附近）调用 `syncCancelBtn(payload.status ?? task.status)`。

- [ ] **Step 4: 添加 cancelBtn click 事件处理**

在 `deleteBtn.addEventListener('click', ...)` 之后添加：

```js
    cancelBtn.addEventListener('click', async () => {
      if (!currentTaskId || !client) return;
      cancelBtn.disabled = true;
      try {
        await client.cancelTask(currentTaskId);
      } catch (e) {
        console.error('cancelTask failed', e);
      } finally {
        cancelBtn.disabled = false;
      }
    });
```

- [ ] **Step 5: 确认 toolbar 隐藏时同步重置 cancelBtn**

找到 `toolbar.classList.add('hidden')` 的地方（约 line 2972），在其后加：
```js
      if (cancelBtn) cancelBtn.style.display = 'none';
```

- [ ] **Step 6: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(renderer): add abort button in toolbar for running tasks"
```

---

## Task 8: 测试

**Files:**
- Create: `tests/task-abort.test.js`

使用临时目录 + stub 脚本（`sleep` 进程），直接调用 orchestrator 函数测试中止行为；通过 HTTP 服务器测试 409 和 404 错误码。

- [ ] **Step 1: 创建测试文件**

```js
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
```

- [ ] **Step 2: 运行测试，确认通过**

```bash
node tests/task-abort.test.js
```

期望输出（约 2 秒内完成）：
```
[abort-test] task is running, aborting...
[abort-test] Test 1 passed: abortTask resets to pending
[abort-test] Test 2 passed: cancel non-running task returns 409
[abort-test] Test 3 passed: cancel unknown task returns 404
[abort-test] All tests passed
```

- [ ] **Step 3: 在 `package.json` 的 `scripts` 里注册测试命令**

找到 `"test:agent:core"` 之类的条目，在其旁边添加：
```json
"test:abort": "node tests/task-abort.test.js",
```

- [ ] **Step 4: 验证注册命令可运行**

```bash
npm run test:abort
```

期望：同 Step 2 输出，退出码 0

- [ ] **Step 5: Commit**

```bash
git add tests/task-abort.test.js package.json
git commit -m "test: add task abort behavioral tests"
```

---

## Task 9: 收尾验证

- [ ] **Step 1: 运行全量核心测试，确认无回归**

```bash
npm run test:agent:core
```

期望：所有测试通过

- [ ] **Step 2: 运行 orchestrator 单元测试**

```bash
npm run test:orchestrator:unit
```

期望：所有测试通过

- [ ] **Step 3: 运行 reset-scope 集成测试**

```bash
npm run test:reset-scope
```

期望：所有测试通过

- [ ] **Step 4: 启动 dev harness 手动验证 GUI**

```bash
bash harness/start-dev.sh --electron
```

1. 创建一个任务（输入 YouTube URL）
2. 等待任务进入 `running` 状态，确认 toolbar 出现「中止」按钮
3. 点击「中止」，确认按钮变 disabled
4. 确认任务状态恢复为 `pending`，「中止」按钮消失
5. 点击重跑，确认可以正常重跑

- [ ] **Step 5: 最终 commit（如有未提交的变动）**

```bash
git status
```

如有未提交文件，补充 commit 后准备 PR。
