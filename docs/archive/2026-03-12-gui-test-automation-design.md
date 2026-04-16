## 背景与目标

基于 `2026-03-11-gui-test-plan.md`，我们已经定义了 GUI 在「Orchestrator Service 最终态」下需要覆盖的场景（M/P/R/U/I）。本设计文档聚焦于：

- 在**不依赖真实 Electron 窗口 / 不做重型 E2E** 的前提下；
- 通过 Node 环境和现有 HTTP + SSE 接口，**程序化模拟前端行为**；
- 为后续实现一批稳定、可维护的自动化测试打基础。

目标是把原 GUI 测试计划中的「点击/界面操作」系统性映射为「Electron main + preload + ServiceClient + HTTP/SSE」层面的自动化测试，并明确哪些场景依然保留为手工或小规模 E2E 验证。

---

## 范围与不在范围

**在范围：**

- Electron 主进程本地 HTTP 服务生命周期：
  - `startLocalHttpService` / `waitForServiceReady` / `stopLocalHttpService`
  - `getFreePort`、`sanitizeLogLine`
- Preload 层暴露的 API：
  - `window.service.getServiceInfo()` 的存在性与返回结构。
- 渲染进程逻辑层：
  - `renderer/service-client.js`（HTTP + SSE 客户端）的行为：
    - `listTasks` / `createTask` / `getTask` / `subscribeEvents`
  - 与 HTTP API（`services/http-server`）和 SSE 流（`/api/events`）的交互。
- GUI 行为中可被抽象为「状态变化」而非视觉表现的部分：
  - 任务列表新增/更新；
  - 步骤状态流转（pills 背后的状态机）；
  - 日志流追加（按 seq 去重）；
  - resync（调用 `getTask` 刷新本地状态）。

**不在范围（本设计不强求自动化）：**

- 真实 Electron 窗口的像素级/布局级验证（白屏检测、首帧时间等）；
- 播放器 UI、字幕切换按钮等纯视觉交互；
- CLI 模式（`scripts/run.sh`）相关行为；
- `services/http-server` / `core/orchestrator` 本身的业务单测与端到端测试（由 Agent Service 测试计划覆盖）。

---

## 总体思路（以「B 路线」为主）

整体采用「**分层自动化 + 少量手工/脚本 smoke**」的策略：

1. **Electron main + preload 集成测试（Node 环境）**
   - 直接在 Node 测试中 require `electron/src/main.js` / `electron/src/preload.js` 的可测试导出（或抽出 helper 模块），用 fake Electron API 代替真实 app/window：
     - 验证本地 HTTP 服务的启停、健康检查与 token 生成/脱敏逻辑；
     - 验证 preload 只暴露 `window.service.getServiceInfo`，且返回结构正确。
   - 覆盖原 GUI 测试计划中 M1–M6、P1–P2 的大部分场景。

2. **ServiceClient + HTTP/SSE 集成测试（Node 环境）**
   - 将 `renderer/service-client.js` 抽象为纯 JS 模块，可在 Node 中直接 require，并注入：
     - `baseUrl`（指向本机起好的 `services/http-server`）；
     - `token`（与服务端配置一致）。
   - 在 Node 测试中驱动该客户端：
     - 调 `listTasks / createTask / getTask / subscribeEvents`；
     - 利用真实的 HTTP + SSE 行为，断言请求路径、鉴权头、事件流、状态更新。
   - 主要对应 R1–R5 以及 U2/U3/U4/U5/U6/U7 中的「逻辑层行为」。

3. **轻量逻辑 UI 测试（可选，后续演进）**
   - 若将 renderer 中的核心状态管理和事件处理函数抽出为独立模块（例如 `renderer/app-state.js` 或 `initAppLogic()`）：
     - 在 Node + `jsdom` 中创建虚拟 DOM；
     - 手动调用「逻辑事件处理函数」（相当于程序化点击按钮）；
     - 对内部状态或虚拟 DOM 做断言。
   - 这一层不是 MVP 硬性要求，但会让 U1–U8 中更多用例（如空状态、首屏行为）可以在不启动真实窗口的前提下被自动化覆盖。

4. **少量手工 / 脚本级 smoke**
   - I1「冷启动到可操作」、I3「关闭应用无僵尸进程」等跨层行为，通过：
     - 简单 shell 脚本 + `ps`/`lsof` 校验；
     - 或偶尔手动跑 `npm start` 观察首屏。
   - I2「新建任务端到端」在自动化侧拆成：
     - ServiceClient `createTask` + HTTP 轮询/事件流验证 steps 流程；
     - GUI 端只做最轻量的视觉确认。

---

## 场景映射：从 GUI 测试计划到自动化

### 1. 主进程（Main Process）场景

对应原文档 M1–M6。

- **M1/M2/M3：本地服务启动与健康检查**
  - **自动化策略：**
    - 在 Node 测试中调用导出的 `startLocalHttpService()`：
      - 断言内部通过 `getFreePort()` 分配端口；
      - 启动子进程 `node services/http-server/index.js`；
      - 在限定时间内轮询 `/healthz`，直到 `body.ok === true`。
    - 单测 `getFreePort()` 返回的端口在 `127.0.0.1` 上可连接，且不会与常见端口冲突（可以用简单的 bind 测试）。
  - **覆盖 GUI 测试项：** M1、M2、M3。

