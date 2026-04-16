#!/usr/bin/env bash
# harness/debug/read-logs.sh
# 从聚合日志中读取并过滤，供 Agent 调用
#
# 用法：
#   bash harness/debug/read-logs.sh [选项]
#
# 选项：
#   --source <name>     只看某个来源（backend/electron-main/electron-renderer/step-*）
#   --level  <level>    只看某个级别（error/warn/info）
#   --since  <ts>       只看某时间之后（格式：HH:MM 或 YYYY-MM-DD HH:MM:SS）
#   --task   <id>       只看某个任务 ID（前缀匹配）
#   --last   <N>        最后 N 行（默认 100）
#   --errors            快捷：只看 error/fatal/crash/Uncaught 行
#   --all               读取所有行（不限 last）
#   --raw               不过滤，直接输出原始聚合日志

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SLUG=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')
DEBUG_LOG="/tmp/${SLUG}-debug.log"

SOURCE_FILTER=""
LEVEL_FILTER=""
SINCE_FILTER=""
TASK_FILTER=""
LAST_N=100
ERRORS_ONLY=0
ALL_LINES=0
RAW=0

# ── 解析参数 ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_FILTER="$2"; shift 2 ;;
    --level)  LEVEL_FILTER="$2";  shift 2 ;;
    --since)  SINCE_FILTER="$2";  shift 2 ;;
    --task)   TASK_FILTER="$2";   shift 2 ;;
    --last)   LAST_N="$2";        shift 2 ;;
    --errors) ERRORS_ONLY=1;      shift ;;
    --all)    ALL_LINES=1;        shift ;;
    --raw)    RAW=1;              shift ;;
    *) shift ;;
  esac
done

# ── 检查聚合日志是否存在 ─────────────────────────────────────────
if [[ ! -f "$DEBUG_LOG" ]]; then
  echo "[read-logs] 聚合日志不存在：$DEBUG_LOG"
  echo "[read-logs] 请先运行：bash harness/debug/setup.sh"
  echo ""
  echo "=== 降级：直接读取已知日志文件 ==="
  bash "$(dirname "${BASH_SOURCE[0]}")/discover.sh" "$PROJECT_DIR" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
for s in d.get('sources', []):
    if s.get('exists'):
        print(f\"  [{s['source']}] {s['path']}\")
" 2>/dev/null || true
  exit 1
fi

# ── RAW 模式 ─────────────────────────────────────────────────────
if [[ "$RAW" == "1" ]]; then
  [[ "$ALL_LINES" == "1" ]] && cat "$DEBUG_LOG" || tail -n "$LAST_N" "$DEBUG_LOG"
  exit 0
fi

# ── 构建过滤管道 ─────────────────────────────────────────────────
CMD="cat \"$DEBUG_LOG\""

# source 过滤：[source] 前缀
[[ -n "$SOURCE_FILTER" ]] && CMD="$CMD | grep -i '\\[${SOURCE_FILTER}'"

# task 过滤
[[ -n "$TASK_FILTER" ]] && CMD="$CMD | grep -i '${TASK_FILTER}'"

# level 过滤
if [[ -n "$LEVEL_FILTER" ]]; then
  CMD="$CMD | grep -iE '\\[${LEVEL_FILTER}\\]|${LEVEL_FILTER}:'"
fi

# errors 快捷：匹配真实错误，排除 monitor 的 errors= 空字段行
if [[ "$ERRORS_ONLY" == "1" ]]; then
  CMD="$CMD | grep -iE 'error|fatal|crash|Uncaught|TypeError|EADDRINUSE|MODULE_NOT_FOUND|UnhandledRejection'"
  CMD="$CMD | grep -vE 'errors=\s*$'"
fi

# since 过滤（简单字符串匹配时间戳前缀）
[[ -n "$SINCE_FILTER" ]] && CMD="$CMD | awk -v ts=\"$SINCE_FILTER\" '\$0 >= ts || /^\[/'"

# last N（仅当未指定 --all 时生效）
if [[ "$ALL_LINES" == "0" ]]; then
  CMD="$CMD | tail -n ${LAST_N}"
fi

# ── 执行 ─────────────────────────────────────────────────────────
echo "=== Debug Log: $DEBUG_LOG ==="
echo "=== 过滤: source=${SOURCE_FILTER:-all} level=${LEVEL_FILTER:-all} errors_only=${ERRORS_ONLY} last=$([[ "$ALL_LINES" == "1" ]] && echo "all" || echo "${LAST_N}")lines ==="
echo ""

eval "$CMD" || true

echo ""
echo "=== 总行数: $(wc -l < "$DEBUG_LOG" | tr -d ' ') | 文件大小: $(du -sh "$DEBUG_LOG" | cut -f1) ==="
