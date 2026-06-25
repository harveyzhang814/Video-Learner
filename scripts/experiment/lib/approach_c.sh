#!/bin/bash
# approach_c.sh — Baseline: two independent sessions (mirrors production llm_engine.sh behavior)
# Usage: bash approach_c.sh --transcript <path> --focus <str> --output-lang <str> --out-dir <dir>

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
SUMMARY_PROMPT_TPL="$SCRIPTS_DIR/summary_prompt.txt"

[[ -f "$ARTICLE_PROMPT_TPL" ]] || { echo "Missing $ARTICLE_PROMPT_TPL" >&2; exit 1; }
[[ -f "$SUMMARY_PROMPT_TPL" ]] || { echo "Missing $SUMMARY_PROMPT_TPL" >&2; exit 1; }

# Detect source language from filename
SOURCE_LANG="en"
[[ "$TRANSCRIPT" == *"original_zh.md" ]] && SOURCE_LANG="zh"

opencode_ensure

echo "[C] Building article prompt..."
ARTICLE_PROMPT_FILE="$(mktemp)"
python3 - "$ARTICLE_PROMPT_TPL" "$ARTICLE_PROMPT_FILE" <<PYEOF
import sys
tpl = open(sys.argv[1], encoding='utf-8').read()
transcript = open("$TRANSCRIPT", encoding='utf-8').read()
result = tpl.replace('{{TRANSCRIPT_CONTENT}}', transcript).replace('{{SOURCE_LANG}}', '$SOURCE_LANG')
open(sys.argv[2], 'w', encoding='utf-8').write(result)
PYEOF

echo "[C] Session 1: generating article..."
SID_ARTICLE="$(opencode_create_session "exp-c-article-$$")"
opencode_send_msg "$SID_ARTICLE" "$ARTICLE_PROMPT_FILE" \
  "$OUT_DIR/article.md" "$OUT_DIR/_metrics_article.json"
rm -f "$ARTICLE_PROMPT_FILE"
echo "[C] article done ($(wc -c < "$OUT_DIR/article.md") bytes)"

echo "[C] Building summary prompt..."
SUMMARY_PROMPT_FILE="$(mktemp)"
python3 "$SCRIPTS_DIR/build_single_summary_prompt.py" \
  "$SUMMARY_PROMPT_TPL" "$OUT_DIR/article.md" "$SUMMARY_PROMPT_FILE" \
  "$FOCUS" "$OUTPUT_LANG"

echo "[C] Session 2: generating summary..."
SID_SUMMARY="$(opencode_create_session "exp-c-summary-$$")"
opencode_send_msg "$SID_SUMMARY" "$SUMMARY_PROMPT_FILE" \
  "$OUT_DIR/summary.md" "$OUT_DIR/_metrics_summary.json"
rm -f "$SUMMARY_PROMPT_FILE"
echo "[C] summary done ($(wc -c < "$OUT_DIR/summary.md") bytes)"

echo "[C] Writing metrics.json..."
python3 - "$OUT_DIR/_metrics_article.json" "$OUT_DIR/_metrics_summary.json" "$OUT_DIR/metrics.json" <<PYEOF
import json, sys
a = json.load(open(sys.argv[1]))
s = json.load(open(sys.argv[2]))
out = {
  "approach": "C",
  "article": a,
  "summary": s,
  "total_time_ms": a["time_ms"] + s["time_ms"]
}
json.dump(out, open(sys.argv[3], "w"), indent=2)
PYEOF
rm -f "$OUT_DIR/_metrics_article.json" "$OUT_DIR/_metrics_summary.json"

echo "[C] Done. metrics:"
cat "$OUT_DIR/metrics.json"
