# ADR: 单例后端 — 固定端口 + 心跳引用计数

**日期**：2026-05-23
**状态**：已实施

---

## 背景

重构前，三种启动方式（Electron GUI、`vdl` CLI、`npm run agent:serve`）各自独立管理 HTTP 服务：

- Electron 在随机端口启动服务，生成独立 token
- CLI 硬编码连接 3000 端口，启动自己的服务实例
- 两者同时运行时产生两个后端，共享同一 SQLite 但内存状态分裂

这导致：任务在 GUI 创建后 CLI 看不到；SSE 订阅分散；token 竞态（两者同时写 `/tmp/vl-agent-token`）。

---

## 决策

引入**单例后端**：所有启动方式共用固定端口 3000 上的同一服务实例。

生命周期由**心跳引用计数**管理，而非进程所有权：

- 客户端连接时注册心跳，定期续期
- 服务在无客户端且无运行任务时自动退出（`AUTO_SHUTDOWN=1` 模式）
- `npm run agent:serve` 不启用自动关闭，永久运行

---

## 核心实现

| 模块 | 职责 |
|------|------|
| `core/agent-connect.js` | 统一 check-or-start 逻辑；EADDRINUSE 竞争处理；token 重试读取 |
| `core/heartbeat-client.js` | 客户端心跳发送（unref 防阻塞退出）；主动注销 |
| `services/http-server/index.js` | 心跳注册表；auto-shutdown 循环；PID/token 文件在 bind 后写入 |
| `cli/lib/server.js` | 委托 agent-connect；注册/注销心跳 |
| `electron/src/main-helpers.js` | 委托 agent-connect；注册/注销心跳 |

---

## 理由

**为什么心跳而非进程所有权？**
进程所有权（"启动者负责关闭"）在 Electron 场景下失效——Electron 是 GUI 应用，不适合持有服务进程的生命周期权。心跳引用计数让任意客户端接入，服务自己决定何时退出。

**为什么在 `listen()` 回调内写 token 文件？**
防止 EADDRINUSE 竞争：两进程同时尝试启动时，输家的 cleanup() 会删除文件，若赢家在 bind 前已写入，输家会误删赢家的 token。在 bind 成功后写入并设 `discoveryFilesWritten` 标志，确保只有赢家拥有文件删除权。

**为什么 3 次重试读 token 文件？**
healthz 可能在 `listen()` 回调执行前返回 200（内核已完成 bind，但 Node.js 回调尚未运行）。100ms × 3 次重试关闭这个竞态窗口。

---

## 影响

- CLI 和 Electron 可完全独立启动，自动共享同一后端
- `vdl gui` 命令成为可能（CLI 启动 GUI，两者接入同一服务）
- 服务崩溃重启后，stale `running` 步骤自动重置为 `failed`
- 步骤增加独立超时上限，防止脚本卡死永久占用
