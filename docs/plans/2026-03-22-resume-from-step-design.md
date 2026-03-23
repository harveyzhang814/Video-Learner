# 步骤运行与重置：`reset_scope` 统一接口（原 resume-from 合并）

> **修订说明（相对初稿）**：不再使用独立路径 `POST .../resume-from/:stepName`。与「只跑某步 / 只重置某步再跑 / 重置下游再跑整条调度」统一为 **`POST /api/tasks/:taskId/steps/:stepName/run`**，由 **请求体单一参数 `reset_scope`** 区分语义。

## 1. 范围与产品结论

- **本阶段**：**Agent HTTP** 扩展上述 `run` 接口；**core** 提供可复用重置逻辑。**Electron / GUI** 后续可把「重置步骤」弹窗与「从该步重跑后续」接到同一 API（不同 `reset_scope`）。
- **单一入口**：所有「对该 `stepName` 动手脚再执行」的行为，**只走一条路由**，避免客户端记两套 URL。
- **依据**：编排 B 层 DAG 与下游闭包语义见 [`2026-03-22-orchestrator-dag-scheduler.md`](./2026-03-22-orchestrator-dag-scheduler.md)；边集以 `core/orchestrator/schedule.js` 中 **`STEP_EDGES`** 为唯一来源。

---

## 2. 方案比较（为何合并）

| 方案 | 做法 | 结论 |
|------|------|------|
| **A（初稿）** | 独立 `POST .../resume-from/:stepName` + 现有 `.../steps/:run` | 路由两条，易混淆 |
| **B（当前定稿）** | **仅**扩展 `.../steps/:stepName/run`，body 增加 **`reset_scope`** | **采用**：一个参数区分三种模式，默认向后兼容 |

---

## 3. 参数：`reset_scope`

请求体为 JSON，在现有可选字段 **`focus`、`force`** 之外增加：

| 值 | 语义 | 重置范围 | 执行 |
|----|------|----------|------|
| **`off`**（默认） | 与 **当前线上行为一致** | **不**批量改任何步骤状态 | 直接 **`runStep(taskId, stepName)`**，同步等待该步结束（与现 HTTP 相同） |
| **`step`** | 「重置该步再跑」 | 仅将 **`stepName` 本步** 置 `pending`，`error: null`，`attempts: 0`（SQLite + 内存）；**不**动其它步 | 随后 **`runStep(taskId, stepName)`**，返回与该步结果一致的状态码/body |
| **`downstream`** | 「resume-from」 | 将 **`stepName` 及 DAG 下游闭包**（见 §4）中 **非 `skipped`** 步置 `pending`（同上清 `error`/`attempts`）；闭包外与前驱 **不**改 | 随后 **`runTask` fire-and-forget**（与 `POST /api/tasks` 创建后相同），**不**在本请求内同步跑单步 `stepName`；HTTP 在重置完成后即可返回 |

### 3.1 省略与兼容

- **省略 `reset_scope` 或显式 `null`**：视为 **`off`**。
- **非法字符串**：**400**，`error` 说明允许值为 `off` | `step` | `downstream`。

### 3.2 与 `mode` / `skipped` / 锚点合法性

- **`excludedByMode(mode)`** 含 `stepName`（如 `both` 下的 `audio`）：任意 `reset_scope` 均 **400**（锚点对该任务 mode 不可用）。
- **`stepName` 对应步当前为 `skipped`**：**400**（不把跳过步当锚点）。
- **下游闭包内**的 `skipped` 步：**不**改为 `pending`（保持跳过语义，与初稿一致）。

### 3.3 并发（409）

- **`reset_scope === 'downstream'`**：若 `task.status === 'running'` **或** 任一步 `steps[*].status === 'running'`，**409**（与初稿 resume 一致）。
- **`reset_scope === 'step'`**：若 **`stepName` 本步** `status === 'running'`，**409**（避免与正在执行的同一步交错）；其它步 `running` 是否禁止——**建议同样 409**（实现简单、与 downstream 一致），若产品要强需求「只重置未跑的一步」再在实现计划中放宽。

---

## 4. 下游闭包（仅 `downstream`）

- 从 **`stepName`** 出发，沿 **`STEP_EDGES` 的有向边**（`from → to`）正向 BFS/DFS，得到集合 **`C`，必含 `stepName`**。
- 对 **`n ∈ C`**：若 `task.steps[n].status === 'skipped'` 则 skip；否则置 `pending` 并清 `error`、`attempts`。
- **`S` 的前驱**不在 `C` 内则 **不**修改（除非 `C` 因图结构包含它们——按定义不包含，因边是正向从 S 走出）。

---

## 5. HTTP 响应约定

| `reset_scope` | 建议状态码 | body 要点 |
|---------------|------------|-----------|
| `off` | 与现逻辑相同（如成功 **202**，失败 **400**） | 与现 `runStep` 的 `result` 一致 |
| `step` | 同上 | 同上（重置后跑一次该步） |
| `downstream` | **202 Accepted** | `{ accepted: true, task_id, from_step, reset_scope: 'downstream', reset_steps: string[] }`；`reset_steps` 为实际被置 `pending` 的步名列表 |

其余：**404**（任务/step 名非法）、**400**（参数/锚点）、**409**（运行中冲突）、**鉴权**与现 `POST /api/tasks`、`POST .../run` 一致（本阶段不新增 token）。

---

## 6. Core 编排层（实现约束）

1. **`schedule.js`**：导出 **`getDownstreamClosure(stepName)`**（返回 `Set`，含起点）。
2. **重置逻辑**（可拆为内部函数，供 HTTP 与日后 GUI 共用）：
   - `applyResetScope(taskId, stepName, scope, options)`：`scope` 为 `'step'|'downstream'`；`'off'` 不调用。
   - `downstream` 完成后由调用方 **`runTask(taskId, options)`**（fire-and-forget）；若未来 `runTask` 对已完成任务收紧，应抽取 **`runTaskLoop`** 与创建任务路径共用。
3. **`runStep`**：保持 **A 层**校验；**不**在 `runStep` 内隐式改其它步状态——**重置一律在 HTTP 或薄封装中先于 `runStep`/`runTask` 完成**。

---

## 7. 错误、测试与文档

- **单测**：`getDownstreamClosure`；`applyResetScope` + mock DB / 小集成。
- **HTTP**：`agent-http.test.js` 扩展：`reset_scope` 省略 → 行为与现一致；`downstream` → 202 + `reset_steps`；409 场景。
- **文档**：`docs/PROJECT_KNOWLEDGE.md` 路由表更新 **`POST .../steps/:stepName/run`** 一行，说明 **`reset_scope`**；[`2026-03-22-orchestrator-dag-scheduler.md`](./2026-03-22-orchestrator-dag-scheduler.md) 维护节仍链到本文。

---

## 8. 待下一阶段（GUI）

- 「重置步骤」与「从该步重跑后续」：同一 **`runStep` HTTP**，分别传 **`reset_scope: 'step'`** 与 **`'downstream'`**（文案与二次确认文案需区分风险）。

---

## 9. 审批

本文档取代「独立 `resume-from` 路由」初稿；实现以本文与 [`2026-03-22-resume-from-step-implementation.md`](./2026-03-22-resume-from-step-implementation.md)（已同步修订）为准。
