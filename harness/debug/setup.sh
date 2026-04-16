#!/usr/bin/env bash
# harness/debug/setup.sh
# 启动完整调试日志环境：聚合所有日志来源到统一流
# 与应用同步启动，在 $WATCH_PIDS 进程退出后自动结束
#
# 用法：
#   bash harness/debug/setup.sh [--watch-pid PID] [--watch-pid PID2] ...
#   bash harness/debug/setup.sh --watch-pid $BACKEND_PID --watch-pid $ELECTRON_PID
#
# 输出：
#   /tmp/<slug>-debug.log     — 统一聚合日志（带 [source] 前缀）
#   /tmp/<slug>-debug.pid     — 本进程 PID（用于 stop.sh）

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SLUG=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')
DEBUG_LOG="/tmp/${SLUG}-debug.log"
PID_FILE="/tmp/${SLUG}-debug.pid"
MANIFEST="/tmp/${SLUG}-log-manifest.json"

WATCH_PIDS=()

# ── 解析参数 ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch-pid) WATCH_PIDS+=("$2"); shift 2 ;;
    *) shift ;;
  esac
done

# ── 防止重复启动 ──────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[debug-env] 已在运行 (PID=$OLD_PID)，日志 → $DEBUG_LOG"
    exit 0
  fi
fi

echo "$$" > "$PID_FILE"
: > "$DEBUG_LOG"  # 清空旧日志

echo "[debug-env $(date '+%H:%M:%S')] 启动，聚合日志 → $DEBUG_LOG"

# ── 发现日志来源 ─────────────────────────────────────────────────
bash "$(dirname "${BASH_SOURCE[0]}")/discover.sh" "$PROJECT_DIR" > /dev/null 2>&1
if [[ ! -f "$MANIFEST" ]]; then
  echo "[debug-env] discover 失败，跳过" >&2
fi

# ── tail -f 所有存在的日志文件 ───────────────────────────────────
TAIL_PIDS=()

start_tail() {
  local file="$1" label="$2"
  if [[ -f "$file" ]]; then
    # 带 source 标签写入聚合日志
    tail -F "$file" 2>/dev/null | while IFS= read -r line; do
      echo "[${label}] ${line}"
    done >> "$DEBUG_LOG" &
    TAIL_PIDS+=($!)
    echo "[debug-env] watching: $file → [$label]"
  fi
}

# 静态日志
start_tail "/tmp/${SLUG}-backend.log"          "backend"
start_tail "/tmp/vl-backend.log"               "backend"
start_tail "$PROJECT_DIR/electron/main-process.log"      "electron-main"
start_tail "$PROJECT_DIR/electron/renderer-console.log"  "electron-renderer"
start_tail "/tmp/${SLUG}-error-summary.txt"    "monitor"
start_tail "/tmp/vl-error-summary.txt"         "monitor"

# work/ 下动态日志（扫描现有 + 监测新文件）
watch_work_logs() {
  local last_seen=()
  while true; do
    # 扫描新增日志文件
    while IFS= read -r f; do
      # 判断是否已经在 tail
      KNOWN=0
      for s in "${last_seen[@]+"${last_seen[@]}"}"; do
        [[ "$s" == "$f" ]] && KNOWN=1 && break
      done
      if [[ "$KNOWN" == "0" ]]; then
        label=$(basename "$(dirname "$(dirname "$f")")")/$(basename "$f" .log)
        tail -F "$f" 2>/dev/null | while IFS= read -r line; do
          echo "[${label}] ${line}"
        done >> "$DEBUG_LOG" &
        TAIL_PIDS+=($!)
        last_seen+=("$f")
        echo "[debug-env] watching new: $f → [$label]" >> "$DEBUG_LOG"
      fi
    done < <(find "$PROJECT_DIR/work" -maxdepth 4 \
      \( -name "*.raw.log" -o -name "task.log.jsonl" \) 2>/dev/null)

    sleep 5
  done
}

watch_work_logs &
WORK_WATCHER_PID=$!
TAIL_PIDS+=($WORK_WATCHER_PID)

# ── 通用 .log 文件扫描（其他技术栈，排除已监测的）──────────────
ALREADY_WATCHING=(
  "/tmp/${SLUG}-backend.log"
  "/tmp/vl-backend.log"
  "$PROJECT_DIR/electron/main-process.log"
  "$PROJECT_DIR/electron/renderer-console.log"
  "/tmp/${SLUG}-error-summary.txt"
  "/tmp/vl-error-summary.txt"
)
while IFS= read -r f; do
  SKIP=0
  for known in "${ALREADY_WATCHING[@]}"; do
    [[ "$f" == "$known" ]] && SKIP=1 && break
  done
  [[ "$SKIP" == "1" ]] && continue
  label=$(echo "$f" | sed "s|$PROJECT_DIR/||" | tr '/' '-')
  start_tail "$f" "$label"
done < <(find "$PROJECT_DIR" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  -not -path "*/.claude/*" -not -path "*/work/*" \
  -not -path "*/harness/*" \
  -name "*.log" 2>/dev/null)

echo "[debug-env] 就绪，监测 ${#TAIL_PIDS[@]} 个日志源"
echo "[debug-env] tail -f $DEBUG_LOG  # 实时查看"
echo "[debug-env] bash harness/debug/read-logs.sh  # 过滤查看"

# ── 等待 WATCH_PIDS 全部退出（或被信号终止）────────────────────
cleanup() {
  echo "[debug-env] 关闭，停止所有 tail 进程..."
  for pid in "${TAIL_PIDS[@]+"${TAIL_PIDS[@]}"}"; do
    kill "$pid" 2>/dev/null || true
  done
  rm -f "$PID_FILE"
  echo "[debug-env] 已退出"
}
trap cleanup INT TERM EXIT

if [[ ${#WATCH_PIDS[@]} -gt 0 ]]; then
  # 轮询直到所有被监测进程退出
  while true; do
    ALL_GONE=1
    for pid in "${WATCH_PIDS[@]}"; do
      kill -0 "$pid" 2>/dev/null && ALL_GONE=0 && break
    done
    [[ "$ALL_GONE" == "1" ]] && break
    sleep 2
  done
  echo "[debug-env] 所有被监测进程已退出，debug-env 随之结束"
else
  # 无 WATCH_PIDS 时前台阻塞，Ctrl-C 退出
  wait
fi
