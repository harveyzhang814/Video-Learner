#!/usr/bin/env bash
# harness/debug/verify-logs.sh
# 验证 Video-Learner 调试日志环境：确认所有日志来源正常写入
#
# 用法：
#   bash harness/debug/verify-logs.sh              # Mode A（独立后端）验证
#   bash harness/debug/verify-logs.sh --mode B     # Mode B（Electron）验证
#   bash harness/debug/verify-logs.sh --all        # 检查全部来源（A+B）
#
# 退出码：0=全部 OK，1=有 FAIL

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SLUG="video-learner"
BACKEND_LOG="/tmp/vl-backend.log"
MAIN_LOG="$PROJECT_DIR/electron/main-process.log"
RENDERER_LOG="$PROJECT_DIR/electron/renderer-console.log"

MODE="A"
CHECK_ALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --all) CHECK_ALL=1; shift ;;
    *) shift ;;
  esac
done

PASS=0
FAIL=0
RESULTS=()

# ── 工具函数 ──────────────────────────────────────────────────────

# ISO 8601 格式检查（行首有 YYYY-MM-DDThh:mm:ss 或 [YYYY-MM-DD 等）
check_iso8601() {
  local file="$1"
  # 匹配 ISO 8601：YYYY-MM-DDThh:mm:ss 或 [YYYY-MM-DDThh:mm:ss 等格式
  head -5 "$file" 2>/dev/null | grep -qE '^\[?[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
}

# 检查文件是否有最近 60 秒内的新内容
check_recent() {
  local file="$1"
  # macOS stat -f %m 返回修改时间（epoch）
  local mtime
  mtime=$(stat -f %m "$file" 2>/dev/null || echo 0)
  local now
  now=$(date +%s)
  [[ $((now - mtime)) -le 60 ]]
}

report() {
  local label="$1" status="$2" detail="${3:-}"
  local marker
  if [[ "$status" == "OK" ]]; then
    marker="OK"
    PASS=$((PASS + 1))
  else
    marker="FAIL"
    FAIL=$((FAIL + 1))
  fi
  local line="  [$marker] $label"
  [[ -n "$detail" ]] && line="$line — $detail"
  RESULTS+=("$line")
  echo "$line"
}

