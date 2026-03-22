# 步骤 `run` + `reset_scope`（HTTP + core）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 **不新增路由** 的前提下，扩展 `POST /api/tasks/:taskId/steps/:stepName/run`：请求体 **`reset_scope`** 取 `off`（默认）| `step` | `downstream`，分别对应「仅 runStep」「先重置本步再 runStep」「先重置下游闭包再 fire-and-forget runTask」。语义见 [`2026-03-22-resume-from-step-design.md`](./2026-03-22-resume-from-step-design.md)。

**Architecture:** `schedule.js` 提供 `getDownstreamClosure`；`core/orchestrator` 提供 `applyResetScope(taskId, stepName, scope, options)`（或等价拆分）；HTTP 在调用 `runStep`/`runTask` 前调用重置；**不**在 `runStep` 内隐式改其它步。

**Tech Stack:** Node.js、Koa、现有 `db.updateStep`。

**设计依据：** [2026-03-22-resume-from-step-design.md](./2026-03-22-resume-from-step-design.md)

---

### Task 1: `getDownstreamClosure` + 单元测试

**Files:**
- Modify: `core/orchestrator/schedule.js`
- Modify: `tests/orchestrator-schedule.test.js`

**Step 1:** 导出 `getDownstreamClosure(stepName)`，返回 `Set`（含起点）；边为 `STEP_EDGES` 正向邻接。

**Step 2:** 断言：`vtt2md` → 含 `vtt2md,md2vtt,article,summary`；`fetch` → 含全部从 fetch 可达；`summary` → 仅 `summary`。

**Step 3:** `npm run test:schedule` → PASS。

**Step 4:** Commit：`feat(orchestrator): add getDownstreamClosure for reset_scope`

---

### Task 2: `applyResetScope` + 与 `runTask` 衔接

**Files:**
- Modify: `core/orchestrator/index.js`
- Modify: `core/orchestrator/schedule.js`（若需导出 `excludedByMode`）

**Step 1:** 实现 `applyResetScope(taskId, stepName, scope, options = {})`：
- `scope` 仅 `'step' | 'downstream'`；`ensureTask`；非法 `stepName` → throw。
- `excludedByMode(task.params.mode).has(stepName)` → throw（`code` 供 HTTP 映射 400）。
- `task.steps[stepName].status === 'skipped'` → throw 400。
- **409**：`task.status === 'running'` 或 **任一步** `running`（与设计一致）。
- **`step`**：只更新 `stepName` 为 `pending`，清 `error`/`attempts`，写 DB。
- **`downstream`**：`closure = getDownstreamClosure(stepName)`；对闭包内非 `skipped` 步同上。

**Step 2:** 导出供 HTTP 使用；**不**在函数内自动 `runTask`（由 HTTP 在 `downstream` 分支调用）。

**Step 3:** 集成测或小脚本：createTask → 改步骤状态 → `applyResetScope` → `getTaskSteps` 校验。

**Step 4:** Commit：`feat(orchestrator): add applyResetScope for step and downstream`

---

### Task 3: 扩展 `POST .../steps/:stepName/run`

**Files:**
- Modify: `services/http-server/index.js`

**Step 1:** 解析 `body.reset_scope`（默认 `off`）；校验枚举。

**Step 2:**  
- `off`：现有逻辑，直接 `runStep(...)`。  
- `step`：`applyResetScope(..., 'step')` → `runStep(...)` → 返回与现 `run` 相同形态。  
- `downstream`：`applyResetScope(..., 'downstream')` → **202** body 含 `reset_steps` → `runTask(...).catch(...)`。

**Step 3:** 扩展 `tests/agent-http.test.js`：`downstream` 202 + 列表；默认路径回归；409 可选。

**Step 4:** Commit：`feat(http): reset_scope on step run (step | downstream)`

---

### Task 4: 文档

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md`（更新 `POST .../run` 说明，删除或改写「规划中 resume-from 独立路由」段落）
- 确认 `docs/plans/2026-03-22-orchestrator-dag-scheduler.md` 维护节仍指向 `resume-from-step-design.md`

**Step 1:** Commit：`docs: document reset_scope on POST .../steps/.../run`

---

## 验收清单

- [ ] 省略 `reset_scope` 时与改动前 `POST .../run` 行为一致。
- [ ] `step`：仅该步变 `pending` 再执行该步。
- [ ] `downstream`：闭包内置 `pending`，`skipped` 不变；202 + `runTask` 触发。
- [ ] 运行中 409。
- [ ] `npm run test:agent`（及 `test:schedule`）通过。

---

**Plan complete.** 执行可选：本会话按 Task 顺序实现，或新会话 + **executing-plans**。
