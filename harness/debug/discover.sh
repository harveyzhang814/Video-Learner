#!/usr/bin/env bash
# harness/debug/discover.sh
# 扫描项目日志来源，输出 JSON manifest
# 通用模板 — 部署后修改「静态日志来源」区块以匹配当前项目

set -euo pipefail

PROJECT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SLUG=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')
MANIFEST="/tmp/${SLUG}-log-manifest.json"

SOURCES=()

add_source() {
  local label="$1" path="$2" type="${3:-static}"
  local exists="false"
  [[ -f "$path" ]] && exists="true"
  SOURCES+=("{\"source\":\"${label}\",\"path\":\"${path}\",\"type\":\"${type}\",\"exists\":${exists}}")
}

# ── 静态日志来源（Video-Learner 项目配置）────────────────────────
# Node.js HTTP 后端（npm run agent:serve → node services/http-server/index.js）
add_source "backend"           "/tmp/vl-backend.log"
add_source "backend-slug"      "/tmp/${SLUG}-backend.log"

# Electron 主进程（patchConsole 写入此文件）
add_source "electron-main"     "$PROJECT_DIR/electron/main-process.log"

# Electron 渲染器（preload 拦截 console-message 写入此文件）
add_source "electron-renderer" "$PROJECT_DIR/electron/renderer-console.log"

# Monitor 错误摘要（harness/monitor.sh 写入）
add_source "monitor"           "/tmp/vl-error-summary.txt"
add_source "monitor-slug"      "/tmp/${SLUG}-error-summary.txt"

# 任务索引文件
add_source "task-index"        "$PROJECT_DIR/work/index.jsonl"

# ── 动态来源（work/ 下的任务步骤日志）─────────────────────────────
# 扫描 work/*/logs/*.raw.log 和 task.log.jsonl
if [[ -d "$PROJECT_DIR/work" ]]; then
  while IFS= read -r f; do
    rel=$(echo "$f" | sed "s|$PROJECT_DIR/||")
    task_id=$(echo "$rel" | cut -d/ -f2)
    fname=$(basename "$f" .log)
    label="${task_id}/${fname}"
    SOURCES+=("{\"source\":\"${label}\",\"path\":\"${f}\",\"type\":\"step\",\"exists\":true}")
  done < <(find "$PROJECT_DIR/work" -maxdepth 4 \
    \( -name "*.raw.log" -o -name "task.log.jsonl" \) 2>/dev/null | sort)
fi

# ── 通用 .log 文件扫描（其他技术栈）──────────────────────────────
while IFS= read -r f; do
  label=$(echo "$f" | sed "s|$PROJECT_DIR/||" | tr '/' '-' | sed 's/\.log$//')
  add_source "generic-${label}" "$f" "generic"
done < <(find "$PROJECT_DIR" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  -not -path "*/.claude/*" -not -path "*/work/*" \
  -not -path "*/harness/*" \
  -name "*.log" 2>/dev/null | sort)

# ── 输出 JSON ────────────────────────────────────────────────────
COUNT=${#SOURCES[@]}
printf '{\n  "project": "%s",\n  "slug": "%s",\n  "count": %d,\n  "sources": [\n' \
  "$PROJECT_DIR" "$SLUG" "$COUNT"

for i in "${!SOURCES[@]}"; do
  printf '    %s' "${SOURCES[$i]}"
  [[ $i -lt $((COUNT - 1)) ]] && printf ','
  printf '\n'
done

printf '  ]\n}\n' | tee "$MANIFEST"
echo "[discover] manifest → $MANIFEST" >&2
