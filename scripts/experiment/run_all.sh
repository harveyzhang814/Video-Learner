#!/bin/bash
# run_all.sh — Run all three session-chain approaches and generate comparison report
# Usage: bash scripts/experiment/run_all.sh --transcript <path> [options]

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SELF_DIR")")"
LIB_DIR="$SELF_DIR/lib"

TRANSCRIPT=""
FOCUS="综合理解"
OUTPUT_LANG="zh-CN"
OUT_DIR=""
APPROACHES="A,B,C"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --transcript)  TRANSCRIPT="$2";  shift 2 ;;
    --focus)       FOCUS="$2";       shift 2 ;;
    --output-lang) OUTPUT_LANG="$2"; shift 2 ;;
    --out-dir)     OUT_DIR="$2";     shift 2 ;;
    --approaches)  APPROACHES="$2";  shift 2 ;;
    -h|--help)
      echo "Usage: $0 --transcript <path> [--focus <str>] [--output-lang zh-CN|en] [--out-dir <dir>] [--approaches A,B,C]"
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]] || { echo "Missing/invalid --transcript" >&2; exit 1; }

# Resolve to absolute path so the sed pattern always matches
TRANSCRIPT="$(cd "$(dirname "$TRANSCRIPT")" && pwd)/$(basename "$TRANSCRIPT")"

# Extract task_id from transcript path (work/<id>/...)
TASK_ID="$(echo "$TRANSCRIPT" | sed -E 's|.*/work/([^/]+)/.*|\1|')"
if [[ -z "$TASK_ID" || "$TASK_ID" == "$TRANSCRIPT" ]]; then
  TASK_ID="unknown-$(python3 -c "import time; print(int(time.time()))")"
fi

[[ -n "$OUT_DIR" ]] || OUT_DIR="$PROJECT_DIR/work/experiment/$TASK_ID"
mkdir -p "$OUT_DIR"

echo "========================================"
echo "Session Chain Experiment"
echo "  task:       $TASK_ID"
echo "  transcript: $TRANSCRIPT ($(wc -c < "$TRANSCRIPT") bytes)"
echo "  approaches: $APPROACHES"
echo "  out-dir:    $OUT_DIR"
echo "========================================"

run_approach() {
  local name="$1"
  local name_lc
  name_lc="$(echo "$name" | tr '[:upper:]' '[:lower:]')"
  local script="$LIB_DIR/approach_${name_lc}.sh"
  local dir="$OUT_DIR/approach_${name_lc}"

  if [[ ! -f "$script" ]]; then
    echo "[run_all] Script not found: $script" >&2
    return 1
  fi

  echo ""
  echo "--- Approach $name ---"
  local start_ms
  start_ms="$(python3 -c "import time; print(int(time.time()*1000))")"

  bash "$script" \
    --transcript "$TRANSCRIPT" \
    --focus "$FOCUS" \
    --output-lang "$OUTPUT_LANG" \
    --out-dir "$dir"

  local end_ms
  end_ms="$(python3 -c "import time; print(int(time.time()*1000))")"
  echo "--- Approach $name finished in $(( (end_ms - start_ms) / 1000 ))s ---"
}

IFS=',' read -ra APPROACH_LIST <<< "$APPROACHES"
for ap in "${APPROACH_LIST[@]}"; do
  ap="${ap//[[:space:]]/}"
  run_approach "$ap"
done

# Generate report if all three ran
if [[ "$APPROACHES" == "A,B,C" || "$APPROACHES" == "A, B, C" ]]; then
  echo ""
  echo "--- Generating report ---"
  bash "$LIB_DIR/report.sh" \
    --task-id "$TASK_ID" \
    --dir-a "$OUT_DIR/approach_a" \
    --dir-b "$OUT_DIR/approach_b" \
    --dir-c "$OUT_DIR/approach_c" \
    --out "$OUT_DIR/report.md"
  echo "Report: $OUT_DIR/report.md"
fi

echo ""
echo "========================================"
echo "Done. Results in: $OUT_DIR"
echo "========================================"
