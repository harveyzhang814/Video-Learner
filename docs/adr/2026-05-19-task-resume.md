# ADR: 任务 Resume 机制

**日期：** 2026-05-19  
**状态：** 已实施

## 背景

Abort 功能将任务状态重置为 `pending`，与"从未启动"的任务无法区分，导致：
- 数据库无法查询"曾被中止"的任务历史
- GUI 无法展示明确的"已中止"状态
- 用户必须通过步骤级 reset_scope 手动恢复，没有语义清晰的"继续"入口

## 决策

### 新增独立 `aborted` 状态

任务中止后进入 `aborted` 状态（而非回到 `pending`），并持久化到 SQLite `tasks.status` 列。`aborted` 与 `pending` 语义上截然不同：前者代表"曾启动、被主动中止"，后者代表"从未启动"。

备选方案：
- 在 `meta.json` 加布尔字段——不影响 DB 查询，重启后读取路径复杂。
- 用 `pending` + 额外元数据区分——状态语义模糊，GUI 难以区分两种 pending。

### DB 迁移：tasks 表新增 status 列

`tasks` 表原本没有 `status` 列，`loadTaskFromDb` 完全从步骤状态计算任务状态。迁移方案：

```sql
ALTER TABLE tasks ADD COLUMN status TEXT
```

默认值为 `NULL`——旧行走原有计算路径，行为不变；新行写入 `'aborted'` 时 `loadTaskFromDb` 优先读取 DB 值，保证进程重启后 `aborted` 状态不丢失。

### Resume：直接复用 `runTask()`

`resumeTask()` 验证状态为 `aborted` 后，直接调用已有的 `runTask()`。`computeReadySteps()` 天然跳过 `completed`/`skipped` 步骤，从所有前驱已完成的 `pending` 步骤继续执行，无需任何额外逻辑。

备选方案：
- 记录中断点（`from_step` 参数）——比自动推断复杂，且 DAG 的状态本身已是精确断点。
- Resume 后自动重试失败步骤——混淆"中止恢复"与"失败重试"两种场景语义。

### `failed` 任务不支持 resume

`failed` 和 `aborted` 是两种不同的终态：前者需要用户主动干预（重置步骤、排查原因），后者是用户主动中断、随时可继续。混合支持会降低语义清晰度。

### HTTP 接口：202 Accepted（fire-and-forget）

`/resume` 返回 `202` 而非 `200`，因为 `runTask` 是异步执行——响应时任务刚进入 `running`，流水线尚未完成。与此形成对比，`/cancel` 返回 `200` 是因为它同步等待进程退出。

### 进程重启后：手动 resume，不自动恢复

`aborted` 状态持久化到 DB，重启后保持 `aborted`，等待用户点击"继续"。自动恢复有意外重跑的风险，对用户来说不可预期。

## 影响

- `core/orchestrator/db.js`：`initTables` 末尾新增 `status TEXT` 列迁移。
- `core/orchestrator/index.js`：abort `finally` 块写入 `db.updateTask({ status: 'aborted' })`，`task.status = 'aborted'`；`loadTaskFromDb` 优先读 `row.status === 'aborted'`；新增 `resumeTask()` 函数并导出。
- `services/http-server/index.js`：`/cancel` 响应改为 `{ status: 'aborted' }`；新增 `POST /api/tasks/:id/resume`（202）。
- `electron/src/renderer/service-client.js`：新增 `resumeTask()` 方法。
- `electron/src/renderer/index.html`：新增"继续"按钮与橙色 `aborted` 状态点；`syncCancelBtn` 改为 `syncActionButtons`，运行中显示"中止"，中止后显示"继续"。
- `electron/src/renderer/client-state.js`：修复 `step.finished` 事件在 `payload.aborted=true` 时将步骤状态正确设为 `pending`（而非 `completed`）。
- 测试：`tests/task-abort.test.js` 断言从 `pending` 改为 `aborted`；新增 `tests/task-resume.test.js`（12 个测试，含 HTTP 层验证）。
