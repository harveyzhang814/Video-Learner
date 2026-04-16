#!/usr/bin/env bash
# harness/debug/stop.sh
# 停止 debug 日志环境

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SLUG=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')
PID_FILE="/tmp/${SLUG}-debug.pid"

if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    echo "[debug-env] 已停止 (PID=$PID)"
  else
    echo "[debug-env] 进程已不存在 (PID=$PID)"
  fi
  rm -f "$PID_FILE"
else
  echo "[debug-env] PID 文件不存在，尝试兜底清理..."
fi

# 兜底：清理所有遗留的 setup.sh 子进程
LEFTOVERS=$(pgrep -f "harness/debug/setup.sh" 2>/dev/null || true)
if [[ -n "$LEFTOVERS" ]]; then
  echo "$LEFTOVERS" | xargs kill 2>/dev/null || true
  echo "[debug-env] 清理遗留进程: $LEFTOVERS"
fi
