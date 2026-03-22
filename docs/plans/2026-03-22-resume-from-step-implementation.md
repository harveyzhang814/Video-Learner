# Resume From Step (HTTP + core) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 `getDownstreamClosure`、`resumeTaskFromStep`，并暴露 `POST /api/tasks/:taskId/resume-from/:stepName`；重置语义与 [`2026-03-22-resume-from-step-design.md`](./2026-03-22-resume-from-step-design.md) 一致。

**Architecture:** 在 `schedule.js` 建正向邻接与 BFS 闭包；`resumeTaskFromStep` 在 `core/orchestrator/index.js` 内更新内存+SQLite，再 `runTask` fire-and-forget（由 HTTP 层触发，与 `POST /tasks` 相同）。

**Tech Stack:** Node.js、Koa、现有 `db.updateStep`。

**设计依据：** [2026-03-22-resume-from-step-design.md](./2026-03-22-resume-from-step-design.md)

---

### Task 1: `getDownstreamClosure` + 单元测试

**Files:**
- Modify: `core/orchestrator/schedule.js`
- Create or modify: `tests/orchestrator-schedule.test.js`

**Step 1:** 导出 `getDownstreamClosure(stepName)`，返回 `Set`（含起点）。边方向与 `STEP_EDGES` 一致（从 `from` 走到 `to`）。

**Step 2:** 断言：`vtt2md` → 含 `vtt2md,md2vtt,article,summary`；`fetch` → 含全部可达；`summary` → 仅 `summary`。

**Step 3:** `node tests/orchestrator-schedule.test.js` → PASS。

**Step 4:** Commit：`feat(orchestrator): add getDownstreamClosure for resume`

---

### Task 2: `resetTaskSteps` + `resumeTaskFromStep` in orchestrator

**Files:**
- Modify: `core/orchestrator/index.js`
- Modify: `core/orchestrator/schedule.js`（如需导出 `excludedByMode` 或复用）

**设计对齐**（见设计文档 §3）：先实现 **`resetTaskSteps(taskId, anchorStep, { scope })`**，`scope` 为 `'downstream'`（闭包同现 `resume` 语义）或 `'step_only'`（仅锚点一步）；**再**实现 **`resumeTaskFromStep` = `resetTaskSteps(..., { scope: 'downstream' })` + 由调用方 `runTask`**，避免两套重置逻辑。

**Step 1:** 实现 `resetTaskSteps` / `resumeTaskFromStep`：
- `ensureTask`；若 `stepName` 不在 `STEPS`，throw。
- 若 `excludedByMode(task.params.mode).has(stepName)`，throw（由 HTTP 映射为 400）。
- `downstream`：`closure = getDownstreamClosure(stepName)`；`step_only`：`closure = { stepName }`。
- 对每个 `name ∈ closure`：若 `task.steps[name].status === 'skipped'`，continue；否则 `pending`，`error: null`，`attempts: 0`，`db.updateStep`。
- 若 `task.status === 'running'`（或与 `runTask` 互斥的同一条件），throw 专用错误（如 `Error` + `code: 'TASK_RUNNING'`）供 HTTP 映射 409。
- `emitOrchestratorEvent('task.updated', …)`（可选）。

**Step 2:** 不在此函数内自动 `runTask`（由 HTTP 调用方 fire-and-forget），或文档化二选一：**推荐** HTTP 调用 `resumeTaskFromStep` 后立刻 `runTask`，与 `POST /tasks` 一致。

**Step 3:** 单元测试：内存 task 对象 + mock db 困难时，用临时目录 + `createTask` + 改步骤状态 + `resume` + `getTaskSteps` 校验（参考 `agent-sqlite` 风格）或纯函数测试 closure + 小集成脚本。

**Step 4:** Commit：`feat(orchestrator): add resumeTaskFromStep`

---

### Task 3: HTTP 路由

**Files:**
- Modify: `services/http-server/index.js`

**Step 1:** `router.post('/tasks/:taskId/resume-from/:stepName', async …)`  
映射错误：`TASK_RUNNING` → 409；`task not found` → 404；anchor/mode → 400；成功 → **202**，body `{ task_id, from, reset_steps }`。

**Step 2:** 成功路径：`await orchestrator.resumeTaskFromStep(...)` 后 `orchestrator.runTask(...).catch(...)`。

**Step 3:** 扩展 `tests/agent-http.test.js`（或新文件）：创建任务 → 改某步为 failed → `POST resume-from` → 断言 202 且 steps 重置。

**Step 4:** Commit：`feat(http): POST resume-from step for pipeline replay`

---

### Task 4: 文档交叉引用

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md`
- Modify: `docs/plans/2026-03-22-orchestrator-dag-scheduler.md`（维护节链接 `resume-from-step-design.md`）

**Step 1:** Commit：`docs: document resume-from HTTP API`

---

## 验收清单

- [ ] `getDownstreamClosure` 单测通过。
- [ ] `resume` 后闭包内非 skipped 步为 `pending`，闭包外不变；skipped 仍为 skipped。
- [ ] 任务 `running` 时 resume 返回 409。
- [ ] `npm run test:agent`（或扩展脚本）通过。

---

**Plan complete and saved to `docs/plans/2026-03-22-resume-from-step-implementation.md`. Two execution options:**

**1. Subagent-Driven（本会话）** — 每 Task 派生子代理，任务间 review  

**2. Parallel Session（新会话）** — 新会话 + **executing-plans**  

**Which approach?**
