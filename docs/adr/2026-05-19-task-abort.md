# ADR: 任务中止机制

**日期：** 2026-05-19  
**状态：** 已实施

## 背景

任务运行期间需要能够随时中止，中止后任务重置为 `pending` 状态，可直接重跑。涉及多层进程（bash → yt-dlp / ffmpeg / claude），需要保证整个进程组都能被干净地终止。

## 决策

### 进程管理：`detached: true` + 进程组 kill

`spawn` 时加 `detached: true`，使 bash 及其所有子进程属于同一进程组。中止时用 `process.kill(-proc.pid, 'SIGTERM')`，5 秒超时后升级为 `SIGKILL`。

备选方案：
- 逐层 kill 子进程——需要追踪子进程 PID 树，跨平台不可靠。
- 仅 kill bash——子进程（yt-dlp、ffmpeg）可能成为孤儿进程继续运行。

### 状态追踪：运行时字段（Approach A）

在任务对象上挂运行时内存字段：`_abortFlag`、`_currentProc`、`_abortResolvers`（任务级）、`_stepAbortResolve`（步骤级）。不持久化到 SQLite。

备选方案：
- 独立 Map 追踪——多了一层间接，与任务对象同步更复杂。
- 持久化中止状态——增加 DB schema 复杂度，而中止状态本质是运行时短暂状态。

### 中止粒度：任务级 + 步骤级

- **任务级中止**：设 `_abortFlag`，DAG 循环在下一轮调度前检测并退出，`finally` 块统一清理状态。
- **步骤级中止**：设 `_stepAbortResolve`，仅终止当前步骤进程，步骤重置为 `pending`，DAG 继续调度（不影响任务整体运行）。

### 产物清理策略

| 步骤 | 中止后处理 |
|------|-----------|
| `article` / `summary` | 删除不完整的输出文件（防止后续步骤读到残缺内容） |
| `video` / `audio` | 保留部分文件（yt-dlp 支持续传） |
| 其余步骤 | 无特殊处理 |

### HTTP 接口：同步响应

等待进程实际退出后再返回 HTTP 200，而非立即返回 202。客户端收到 200 时状态已确定为 `pending`，无需轮询。

## 影响

- `core/orchestrator/index.js`：`runStepScript` 加 `detached: true`；`runTask` DAG 循环加 abort 检测；新增 `abortTask` / `abortStep` 函数。
- `services/http-server/index.js`：两条新路由 `POST .../cancel`。
- `electron/src/renderer/`：任务卡片新增「中止」按钮，运行中显示，点击后调用 cancel API。
- 测试：`tests/task-abort.test.js`，8 个行为测试，含文件清理验证。
