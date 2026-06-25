#!/usr/bin/env bash
# harness/check-errors.sh
# 读取 monitor 写入的错误摘要文件，供 Agent 按需调用
# 由 debug-log-env skill 生成
#
# 退出码：0=ok  1=error  2=exited  3=未运行

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLUG=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')
SUMMARY_FILE="/tmp/${SLUG}-error-summary.txt"

if [[ ! -f "$SUMMARY_FILE" ]]; then
  echo "status=not_running"
  echo "(monitor 未启动，请先运行 bash harness/start-dev.sh)"
  exit 3
fi

cat "$SUMMARY_FILE"

STATUS=$(grep '^status=' "$SUMMARY_FILE" | cut -d= -f2)
case "$STATUS" in
  ok)     exit 0 ;;
  error)  exit 1 ;;
  exited) exit 2 ;;
  *)      exit 3 ;;
esac
