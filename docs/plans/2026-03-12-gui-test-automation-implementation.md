# GUI Test Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 `2026-03-12-gui-test-automation-design.md`，实现一套在 Node 环境下运行的 GUI 自动化测试，覆盖 Electron main/preload、本地 HTTP 服务、ServiceClient HTTP/SSE 行为，以及关键的 GUI 逻辑状态。

**Architecture:** 所有测试均作为 Node 脚本运行，不启动真实 Electron 窗口；通过（1）对 main/preload 抽取 helper 并在测试中直接调用，（2）在测试中启动 `services/http-server`，注入 `{ baseUrl, token }` 到 `renderer/service-client.js`，以及（3）为 SSE 事件和 GUI 状态建模，来覆盖原 GUI 测试计划中 M/P/R/U/I 的主要场景。

**Tech Stack:** Node 18+、原生 `assert` 或轻量测试框架（如 Node 内置 test）、Electron 主进程/预加载脚本、`services/http-server`（Koa）、SSE（EventSource polyfill）。

---

## Task 1: 为 main/preload 抽取可测试 helper

**Files:**
- Modify: `electron/src/main.js`
- Modify: `electron/src/preload.js`
- Create: `electron/src/main-helpers.js`
- Create: `electron/src/preload-helpers.js`

**Step 1: 为 main 提取基础 helper（start/stop/serviceInfo/sanitizeLogLine）**

- 在 `electron/src/main.js` 中识别并确认已有的函数：
  - `sanitizeLogLine(line)`
  - `getFreePort()`
  - `waitForServiceReady({ baseUrl, timeoutMs })`
  - `startLocalHttpService()`
  - `stopLocalHttpService()`（若不存在则补一个封装当前子进程退出逻辑的函数）
  - 读写 `httpServiceInfo` 的 getter（若没有则新建 `getHttpServiceInfo()`）
- 新建 `electron/src/main-helpers.js`，导出一个纯 Node 可用的 API：

```js
module.exports = {
  sanitizeLogLine,
  getFreePort,
  waitForServiceReady,
  startLocalHttpService,
  stopLocalHttpService,
  getHttpServiceInfo,
};
```

- 在 `main.js` 中从 `./main-helpers` 引用上述函数，而不是在文件顶部直接定义，实现「主进程逻辑」与「可测试 helper」的解耦。

**Step 2: 为 preload 提取暴露逻辑**

- 检查 `electron/src/preload.js` 当前写法：
  - 找出 `contextBridge.exposeInMainWorld('service', { getServiceInfo: ... })` 相关代码；
  - 留意是否还暴露了旧的 `window.api.runPipeline` 等 IPC。
- 新建 `electron/src/preload-helpers.js`，导出一个函数，例如：

```js
function registerPreloadApis({ contextBridge, ipcRenderer }) {
  // 只暴露 service.getServiceInfo
}

module.exports = { registerPreloadApis };
```

- 在 `preload.js` 中只负责从 Electron 引入 `contextBridge` / `ipcRenderer`，然后调用 `registerPreloadApis`：

```js
const { contextBridge, ipcRenderer } = require('electron');
const { registerPreloadApis } = require('./preload-helpers');

registerPreloadApis({ contextBridge, ipcRenderer });
```

**Step 3: 手动运行 Electron 以确保行为不变**

- 运行：

```bash
cd electron
npm start
```

- 期望：
  - 应用能正常启动；
  - GUI 能够展示任务列表/创建任务；
  - 控制台日志行为与改动前一致（不必完全逐行相同，但不出现明显错误）。

**Step 4: （可选）提交一次重构 commit**

- 命令示例：

```bash
git add electron/src/main.js electron/src/main-helpers.js electron/src/preload.js electron/src/preload-helpers.js
git commit -m "refactor: extract electron main/preload helpers for testing"
```

---

## Task 2: 为 main helper 编写 Node 集成测试（覆盖 M1–M6）

**Files:**
- Create: `tests/main-process.test.js`
- Read/Use: `services/http-server/index.js`

**Step 1: 初始化测试文件骨架**

- 在 `tests/main-process.test.js` 中初始化结构，使用 Node 原生 test 或简单自定义 runner，例如：

