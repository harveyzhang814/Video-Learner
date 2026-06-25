# GUI 测试计划（Orchestrator Service 最终态）

> 基于 `feature/orchestrator-service-final-state` 的 Electron 架构：主进程仅负责启动/发现本地 HTTP 服务并暴露 `{ baseUrl, token }`，渲染进程通过 HTTP + SSE 与 `services/http-server` 通信。

---

## 1. 范围与目标

- **范围**：Electron 主进程（服务生命周期、IPC）、Preload（暴露 `service.getServiceInfo`）、渲染进程（ServiceClient、任务列表/创建、SSE 订阅、步骤 pills、日志、resync）。
- **目标**：保证 GUI 在「无本地 WebSocket、无 run-pipeline IPC」的前提下，通过 HTTP + SSE 正确展示任务状态与实时日志，并与本地服务生命周期一致。

---

## 2. 主进程（Main Process）


| 编号  | 场景          | 步骤                                           | 预期                                                                                                      |
| --- | ----------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| M1  | 应用启动时启动本地服务 | 启动 Electron，等待 `app.whenReady` 完成            | 子进程 `node services/http-server/index.js` 已 spawn，`/healthz` 返回 200，控制台有 `[agent-http] ready`，无 token 输出 |
| M2  | 获取空闲端口      | 调用 `getFreePort()`                           | 返回 127.0.0.1 上可用端口，不与其他进程冲突                                                                             |
| M3  | 服务就绪等待      | 服务未就绪时轮询 `/healthz`                          | 在超时内（如 12s）等到 `body.ok === true` 或超时抛错                                                                  |
| M4  | 日志脱敏        | 子进程 stdout/stderr 含 `?token=xxx`             | 输出到控制台的内容中 token 被替换为 `[REDACTED]`                                                                      |
| M5  | IPC 暴露服务信息  | 渲染进程调用 `service.getServiceInfo()`            | 返回 `{ baseUrl: 'http://127.0.0.1:port', token: '...' }`，且 token 与子进程环境中的 `AGENT_EVENTS_TOKEN` 一致        |
| M6  | 应用退出时关闭服务   | 触发 `before-quit`，调用 `stopLocalHttpService()` | 子进程被 kill，端口释放，无僵尸进程                                                                                    |


---

## 3. Preload


| 编号  | 场景      | 步骤                       | 预期                                                    |
| --- | ------- | ------------------------ | ----------------------------------------------------- |
| P1  | 暴露的 API | 在渲染进程检查 `window.service` | 存在 `getServiceInfo`，无 `window.api.runPipeline` 等旧 IPC |
| P2  | 返回值结构   | 调用 `getServiceInfo()`    | 返回 Promise，resolve 为 `{ baseUrl, token }`，均为非空字符串     |


---

## 4. 渲染进程 — ServiceClient


| 编号  | 场景              | 步骤                                                                    | 预期                                                                       |
| --- | --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| R1  | 初始化             | 使用 `getServiceInfo()` 得到的 `{ baseUrl, token }` new ServiceClient(...) | 不抛错，后续请求发往正确 baseUrl                                                     |
| R2  | listTasks       | 调用 `client.listTasks({ limit: 10 })`                                  | 请求 `GET /api/tasks?limit=10`，带 `Authorization: Bearer <token>`，返回任务数组    |
| R3  | createTask      | 调用 `client.createTask({ url, focus, mode, force, output_lang })`      | 请求 `POST /api/tasks`，body 为 JSON，返回 201 及 task 对象                        |
| R4  | getTask         | 调用 `client.getTask(taskId)`                                           | 请求 `GET /api/tasks/:id`，返回任务详情（含 meta、steps）                             |
| R5  | subscribeEvents | 调用 `client.subscribeEvents()`                                         | 返回 EventSource，连接 `baseUrl/api/events?token=...`，能收到 `connected` 注释及后续事件 |


---

## 5. 渲染进程 — UI 行为


| 编号  | 场景        | 步骤                                 | 预期                                                                                                |
| --- | --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| U1  | 首屏加载      | 打开窗口，首帧完成                          | 调用 `getServiceInfo()` → `listTasks()`，历史列表展示（或空状态）；无报错                                            |
| U2  | 任务列表展示    | 存在已完成/运行中任务                        | 列表项显示 taskId/标题/状态等，点击可选中并刷新右侧详情                                                                  |
| U3  | 新建任务      | 点击「新建」，输入 URL（及 focus/mode），确认     | 调用 `createTask()`，列表或详情中出现新任务，步骤 pills 为 pending；弹窗内可显示步骤与日志                                      |
| U4  | SSE 订阅    | 在创建任务或选中任务后已调用 `subscribeEvents()` | 收到 `task.created` / `task.updated` / `step.started` / `step.finished` 时，对应任务步骤 pill 与状态更新         |
| U5  | 日志追加      | 某任务 step 运行中，收到 `log.appended`     | 弹窗日志区域按 seq 去重追加行，自动滚动到底部；错误行可高亮                                                                  |
| U6  | resync 处理 | 收到 `stream.resync_required`        | 用当前 taskId 调用 `getTask()` 或快照接口刷新任务/步骤状态，避免状态长期不一致                                                |
| U7  | 步骤 Pills  | 步骤状态变化                             | fetch/video/audio/subs/vtt2md/md2vtt/article/summary 的 pill 随 step 状态显示 pending/active/done/error |
| U8  | 空状态       | 无任务                                | 显示空状态提示，新建按钮可用                                                                                    |


---

## 6. 集成与回归


| 编号  | 场景               | 步骤                                          | 预期                                                       |
| --- | ---------------- | ------------------------------------------- | -------------------------------------------------------- |
| I1  | Electron 冷启动到可操作 | `npm start` 或 `start-electron.sh` 启动，等待窗口出现 | 10s 内窗口显示，历史列表或空状态可见，无白屏或未捕获异常                           |
| I2  | 新建任务端到端          | 输入有效 YouTube URL，创建任务，等待至少一个 step 完成        | 任务出现在列表，步骤 pill 从 pending → active → done（或 error），日志有输出 |
| I3  | 关闭应用             | 关闭窗口或退出应用                                   | 进程退出，无残留 node 子进程监听端口                                    |


---

## 7. 非目标（Out of Scope）

- 不覆盖 `services/http-server` 或 `core/orchestrator` 的单元测试（见 Agent Service 测试计划）。
- 不覆盖 CLI 模式（`scripts/run.sh`）。
- 不覆盖「打开文件夹」「删除任务」等尚未通过 HTTP API 暴露的功能的完整 E2E（可列占位/后续补充）。

---

## 8. 执行方式与优先级

- **手工/自动化**：主进程与 Preload 可考虑 Electron 环境下的单元/集成测试（如 spectron 或 playwright）；渲染进程 ServiceClient 可用 mock 的 fetch/EventSource 做单元测试；UI 行为与 I1–I3 建议手工或 E2E 覆盖。
- **优先级**：M1/M5/M6、P1/P2、R1–R5、U1/U3/U4、I1/I2/I3 为 P0；其余为 P1。

---

## 9. 参考

- `docs/PROJECT_KNOWLEDGE.md`：Electron 与 Agent Service 架构说明。
- `electron/src/main.js`：服务启动/停止与 IPC。
- `electron/src/renderer/service-client.js`：HTTP + SSE 客户端。
- `electron/src/renderer/index.html`：UI 与事件处理。

