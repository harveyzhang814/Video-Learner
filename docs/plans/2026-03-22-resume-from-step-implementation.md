# `reset_scope` on `POST .../steps/:stepName/run` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 扩展 `POST /api/tasks/:taskId/steps/:stepName/run`：请求体 **`reset_scope`** 为 `off`（默认）| `step` | `downstream`，分别对应仅 `runStep`、先重置本步再 `runStep`、先重置下游闭包再 fire-and-forget `runTask`，且与设计 [`2026-03-22-resume-from-step-design.md`](./2026-03-22-resume-from-step-design.md) 一致。

**Architecture:** 在 `schedule.js` 增加正向图与 `getDownstreamClosure`；导出 `excludedByMode` 供 core 校验锚点。`db.js` 增加**不递增 attempts** 的写回方法（现有 `updateStep` 每次会把 `attempts+1`，不能直接用于「重置为 0」）。`index.js` 实现 `applyResetScope` 与错误码；`http-server` 解析 `reset_scope` 并映射 400/404/409。

**Tech Stack:** Node.js（CommonJS）、Koa、`better-sqlite3`、现有 `tests/orchestrator-schedule.test.js` / `tests/agent-http.test.js`。

**设计依据：** [2026-03-22-resume-from-step-design.md](./2026-03-22-resume-from-step-design.md)

---

### Task 1: `getDownstreamClosure` + 失败单测（TDD）

**Files:**
- Modify: `core/orchestrator/schedule.js`
- Modify: `tests/orchestrator-schedule.test.js`

**Step 1: 在 `tests/orchestrator-schedule.test.js` 末尾（`run()` 内、现有断言之后）增加用例**

```javascript
const { getDownstreamClosure } = require('../core/orchestrator/schedule');

// vtt2md → vtt2md, md2vtt, article, summary
{
  const c = getDownstreamClosure('vtt2md');
  assert.ok(c.has('vtt2md') && c.has('md2vtt') && c.has('article') && c.has('summary'));
  assert.strictEqual(c.has('fetch'), false);
}
// summary → 仅自身
{
  const c = getDownstreamClosure('summary');
  assert.strictEqual(c.size, 1);
  assert.ok(c.has('summary'));
}
```

**Step 2: 运行**

```bash
cd /path/to/Video-Learner && npm run test:schedule
```

**Expected:** FAIL（`getDownstreamClosure is not a function` 或类似）。

**Step 3: 在 `schedule.js` 实现**

- 由 `STEP_EDGES` 建 `successors: Map<step, step[]>`（对每个 `[from,to]`，`to` 加入 `from` 的列表）。
- `getDownstreamClosure(start)`：从 `start` BFS，`Set` 返回；若 `start` 不在 `ALL_STEPS` 可返回仅含 `start` 或空集——**与 `STEPS` 校验放在 core**，此处假定合法。
- `module.exports` 增加 `getDownstreamClosure`、`excludedByMode`（从文件内已有函数导出）。

**Step 4: 再运行 `npm run test:schedule` → PASS**

