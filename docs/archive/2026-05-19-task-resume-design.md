# Task Resume 功能设计文档

## 概述

为任务流水线添加 Resume（继续）功能：任务被 Abort 后进入独立的 `aborted` 状态，用户可通过 Resume 从中断处继续执行，已完成的 steps 不会重跑。

## 背景

现有 Abort 功能将任务状态重置为 `pending`，与"从未启动"的任务状态无法区分，导致：
- 数据库中无法查询"曾被中止"的任务
- GUI 无法展示明确的"已中止"视觉状态
- 没有语义清晰的"继续"入口，用户必须通过 step 级别的 reset_scope 手动恢复

## 用户故事

1. 用户启动任务，等待过程中点击 Cancel → 任务显示"已中止"（橙色徽章），Cancel 按钮变为 Resume 按钮
2. 用户点击 Resume → 任务从中断处继续，已完成的 steps 不重跑
3. 用户重启应用后，中止的任务仍显示"已中止"状态，Resume 按钮可用（手动触发，不自动 resume）

## 状态机

```
pending ──[run]──> running ──[complete]──> completed
                     │
                     ├──[abort]──> aborted ──[resume]──> running
                     │
                     └──[fail]──> failed
```

**Resume 仅对 `aborted` 状态有效，`failed` 任务不支持 resume。**

## 架构设计

### 涉及文件

| 层级 | 文件 | 变更类型 |
|------|------|----------|
| DB 层 | `core/orchestrator/db.js` | 新增 status 列迁移 |
| Orchestrator | `core/orchestrator/index.js` | abort finally 块改状态；loadTaskFromDb 更新；新增 `resumeTask()` |
| HTTP API | `services/http-server/index.js` | `/cancel` 响应改为 `aborted`；新增 `/resume` 路由 |
| Electron 客户端 | `electron/src/renderer/service-client.js` | 新增 `resumeTask()` |
| Electron UI | `electron/src/renderer/index.html` | 新增 resumeBtn HTML；syncActionButtons；aborted CSS |
| Electron 状态 | `electron/src/renderer/client-state.js` | 修复 step.finished aborted: true 处理 |
| 测试 | `tests/task-abort.test.js` + 新文件 | 更新期望值 + resume 测试 |

## 数据层

### Schema 变更（需要迁移）

`tasks` 表当前**没有 `status` 列**，且 `loadTaskFromDb` 从 step states 重新计算状态，不读取 DB 中的任何状态字段。必须新增列并更新恢复逻辑，才能让 `aborted` 状态在进程重启后持久存在。

**迁移（db.js `initTables` 末尾加入）：**

```js
try {
  const cols = db.prepare('PRAGMA table_info(tasks)').all();
  if (!cols.some((c) => c.name === 'status')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN status TEXT`);
    // 默认值为 NULL：现有行 status = NULL，loadTaskFromDb 走计算路径，不受影响
  }
} catch (_) {}
```

**现有行默认值：** `NULL`。`NULL !== 'aborted'`，旧任务照常走 step-states 重计算路径，行为不变。

### `loadTaskFromDb` 更新

```js
// 旧：完全从 step states 重计算
let status = 'pending';
if (statusList.some(s => s === 'running'))  status = 'running';
else if (isTaskFailed(tempTask))            status = 'failed';
else if (isTaskCompleted(tempTask))         status = 'completed';

// 新：若 DB 中明确标记为 aborted，尊重该标记
let status = 'pending';
if (row.status === 'aborted') {
  status = 'aborted';  // 进程重启后恢复中止状态，不自动 resume
} else if (statusList.some(s => s === 'running'))  status = 'running';
else if (isTaskFailed(tempTask))            status = 'failed';
else if (isTaskCompleted(tempTask))         status = 'completed';
```

### 崩溃恢复

`aborted` 状态的任务在进程重启后保持 `aborted`，等待用户手动点击 Resume。不做任何自动处理。

### 守卫矩阵

| 操作 | `aborted` 任务是否允许 | 错误码 |
|------|----------------------|--------|
| `runTask` 直接调用 | 内部函数，通过 `resumeTask` 间接调用 | — |
| `abortTask` | ✗ | `NOT_RUNNING` |
| `resumeTask` | ✓ | — |
| `abortStep` | ✗ | `STEP_NOT_RUNNING` |
| `reset_scope` via HTTP | ✓（任务须非 running，aborted 非 running 故允许） | — |

## Orchestrator 变更

### `runTask` finally 块（1 行改动 + 1 行 DB 写）

```js
// 旧
task.status = 'pending';
emitOrchestratorEvent('task.updated', taskId, { status: 'pending' });

