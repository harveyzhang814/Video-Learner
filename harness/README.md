# harness/debug — 调试日志环境参考手册

> 面向 Agent/脚本调用，精确、结构化，不含解释性文字。

---

## 日志目录

| 类型 | 路径 |
|------|------|
| 后端 stdout（Mode A） | `/tmp/vl-backend.log` |
| 聚合日志流 | `/tmp/video-learner-debug.log` |
| debug-env PID | `/tmp/video-learner-debug.pid` |
| 后端 PID | `/tmp/vl-backend.pid` |
| Electron 主进程（Mode B） | `electron/main-process.log` |
| Electron 渲染器（Mode B） | `electron/renderer-console.log` |
| 步骤日志 | `work/<taskId>/logs/task.log.jsonl` |
| 步骤原始输出 | `work/<taskId>/logs/<step>.raw.log` |

---

## 日志来源列表

| 来源标签 | 文件 | 接入方式 | 模式 |
|----------|------|----------|------|
| `[backend]` | `/tmp/vl-backend.log` | `node services/http-server/index.js 2>&1 \| python3 timestamp-injector >> /tmp/vl-backend.log` | A |
| `[electron-main]` | `electron/main-process.log` | `patchConsole()` in `electron/src/main.js:12` — ISO 8601 格式自动写入 | B |
| `[electron-renderer]` | `electron/renderer-console.log` | preload IPC `console-message` hook in `electron/src/main.js:46` | B |
| `[<taskId>/<step>.raw.log]` | `work/<id>/logs/<step>.raw.log` | `core/orchestrator/index.js:509` — shell 脚本 stdout/stderr | A/B |
| `[<taskId>/task.log.jsonl]` | `work/<id>/logs/task.log.jsonl` | `core/orchestrator/index.js:514` — 编排层状态事件 JSONL | A/B |

**时间戳格式**：所有来源行首均为 ISO 8601（`2024-01-15T14:30:01Z` 或 `2024-01-15T14:30:01.234Z`）。backend.log 通过 Python3 注入，Electron 日志由 patchConsole 注入，JSONL 包含 `"ts"` 字段。

---

## 脚本一览

| 脚本 | 用途 |
|------|------|
| `harness/start-dev.sh` | 启动后端 + monitor + debug-env（可选 Electron） |
| `harness/monitor.sh` | 后台错误监控，状态写入 `/tmp/video-learner-error-summary.txt` |
| `harness/check-errors.sh` | 读取错误摘要，供 Agent 按需调用 |
| `harness/debug/setup.sh` | 启动聚合日志守护进程（tail -f 所有来源） |
| `harness/debug/stop.sh` | 停止聚合日志守护进程 |
| `harness/debug/discover.sh` | 扫描所有日志来源，输出 JSON manifest |
| `harness/debug/read-logs.sh` | 过滤读取聚合日志 |
| `harness/debug/verify-logs.sh` | 验证所有来源正常写入（环境就绪检查） |

---

## 启动/停止操作

### Mode A — 独立后端

```bash
# 启动（含时间戳注入）
: > /tmp/vl-backend.log
node services/http-server/index.js 2>&1 \
  | python3 -u -c 'import sys,datetime; [print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), l.rstrip(), flush=True) for l in iter(sys.stdin.readline,"")]' \
  >> /tmp/vl-backend.log &
echo $! > /tmp/vl-backend.pid

# 或使用统一启动入口
bash harness/start-dev.sh

# 启动聚合日志守护进程
bash harness/debug/setup.sh

# 停止聚合守护进程
bash harness/debug/stop.sh

# 停止后端
kill $(cat /tmp/vl-backend.pid) 2>/dev/null
```

### Mode B — Electron

```bash
bash start-electron.sh
# 日志自动写入 electron/main-process.log 和 electron/renderer-console.log
```

---

## 查询方式

```bash
# 后端日志（最近 50 行）
bash harness/debug/read-logs.sh --source backend --last 50

# Electron 主进程（最近 30 行）
bash harness/debug/read-logs.sh --source electron-main --last 30

# Electron 渲染器（最近 30 行）
bash harness/debug/read-logs.sh --source electron-renderer --last 30

# 只看错误（全部来源）
bash harness/debug/read-logs.sh --errors --last 50

# 某个任务的日志
bash harness/debug/read-logs.sh --task <taskId前缀> --last 50

# 直接读后端日志（过滤错误）
grep -iE "error|fatal|crash" /tmp/vl-backend.log | tail -20

# 直接读步骤 JSONL 错误
cat work/<taskId>/logs/task.log.jsonl | grep '"level":"error"'
```

**跨层时序关联**：各文件行首均有 ISO 8601，可用以下方式按时间合并：

```bash
cat /tmp/vl-backend.log work/<taskId>/logs/task.log.jsonl | sort | tail -50
```

---

## 验证脚本

```bash
# Mode A 验证（独立后端）
bash harness/debug/verify-logs.sh

# Mode B 验证（Electron）
bash harness/debug/verify-logs.sh --mode B

# 全部验证
bash harness/debug/verify-logs.sh --all
```

预期输出：`RESULT: OK — 环境就绪`。

---

## 错误诊断快速参考

| 现象 | 最可能原因 | 操作 |
|------|-----------|------|
| `EADDRINUSE: 3000` | 端口被旧进程占用 | `lsof -ti :3000 \| xargs kill` |
| backend.log 无时间戳 | 未用 Python3 wrapper 启动 | 用 `harness/start-dev.sh` 或手动加 pipe |
| 聚合日志为空 | debug-env 未启动 | `bash harness/debug/setup.sh` |
| 步骤日志无输出 | 任务未运行 / 步骤未触发 | `POST /api/tasks` 创建任务 |
| verify FAIL: ISO8601 | backend 直接 `>> log` 无时间戳 | 改用 Python3 timestamp injector |