**Step 5: Commit**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(orchestrator): getDownstreamClosure + export excludedByMode"
```

---

### Task 2: `db.writeStepState`（重置 attempts 不经过 `updateStep`）

**Files:**
- Modify: `core/orchestrator/db.js`

**背景：** `updateStep` 在行内执行 `attempts = existing.attempts + 1`，**不能**用于设计要求的「`pending` + `attempts: 0`」。

**Step 1: 在 `createDbManager` 返回对象中增加**

```javascript
writeStepState(taskId, stepName, { status, attempts = 0, error = null }) {
  const existing = db.prepare('SELECT * FROM steps WHERE task_id = ? AND step_name = ?').get(taskId, stepName);
  if (existing) {
    return db
      .prepare(
        `UPDATE steps SET status = ?, attempts = ?, error = ?,
         started_at = NULL, completed_at = NULL
         WHERE task_id = ? AND step_name = ?`
      )
      .run(status, attempts, error, taskId, stepName);
  }
  return db
    .prepare(
      `INSERT INTO steps (task_id, step_name, status, attempts, error, started_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(taskId, stepName, status, attempts, error);
}
```

（若团队希望保留 `started_at`/`completed_at` 语义，可在实现时微调 SQL，但重置为「干净 pending」时清空时间戳更直观。）

**Step 2:** 无需单独测试文件时，可依赖 Task 4 集成测；若有精力可加 `tests/db-write-step-state.test.js` 临时库路径测一轮。

**Step 3: Commit**

```bash
git add core/orchestrator/db.js
git commit -m "feat(db): writeStepState for pending reset without attempts bump"
```

---

### Task 3: `applyResetScope` in `core/orchestrator/index.js`

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: `require` 增加** `getDownstreamClosure`, `excludedByMode` from `./schedule`。

**Step 2: 实现 `applyResetScope(taskId, stepName, scope, options = {})`**

- `scope` 仅允许 `'step' | 'downstream'`（调用方保证；非法由 HTTP 挡）。
- `const task = ensureTask(taskId, options)`。
- 若 `!STEPS.includes(stepName)` → `throw Object.assign(new Error('unknown step'), { code: 'BAD_STEP' })`。
- 若 `excludedByMode(task.params.mode).has(stepName)` → `{ code: 'BAD_ANCHOR_MODE' }`。
- 若 `(task.steps[stepName] || {}).status === 'skipped'` → `{ code: 'ANCHOR_SKIPPED' }`。
- **409：** 若 `task.status === 'running'` **或** `Object.values(task.steps).some(s => s.status === 'running')` → `{ code: 'TASK_OR_STEP_RUNNING' }`。
- **`step`：** 对 `stepName`：`task.steps[stepName] = { status: 'pending', attempts: 0, error: null }`；`db.writeStepState(id, stepName, { status: 'pending', attempts: 0, error: null })`（`id = task.meta.id`）。
- **`downstream`：** `closure = getDownstreamClosure(stepName)`；遍历 `name`：若 `task.steps[name]?.status === 'skipped'` 则 continue；否则同上写内存+DB。
- 返回 `{ reset_steps: string[] }`（按实际被置 `pending` 的步名列表，便于 HTTP body）。

**Step 3: `module.exports` 增加 `applyResetScope`**

**Step 4: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): applyResetScope for step and downstream"
```

---

### Task 4: 扩展 HTTP `POST .../steps/:stepName/run`

**Files:**
- Modify: `services/http-server/index.js`

**Step 1: 解析 body**

```javascript
const { focus, force, reset_scope: resetScopeRaw } = ctx.request.body || {};
const resetScope = resetScopeRaw == null || resetScopeRaw === '' ? 'off' : String(resetScopeRaw);
```

**Step 2: 校验枚举** — 若不在 `['off','step','downstream']` → `ctx.status = 400`，`ctx.body = { error: 'reset_scope must be off, step, or downstream' }`。

**Step 3: 分支**

- **`off`：** 保持现有 `runStep` + 状态码逻辑不变。
- **`step`：** `try { orchestrator.applyResetScope(taskId, stepName, 'step', { rootDir: ROOT_DIR }); } catch (e) { map codes }` → 再 `runStep(...)`。
- **`downstream`：** `applyResetScope(..., 'downstream')` → `ctx.status = 202`，`ctx.body = { accepted: true, task_id: taskId, from_step: stepName, reset_scope: 'downstream', reset_steps: result.reset_steps }` → `orchestrator.runTask(taskId, { rootDir: ROOT_DIR }).catch(err => console.error(...))`。

**Step 4: 错误映射**

| `err.code` | HTTP |
|------------|------|
| `TASK_OR_STEP_RUNNING` | 409 |
| `BAD_ANCHOR_MODE` / `ANCHOR_SKIPPED` / 非法锚点 | 400 |
| `BAD_STEP` / `unknown step` | 404 |
| `task not found` | 404 |

**Step 5: Commit**

```bash
git add services/http-server/index.js
git commit -m "feat(http): reset_scope on POST .../steps/:stepName/run"
```

---

### Task 5: 自动化测试

**Files:**
- Modify: `tests/agent-http.test.js`（或新建 `tests/reset-scope-http.test.js` 用 `createApp({ rootDir: tmp })` 隔离）

**Step 1:** 在 **不跑完整流水线** 的前提下：可用 `createApp({ rootDir: fs.mkdtempSync(...) })` + `orchestrator.createTask`（或通过 POST `/api/tasks`）得到 `taskId`，**手动**用 `applyResetScope` 或 DB 把某几步设为 `completed`，再：

- `POST .../steps/article/run` + `{"reset_scope":"downstream"}` → 期望 **202**，`body.reset_steps` 含 `article`、`summary`（及图中其它下游）。
- 省略 `reset_scope` 的 `POST .../run` 仍返回 **202 或 400**（与现有一致），不因新字段报错。

**Step 2:** `reset_scope: "bogus"` → **400**。

**Step 3: 运行**

```bash
npm run test:agent
npm run test:schedule
npm run test:agent:core
```

**Expected:** 全部 PASS。

**Step 4: Commit**

```bash
git add tests/agent-http.test.js
git commit -m "test(http): reset_scope downstream and validation"
```

---

### Task 6: 文档收尾

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md`（若 Task 4 后表格已准，仅补一句「已实现」或示例 body）
- 确认 [`2026-03-22-resume-from-step-design.md`](./2026-03-22-resume-from-step-design.md) 无需改语义

**Step 1: Commit**

```bash
git add docs/PROJECT_KNOWLEDGE.md
git commit -m "docs: note reset_scope implementation status"
```

---

## 验收清单

- [ ] 省略 `reset_scope` 与旧客户端完全兼容。
- [ ] `step`：仅锚点步 `pending` + `attempts` 0，再执行该步。
- [ ] `downstream`：闭包内置 `pending`，`skipped` 不变；202 + 触发 `runTask`。
- [ ] `running` → 409；非法 `reset_scope` → 400；排除锚点 / `skipped` 锚点 → 400。
- [ ] `npm run test:agent:core` 通过。

---

**Plan complete and saved to `docs/plans/2026-03-22-resume-from-step-implementation.md`. Two execution options:**

**1. Subagent-Driven（本会话）** — 每 Task 派生子代理，任务间 review，迭代快  

**2. Parallel Session（新会话）** — 新开会话加载 **executing-plans**，按检查点批量执行  

**Which approach?**
