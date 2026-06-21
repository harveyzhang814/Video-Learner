# 如何运行 Web 端

> **定位说明：** Web 端是**给人用的图形界面**。Agent 不会自己访问 web 端——它没有浏览器、不需要图形界面。所有 agent 自动化需求请走 `vdl <URL>` / `vdl list / status / result` 或 `core/agent-connect.connect()` 直接调 HTTP API（详见下方"Agent 用法"小节）。

## 启动

```bash
vdl web
```

行为：

1. 如本机没有后端进程，自动启动一个（监听 `127.0.0.1:3000`）
2. 自动打开默认浏览器到 `http://127.0.0.1:3000`
3. CLI 命令立即返回，终端可继续做别的事

## 关闭

直接关闭浏览器 tab。后端会在约 30 秒内自动退出。

机制：浏览器通过 SSE 长连接被后端追踪；连接断开后，若同时没有其他 CLI / API 客户端在使用，进入 grace 期后自动 shutdown。

## 可选参数

| 参数 | 说明 |
|---|---|
| `--no-browser` | 只启动后端，不打开浏览器（用于远程访问 / 自动化） |
| `--port <n>`   | 覆盖默认端口 3000 |

## 与 CLI 任务共存

`vdl web` 启动的后端与 `vdl <URL>` 提交任务用的是同一个进程。多端可以同时使用：

```bash
# 终端 A
vdl web

# 终端 B（同时）
vdl https://www.youtube.com/watch?v=...
```

后端会等到所有客户端（浏览器 tab + CLI 任务进程）都离开后才退出。

## Agent 用法

Agent 本身**不使用** web 端。Web 端是给人用的，agent 与 web 端的唯一接触点是"代用户启动它"。

### 唯一适用场景：替用户打开 UI

用户跟 agent 说"帮我打开 web 看看"、"打开网页查任务"，或者 agent 完成某个任务后想呈现可视化结果给用户——这种"agent 是助理，用户才是使用者"的场景，直接执行：

```bash
vdl web
```

行为：
1. Agent 进程触发 CLI
2. CLI 起后端、在**用户桌面**弹出浏览器、立即 `process.exit(0)`
3. Agent 拿到 exit code 0，认为任务完成
4. **用户**在浏览器里操作；用户关浏览器 → 后端 30s 后自停
5. Agent 不需要做任何收尾

### 反模式：不要让 agent 自己"使用"web 端

| ❌ 错误意图 | ✅ 正确做法 |
|---|---|
| Agent 想跑一个 YouTube 任务 | `vdl <URL>`（CLI 自动持心跳） |
| Agent 想查任务列表 / 状态 / 结果 | `vdl list` / `vdl status <id>` / `vdl result <id>` |
| Agent 想直接调 HTTP API | `core/agent-connect.connect({ clientId: '...' })` |
| Agent 想"启动后端但不开浏览器" | 通常不需要——上面三条会自动起后端。真有需要再 `vdl web --no-browser`，但要明白 30s 后没人就关 |

技术原因：`vdl web` 的后端生命周期挂在浏览器的 SSE 长连接上。Agent 没有浏览器，启动后没人维持 SSE，后端会在 grace 期后自杀——这对 agent 的工作毫无价值，还会浪费一次 spawn。

## 故障排查

| 现象 | 排查 |
|---|---|
| `Backend running on ...` 但浏览器没打开 | macOS 检查 `open` 命令；Linux 检查 `xdg-open`；可手动访问打印的 URL |
| 浏览器显示 `connection refused` | 后端已 shutdown，重新跑 `vdl web` |
| `vdl web` 报 `Agent HTTP server failed to start` | 端口被占用，参考 `docs/explanation/singleton-backend.md` |
