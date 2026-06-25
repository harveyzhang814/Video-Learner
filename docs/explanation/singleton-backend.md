# 统一后端与心跳机制

本文解释为什么三种启动方式（Electron GUI、`vdl` CLI、`npm run agent:serve`）共用同一后端实例，以及心跳引用计数如何管理服务生命周期。

相关 ADR：[adr/2026-05-23-singleton-backend.md](../adr/2026-05-23-singleton-backend.md)

---

## 问题根源

重构前，Electron 主进程在随机端口启动 HTTP 服务，CLI 则硬编码连接 3000 端口。两者同时运行时会出现两个独立后端——共享同一个 SQLite 数据库，但各自维护不同的内存状态（任务注册表、SSE 订阅），导致状态不一致和 token 竞态。

---

## 解决方案：固定端口 + 心跳引用计数

所有启动方式均连接固定端口 3000。"谁先到谁占用，后来者自动接入"。

### 核心模块

**`core/agent-connect.js`** — 统一 check-or-start 入口

```
connect() 调用时：
  Phase 1: GET /healthz
    └─ 200 → 服务已在运行
              读 /tmp/vl-agent-token（最多 3 次重试 × 100ms）
              注册心跳，返回 { baseUrl, token, heartbeatHandle }

    └─ 失败 → spawn node services/http-server/index.js
              env: AUTO_SHUTDOWN=1, PORT=3000
              每 300ms 轮询 healthz，最多 8s
              若 EADDRINUSE（并发竞争）→ 重试 healthz，接入赢家
              读 token 文件，注册心跳，返回
```

CLI（`cli/lib/server.js`）和 Electron（`electron/src/main-helpers.js`）都调用 `connect()`，不再各自实现启动逻辑。

**`core/heartbeat-client.js`** — 心跳发送

```
start({ baseUrl, token, clientId, intervalMs=10000 })
  → 立即发送首次 POST /api/heartbeat
  → 每 10s 发送一次（setInterval + unref，不阻塞进程退出）
  → 返回 handle

stop(handle)
  → clearInterval
  → 发送 DELETE /api/heartbeat/:clientId
```

`intervalId.unref()` 确保心跳定时器不会阻止 CLI 或 Electron 正常退出。

---

## 服务端：心跳注册表与自动关闭

HTTP server 维护一个 `Map<clientId, lastSeenTimestamp>` 心跳注册表。

三个端点：

| 端点 | 作用 |
|------|------|
| `POST /api/heartbeat` | 注册/刷新客户端，body: `{ clientId }` |
| `GET /api/heartbeat/status` | 返回当前注册的客户端列表（调试用） |
| `DELETE /api/heartbeat/:clientId` | 客户端主动注销 |

**Auto-shutdown 循环**（仅 `AUTO_SHUTDOWN=1` 时激活，每 5s 一次）：

```
1. 驱逐超过 20s 未发心跳的客户端
2. hasClients       = registry.size > 0
3. hasRunningTasks  = orchestrator.getActiveTaskCount() > 0
4. 若 !hasClients && !hasRunningTasks：
     → 启动 30s 宽限计时器 → process.exit(0)
5. 若有新客户端或任务恢复运行：
     → 取消宽限计时器
```

`hasRunningTasks` 使用编排器内部的 `activeRunTasks` 计数器（`runTask()` 进入时 +1，`finally` 块 -1），而非查询数据库 `status` 字段——后者在进程内无法反映实时状态。这保证了**所有客户端断开后，后端仍会等任务跑完再退出**，不会中途丢弃长时间运行的步骤（如 ASR 转录、LLM 写作）。

`npm run agent:serve` 不设置 `AUTO_SHUTDOWN=1`，服务永久运行，适合长期挂载场景。

---

## Web 浏览器：SSE 连接作为被动心跳

浏览器 tab 无法 spawn 后端进程，也无法可靠地在关闭时发送 DELETE 注销请求（`beforeunload` + `sendBeacon` 在多场景下不可靠）。但 web 前端**已经**会建立长连接 `EventSource('/api/events')` 接收任务进度推送——这条 SSE 连接的 TCP 状态天然反映"浏览器还在用"。

服务端用一个独立的 Set 跟踪活跃 SSE 连接：

```
sseRegistry: Set<sseId>

GET /api/events handler:
  sseId = crypto.randomUUID()
  sseRegistry.add(sseId)
  req.on('close' | 'error') → sseRegistry.delete(sseId)
```