- **M4：日志脱敏**
  - **自动化策略：**
    - 对 `sanitizeLogLine(line)` 写纯函数单测：
      - 输入包含 `?token=abc123&foo=bar`、`... ?token=abc123` 等多种变体；
      - 输出中只保留 `?token=[REDACTED]`，其余内容不变。
  - **覆盖 GUI 测试项：** M4。

- **M5：IPC 暴露服务信息**
  - **自动化策略：**
    - 在 main 层提供/抽出一个 `getHttpServiceInfo()`（或复用已有 `httpServiceInfo` 读取逻辑）；
    - 在 Node 集成测试中：
      - 启动服务后调用该函数，拿到 `{ baseUrl, token }`；
      - 用 HTTP 请求 `/healthz` 验证 `baseUrl` 可用；
      - 验证 `token` 等于子进程环境里的 `AGENT_EVENTS_TOKEN`（可通过 IPC/日志回传或测试专用钩子）。
  - **覆盖 GUI 测试项：** M5。

- **M6：退出时关闭服务**
  - **自动化策略：**
    - 暴露 `stopLocalHttpService()` 或对 `app.on('before-quit')` 的 handler 抽出函数；
    - 在集成测试中：
      - 先 `startLocalHttpService()`；
      - 再调用 stop 函数；
      - 使用 `ps`/`process.kill(pid, 0)`/`net.connect` 等手段确认子进程退出、端口释放。
  - **覆盖 GUI 测试项：** M6。

### 2. Preload 场景

对应原文档 P1–P2。

- **P1：暴露的 API**
  - **自动化策略：**
    - 用 fake `contextBridge.exposeInMainWorld`（例如在测试中挂到一个普通对象上）执行 `preload.js` 逻辑；
    - 断言：
      - `window.service` 存在；
      - 只包含 `getServiceInfo`（或预期的新字段），没有 `window.api.runPipeline` 等旧 IPC。

- **P2：返回值结构**
  - **自动化策略：**
    - 使用上一步挂载的 `window.service.getServiceInfo()`，在测试中调用并 `await`；
    - 断言：
      - 返回 Promise；
      - resolve 结果为 `{ baseUrl, token }`，均为非空字符串；
      - `baseUrl` 与 main 层 `startLocalHttpService()` 提供的一致。

---

## 3. 渲染进程 ServiceClient 场景

对应原文档 R1–R5。

测试前置：通过 main 或直接 Node 启动 `services/http-server`，获取 `{ baseUrl, token }` 供客户端使用。

- **R1：初始化**
  - **自动化策略：**
    - 在 Node 测试中：
      - 调用 `getServiceInfo()`（或模拟同等结果），然后 `new ServiceClient({ baseUrl, token })`；
      - 断言构造过程不抛错；后续请求均指向该 `baseUrl`。

- **R2：listTasks**
  - **自动化策略：**
    - 预先在 SQLite 中插入 1–2 条任务，或通过 HTTP API 创建；
    - 调用 `client.listTasks({ limit: 10 })`；
    - 断言：
      - 真实请求是 `GET /api/tasks?limit=10`；
      - 请求头包含 `Authorization: Bearer <token>`；
      - 返回数组长度/字段与约定一致。

- **R3：createTask**
  - **自动化策略：**
    - 调用 `client.createTask({ url, focus, mode, force, output_lang })`；
    - 断言：
      - 请求为 `POST /api/tasks`；
      - body 为 JSON 且字段与 Agent Service 设计文档一致；
      - 返回 201 和包含 `task_id` 的 task 对象。

- **R4：getTask**
  - **自动化策略：**
    - 用 `createTask` 创建任务或直接通过 HTTP 创建；
    - 调用 `client.getTask(taskId)`；
    - 断言：
      - 请求为 `GET /api/tasks/:id`；
      - 返回结构包含 `meta` 和 `steps`，且字段与 `PROJECT_KNOWLEDGE` 中逻辑 meta 对齐。

- **R5：subscribeEvents（SSE）**
  - **自动化策略：**
    - 启动服务，并确保后台 orchestrator 会对指定任务发送事件；
    - 调用 `client.subscribeEvents()`：
      - 断言内部连接的是 `baseUrl/api/events?token=...`；
      - 监听事件流，确认至少收到：
        - 连接建立注释（如 `: connected`）；
        - 一个或多个 `task.created` / `task.updated` / `step.started` / `step.finished` 事件；
      - 在测试中使用超时/计数控制，避免挂死。

---

## 4. GUI 行为的逻辑自动化映射

对应原文档 U1–U8。

这里不验证真实 DOM，而是通过「ServiceClient + 状态模型」验证行为是否符合预期。

- **U1：首屏加载**
  - **自动化策略：**
    - 使用 `getServiceInfo()` + `listTasks()` 在 Node 测试中串联调用；
    - 断言：
      - 若 DB 中有历史任务，则返回列表非空；
      - 若无历史任务，则返回空数组，前端可据此渲染空状态。

