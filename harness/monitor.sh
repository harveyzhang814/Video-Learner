#!/usr/bin/env bash
# harness/monitor.sh
# 后台错误监控 watcher：定期扫描日志文件，将状态写入摘要文件
# 由 debug-log-env skill 生成，基于项目实际日志路径配置
#
# 用法：bash harness/monitor.sh <WATCH_PID> <LOG_FILE> [LOG_FILE2 ...]
# 退出：WATCH_PID 进程退出后自动停止

set -euo pipefail

WATCH_PID="${1:?需要传入 WATCH_PID}"
shift
LOG_FILES=("$@")

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLUG=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')
SUMMARY_FILE="/tmp/${SLUG}-error-summary.txt"
CHECK_INTERVAL=3
START_TIME=$(date '+%Y-%m-%d %H:%M:%S')

# 错误关键词（可按项目需要扩展）
ERROR_PATTERN="error|fatal|crash|uncaught|typeerror|eaddrinuse|module_not_found|unhandledrejection|exception|panic"

write_summary() {
  local status="$1" errors="$2"
  cat > "$SUMMARY_FILE" <<EOF
# ${SLUG} Dev Monitor
started=${START_TIME}
watch_pid=${WATCH_PID}
status=${status}
errors=${errors}
EOF
}

echo "[monitor $(date '+%H:%M:%S')] 启动，监测 PID=${WATCH_PID}，摘要 → $SUMMARY_FILE"
write_summary "ok" ""

while true; do
  # 检查被监测进程是否还在运行
  if ! kill -0 "$WATCH_PID" 2>/dev/null; then
    write_summary "exited" ""
    echo "[monitor] PID=${WATCH_PID} 已退出，monitor 停止"
    exit 0
  fi

  # 扫描日志文件中的错误
  FOUND_ERRORS=""
  for log_file in "${LOG_FILES[@]+"${LOG_FILES[@]}"}"; do
    if [[ -f "$log_file" ]]; then
      recent=$(tail -20 "$log_file" 2>/dev/null | grep -iE "$ERROR_PATTERN" | tail -3 || true)
      if [[ -n "$recent" ]]; then
        FOUND_ERRORS="${FOUND_ERRORS}${recent}"$'\n'
      fi
    fi
  done

  if [[ -n "$FOUND_ERRORS" ]]; then
    write_summary "error" "$FOUND_ERRORS"
  else
    write_summary "ok" ""
  fi

  sleep "$CHECK_INTERVAL"
done
