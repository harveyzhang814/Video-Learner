# Web 端后端生命周期管理 设计文档

**日期：** 2026-06-21
**分支建议：** `feature/web-backend-lifecycle`
**关联：** Electron → Web 迁移（`docs/superpowers/specs/2026-06-16-electron-to-web-migration-design.md`）

---

## 概述

为纯浏览器版 web 前端补齐后端生命周期管理：通过新增 `vdl web` 子命令负责"开机引导"（spawn 后端 + 打开浏览器），并把已有的 SSE 长连接作为浏览器侧的**被动**保活信号注入 auto-shutdown 判断。CLI / API 客户端的心跳协议、注册表、调用路径**完全不变**。

## 背景

迁移到纯浏览器架构后，原 Electron 进程承担的两项生命周期职责消失：

1. **启动**：浏览器无法 spawn 后端进程
2. **关闭通知**：浏览器关闭 tab 时无法可靠通知后端（`beforeunload` + `sendBeacon` 在多场景不可靠，且会引入新协议）

现有 CLI / API 客户端使用 `core/heartbeat-client.js` 主动心跳 + `services/http-server/index.js` 中的 `heartbeatRegistry` + auto-shutdown 循环管理生命周期，这套机制**继续保留并主导整体生命周期**。

## 关键洞察

Web 前端已经会建立长连接 `EventSource('/api/events')` 接收任务进度推送。这条 SSE 连接的 TCP 状态天然反映"浏览器还在用"：

| 事件 | TCP 反应 | 后端可观测 |
|---|---|---|
| tab 打开 | 连接建立 | `GET /api/events` handler 进入 |
| tab 关闭 | TCP FIN | `ctx.req.on('close')` 触发（已有） |
| 浏览器崩溃 / 强杀 | TCP RST | `ctx.req.on('close')` / `'error'` 触发（已有） |
| 笔记本睡眠 / 网络断 | 连接断 | `ctx.req.on('close')` 触发；醒来 EventSource 自动重连 |

→ 不需要浏览器侧任何主动心跳代码。SSE 连接的存在即"在线"，断开即"离线"。

## 架构设计

### 三类客户端共用一套生命周期裁决

```
                  ┌─→ heartbeatRegistry  ←─ CLI 任务（现有，不动）
                  │                       ←─ API 长任务客户端（现有，不动）
auto-shutdown ────┤
循环                │
                  └─→ sseRegistry        ←─ 浏览器 tab（新增，SSE 连接）

任一 registry 非空 → backend 活
两者都空 → grace 30s → process.exit(0)
```

### `vdl web` 子命令

```
vdl web              # 默认：spawn backend + open browser + exit
vdl web --no-browser # 只 spawn backend
vdl web --port 3001  # 端口覆盖
```

行为：

1. 调 `agent-connect.connect({ noHeartbeat: true })`
   - Phase 1 命中（后端已活）→ 直接打开浏览器
   - Phase 2（后端未起）→ spawn `services/http-server/index.js`，等 healthz
2. `open http://127.0.0.1:3000`（macOS `open` / Linux `xdg-open` / Windows `start`）
3. CLI 进程 `process.exit(0)` —— 终端立即回 prompt，不挂着

**`vdl web` 不持有心跳**（`noHeartbeat: true`）。后端存活完全由浏览器 SSE 连接维持。

### 后端改动（极小）

`services/http-server/index.js`：

```js
// 新增
const sseRegistry = new Set();

// /api/events handler 内（已有 ctx.req.on('close', cleanup) 旁边）
const sseId = crypto.randomUUID();
sseRegistry.add(sseId);
// cleanup 函数末尾追加：
sseRegistry.delete(sseId);

// auto-shutdown 循环判断（line ~842）
const hasClients = registry.size > 0 || sseRegistry.size > 0;

// 暴露给 ctx 供测试访问
app.context.sseRegistry = sseRegistry;
```

### 前端改动（零）

`web/src/lib/sse.ts` 已经会建立 `EventSource('/api/events')`，无需新增代码。

## 数据流

```
启动：
  用户 → vdl web
       ├─ agent-connect.connect({ noHeartbeat: true })
       │   ├─ Phase 1: healthz 成功 → 跳过 spawn
       │   └─ Phase 2: spawn services/http-server/index.js
       │       └─ 子进程写 /tmp/vl-agent-token，监听 :3000
       ├─ open http://127.0.0.1:3000
       └─ exit(0)

运行：
  浏览器 → GET /api/events （SSE）
        ├─ 后端: sseRegistry.add(uuid)
        └─ 保持长连接，接收 task 事件推送

关闭（tab 关）：
  浏览器关 tab → TCP FIN
              → ctx.req.on('close') 触发
              → sseRegistry.delete(uuid)
              → 后端 auto-shutdown 循环检测: heartbeatRegistry 空 ∧ sseRegistry 空
              → grace 30s → process.exit(0)
```

## 错误处理