Auto-shutdown 循环的判断条件由 OR 复合：

```
hasClients = heartbeatRegistry.size > 0 || sseRegistry.size > 0
```

→ 三类客户端共用一套生命周期裁决，互不干扰：

| 客户端 | 注册到 | 注册方式 | 注销方式 |
|---|---|---|---|
| CLI 任务 (`vdl <URL>`) | `heartbeatRegistry` | 主动 POST `/api/heartbeat` 每 10s | 主动 DELETE 或 20s 超时 evict |
| API 客户端 | `heartbeatRegistry` | 同上 | 同上 |
| 浏览器 tab | `sseRegistry` | 建立 SSE 连接（自动） | TCP FIN/RST（关 tab、崩溃、睡眠均触发） |

### 关闭路径

```
用户关浏览器 tab → TCP FIN → ctx.req.on('close') → sseRegistry.delete(sseId)
  → auto-shutdown 循环: heartbeatRegistry 空 ∧ sseRegistry 空
  → 30s grace → process.exit(0)
```

**最坏情况延迟约 30 秒**（grace 期）。浏览器崩溃或断电导致 TCP RST 也走同一路径，无需任何客户端代码配合。

### `vdl web` 启动模式

CLI 子命令 `vdl web` 专为浏览器场景设计：

```
vdl web → agent-connect.connect({ noHeartbeat: true })
       → 若后端未起则 spawn（Phase 2 路径）
       → spawn 浏览器 open URL
       → process.exit(0)
```

关键差异：CLI **不持有心跳**（`noHeartbeat: true`）。后端存活完全由浏览器 SSE 连接维持。终端立即回 prompt，不挂起；用户唯一的关闭动作就是关浏览器 tab。

详见 [how-to/run-web.md](../how-to/run-web.md)。

---

## EADDRINUSE 竞争处理

两个进程同时检测到端口 3000 未监听，各自尝试 spawn：

```
进程 A        进程 B
  │               │
healthz 失败   healthz 失败
  │               │
spawn server   spawn server
  │               │
bind :3000 ✓   EADDRINUSE
  │               │
写 token 文件   _waitForReady 超时
  │               │
           → 再次 GET /healthz → 200
           → 读 token 文件（进程 A 写的）
           → 正常返回
```

Token/PID 文件在 `listen()` 回调内写入（bind 成功后），确保只有赢家写入，输家不会覆盖。

---

## 崩溃恢复

服务重启时，`listen()` 回调自动调用 `db.resetStaleRunningSteps()`：

- 删除 `task_id` 不合法的孤儿 step 行
- 将所有 `running` 步骤重置为 `failed`

重置后的步骤可在 GUI 或 CLI 中手动重跑。

---

## 步骤超时

每个步骤有独立的超时上限（定义于 `core/orchestrator/schedule.js`）：

| 步骤 | 默认超时 |
|------|--------|
| `video` | 2 小时 |
| `article` / `summary` / `asr` | 60 分钟 |
| `audio` | 30 分钟 |
| `fetch` / `subs` / `vtt2md` / `md2vtt` | 10 分钟 |

超时后进程组收到 SIGTERM（5s 后 SIGKILL），步骤标记为 `failed`。

### 超长视频模式（timeout_scale）

对于超长视频，可通过 **`timeout_scale`** 整体放大所有步骤的超时时长：

| 触发方式 | 作用范围 | 示例 |
|---------|---------|------|
| CLI `--long` | 该任务（×3） | `vdl --long <URL>` |
| CLI `--ultra-long` | 该任务（×6） | `vdl --ultra-long <URL>` |
| CLI `--timeout-scale <n>` | 该任务（×n） | `vdl --timeout-scale 4 <URL>` |
| HTTP `{ timeout_scale: 3 }` | 该任务（×3） | `POST /api/tasks` body |
| 环境变量 `VL_TIMEOUT_SCALE=3` | 服务端全局 | `VL_TIMEOUT_SCALE=3 npm run agent:serve` |

**优先级**（高 → 低）：`VL_TIMEOUT_<STEP>=<ms>`（单步绝对值）> per-task `timeout_scale` > `VL_TIMEOUT_SCALE` 环境变量 > 默认值。

`timeout_scale` 是 per-task 的——并发任务各自独立，互不影响。
