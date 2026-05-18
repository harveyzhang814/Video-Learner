#!/usr/bin/env bash
# harness/start-dev.sh
# Video-Learner 开发环境统一启动脚本（由 debug-log-env skill 生成）
#
# 用法：
#   bash harness/start-dev.sh              # 仅启动后端 + debug 环境
#   bash harness/start-dev.sh --electron   # 同时启动 Electron GUI
#
# 支持的参数：
#   --electron       启动 Electron GUI（默认不启动）
#   --no-monitor     跳过 monitor 错误监控
#   --no-debug       跳过 debug 日志聚合环境
#   --help           显示帮助

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLUG="video-learner"

BACKEND_LOG="/tmp/vl-backend.log"
BACKEND_PID_FILE="/tmp/vl-backend.pid"
ELECTRON_LOG="/tmp/vl-electron-dev.log"
ELECTRON_PID_FILE="/tmp/vl-electron-dev.pid"

START_ELECTRON=0
START_MONITOR=1
START_DEBUG=1
CHILD_PIDS=()

# ── 解析参数 ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --electron)    START_ELECTRON=1;  shift ;;
    --no-monitor)  START_MONITOR=0;   shift ;;
    --no-debug)    START_DEBUG=0;     shift ;;
    --help|-h)
      echo "用法: bash harness/start-dev.sh [--electron] [--no-monitor] [--no-debug]"
      echo ""
      echo "参数："
      echo "  --electron    同时启动 Electron GUI"
      echo "  --no-monitor  跳过 monitor 错误监控"
      echo "  --no-debug    跳过 debug 日志聚合环境"
      echo "  --help        显示此帮助"
      exit 0
      ;;
    *) echo "[start-dev] 未知参数: $1" >&2; shift ;;
  esac
done

# ── 清理函数（macOS 兼容，不依赖 setsid）────────────────────────
cleanup() {
  echo ""
  echo "[start-dev] 收到退出信号，清理子进程..."
  for pid in "${CHILD_PIDS[@]+"${CHILD_PIDS[@]}"}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # 停止 debug 环境
  bash "$PROJECT_DIR/harness/debug/stop.sh" 2>/dev/null || true
  # 清理 PID 文件
  rm -f "$BACKEND_PID_FILE" "$ELECTRON_PID_FILE"
  echo "[start-dev] 已退出"
}
trap cleanup INT TERM EXIT

# ── 1. 启动后端（HTTP Agent Service）─────────────────────────────
echo "[start-dev] 启动后端: node services/http-server/index.js"
: > "$BACKEND_LOG"  # 清空旧日志
node "$PROJECT_DIR/services/http-server/index.js" 2>&1 \
  | python3 -u -c 'import sys,datetime; [print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), l.rstrip(), flush=True) for l in iter(sys.stdin.readline,"")]' \
  >> "$BACKEND_LOG" &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$BACKEND_PID_FILE"
CHILD_PIDS+=($BACKEND_PID)
echo "[start-dev] 后端 PID=$BACKEND_PID, 日志 → $BACKEND_LOG"

# ── 2. 等待后端健康检查 ───────────────────────────────────────────
echo "[start-dev] 等待后端就绪..."
MAX_WAIT=15
WAITED=0
until curl -s http://127.0.0.1:3000/healthz > /dev/null 2>&1; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[start-dev] 后端进程异常退出！查看日志: $BACKEND_LOG" >&2
    tail -20 "$BACKEND_LOG" >&2
    exit 1
  fi
  if [[ $WAITED -ge $MAX_WAIT ]]; then
    echo "[start-dev] 警告: 后端 $MAX_WAIT 秒内未响应 /healthz，继续启动其他组件..." >&2
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
if curl -s http://127.0.0.1:3000/healthz > /dev/null 2>&1; then
  echo "[start-dev] 后端就绪 ✓ (http://127.0.0.1:3000)"
fi

# ── 3. 启动 monitor（错误监控）───────────────────────────────────
if [[ "$START_MONITOR" == "1" ]]; then
  bash "$PROJECT_DIR/harness/monitor.sh" "$BACKEND_PID" \
    "$BACKEND_LOG" \
    "$PROJECT_DIR/electron/main-process.log" \
    "$PROJECT_DIR/electron/renderer-console.log" &
  MONITOR_PID=$!
  CHILD_PIDS+=($MONITOR_PID)
  echo "[start-dev] monitor PID=$MONITOR_PID, 摘要 → /tmp/${SLUG}-error-summary.txt"
fi

# ── 4. 启动 Electron GUI（可选）──────────────────────────────────
ELECTRON_PID=""
if [[ "$START_ELECTRON" == "1" ]]; then
  echo "[start-dev] 启动 Electron GUI..."
  : > "$ELECTRON_LOG"
  npx electron "$PROJECT_DIR/electron/src/main.js" >> "$ELECTRON_LOG" 2>&1 &
  ELECTRON_PID=$!
  echo "$ELECTRON_PID" > "$ELECTRON_PID_FILE"
  CHILD_PIDS+=($ELECTRON_PID)
  echo "[start-dev] Electron PID=$ELECTRON_PID, 日志 → $ELECTRON_LOG"
fi

# ── 5. 启动 debug 日志聚合环境 ────────────────────────────────────
if [[ "$START_DEBUG" == "1" ]]; then
  DEBUG_WATCH_ARGS="--watch-pid $BACKEND_PID"
  [[ -n "$ELECTRON_PID" ]] && DEBUG_WATCH_ARGS="$DEBUG_WATCH_ARGS --watch-pid $ELECTRON_PID"
  bash "$PROJECT_DIR/harness/debug/setup.sh" $DEBUG_WATCH_ARGS &
  DEBUG_PID=$!
  CHILD_PIDS+=($DEBUG_PID)
  echo "[start-dev] debug-env PID=$DEBUG_PID, 聚合日志 → /tmp/${SLUG}-debug.log"
fi

# ── 6. 显示状态摘要 ───────────────────────────────────────────────
echo ""
echo "=== Video-Learner 开发环境已启动 ==="
echo "  后端:      http://127.0.0.1:3000"
echo "  后端日志:  $BACKEND_LOG"
[[ -n "$ELECTRON_PID" ]] && echo "  Electron:  PID=$ELECTRON_PID"
echo "  聚合日志:  /tmp/${SLUG}-debug.log"
echo "  错误摘要:  /tmp/${SLUG}-error-summary.txt"
echo ""
echo "调试命令："
echo "  bash harness/debug/read-logs.sh --last 50"
echo "  bash harness/debug/read-logs.sh --errors --last 30"
echo "  bash harness/debug/read-logs.sh --source backend --last 50"
echo "  bash harness/check-errors.sh"
echo ""
echo "按 Ctrl-C 停止所有服务"
echo "======================================="

# ── 7. 前台等待（持续监测后端存活）───────────────────────────────
while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[start-dev] 后端进程已退出 (PID=$BACKEND_PID), 停止开发环境"
    break
  fi
  sleep 3
done