| 场景 | 行为 |
|---|---|
| `vdl web` 时端口被占且非本项目 backend | `agent-connect` 现有逻辑：spawn 失败 → 报错退出 |
| `vdl web` 时 healthz 不返回 | 8s 超时，报错退出（现有） |
| `open` 命令失败（无 GUI 环境） | CLI 打印 URL 提示，退出码 0（手动复制访问） |
| 浏览器无法连 SSE（CSP/扩展拦截） | `sseRegistry` 不增长 → backend grace 后退出；前端走 `use-task-stream.ts` 重连逻辑 |
| 网络抖动导致 SSE 断开 | EventSource 自动重连 → 新的 sseId 注册 → 期间若 grace 已触发，下次连接会创建新 backend（依赖前端调用 `agent-connect`？见 §风险 1） |

## 测试策略

新增：

- `tests/sse-presence.test.js`
  - 建立 SSE 连接 → `app.context.sseRegistry.size === 1`
  - 关闭客户端 → size 回到 0
  - 两个 SSE 同时存在 → size === 2，逐个关闭依次减
- `tests/auto-shutdown-mixed.test.js`
  - 仅 heartbeat client → 不关
  - 仅 SSE client → 不关
  - 两类都空 → grace 后退出（用短 GRACE_MS 加速）
  - 一类空、另一类非空 → 不关
- `tests/cli-vdl-web.test.js`
  - mock `agent-connect.connect` 与 `child_process.spawn('open', …)`
  - 验证 `noHeartbeat: true` 传入、open 调用、process.exit(0)
  - `--no-browser` 跳过 open 调用

回归（必须仍然 green）：

- `tests/agent-connect.test.js`
- 所有 heartbeat 相关测试
- `tests/test-sse.js`

## 隔离性保证

| 模块 | 是否改动 | 原因 |
|---|---|---|
| `core/heartbeat-client.js` | ❌ | CLI/API 客户端协议不变 |
| `core/agent-connect.js` | ❌ | `noHeartbeat` 选项已存在 |
| `POST /api/heartbeat` 路由 | ❌ | 现有客户端继续调 |
| `DELETE /api/heartbeat/:id` | ❌ | 现有客户端继续调 |
| `heartbeatRegistry` 写入路径 | ❌ | 现有 |
| auto-shutdown EVICT/GRACE 常量 | ❌ | 现有 CLI 行为不变 |
| `GET /api/events` SSE handler | ✅ 加 ~3 行 | add/delete sseRegistry |
| auto-shutdown 判断 | ✅ 改 1 行 | OR 条件 |
| `cli/vdl-web.js` | ✅ 新建 ~50 行 | 新子命令 |
| `cli/index.js` | ✅ 加 ~5 行 | 注册子命令 |

## 风险和缓解

### 风险 1：浏览器尝试访问已 shutdown 的后端

**场景**：用户关 tab 后 30s+ 才重新打开浏览器历史记录，此时后端已退。

**当前**：前端 fetch 会拿到 connection refused，进入错误态。

**缓解**：
- 前端 `lib/api.ts` 加一个友好的"backend stopped"错误页，指引用户运行 `vdl web`
- 长期可考虑：浏览器侧检测到首次连接失败时，弹一个"是否需要打开终端启动后端"的提示（macOS 可深链到 Terminal.app）

本期范围内只做错误页。

### 风险 2：浏览器代理 / CSP 阻止 SSE

**影响**：后端拿不到 SSE 连接 → 误判无人使用 → grace 后关。

**缓解**：开发文档明确"web 端需允许 `127.0.0.1` SSE"；前端 SSE 失败时弹错误页。

### 风险 3：多 tab 场景

**当前设计**：每 tab 一个 SSE 连接 → 每个独立 sseId → 任一 tab 存活 backend 就活。

**符合直觉**，不需特殊处理。

### 风险 4：浏览器后台 tab 是否会主动关闭 SSE

部分浏览器节流策略可能在长时间后台时关闭 EventSource。被关后 EventSource 会自动重连 → 注册新 sseId → 不会误关 backend。

如重连前 grace 已触发，结果与"用户真的离开"等价 —— 可接受。

## 部署 / 迁移路径

1. 本期实现 `vdl web` + SSE-presence 信号
2. Electron 过渡期：Electron `electron/src/main.js` 已经走 `loadURL('http://127.0.0.1:3000')`，渲染器内的 SSE 同样注册到 sseRegistry，与 web 行为完全一致。Electron 主进程持有的 heartbeat client 继续工作，**不冲突**
3. 最终下线 Electron 时，删除 `electron/` 目录即可，无需调整 lifecycle 代码

## 不在本期范围

- 浏览器侧"backend stopped"提示页的图形设计细节（占位错误态即可）
- `vdl web --detach` 模式
- 远程访问支持（HOST 非 127.0.0.1）
- 浏览器自动唤起 Terminal.app

---

## 自检

- [x] 占位符扫描：无 TBD/TODO
- [x] 内部一致性：三种客户端 → 两个 registry → 一个 auto-shutdown 判断；表格与流程图一致
- [x] 范围聚焦：单一主题——补齐 web 端缺失的生命周期信号，不延伸到 UI/UX 与远程部署
- [x] 歧义检查：`vdl web` 行为、SSE 注册时机、auto-shutdown 判断式均给出具体代码位置
