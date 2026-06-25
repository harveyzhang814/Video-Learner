#!/bin/bash
# approach_a.sh — Pure context: single session, summary relies on session history (no article re-pass)
# Usage: bash approach_a.sh --transcript <path> --focus <str> --output-lang <str> --out-dir <dir>

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(dirname "$SELF_DIR")"
# shellcheck source=/dev/null
source "$SELF_DIR/session_http.sh"

TRANSCRIPT=""
FOCUS="综合理解"
OUTPUT_LANG="zh-CN"
OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --transcript) TRANSCRIPT="$2"; shift 2 ;;
    --focus)      FOCUS="$2";      shift 2 ;;
    --output-lang) OUTPUT_LANG="$2"; shift 2 ;;
    --out-dir)    OUT_DIR="$2";    shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]] || { echo "Missing/invalid --transcript" >&2; exit 1; }
[[ -n "$OUT_DIR" ]] || { echo "Missing --out-dir" >&2; exit 1; }
mkdir -p "$OUT_DIR"

ARTICLE_PROMPT_TPL="$SCRIPTS_DIR/article_prompt.txt"
[[ -f "$ARTICLE_PROMPT_TPL" ]] || { echo "Missing $ARTICLE_PROMPT_TPL" >&2; exit 1; }

SOURCE_LANG="en"
[[ "$TRANSCRIPT" == *"original_zh.md" ]] && SOURCE_LANG="zh"

opencode_ensure

echo "[A] Building article prompt..."
ARTICLE_PROMPT_FILE="$(mktemp)"
python3 - "$ARTICLE_PROMPT_TPL" "$ARTICLE_PROMPT_FILE" <<PYEOF
import sys
tpl = open(sys.argv[1], encoding='utf-8').read()
transcript = open("$TRANSCRIPT", encoding='utf-8').read()
result = tpl.replace('{{TRANSCRIPT_CONTENT}}', transcript).replace('{{SOURCE_LANG}}', '$SOURCE_LANG')
open(sys.argv[2], 'w', encoding='utf-8').write(result)
PYEOF

echo "[A] Creating single session..."
SID="$(opencode_create_session "exp-a-$$")"

echo "[A] Msg 1: generating article..."
opencode_send_msg "$SID" "$ARTICLE_PROMPT_FILE" \
  "$OUT_DIR/article.md" "$OUT_DIR/_metrics_article.json"
rm -f "$ARTICLE_PROMPT_FILE"
echo "[A] article done ($(wc -c < "$OUT_DIR/article.md") bytes)"

echo "[A] Msg 2: generating summary (context-only, no article re-pass)..."
SUMMARY_PROMPT_FILE="$(mktemp)"
cat > "$SUMMARY_PROMPT_FILE" << PROMPT
请基于你在上一条消息中生成的文章，撰写摘要。

要求：
1. 首先用 1-2 句话概括文章的核心观点
2. 列出主要论点，每个论点下可包含关键子论点（最多一层）
3. 用户更加关注：${FOCUS}
4. 使用 ${OUTPUT_LANG} 语言输出（zh-CN=简体中文，en=英文）
5. 术语保留：专业名词、技术术语、代码、API 名称等保留原语言形式
6. 直接输出摘要正文（Markdown），不要输出任何解释、前言或确认信息
PROMPT

opencode_send_msg "$SID" "$SUMMARY_PROMPT_FILE" \
  "$OUT_DIR/summary.md" "$OUT_DIR/_metrics_summary.json"
rm -f "$SUMMARY_PROMPT_FILE"
echo "[A] summary done ($(wc -c < "$OUT_DIR/summary.md") bytes)"

echo "[A] Writing metrics.json..."
python3 - "$OUT_DIR/_metrics_article.json" "$OUT_DIR/_metrics_summary.json" "$OUT_DIR/metrics.json" <<PYEOF
import json, sys
a = json.load(open(sys.argv[1]))
s = json.load(open(sys.argv[2]))
out = {
  "approach": "A",
  "article": a,
  "summary": s,
  "total_time_ms": a["time_ms"] + s["time_ms"]
}
json.dump(out, open(sys.argv[3], "w"), indent=2)
PYEOF
rm -f "$OUT_DIR/_metrics_article.json" "$OUT_DIR/_metrics_summary.json"

echo "[A] Done. metrics:"
cat "$OUT_DIR/metrics.json"