```js
const assert = require('assert');
const {
  sanitizeLogLine,
  getFreePort,
  waitForServiceReady,
  startLocalHttpService,
  stopLocalHttpService,
  getHttpServiceInfo,
} = require('../electron/src/main-helpers');

async function run() {
  // 后续填充各测试用例
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: 编写 M4 的纯函数测试（sanitizeLogLine）**

- 在 `run()` 中加入若干断言：
  - 输入带 token 的行（带 query、带空格、多次 token）；
  - 验证输出中 token 部分被 `[REDACTED]` 替代，其他文本不变。

**Step 3: 为 getFreePort 编写基本连通性测试（M2）**

- 在 `run()` 中调用 `getFreePort()`：
  - 断言返回值是数字且 > 0；
  - 用 Node `net` 创建一个 server 绑定该端口，确认不会冲突；
  - 关闭 server 释放端口。

**Step 4: 测试 startLocalHttpService + waitForServiceReady（M1/M3/M5）**

- 在 `run()` 中：
  - 调用 `await startLocalHttpService()`，拿到 `{ baseUrl, token }`；
  - 使用 `http.get` 请求 `${baseUrl}/healthz`，解析 JSON，断言 `body.ok === true`；
  - 调用 `getHttpServiceInfo()`，确认返回值与上一步一致；
  - 验证 `token` 是非空字符串（详细「是否与子进程环境一致」可作为后续增强）。

**Step 5: 测试 stopLocalHttpService（M6）**

- 在 `run()` 中：
  - 确认 `startLocalHttpService()` 已启动服务；
  - 调用 `await stopLocalHttpService()`；
  - 使用 `http.get` 或 `net.connect` 测试端口应不可再用（或请求失败），以确认没有僵尸进程在监听。

**Step 6: 将本测试脚本挂到 npm script 中**

- 在根 `package.json` 中增加：

```json
"scripts": {
  "test:gui:main": "node tests/main-process.test.js"
}
```

**Step 7: 运行测试并修正潜在问题**

- 运行：

```bash
npm run test:gui:main
```

- 预期：
  - 测试全部通过；
  - 如遇端口占用、子进程未正确退出等问题，优先修复 helper 逻辑而不是屏蔽错误。

---

## Task 3: 为 preload helper 编写 Node 集成测试（覆盖 P1–P2）

**Files:**
- Create: `tests/preload.test.js`
- Use: `electron/src/preload-helpers.js`

**Step 1: 构造 fake contextBridge/ipcRenderer**

- 在 `tests/preload.test.js` 中：

```js
const assert = require('assert');
const { registerPreloadApis } = require('../electron/src/preload-helpers');

