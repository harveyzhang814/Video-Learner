# 如何运行 Web 端

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

## 故障排查

| 现象 | 排查 |
|---|---|
| `Backend running on ...` 但浏览器没打开 | macOS 检查 `open` 命令；Linux 检查 `xdg-open`；可手动访问打印的 URL |
| 浏览器显示 `connection refused` | 后端已 shutdown，重新跑 `vdl web` |
| `vdl web` 报 `Agent HTTP server failed to start` | 端口被占用，参考 `docs/explanation/singleton-backend.md` |