// 新
task.status = 'aborted';
db.updateTask(id, { status: 'aborted' });   // 持久化到 DB，保证重启恢复
emitOrchestratorEvent('task.updated', taskId, { status: 'aborted' });
```

`abortTask` 返回值同步改为 `{ task_id, status: 'aborted' }`。

### Resume 后哪些 steps 重跑

`computeReadySteps()` 只返回"所有前驱全部 `completed/skipped` 的 `pending` step"。abort 时正在运行的 step 已在 finally 块中重置为 `pending`，下游未触及的 step 保持 `pending`，已完成的 step 保持 `completed`。因此 `resumeTask` 无需任何额外逻辑，`runTask` 天然从正确位置继续。

### 新增 `resumeTask(taskId)`

```js
async function resumeTask(taskId) {
  const task = getTask(taskId);
  if (!task)
    throw Object.assign(new Error('Task not found'), { code: 'NOT_FOUND' });
  if (task.status !== 'aborted')
    throw Object.assign(new Error('Task is not aborted'), { code: 'NOT_ABORTED' });

  // runTask 内部同步设 status='running' 后启动 DAG（单线程，无竞态）
  runTask(taskId).catch(err => console.error(`[resume] ${err.message}`));

  return { task_id: taskId, status: 'running' };
}
```

### `abortTask` 守卫更新

```js
// 新增 aborted 分支（现有守卫仅检查 'running'）
if (task.status === 'aborted')
  throw Object.assign(new Error('Task already aborted'), { code: 'NOT_RUNNING' });
```

### 导出

```js
module.exports = { ..., resumeTask };
```

## HTTP API 变更

### 现有 `/cancel` 端点（1 行改动）

```js
// 旧
res.json({ task_id: taskId, status: 'pending' });

