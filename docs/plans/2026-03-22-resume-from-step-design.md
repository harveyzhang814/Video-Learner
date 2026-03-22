# 从指定 Step 重置后续链路（第二阶段）— 设计

## 范围与产品结论

- **本阶段**：**Agent HTTP** 暴露「从某步起重置后继并重新调度」能力；**core** 提供可复用入口。**Electron / GUI 不接**，留待下一阶段。
- **与现有接口关系**：
  - `POST /api/tasks/:taskId/steps/:stepName/run`：**只跑单步**，不重置后继状态；行为保持不变。
  - 新接口：**先按 DAG 重置 `S` 及后继**，再 **`runTask` 等价调度循环**（与 [`2026-03-22-orchestrator-dag-scheduler.md`](./2026-03-22-orchestrator-dag-scheduler.md) 一致）。
- **依据**：编排设计文档「从指定 step 重试剩余链路」节；DAG 边以 `core/orchestrator/schedule.js` 中 `STEP_EDGES` 为唯一来源，避免双份图。

---

## 方案比较（简述）

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **A（推荐）** | `POST /api/tasks/:id/resume-from/:stepName`；core `resumeTaskFromStep(taskId, stepName, options)` | 语义清晰、易文档化、与 `steps/:name/run` 并列不混淆 | 路径多一段 |
| **B** | `POST /api/tasks/:id/resume`，body `{ from }` | 易扩展 flags | 与 GET 类语义重复、易忘 body |
| **C** | 仅扩展现有 `.../steps/:run` 加 query `?cascade=1` | 少新路由 | 单步跑与级联重置混在同一 URL，易误用 |

**采用 A。**

---

## 核心语义

### 1. 下游闭包（downstream closure）

- 在有向图上从 **`S` 出发沿边 `前置 → 后继` 正向遍历**（与 `STEP_EDGES` 方向一致），得到节点集合 **`C`，必含 `S`**。
- **`mode` 下被排除的步**（与 `excludedByMode` 一致，如 `both` 下的 `audio`）：**不作为合法的 `S`**；若调用方传入，返回 **400**（`invalid resume anchor for mode`）。
- **`skipped` 步**：若某步当前为 `skipped`（含 mode 跳过），**仍参与图上的可达性**（边不变），但 **重置时保持 `skipped`，不改为 `pending`**（与设计文档「不参与…重置为 pending」一致：即不破坏跳过语义）。

### 2. 默认重置范围

- 对 **`C` 中每个非 `skipped` 的步**：置 `pending`，`error: null`，**`attempts` 置 `0`**（与「重新跑一条干净链路」一致；若产品以后要保留 attempts，可再开字段）。
- **`C` 外**的步：**不改**状态。
- **`S` 的前驱**：**不修改**（除非未来另增 `force` 全量入口，本阶段不做）。

### 3. 可选收窄（YAGNI 默认不做）

- 设计文档允许「仅重置 `S`、不动后继」的**高风险**模式；本阶段 **不暴露**，减少与产物不一致的误用。若以后要加，建议 body：`{ scope: 'step_only' }` 并强提示。

### 4. 调度

- 重置并持久化 SQLite 与内存 `task.steps` 后，调用与 **`POST /tasks` 相同的 fire-and-forget**：`orchestrator.runTask(taskId, { rootDir, ... })`。若未来 `runTask` 对已完成任务的入口收紧，实现时应抽取与 `runTask` **共用的调度循环**（`runTaskLoop`），由 `runTask` 与 `resumeTaskFromStep` 共用，避免两套 B 层逻辑。
- **并发**：若 `task.status === 'running'` 或等价「已有 `runTask` 在执行该任务」，**拒绝新 resume**（建议 **409**，body 含明确 `code`），避免双实例交错写步骤状态。
- 任务级 `task.status`：重置后、启动 `runTask` 前，将内存中任务标为 **`pending` 或 `running`** 与现 `runTask` 入口一致（由 `runTask` 内自行设为 `running`）；若需在重置瞬间 emit `task.updated`，在实现中补一条。

### 5. HTTP 约定

- **`POST /api/tasks/:taskId/resume-from/:stepName`**
  - **202 Accepted**：接受请求；重置在返回前完成，调度与 **`POST /api/tasks` 创建后 `runTask` 一样 fire-and-forget**。body 建议 `{ accepted: true, task_id, from, reset_steps: string[] }`（`reset_steps` 为实际被置 `pending` 的步名列表，便于客户端与日志）。
  - **404**：任务不存在 / step 名非法（不在 `STEPS`）。
  - **400**：`stepName` 对当前 `mode` 为排除步、`S` 本身为 `skipped`、或其它参数错误。
  - **409**：`task.status === 'running'` 或任一步 `steps[*].status === 'running'`，无法安全 resume。
  - **鉴权**：与现有 `POST /api/tasks`、`POST .../steps/:stepName/run` 一致，本阶段 **不** 新增 token 要求。
  - 成功响应后，客户端继续 **轮询 `GET /tasks/:id` + SSE**，与创建任务一致。

### 6. 错误与测试

- **单测**：`schedule.js` 增加 `getDownstreamClosure(stepName)`（或同义导出），断言从 `vtt2md` 出发含 `md2vtt,article,summary` 等。
- **单测 / 集成**：`resumeTaskFromStep` 后内存+DB 中对应步为 `pending`；`skipped` 不变；`runTask` 在 running 时第二次 resume 返回失败。
- **HTTP 测试**：扩展现有 `agent-http.test.js` 或新文件，覆盖 202 + reset 列表、409。

### 7. 文档

- `docs/PROJECT_KNOWLEDGE.md`：Agent HTTP 节增加 resume-from 路由一句。
- [`2026-03-22-orchestrator-dag-scheduler.md`](./2026-03-22-orchestrator-dag-scheduler.md)：维护节链接本文。

---

## 待下一阶段（GUI）

- Electron：在步骤列表上「从该步重跑后续」调用同一 HTTP 或 `core.resumeTaskFromStep`（与是否本地直连 core 的架构选择有关）；**本设计不绑定实现**。

---

## 审批

本文档经产品选择 **HTTP（B）优先、GUI 后置** 后定稿；若需调整仅重置范围或 HTTP 状态码，在实现前修订本节并同步实现计划。