- **U2：任务列表展示**
  - **自动化策略：**
    - 利用 `listTasks()` 的结果作为「列表数据源」；
    - 若后续抽出 UI 状态模块，可在逻辑测试中将该数组注入状态并断言排序/选中逻辑。

- **U3：新建任务**
  - **自动化策略：**
    - 调用 `client.createTask()` 后立即 `listTasks()` 或 `getTask()`：
      - 断言新任务存在；
      - 其 steps 初始状态为 `pending`。

- **U4：SSE 订阅与步骤状态更新**
  - **自动化策略：**
    - 结合 R5 的事件测试，再加一层「状态模型」：
      - 为任务维护一个本地 `stepsState`；
      - 消费 SSE 事件（`task.created` / `task.updated` / `step.started` / `step.finished`），按业务规则更新本地状态；
      - 在测试中喂若干真实/模拟事件，断言状态流转 satisfies：
        - `pending → running → completed/failed`；
        - 每个 step 对应 GUI 中 pill 背后的一致状态机。

- **U5：日志追加**
  - **自动化策略：**
    - 针对某任务订阅 SSE，并关注 `log.appended` 事件；
    - 在测试中维护一个 `logs` 数组：
      - 按 `seq` 排序、去重；
      - 模拟多条乱序/重复事件，断言最终数组顺序与去重规则正确。

- **U6：resync 处理**
  - **自动化策略：**
    - 当收到 `stream.resync_required` 事件时，调用 `client.getTask(taskId)` 刷新本地状态；
    - 测试中模拟：
      - 本地状态故意与服务端不一致；
      - 触发 resync 逻辑；
      - 断言状态被服务端快照覆盖。

- **U7：步骤 Pills 映射**
  - **自动化策略：**
    - 在逻辑层维护 `stepName → UI 状态（pending/active/done/error）` 的映射函数；
    - 对各种组合（仅部分完成、某步失败等）写纯函数单测，保证映射稳定。

- **U8：空状态**
  - **自动化策略：**
    - 与 U1 类似：`listTasks()` 返回空数组 → 逻辑层输出 `isEmpty=true`，供前端渲染空状态；
    - 单测只需覆盖该条件判断。

---

## 5. 集成与回归策略

对应原文档 I1–I3。

- **I1：Electron 冷启动到可操作**
  - **自动化优先级：** 手工/轻量脚本。
  - **策略：**
    - 保持简单：偶尔通过 `npm start` 手工验证首屏加载时间和是否白屏；
    - 若未来有需要，可用 Playwright/Electron 官方测试框架加一个极轻量的「打开窗口 + 等待某元素出现」的 smoke。

- **I2：新建任务端到端**
  - **拆分为：**
    - Node 集成测试：
      - `createTask()` → SSE 事件流 → `getTask()`/`steps` 验证至少一个 step 从 `pending` → `running` → `completed/failed`；
    - GUI 侧少量手动验证：
      - 新建任务后列表与日志 UI 是否同步变化（不必须自动化）。

- **I3：关闭应用**
  - **策略：**
    - 在 main 层自动化测试中覆盖 M6（子进程退出、端口释放）；
    - 真实 GUI exit 的行为留给偶发的手工检查或简单 shell 脚本（启动 Electron → 关闭窗口 → 检查残留进程）。

---

## 6. 测试文件结构与命令（建议）

建议在根目录下扩展测试文件与 NPM Script（示意，具体实现时再细化）：

- 测试文件结构（示例）：
  - `tests/main-process.test.js`：覆盖 M1–M6；
  - `tests/preload.test.js`：覆盖 P1–P2；
  - `tests/service-client-http.test.js`：覆盖 R1–R4；
  - `tests/service-client-sse.test.js`：覆盖 R5 + U4/U5/U6/U7；
  - `tests/gui-logic-state.test.js`（可选）：覆盖 U1–U3/U8 的状态逻辑。

- `package.json` 脚本（示意）：
  - `"test:gui:main": "node tests/main-process.test.js"`
  - `"test:gui:preload": "node tests/preload.test.js"`
  - `"test:gui:client": "node tests/service-client-*.test.js"`
  - `"test:gui": "npm run test:gui:main && npm run test:gui:preload && npm run test:gui:client"`

---

## 7. 后续工作与演进方向

1. 在 Electron main/preload 中抽取少量 helper，使其更易被 Node 测试直接调用。
2. 将 `renderer/service-client.js` 明确成独立模块，避免强依赖 `window`/DOM。
3. 为 SSE 事件流定义更清晰的本地状态模型与映射函数（步骤 pills 状态机），并为其补齐单测。
4. 视实际需求决定是否引入轻量的 E2E（Playwright/Electron），仅覆盖 1–2 条关键 happy path。

本设计文档只给出「如何在不依赖真实 GUI 的前提下，把现有 GUI 测试计划映射到自动化层面」的整体思路。后续可基于本设计使用 `writing-plans` 技能补充一份更细粒度的实现计划（按文件/PR 维度拆解）。