// 新
res.json({ task_id: taskId, status: 'aborted' });
```

### 新增 `/resume` 端点

```
POST /api/tasks/:taskId/resume
```

```js
router.post('/tasks/:taskId/resume', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const result = await orchestrator.resumeTask(taskId, { rootDir: ROOT_DIR });
    ctx.status = 202;
    ctx.body = result; // { task_id, status: 'running' }
  } catch (err) {
    if (/task not found/.test(err.message)) { ctx.status = 404; ctx.body = { error: err.message }; }
    else if (err.code === 'NOT_ABORTED')    { ctx.status = 409; ctx.body = { error: err.message, code: 'NOT_ABORTED' }; }
    else                                    { ctx.status = 500; ctx.body = { error: err.message }; }
  }
});
```

**状态码：** `202 Accepted`（runTask 为 fire-and-forget，响应时任务尚未完成）

### SSE 事件流（无需新增事件类型）

| 时机 | 事件 | payload |
|------|------|---------|
| abort 完成 | `task.updated` | `{ status: 'aborted' }` |
| resume 触发 | `task.updated` | `{ status: 'running' }` |
| step 开始 | `step.started` | `{ step, status: 'running' }` |
| step 完成 | `step.finished` | `{ step, status: 'completed' }` |
| 全部完成 | `task.updated` | `{ status: 'completed' }` |

## Electron GUI 变更

### `index.html` — 新增 resumeBtn

```html
<!-- 现有 cancelBtn 旁边新增 -->
<button class="btn danger"   id="cancelBtn"  style="display:none">中止</button>
<button class="btn primary"  id="resumeBtn"  style="display:none">继续</button>
```

CSS（history status-dot 新增 aborted）：

```css
.history-item .status-dot.aborted { background: #F97316; }  /* 橙色 */
```

### `index.html` — `syncCancelBtn` 改为 `syncActionButtons`

```js
// 旧
function syncCancelBtn(taskStatus) {
  cancelBtn.style.display = taskStatus === 'running' ? '' : 'none';
}

// 新
function syncActionButtons(taskStatus) {
  cancelBtn.style.display = taskStatus === 'running'  ? '' : 'none';
  resumeBtn.style.display = taskStatus === 'aborted'  ? '' : 'none';
}
// 所有调用处替换为 syncActionButtons(...)
```

### `service-client.js`

```js
resumeTask(taskId) {
  return this._post(`/api/tasks/${taskId}/resume`);
}
```

### `client-state.js` — 修复 step.finished 忽略 aborted: true

```js
// 旧（第 41 行）
const status = type === 'step.failed' ? 'failed' : 'completed';

// 新
const status = type === 'step.failed' ? 'failed'
  : (payload.aborted ? 'pending' : 'completed');
```

### `ui-state.js`（若存在派生字段）

```js
isAborted: task.status === 'aborted',
canResume: task.status === 'aborted',
```

## 测试策略

### `tests/task-abort.test.js`（更新期望值）

所有 `status: 'pending'` 断言改为 `status: 'aborted'`（行 101、104、168、239、329）。

### 新文件 `tests/task-resume.test.js`

| # | 场景 | 期望结果 |
|---|------|----------|
| 1 | abort 后调用 resume | task.status → `running`，已完成 steps 保持 `completed` |
| 2 | resume 后 DAG 从 pending step 继续 | 仅运行未完成的 steps |
| 3 | resume 后正常完成 | task.status → `completed` |
| 4 | 对 `running` 任务调用 resume | 抛 `NOT_ABORTED`，HTTP 返回 409 |
| 5 | 对 `pending` 任务调用 resume | 抛 `NOT_ABORTED`，HTTP 返回 409 |
| 6 | 对 `completed` 任务调用 resume | 抛 `NOT_ABORTED`，HTTP 返回 409 |
| 7 | 对 `failed` 任务调用 resume | 抛 `NOT_ABORTED`，HTTP 返回 409 |
| 8 | abort 后 _dropTaskFromMemory + loadTaskFromDb | task.status 恢复为 `aborted`（非 `pending`） |
| 9 | 对 `aborted` 任务调用 abortTask | 抛 `NOT_RUNNING`，HTTP 返回 409 |

### 回归检查点

- `reset-scope-http.test.js`：reset_scope 逻辑不受影响（aborted 非 running，允许 reset_scope）
- `orchestrator-schedule.test.js`：DAG 逻辑无变更，预期全部通过

## NOT in scope

| 项目 | 原因 |
|------|------|
| `failed` 任务 resume | 用户明确排除 |
| 自动 resume（进程重启后） | 手动触发更安全，避免意外重跑 |
| Resume 时指定起点（from_step） | 用户选择自动推断（方案 I） |
| abort 次数统计/审计日志 | 超出本次范围 |

## What Already Exists（可复用）

| 现有机制 | 本次如何复用 |
|----------|-------------|
| `computeReadySteps()` | Resume 起点自动推断，无需新逻辑 |
| `runTask()` | resumeTask 直接调用，天然从 pending steps 继续 |
| `db.updateStep()` 现有迁移模式 | 新增 status 列迁移沿用相同 try/catch 模式 |
| SSE `task.updated` 事件 | abort/resume 状态变更无需新事件类型 |
| `_dropTaskFromMemory` | 测试中直接用于验证重启恢复 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 现有 `status: 'pending'` 断言失败 | 集中更新 task-abort.test.js 第 101/104/168/239/329 行 |
| 迁移默认值混淆 | 代码注释明确说明 NULL 为旧行默认值，走计算路径 |
| `reset_scope` HTTP 端点对 `aborted` 任务行为 | 现有守卫检查 `task.status === 'running'`，aborted 非 running 故默认允许 |
| syncCancelBtn 调用遗漏 | 全局搜索 `syncCancelBtn` 替换为 `syncActionButtons` |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 4 issues found, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT: ENG REVIEW CLEARED — ready to implement.**
