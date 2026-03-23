# GUI 重试弹窗与 `reset_scope` HTTP 对齐

> **状态**：设计稿（实现前请再确认 §5 验收项）。  
> **依赖**：[`2026-03-22-resume-from-step-design.md`](./2026-03-22-resume-from-step-design.md)（`POST .../steps/:stepName/run` + `reset_scope`）；已有 GUI 重试 UI 见 [`2026-03-15-gui-retry-step-design.md`](./2026-03-15-gui-retry-step-design.md)。

---

## 1. 目标

将主界面失败 pill →「重试确认」弹窗 → HTTP 调用，与 **`reset_scope`** 语义对齐，并**启用**「自动执行后续步骤？」复选框。

| 用户选择 | `reset_scope` | 说明 |
|----------|----------------|------|
| **未勾选**「自动执行后续步骤」 | **`step`** | 先将锚点步在库内重置为 `pending`（清 `error`、`attempts`），再 **`runStep`** 同步执行该步；与统一接口设计一致（用户已选 **B**）。 |
| **勾选** | **`downstream`** | 重置锚点及 DAG 下游闭包后 **`runTask`** 异步调度；HTTP **202** + `accepted`（见依赖文档）。 |

**不再使用**「仅 `off` + `force:true`」作为默认重试语义（与旧 GUI 实现不同）；旧行为等价于 `reset_scope: off`，本设计**不**作为默认，以避免「失败步未先按统一语义重置」的歧义。

---

## 2. 方案比较（实现策略）

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **A. 薄接线** | `ServiceClient.runStep` 增加 `reset_scope`；弹窗按勾选 POST；其余不动 | 改动面小 | 下游模式 UX 略糙 |
| **B. 接线 + 下游 UX（推荐）** | 同 A + 区分阶段二文案（单步 vs 整链）、**409/400** 明确提示、成功发起后在 log 中打一行摘要（含 `reset_steps` 若返回） | 与 HTTP 语义一致、可感知 | 多几行 UI 逻辑 |
| **C. 强增强** | 同 B + 下游结束后自动关闭弹窗 / Toast 展示 `reset_steps` | 更「产品化」 | 需约定「任务何时算结束」与弹窗生命周期，超出本迭代 |

**推荐**：**B**。

---

## 3. 客户端与请求体

### 3.1 `ServiceClient`（`electron/src/renderer/service-client.js`）

- `runStep(taskId, stepName, { focus, force, reset_scope } = {})`
- `body: JSON.stringify({ focus, force, reset_scope })`，**省略**值为 `undefined` 的键（或显式不传 `reset_scope` 表示由调用方决定）。

### 3.2 弹窗确认时参数

- **未勾选**：`{ reset_scope: 'step', force: true }`  
  - `force: true` 与现行为一致，保证 **video/audio** 等脚本在需要时仍强制重试（与任务创建时的 `force` 无关，仅本次请求传入 `runStep`）。
- **勾选**：`{ reset_scope: 'downstream', force: true }`  
  - **说明**：服务端对 **`downstream`** 分支当前为 `runTask(taskId, { rootDir })`，**任务级**是否强制重下仍由任务 `params.force` / DB 决定；请求体中的 `force` 可保留以便将来 HTTP 层透传，**若服务端未使用**，不改变行为（本设计不强制改后端）。

---

## 4. UI / 交互

### 4.1 复选框

- **启用** `#retryModalAutoNext`（去掉 `disabled`）。
- 文案保持：「自动执行后续步骤？」（含义：自锚点起按 DAG 重置下游并跑整条调度）。

### 4.2 阶段二（进行中）

- **单步（`step`）**：加载文案「重试中…」或「正在重试该步骤…」（与现有一致即可）。
- **下游（`downstream`）**：加载文案建议为「已提交，正在执行后续步骤…」或「调度中…」，避免用户以为仅单步同步完成。

### 4.3 SSE 与 `retrySession`

- 维持现有 **`retrySession`** 按 `taskId` 将日志写入 `#retryModalLog`。
- **`downstream`** 时多步依次执行，日志仍来自同一任务的 SSE；**不过滤 step**，便于看到完整链。

### 4.4 错误处理

| HTTP | 处理 |
|------|------|
| **409** `TASK_OR_STEP_RUNNING` | 提示「任务或某步骤正在执行，请稍后再试」；可回退到阶段一或关闭弹窗并 `getTask`。 |
| **400** `BAD_ANCHOR_MODE` / `ANCHOR_SKIPPED` | 展示 `message` 或统一文案「当前步骤不可作为锚点」。 |
| **404** | 任务或 step 不存在。 |

成功时：

- **`step`**：body 与现 `runStep` 一致（含 `success` 等）；可在 log 末尾追加 `reset_steps`（若服务端返回）。
- **`downstream`**：**202** + `accepted`、`from_step`、`reset_steps`；在 log 追加一行 `[accepted] reset_steps: ...`（可选，便于排障）。

---

## 5. 验收标准（实现后勾选）

- [x] 未勾选复选框 → 请求含 **`reset_scope: 'step'`** 且 **`force: true`**。
- [x] 勾选 → 请求含 **`reset_scope: 'downstream'`**（及 `force` 按 §3.2）。
- [x] **`ServiceClient`**：`/api/tasks/.../run` body 字段正确（手工/DevTools）。
- [x] **409/400** 在 `alert` 中可理解；失败时回退确认阶段。
- [x] `docs/PROJECT_KNOWLEDGE.md` §10.2 已补充 GUI 与 `reset_scope`。

---

## 6. 非目标（本迭代）

- 修改 **`downstream`** 时 HTTP 层对 `force` 的透传至 `runTask`（若产品需要「从该步跑后续且强制重下视频」，另开任务）。
- 在弹窗内区分「仅重置」与「重置并跑」（当前产品无「只重置不跑」的独立入口）。

---

## 7. 后续

- 用户确认本设计后，使用 **writing-plans** 产出 `docs/plans/2026-03-22-gui-retry-reset-scope-implementation.md`（任务拆分：client → 弹窗 → 错误分支 → 文档）。