check_source() {
  local label="$1" file="$2" trigger_needed="${3:-0}"
  echo ""
  echo "--- 检查: $label"
  echo "    路径: $file"

  # 1. 文件存在
  if [[ ! -f "$file" ]]; then
    report "$label" FAIL "MISSING (文件不存在)"
    return
  fi

  # 2. 有新内容（60 秒内修改）
  if ! check_recent "$file"; then
    # 对步骤日志（work/）：历史文件正常，SKIP 而非 FAIL
    if [[ "$file" == */work/* ]]; then
      echo "  [SKIP] $label — 历史文件（60 秒以上未更新，无活跃任务时属正常）"
      return
    fi
    report "$label" FAIL "NO_NEW_OUTPUT (文件存在但超过 60 秒未更新)"
    return
  fi

  # 3. ISO 8601 时间戳（JSONL 格式或 prefix 格式）
  # 对于 task.log.jsonl，检查 JSON 里的 ts 字段
  if [[ "$file" == *.jsonl ]]; then
    if ! head -3 "$file" 2>/dev/null | grep -qE '"ts"\s*:\s*"[0-9]{4}-[0-9]{2}-[0-9]{2}T'; then
      report "$label" FAIL "ISO8601_FAIL (JSONL 中未找到 ts 字段或格式不符)"
      return
    fi
  else
    if ! check_iso8601 "$file"; then
      local sample
      sample=$(head -1 "$file" 2>/dev/null | cut -c1-80)
      report "$label" FAIL "ISO8601_FAIL (行首格式不符，示例: $sample)"
      return
    fi
  fi

  report "$label" OK
}

# ── 主验证流程 ────────────────────────────────────────────────────
echo "=== Video-Learner 日志环境验证 ==="
echo "    模式: $([[ $CHECK_ALL == 1 ]] && echo 'A+B' || echo $MODE)"
echo "    时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ── Mode A: 独立后端 ──────────────────────────────────────────────
if [[ "$MODE" == "A" || "$CHECK_ALL" == "1" ]]; then
  echo "=== [Mode A] 独立后端日志 ==="

  # 检查后端是否在运行
  BACKEND_RUNNING=0
  if curl -s http://127.0.0.1:3000/healthz > /dev/null 2>&1; then
    BACKEND_RUNNING=1
    echo "  后端运行中 ✓"
  else
    echo "  后端未运行，尝试临时启动..."
    # 临时启动后端
    : > "$BACKEND_LOG"
    node "$PROJECT_DIR/services/http-server/index.js" 2>&1 \
      | python3 -u -c 'import sys,datetime; [print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), l.rstrip(), flush=True) for l in iter(sys.stdin.readline,"")]' \
      >> "$BACKEND_LOG" &
    TEMP_BACKEND_PID=$!
    # 等待就绪（最多 10 秒）
    WAITED=0
    until curl -s http://127.0.0.1:3000/healthz > /dev/null 2>&1; do
      if ! kill -0 "$TEMP_BACKEND_PID" 2>/dev/null; then
        echo "  后端启动失败！日志:"
        tail -10 "$BACKEND_LOG" 2>/dev/null || true
        report "backend ($BACKEND_LOG)" FAIL "后端进程启动失败"
        BACKEND_RUNNING=0
        break
      fi
      [[ $WAITED -ge 10 ]] && break
      sleep 1
      WAITED=$((WAITED + 1))
    done
    if curl -s http://127.0.0.1:3000/healthz > /dev/null 2>&1; then
      BACKEND_RUNNING=1
      echo "  后端临时启动成功 (PID=$TEMP_BACKEND_PID)"
      # 注册清理
      trap "kill $TEMP_BACKEND_PID 2>/dev/null || true" EXIT
    fi
  fi

  if [[ "$BACKEND_RUNNING" == "1" ]]; then
    # 触发 API 调用以产生日志
    echo "  触发 API 请求..."
    curl -s http://127.0.0.1:3000/healthz > /dev/null 2>&1 || true
    TOKEN=""
    if [[ -f "/tmp/vl-backend.token" ]]; then
      TOKEN=$(cat /tmp/vl-backend.token 2>/dev/null || true)
    fi
    if [[ -n "$TOKEN" ]]; then
      curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/tasks > /dev/null 2>&1 || true
    fi
    sleep 1  # 等待 stdout flush
    check_source "backend ($BACKEND_LOG)" "$BACKEND_LOG"
  fi
fi

# ── Mode B: Electron ──────────────────────────────────────────────
if [[ "$MODE" == "B" || "$CHECK_ALL" == "1" ]]; then
  echo ""
  echo "=== [Mode B] Electron 日志 ==="
  check_source "electron-main ($MAIN_LOG)" "$MAIN_LOG"
  check_source "electron-renderer ($RENDERER_LOG)" "$RENDERER_LOG"
fi

# ── 步骤日志（动态，如有任务）───────────────────────────────────────
echo ""
echo "=== 步骤日志（work/） ==="
STEP_FOUND=0
while IFS= read -r f; do
  rel=$(echo "$f" | sed "s|$PROJECT_DIR/||")
  task_id=$(echo "$rel" | cut -d/ -f2)
  fname=$(basename "$f")
  check_source "${task_id}/${fname}" "$f"
  STEP_FOUND=1
done < <(find "$PROJECT_DIR/work" -maxdepth 4 \
  \( -name "*.raw.log" -o -name "task.log.jsonl" \) 2>/dev/null | sort | tail -5)

if [[ "$STEP_FOUND" == "0" ]]; then
  echo "  (暂无任务步骤日志，需先创建并运行一个任务)"
fi

# ── 汇总 ─────────────────────────────────────────────────────────
echo ""
echo "=== 验证结果汇总 ==="
echo "  通过: $PASS  失败: $FAIL"

if [[ "$FAIL" == "0" && "$PASS" -gt 0 ]]; then
  echo ""
  echo "RESULT: OK — 环境就绪"
  exit 0
elif [[ "$PASS" == "0" && "$FAIL" == "0" ]]; then
  echo ""
  echo "RESULT: SKIP — 无可检查来源（后端未运行 + Electron 未启动）"
  exit 1
else
  echo ""
  echo "RESULT: FAIL — 有 $FAIL 个来源未通过"
  echo ""
  echo "诊断指引："
  echo "  MISSING       → 确认后台进程在运行；检查写入路径"
  echo "  NO_NEW_OUTPUT → 手动触发一次操作；检查重定向是否生效"
  echo "  ISO8601_FAIL  → head -3 <log> 查看实际行首格式"
  exit 1
fi
