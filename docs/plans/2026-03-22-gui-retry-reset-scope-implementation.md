# GUI 重试弹窗与 `reset_scope` 接线 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 启用重试弹窗中的「自动执行后续步骤」，并在 `ServiceClient` 与确认逻辑中按设计文档发送 `reset_scope: 'step'` 或 `'downstream'`（未勾选时采用 **B**：`step` + `force: true`）。

**Architecture:** 扩展 `electron/src/renderer/service-client.js` 的 `runStep` 序列化 `reset_scope`；`index.html` 中去掉复选框 `disabled`，确认时根据勾选状态组装 body；统一处理 **409/400** 响应，下游模式调整阶段二提示文案；可选在成功响应后向 `#retryModalLog` 追加一行摘要。

**Tech Stack:** 现有 Electron renderer（单文件 `index.html`）、无新依赖；与 `services/http-server` 已有行为对齐。

**设计文档:** [`2026-03-22-gui-retry-reset-scope-design.md`](./2026-03-22-gui-retry-reset-scope-design.md)

---

### Task 1: 扩展 `ServiceClient.runStep`

**Files:**
- Modify: `electron/src/renderer/service-client.js`

**Step 1:** 将 `runStep(taskId, stepName, { focus, force, reset_scope } = {})` 中 `body` 改为仅包含有定义的字段，例如：

```javascript
const body = {};
if (focus !== undefined) body.focus = focus;
if (force !== undefined) body.force = force;
if (reset_scope !== undefined) body.reset_scope = reset_scope;
// body: JSON.stringify(body)
```

**Step 2:** 手动验证：在 DevTools 对 `runStep` 调用一次，确认 JSON 含 `reset_scope` 时字段正确。

---

### Task 2: 启用复选框与确认逻辑

**Files:**
- Modify: `electron/src/renderer/index.html`（`#retryModalAutoNext` 与 `retryModalConfirm` 的 click 处理）

**Step 1:** 去掉 `#retryModalAutoNext` 的 `disabled` 属性（或改为默认不勾选且可点）。

**Step 2:** 在确认按钮逻辑中：

- `const downstream = retryModalAutoNext && retryModalAutoNext.checked;`
- `downstream` 为 `false`：`client.runStep(..., { reset_scope: 'step', force: true })`
- `downstream` 为 `true`：`client.runStep(..., { reset_scope: 'downstream', force: true })`

**Step 3:** 若 `openRetryModal` 需要重置复选框状态，在打开时设 `checked = false`（或保留用户上次选择，按产品偏好二选一；默认 **每次打开重置为 false**）。

---

### Task 3: 阶段二文案与下游响应摘要

**Files:**
- Modify: `electron/src/renderer/index.html`（`switchRetryModalToRunning`、`retryModalLoading` 或等价）

**Step 1:** 在 `switchRetryModalToRunning` 或 `retryModalConfirm` 成功发起请求前，根据 `downstream` 设置加载文案（单步 vs 下游）。

**Step 2:** 在确认后 `.then((res) => { ... })` 中（若当前为 fire-and-forget，可改为 `await` 或 `.then`）：若 `res && res.accepted && res.reset_steps`，向 `appendRetryModalLog` 追加一行简短摘要（可选）。

**Step 3:** 对 **`downstream`**，HTTP 快速返回 **202**；确保 `_fetchJson` 不因 `success: undefined` 误判为失败（当前 `res.ok` 对 202 为 true，应无问题）。

---

### Task 4: 错误处理

**Files:**
- Modify: `electron/src/renderer/index.html`（`runStep` 的 `.catch`）

**Step 1:** 解析 `err.message` 中的状态码（现有 `throw new Error(\`${status} ${msg}\`)`）；对 **409**、**400** 使用 `appendRetryModalLog` + `alert` 或仅 `alert`，并 `retryModalConfirm.disabled = false`、`retrySession = null`，必要时回退到阶段一（`switchRetryModalToConfirm` 或等价）。

**Step 2:** 确认 **409** 文案与设计 §4.4 一致。

---

### Task 5: 文档与回归

**Files:**
- Modify（可选）: `docs/PROJECT_KNOWLEDGE.md` 一句 GUI 说明；或 `README.md` Agent/GUI 小节

**Step 1:** 手工：失败 pill → 不勾选 → 确认 → 抓包或日志确认 `reset_scope: step`。

**Step 2:** 手工：勾选「自动执行后续」→ 确认 → 确认 `reset_scope: downstream` 且任务进入多步执行。

**Step 3:** `npm run test:reset-scope`（回归服务端）；Electron 无自动化则依赖手工。

---

### Task 6: 提交

```bash
git add electron/src/renderer/service-client.js electron/src/renderer/index.html docs/plans/2026-03-22-gui-retry-reset-scope-design.md docs/plans/2026-03-22-gui-retry-reset-scope-implementation.md
git commit -m "feat(gui): wire retry modal to reset_scope step/downstream"
```

（若 §5 文档未改，可略去 `PROJECT_KNOWLEDGE.md`。）
