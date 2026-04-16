# Dev Harness：自动构建/启动/错误监测方案

> **适用场景**：Electron 前端 + Node.js HTTP 后端的本地开发项目。  
> **设计目标**：让 Agent（Claude Code）无需人工干预，自动启动服务、检测报错、自动修复。  
> **可移植性**：本文档描述的方案与具体业务无关，可整体迁移到其他同类项目。

---

## 目录

1. [架构概览](#1-架构概览)
2. [工作原理](#2-工作原理)
3. [文件清单](#3-文件清单)
4. [脚本完整代码](#4-脚本完整代码)
5. [主进程日志补丁（Electron）](#5-主进程日志补丁electron)
6. [Claude Code 配置](#6-claude-code-配置)
7. [Agent 操作手册](#7-agent-操作手册)
8. [移植到其他项目](#8-移植到其他项目)
9. [已知局限](#9-已知局限)

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Session                           │
│                                                                  │
│  SessionStart Hook ──► dev-autostart.sh                         │
│    ├── 后端已运行? → 报告状态，跳过                               │
│    ├── 端口占用?   → 自动清理 → 重启                              │
│    └── 启动失败?   → 输出日志 → Agent 分析错误 → 自动修复         │
│                                                                  │
│  CronCreate (每 2 分钟) ──► dev-check-errors.sh                 │
│    ├── 后端 healthz 失败 → 重启后端                              │
│    ├── 主进程日志有 [error]/[fatal] → 通知用户                   │
│    └── 渲染器有 Uncaught/TypeError → 通知用户                    │
│                                                                  │
│  按需 ──► "检查报错" → dev-check-errors.sh → 摘要输出            │
└─────────────────────────────────────────────────────────────────┘

日志文件分布：
  /tmp/vl-backend.log          ← 后端 stdout/stderr
  /tmp/vl-backend.pid          ← 后端 PID
  /tmp/vl-electron.log         ← Electron 启动 stdout/stderr（--electron 模式）
  /tmp/vl-electron.pid         ← Electron PID（--electron 模式）
  electron/main-process.log    ← Electron 主进程 console（需补丁，见第5节）
  electron/renderer-console.log← Electron 渲染器 console（框架自带）
```

---

## 2. 工作原理

### 2.1 服务启动层（dev-autostart.sh）

脚本实现了**幂等启动**逻辑：

```
运行脚本
  ↓
PID 文件存在且进程活着且 healthz OK?
  → YES: 打印"已运行"，退出
  → NO:  清理旧进程 → 清理端口占用 → 后台启动 → 轮询 healthz
            → 8s 内 OK: 报告成功
            → 超时:     打印最近 30 行日志，exit 1
```

`--electron` 参数额外启动 Electron，将其 stdout/stderr 重定向到 `/tmp/vl-electron.log`。

### 2.2 错误检测层（dev-check-errors.sh）

单次运行检查 4 个来源：

| 来源 | 文件 | 检测关键词 |
|------|------|-----------|
| 后端进程 | `/tmp/vl-backend.log` | `error`, `fatal`, `crash`, `EADDRINUSE`, `MODULE_NOT_FOUND` |
| 后端健康 | `curl /healthz` | 非 200 / 连接拒绝 |
| 主进程 | `electron/main-process.log` | `[error]`, `[fatal]`, `UncaughtException`, `UnhandledRejection`, `Process gone` |
| 渲染器 | `electron/renderer-console.log` | `[error]`, `Uncaught`, `TypeError`, `SyntaxError`, `Failed to` |

### 2.3 定时监测层（CronCreate）

在 Claude Code Session 内注册 2 分钟周期任务，触发 `dev-check-errors.sh` 并自动执行修复动作。Session 关闭后任务消失；重新开启 Session 时由 `SessionStart` hook 重新注册。

> **Agent 注意**：每次新 Session 开始时，需调用 CronCreate 重新注册定时任务。可将注册命令写入 `dev-autostart.sh` 末尾或 CLAUDE.md 的 SessionStart 指令中。

---

## 3. 文件清单

```
项目根目录/
├── scripts/
│   ├── dev-autostart.sh          # 自动启动脚本（SessionStart hook 调用）
│   └── dev-check-errors.sh       # 错误检查脚本（CronCreate / 按需调用）
├── electron/
│   └── src/
│       └── main.js               # 需添加主进程日志补丁（见第5节）
└── .claude/
    └── settings.local.json       # SessionStart hook 配置（见第6节）

运行时产生（/tmp/，不进 git）：
  /tmp/vl-backend.log
  /tmp/vl-backend.pid
  /tmp/vl-electron.log            # 仅 --electron 模式
  /tmp/vl-electron.pid            # 仅 --electron 模式

运行时产生（项目内，建议加入 .gitignore）：
  electron/main-process.log
  electron/renderer-console.log
```

---

## 4. 脚本完整代码

### 4.1 dev-autostart.sh

```bash
#!/usr/bin/env bash
# dev-autostart.sh — Claude Code SessionStart hook
# 用法：
#   dev-autostart.sh            # 仅启动后端（无头模式，默认）
#   dev-autostart.sh --electron # 同时启动 Electron 前端

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_LOG="/tmp/vl-backend.log"
BACKEND_PID_FILE="/tmp/vl-backend.pid"
ELECTRON_LOG="/tmp/vl-electron.log"
ELECTRON_PID_FILE="/tmp/vl-electron.pid"
HEALTHZ_URL="http://127.0.0.1:3000/healthz"
MAX_WAIT=8  # seconds
START_ELECTRON=0

[[ "${1:-}" == "--electron" ]] && START_ELECTRON=1

# ════════════════════════════════════════════════════════════════
# 后端部分
# ════════════════════════════════════════════════════════════════

# ── 1. 检查后端是否已经运行 ──────────────────────────────────────
if [[ -f "$BACKEND_PID_FILE" ]]; then
  OLD_PID=$(cat "$BACKEND_PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    if curl -sf "$HEALTHZ_URL" >/dev/null 2>&1; then
      echo "[backend] ✓ 已运行 (PID=$OLD_PID, port=3000)"
      BACKEND_ALREADY_UP=1
    else
      echo "[backend] ⚠ 进程存在但 healthz 失败，尝试重启..."
      kill "$OLD_PID" 2>/dev/null || true
      sleep 0.5
      BACKEND_ALREADY_UP=0
    fi
  else
    BACKEND_ALREADY_UP=0
  fi
else
  BACKEND_ALREADY_UP=0
fi

# ── 2. 启动后端（如需） ──────────────────────────────────────────
if [[ "$BACKEND_ALREADY_UP" == "0" ]]; then
  # 清理占用端口的进程
  if lsof -ti :3000 >/dev/null 2>&1; then
    echo "[backend] 端口 3000 被占用，清理中..."
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi

  echo "[backend] 启动 Agent HTTP Service..."
  cd "$PROJECT_DIR"
  node services/http-server/index.js >> "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

  ELAPSED=0
  while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    if curl -sf "$HEALTHZ_URL" >/dev/null 2>&1; then
      echo "[backend] ✓ 启动成功 (PID=$BACKEND_PID, port=3000, elapsed=${ELAPSED}s)"
      break
    fi
    sleep 0.5
    ELAPSED=$((ELAPSED + 1))
  done

  if ! curl -sf "$HEALTHZ_URL" >/dev/null 2>&1; then
    echo "[backend] ✗ 启动失败！最近日志："
    echo "---"
    tail -30 "$BACKEND_LOG" 2>/dev/null || echo "(日志为空)"
    echo "---"
    exit 1
  fi
fi

# ════════════════════════════════════════════════════════════════
# Electron 前端部分（仅 --electron 时启动）
# ════════════════════════════════════════════════════════════════

if [[ "$START_ELECTRON" == "1" ]]; then
  ELECTRON_RUNNING=0
  if [[ -f "$ELECTRON_PID_FILE" ]]; then
    OLD_EPID=$(cat "$ELECTRON_PID_FILE")
    if kill -0 "$OLD_EPID" 2>/dev/null; then
      echo "[electron] ✓ 已运行 (PID=$OLD_EPID)"
      ELECTRON_RUNNING=1
    fi
  fi

  if [[ "$ELECTRON_RUNNING" == "0" ]]; then
    echo "[electron] 启动 Electron（日志 → $ELECTRON_LOG）..."
    cd "$PROJECT_DIR"
    bash start-electron.sh > "$ELECTRON_LOG" 2>&1 &
    ELECTRON_PID=$!
    echo "$ELECTRON_PID" > "$ELECTRON_PID_FILE"
    sleep 3
    if kill -0 "$ELECTRON_PID" 2>/dev/null; then
      echo "[electron] ✓ 启动成功 (PID=$ELECTRON_PID)"
    else
      echo "[electron] ✗ 启动失败！最近日志："
      echo "---"
      tail -30 "$ELECTRON_LOG" 2>/dev/null || echo "(日志为空)"
      echo "---"
      # Electron 失败不阻断整体流程
    fi
  fi
fi

echo "[dev-autostart] 完成"
```

**移植要点**：
- `HEALTHZ_URL`：替换为你项目的健康检查端点
- `node services/http-server/index.js`：替换为实际后端启动命令
- `bash start-electron.sh`：替换为实际前端启动命令
- `/tmp/vl-*`：前缀 `vl` 改为你项目的缩写

---

### 4.2 dev-check-errors.sh

```bash
#!/usr/bin/env bash
# dev-check-errors.sh — 检查后端 + Electron 前端所有日志中的错误
# Claude 可调用此脚本自动获取错误摘要

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_LOG="/tmp/vl-backend.log"
ELECTRON_LOG="/tmp/vl-electron.log"
MAIN_LOG="$PROJECT_DIR/electron/main-process.log"
RENDERER_LOG="$PROJECT_DIR/electron/renderer-console.log"
BACKEND_PID_FILE="/tmp/vl-backend.pid"
ELECTRON_PID_FILE="/tmp/vl-electron.pid"
HEALTHZ_URL="http://127.0.0.1:3000/healthz"

echo "=== Video-Learner 错误检查报告 ==="
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ── 后端状态 ─────────────────────────────────────────────────────
echo "【后端状态】"
if [[ -f "$BACKEND_PID_FILE" ]]; then
  PID=$(cat "$BACKEND_PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  进程: 运行中 (PID=$PID)"
  else
    echo "  进程: ✗ 已停止 (PID=$PID)"
  fi
else
  echo "  进程: 未知（PID 文件不存在）"
fi

if curl -sf "$HEALTHZ_URL" >/dev/null 2>&1; then
  echo "  healthz: ✓ 正常"
else
  echo "  healthz: ✗ 无响应"
fi

echo ""
echo "【后端日志错误（最近 50 行）】"
if [[ -f "$BACKEND_LOG" ]]; then
  ERRORS=$(tail -50 "$BACKEND_LOG" | grep -iE "error|fatal|crash|unhandled|EADDRINUSE|MODULE_NOT_FOUND" || true)
  if [[ -n "$ERRORS" ]]; then echo "$ERRORS"; else echo "  (无异常)"; fi
else
  echo "  (日志文件不存在)"
fi

# ── Electron 状态 ────────────────────────────────────────────────
echo ""
echo "【Electron 状态】"
if [[ -f "$ELECTRON_PID_FILE" ]]; then
  EPID=$(cat "$ELECTRON_PID_FILE")
  if kill -0 "$EPID" 2>/dev/null; then
    echo "  进程: 运行中 (PID=$EPID)"
  else
    echo "  进程: ✗ 已退出 (PID=$EPID)"
  fi
else
  ELECTRON_PROC=$(pgrep -f "electron/node_modules/.bin/electron" 2>/dev/null | head -1 || true)
  if [[ -n "$ELECTRON_PROC" ]]; then
    echo "  进程: 运行中 (PID=$ELECTRON_PROC，非 autostart 启动)"
  else
    echo "  进程: 未运行"
  fi
fi

# ── Electron 主进程日志 ──────────────────────────────────────────
echo ""
echo "【Electron 主进程错误（main-process.log 最近 60 行）】"
if [[ -f "$MAIN_LOG" ]]; then
  MAIN_ERRORS=$(tail -60 "$MAIN_LOG" | grep -iE "\[error\]|\[fatal\]|\[warn\]|UncaughtException|UnhandledRejection|failed to start|Process gone" || true)
  if [[ -n "$MAIN_ERRORS" ]]; then echo "$MAIN_ERRORS"; else echo "  (无异常)"; fi
else
  echo "  (日志不存在，需运行一次 Electron 后生成)"
fi

# ── Electron 渲染器日志 ──────────────────────────────────────────
echo ""
echo "【Electron 渲染器错误（renderer-console.log 最近 80 行）】"
if [[ -f "$RENDERER_LOG" ]]; then
  RENDERER_ERRORS=$(tail -80 "$RENDERER_LOG" | grep -iE "\[error\]|\[warn\]|Uncaught|TypeError|ReferenceError|SyntaxError|Failed to|NetworkError" || true)
  if [[ -n "$RENDERER_ERRORS" ]]; then echo "$RENDERER_ERRORS"; else echo "  (无异常)"; fi
else
  echo "  (日志不存在，Electron 可能未运行)"
fi

# ── Electron 启动日志 ────────────────────────────────────────────
echo ""
echo "【Electron 启动日志（/tmp/vl-electron.log 最近 30 行）】"
if [[ -f "$ELECTRON_LOG" ]]; then
  tail -30 "$ELECTRON_LOG"
else
  echo "  (不存在，仅 --electron 模式下生成)"
fi

echo ""
echo "=== 检查完成 ==="
```

---

## 5. 主进程日志补丁（Electron）

**问题**：Electron 主进程的 `console.error` / `uncaughtException` 默认只输出到终端，Agent 无法读取。

**解法**：在 `electron/src/main.js` 顶部（`require` 之后、任何业务逻辑之前）加入以下补丁：

```js
// ── Dev Harness：主进程日志持久化 ──────────────────────────────
const MAIN_LOG_PATH = path.join(__dirname, '..', 'main-process.log');
(function patchConsole() {
  const _write = (level, args) => {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(String).join(' ')}\n`;
    try { fs.appendFileSync(MAIN_LOG_PATH, line, 'utf8'); } catch (_) {}
  };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log   = (...a) => { orig.log(...a);   _write('info',  a); };
  console.warn  = (...a) => { orig.warn(...a);  _write('warn',  a); };
  console.error = (...a) => { orig.error(...a); _write('error', a); };
  process.on('uncaughtException', (err) => {
    _write('fatal', [`UncaughtException: ${err && err.stack ? err.stack : err}`]);
  });
  process.on('unhandledRejection', (reason) => {
    _write('fatal', [`UnhandledRejection: ${reason && reason.stack ? reason.stack : reason}`]);
  });
})();
// ── End Dev Harness ────────────────────────────────────────────
```

**放置位置**：

```js
const { app, BrowserWindow, ... } = require('electron');
const path = require('path');
const fs = require('fs');
// ... 其他 require ...

// ← 在这里插入上面的补丁块

let mainWindow;
// ... 业务代码 ...
```

**效果**：

| 事件 | 写入文件 | 级别 |
|------|---------|------|
| `console.log(...)` | `main-process.log` | `[info]` |
| `console.warn(...)` | `main-process.log` | `[warn]` |
| `console.error(...)` | `main-process.log` | `[error]` |
| `uncaughtException` | `main-process.log` | `[fatal]` |
| `unhandledRejection` | `main-process.log` | `[fatal]` |

> **注意**：补丁不影响原有 stderr 输出，仅额外追加写文件。生产构建中可通过 `NODE_ENV` 判断跳过。

---

## 6. Claude Code 配置

### 6.1 SessionStart Hook（`.claude/settings.local.json`）

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash /绝对路径/scripts/dev-autostart.sh"
          }
        ]
      }
    ]
  }
}
```

> **路径必须是绝对路径**，因为 hook 的工作目录不可预期。

Hook 输出会注入 Claude 的 Session 上下文，Claude 启动时即知服务状态。

### 6.2 CronCreate 注册（每次 Session 由 Agent 执行）

每次新 Session 开始，Agent 应调用 CronCreate 注册定时健康检查（Session-only，关闭后自动消失）：

```
CronCreate:
  cron: "*/2 * * * *"
  recurring: true
  prompt: |
    运行 `bash /绝对路径/scripts/dev-check-errors.sh` 并分析输出。
    如果发现以下任一情况，立即采取行动并告知用户：
    1. 后端 healthz 无响应 → 重启后端
    2. 后端日志有 ERROR/FATAL/crash
    3. Electron 主进程日志有 [error]/[fatal]/UncaughtException/UnhandledRejection
    4. Electron 渲染器有 Uncaught/TypeError/SyntaxError
    如果一切正常，只输出一行：「✓ 健康检查通过」
```

### 6.3 .gitignore 追加

```gitignore
# Dev Harness 运行时日志
electron/main-process.log
electron/renderer-console.log
```

---

## 7. Agent 操作手册

> 本节面向 Agent（Claude Code）阅读，描述各场景下的标准操作。

### 7.1 Session 开始时

1. SessionStart Hook 自动运行 `dev-autostart.sh`，读取输出判断后端状态
2. 如输出包含 `✗ 启动失败`：
   - 读取日志中的错误信息
   - 常见错误及修复：

     | 错误 | 修复动作 |
     |------|---------|
     | `EADDRINUSE` | `lsof -ti :PORT \| xargs kill -9` |
     | `MODULE_NOT_FOUND: 'xxx'` | `npm install xxx` |
     | `SyntaxError` | 读取报错文件行号，修复语法 |
     | `EACCES` | `chmod +x` 相关文件 |

3. 修复后重新运行 `dev-autostart.sh` 验证
4. 调用 CronCreate 注册 2 分钟定时检查

### 7.2 用户说"检查报错" / "有没有错误"

```bash
bash scripts/dev-check-errors.sh
```

分析输出，重点关注 `[error]` / `[fatal]` / `✗` 标记。

### 7.3 CronCreate 定时检查触发

- 若一切正常：静默输出 `✓ 健康检查通过`
- 若后端挂了：执行重启命令 → 验证 healthz → 告知用户"后端已自动重启"
- 若有错误日志：定位错误行 → 分析根因 → 若可自动修复则修复，否则详细告知用户

### 7.4 发现错误后的诊断流程

```
读取 dev-check-errors.sh 输出
  ↓
确认错误来源（后端/主进程/渲染器）
  ↓
读取对应完整日志文件（tail -100）
  ↓
定位错误行号和文件
  ↓
判断是否可自动修复
  ├── YES: 修复 → 重启服务 → 验证 → 告知用户
  └── NO:  输出详细错误上下文 → 请用户确认修复方案
```

### 7.5 完整重启流程（后端）

```bash
kill $(cat /tmp/vl-backend.pid 2>/dev/null) 2>/dev/null || true
sleep 0.5
bash scripts/dev-autostart.sh
```

### 7.6 按需读取日志（调试时）

```bash
# 后端最近错误
tail -50 /tmp/vl-backend.log | grep -iE "error|fatal|crash"

# Electron 主进程最近错误
tail -60 electron/main-process.log | grep -iE "\[error\]|\[fatal\]"

# 渲染器最近所有输出
tail -100 electron/renderer-console.log
```

---

## 8. 移植到其他项目

替换以下占位符，其余逻辑不变：

| 占位符 | 说明 | 示例 |
|--------|------|------|
| `vl` | 日志文件前缀（项目缩写） | `vl` → `myapp` |
| `3000` | 后端端口 | 可改为 `8080` |
| `http://127.0.0.1:3000/healthz` | 健康检查端点 | 改为实际 URL |
| `node services/http-server/index.js` | 后端启动命令 | `npm run dev:server` |
| `bash start-electron.sh` | 前端启动命令 | `npm run dev:frontend` |
| `electron/node_modules/.bin/electron` | Electron 进程匹配串 | 对应实际路径 |
| `electron/main-process.log` | 主进程日志路径 | 对应实际路径 |
| `electron/renderer-console.log` | 渲染器日志路径 | 对应实际路径 |

**无 Electron 的纯 Node.js 项目**：删除脚本中 `Electron 前端部分` 代码块及 `dev-check-errors.sh` 中 Electron 相关段落即可。

**有构建步骤的项目**（如 webpack/vite）：在 `dev-autostart.sh` 后端启动之前加入：

```bash
# ── 0. 构建检查 ──────────────────────────────────────────────────
if [[ ! -d "dist" ]] || [[ "src" -nt "dist" ]]; then
  echo "[build] 检测到源码变更，重新构建..."
  npm run build > /tmp/vl-build.log 2>&1 || {
    echo "[build] ✗ 构建失败！日志："
    tail -30 /tmp/vl-build.log
    exit 1
  }
fi
```

---

## 9. 已知局限

| 局限 | 说明 | 绕过方式 |
|------|------|---------|
| CronCreate Session-only | Claude 退出后定时任务消失 | 每次 Session 开始重新注册；或使用 `durable: true` 持久化（需 Claude Code 进程常驻） |
| Electron 必须有显示器 | `--electron` 模式在无头服务器上失败 | CI/CD 中使用 `xvfb-run`；本地开发一般不需要 headless |
| 主进程日志补丁需重启生效 | 修改 main.js 后需重启 Electron | 一次性操作，之后永久生效 |
| 错误自动修复范围有限 | 复杂业务 bug 无法自动修复 | Agent 提供详细诊断，由用户确认修复方案 |
| 端口号硬编码 | 脚本目前固定 3000 | 改为读取 `.env` 或 `config` 文件中的 `PORT` 变量 |