async function run() {
  const exposed = {};
  const fakeContextBridge = {
    exposeInMainWorld(name, api) {
      exposed[name] = api;
    },
  };
  const fakeIpcRenderer = {
    invoke: async () => {
      throw new Error('not implemented in test');
    },
  };

  registerPreloadApis({ contextBridge: fakeContextBridge, ipcRenderer: fakeIpcRenderer });

  // 后续断言
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: 断言只暴露 service.getServiceInfo（P1）**

- 在 `run()` 中：
  - 断言 `exposed.service` 存在；
  - 断言 `typeof exposed.service.getServiceInfo === 'function'`；
  - 检查没有暴露诸如 `api.runPipeline` 等兼容性遗留字段。

**Step 3: 断言 getServiceInfo 返回结构（P2）**

- 为测试方便，可在 `preload-helpers` 中允许注入一个测试用 `getServiceInfoImpl`，或在测试中用 fake httpServiceInfo：
  - 在 `registerPreloadApis` 设计上支持从 main 通过 IPC 请求 `getServiceInfo`；
  - 在测试中对 `fakeIpcRenderer.invoke` 做 stub，返回 `{ baseUrl: 'http://127.0.0.1:12345', token: 'test-token' }`；
  - 在断言中：
    - `await exposed.service.getServiceInfo()`；
    - 验证返回为 Promise，且结果中 `baseUrl`、`token` 为非空字符串。

**Step 4: 将测试挂到 npm script 并运行**

- 在根 `package.json` 中增加：

```json
"scripts": {
  "test:gui:preload": "node tests/preload.test.js"
}
```

- 然后运行：

```bash
npm run test:gui:preload
```

---

## Task 4: 抽象并测试 ServiceClient 的 HTTP 行为（覆盖 R1–R4）

**Files:**
- Read/Modify: `electron/src/renderer/service-client.js`
- Create: `tests/service-client-http.test.js`
- Use: `services/http-server/index.js`

**Step 1: 确保 ServiceClient 作为可 require 模块导出**

- 在 `renderer/service-client.js` 中：
  - 确认导出了 `class ServiceClient` 或等价 API；
  - 避免在 `require` 时立即访问 `window` 或 DOM，全局使用 `fetch`/`EventSource` 应可在 Node 中 polyfill；
  - 如有必要，引入一个工厂函数：

```js
function createServiceClient({ baseUrl, token }) {
  return new ServiceClient({ baseUrl, token });
}

module.exports = { ServiceClient, createServiceClient };
```

**Step 2: 编写测试脚本骨架**

- 在 `tests/service-client-http.test.js` 中：
  - 引入 `ServiceClient`；
  - 在 `before` 部分启动本地 `services/http-server`（使用 `child_process.spawn` 或直接 require+listen）；
  - 获得 `{ baseUrl, token }`（可通过 http-server 提供的健康检查或测试专用端点）。

**Step 3: 测试 R1 初始化**

- 使用 `new ServiceClient({ baseUrl, token })`：
  - 断言构造不会抛错；
  - 若内部保存了 `this.baseUrl`，可直接断言其值。

**Step 4: 测试 listTasks（R2）**

- 前置：可通过 HTTP API 或直接往 SQLite 插入 1–2 条任务；
- 调用 `client.listTasks({ limit: 10 })`：
  - 断言返回的是数组；
  - 至少包含 `task_id`、`status` 等字段；
  - 长度符合预期（≥ 插入条数，或由 limit 控制）。

**Step 5: 测试 createTask（R3）**

- 使用一个固定 URL 调用 `client.createTask({ url, focus, mode, force, output_lang })`：
  - 断言返回包含 `task_id` 与 `meta.url` 等字段；
  - 后续用 `listTasks()` 确认该任务存在。

**Step 6: 测试 getTask（R4）**

- 在 Step 5 中拿到 `task_id` 后：
  - 调用 `client.getTask(taskId)`；
  - 断言返回结构中：
    - `task_id` 与传入一致；
    - `meta` 字段齐全（至少有 url、id、output_lang 等）；
    - `steps` 为数组，包含 `name`、`status` 等。

**Step 7: 挂到 npm script 并运行**

- 在根 `package.json` 中增加：

```json
"scripts": {
  "test:gui:client:http": "node tests/service-client-http.test.js"
}
```

- 运行：

```bash
npm run test:gui:client:http
```

---

## Task 5: 为 ServiceClient 的 SSE/状态逻辑编写测试（覆盖 R5 + U4/U5/U6/U7）

**Files:**
- Create: `tests/service-client-sse.test.js`
- (可选) Create: `electron/src/renderer/client-state.js`

**Step 1: 为 SSE 事件建模本地状态**

- 新建 `electron/src/renderer/client-state.js`（或类似），导出状态更新纯函数：

```js
function reduceTaskState(state, event) {
  // 根据 task.created/task.updated/step.started/step.finished/log.appended/stream.resync_required 等更新 state
}

module.exports = { reduceTaskState };
```

- 确保该模块不依赖 DOM，仅操作 JS 对象。

**Step 2: 为 reduceTaskState 写纯函数单测（不依赖真实 SSE）**

- 在 `tests/service-client-sse.test.js` 中：
  - 构造一个初始 `state`；
  - 依次喂一系列模拟事件（包括重试、多步混合、失败场景）；
  - 断言：
    - 步骤状态按预期从 `pending` → `running` → `completed/failed` 流转；
    - `logs` 数组按 `seq` 去重、排序；
    - 收到 `stream.resync_required` 时，设置一个 `needsResync=true` 标志（供上层调用 `getTask()`）。

**Step 3: 测试真实 SSE 流（R5 视角）**

- 在同一测试中或拆分用例：
  - 启动 `services/http-server`，创建一个任务；
  - 使用 `client.subscribeEvents()` 拿到 EventSource（或 polyfill）；
  - 在有限时间内监听事件，将每条事件交给 `reduceTaskState`；
  - 断言最终 state 中：
    - 存在该任务；
    - 至少一个 step 从 pending → running → completed/failed；
    - 有若干日志被追加。

**Step 4: 将测试脚本纳入 npm script 并运行**

- 在根 `package.json` 中增加：

```json
"scripts": {
  "test:gui:client:sse": "node tests/service-client-sse.test.js"
}
```

- 运行：

```bash
npm run test:gui:client:sse
```

---

## Task 6: 逻辑 UI 状态测试（覆盖 U1–U3/U8，可选）

**Files:**
- (可选) Create: `electron/src/renderer/ui-state.js`
- (可选) Create: `tests/gui-logic-state.test.js`

**Step 1: 抽象 GUI 状态模型**

- 在 `ui-state.js` 中定义前端所需的最小状态结构：

```js
function deriveUiState({ tasks, selectedTaskId }) {
  return {
    isEmpty: tasks.length === 0,
    selectedTask: tasks.find((t) => t.task_id === selectedTaskId) || null,
    // 其他必要字段，如排序好的任务列表、当前任务的 step pills 映射等
  };
}

module.exports = { deriveUiState };
```

**Step 2: 为 deriveUiState 写单测**

- 在 `tests/gui-logic-state.test.js` 中：
  - 测试无任务时 `isEmpty=true`（覆盖 U8）；
  - 测试有任务且选中某个任务时，`selectedTask` 正确（覆盖 U2）；
  - 测试通过 `listTasks()` + `selectedTaskId` 组合出首屏状态（覆盖 U1/U3 的逻辑部分）。

**Step 3:（可选）在 renderer 中接入 deriveUiState**

- 将现有 DOM 操作逻辑中「直接操作原始数据」的部分替换为：
  - 先调用 `deriveUiState` 获得抽象状态；
  - 再根据该状态更新 DOM；
  - 这样 UI 测试可以只关注状态，而不依赖真实 DOM。

---

## Task 7: 汇总 test:gui 脚本并完成验证

**Files:**
- Modify: `package.json`

**Step 1: 在 package.json 中统一挂载 GUI 测试入口**

- 在根 `package.json` 中的 `scripts` 段增加：

```json
"scripts": {
  "test:gui:main": "node tests/main-process.test.js",
  "test:gui:preload": "node tests/preload.test.js",
  "test:gui:client:http": "node tests/service-client-http.test.js",
  "test:gui:client:sse": "node tests/service-client-sse.test.js",
  "test:gui:state": "node tests/gui-logic-state.test.js",
  "test:gui": "npm run test:gui:main && npm run test:gui:preload && npm run test:gui:client:http && npm run test:gui:client:sse && npm run test:gui:state"
}
```

**Step 2: 跑完整 GUI 测试套件**

- 运行：

```bash
npm run test:gui
```

- 预期：
  - 所有 GUI 相关测试通过；
  - 若个别测试因异步/超时不稳定，可适当增加超时时间或对服务启动/关闭做更多保护；
  - 不依赖真实 Electron 窗口，也不需要浏览器。

---

## Task 8: 清理与提交

**Files:**
- All modified/created files in previous tasks.

**Step 1: 手动自查**

- 确认：
  - 新增测试文件命名与内容清晰；
  - main/preload 抽取的 helper 不影响现有运行行为；
  - `test:gui` 在本机可以连续运行两次以上而不残留僵尸进程。

**Step 2: 提交实现 GUI 自动化测试的 commit**

- 建议使用类似信息：

```bash
git add electron/src/main-helpers.js electron/src/preload-helpers.js electron/src/main.js electron/src/preload.js tests/*.js package.json
git commit -m "test(gui): add node-based automation for main, preload and service client"
```

---

计划完成并已保存到 `docs/plans/2026-03-12-gui-test-automation-implementation.md`。后续执行可以选择：

1. **Subagent-Driven（当前会话）**：按 Task 1–8 逐个任务执行，每个任务结束后 review 代码与测试结果，再进入下一个任务。
2. **Parallel Session（单独会话）**：在工作树中开启一个新会话，使用 `superpowers:executing-plans` 按本实现计划批量落地，并在关键任务间做检查点。

