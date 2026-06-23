#!/bin/bash
# Summary generation step script
# Usage: bash scripts/generate_summary.sh <ARTICLE_PATH> <FOCUS> <OUTPUT_PATH> [OUTPUT_LANG]
#   ARTICLE_PATH: Path to article.md
#   FOCUS: User's focus/interest (e.g., "技术细节", "主要论点", "行动项")
#   OUTPUT_PATH: Path to output summary.md
#   OUTPUT_LANG: Output language (optional, default zh-CN)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROMPT_TEMPLATE="$SCRIPT_DIR/summary_prompt.txt"
MINI_PROMPT_TEMPLATE="$SCRIPT_DIR/summary_mini_prompt.txt"
REDUCE_PROMPT_TEMPLATE="$SCRIPT_DIR/summary_reduce_prompt.txt"

# Initialize database
source "$SCRIPT_DIR/db.sh"

# Check arguments
if [ $# -lt 3 ]; then
    echo "[STATUS] summary_error: Missing arguments"
    echo "Usage: $0 <ARTICLE_PATH> <FOCUS> <OUTPUT_PATH> [OUTPUT_LANG]"
    exit 1
fi

ARTICLE_PATH="$1"
FOCUS="$2"
OUTPUT_PATH="$3"
OUTPUT_LANG="${4:-zh-CN}"  # Default to zh-CN

# Extract task ID from article path (e.g., work/<id>/writing/article.md)
# Convert to absolute path first to ensure regex matches correctly
ARTICLE_PATH="$(cd "$(dirname "$ARTICLE_PATH")" && pwd)/$(basename "$ARTICLE_PATH")"
TASK_ID=$(echo "$ARTICLE_PATH" | sed -E 's|.*/([^/]+)/writing/.*|\1|')

# Validate input file exists
if [ ! -f "$ARTICLE_PATH" ]; then
    echo "[STATUS] summary_error: Article file not found: $ARTICLE_PATH"
    exit 1
fi

# Create output directory if needed
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
CHUNK_SUMMARY_DIR="$OUTPUT_DIR/chunks"
mkdir -p "$OUTPUT_DIR"

echo "[STATUS] summary_start"
echo "Generating summary from: $ARTICLE_PATH"
echo "Focus: $FOCUS"
echo "Output language: $OUTPUT_LANG"

# Update step to running
update_step "$TASK_ID" "summary" "running"

# ---------------------------------------------------------------------------
# Section-aware chunking — split article by ## headings, decide path
# ---------------------------------------------------------------------------
MANIFEST_PATH="$CHUNK_SUMMARY_DIR/sections_manifest.json"
mkdir -p "$CHUNK_SUMMARY_DIR"

TRUNK_COUNT=0
if python3 "$SCRIPT_DIR/split_article_sections.py" "$ARTICLE_PATH" "$CHUNK_SUMMARY_DIR" 2>&1; then
    TRUNK_COUNT=$(python3 -c "import json; print(json.load(open('$MANIFEST_PATH'))['trunk_count'])" 2>/dev/null || echo "0")
else
    echo "Warning: split_article_sections.py failed, falling back to single-call path" >&2
    TRUNK_COUNT=0
fi

# ---------------------------------------------------------------------------
# MAP-REDUCE PATH  (trunk_count >= 3)
# ---------------------------------------------------------------------------
if [ "${TRUNK_COUNT:-0}" -ge 3 ]; then
    echo "Long article (${TRUNK_COUNT} trunks): generating mini-summaries"

    TRUNK_FAILED=0

    for IDX in $(python3 -c "import json; [print(t['index']) for t in json.load(open('$MANIFEST_PATH'))['trunks']]" 2>/dev/null); do
        TRUNK_SUMMARY="$CHUNK_SUMMARY_DIR/trunk_$(printf '%03d' $IDX)_summary.md"

        # Resume: skip already-generated trunk summaries
        if [ -s "$TRUNK_SUMMARY" ]; then
            echo "  trunk $IDX: already exists, skipping"
            continue
        fi

        TRUNK_FILE="$CHUNK_SUMMARY_DIR/trunk_$(printf '%03d' $IDX).md"
        echo "  trunk $IDX/$TRUNK_COUNT"

        TEMP_PROMPT=$(mktemp)
        if ! python3 "$SCRIPT_DIR/build_section_prompt.py" \
                "$MINI_PROMPT_TEMPLATE" "$TRUNK_FILE" "$TEMP_PROMPT" \
                "$IDX" "$TRUNK_COUNT" "$FOCUS" "$OUTPUT_LANG"; then
            echo "[STATUS] summary_error: failed to build prompt for trunk $IDX"
            rm -f "$TEMP_PROMPT"
            TRUNK_FAILED=1
            break
        fi

        if ! WRITING_ENGINE="${WRITING_ENGINE:-}" bash "$SCRIPT_DIR/llm_engine.sh" \
                --input "$TEMP_PROMPT" \
                --output "$TRUNK_SUMMARY"; then
            echo "[STATUS] summary_error: trunk $IDX mini-summary failed"
            rm -f "$TEMP_PROMPT"
            TRUNK_FAILED=1
            break
        fi
        rm -f "$TEMP_PROMPT"
    done

    if [ "$TRUNK_FAILED" -eq 1 ]; then
        update_step "$TASK_ID" "summary" "failed" "trunk mini-summary failed"
        echo "[STATUS] summary_error: Summary generation failed (trunk error)"
        exit 1
    fi

    # Reduce: combine all mini-summaries into final summary
    echo "Reducing $TRUNK_COUNT mini-summaries → $OUTPUT_PATH"
    TEMP_REDUCE=$(mktemp)
    if ! python3 "$SCRIPT_DIR/build_reduce_prompt.py" \
            "$REDUCE_PROMPT_TEMPLATE" "$CHUNK_SUMMARY_DIR" "$TRUNK_COUNT" "$TEMP_REDUCE" \
            "$FOCUS" "$OUTPUT_LANG"; then
        rm -f "$TEMP_REDUCE"
        update_step "$TASK_ID" "summary" "failed" "reduce prompt build failed"
        echo "[STATUS] summary_error: Failed to build reduce prompt"
        exit 1
    fi

    if ! WRITING_ENGINE="${WRITING_ENGINE:-}" bash "$SCRIPT_DIR/llm_engine.sh" \
            --input "$TEMP_REDUCE" \
            --output "$OUTPUT_PATH"; then
        rm -f "$TEMP_REDUCE"
        update_step "$TASK_ID" "summary" "failed" "reduce failed"
        echo "[STATUS] summary_error: Summary reduce failed"
        exit 1
    fi
    rm -f "$TEMP_REDUCE"

    update_step "$TASK_ID" "summary" "completed"
    echo "[STATUS] summary_done"
    exit 0
fi

# ---------------------------------------------------------------------------
# SINGLE-CALL PATH  (trunk_count < 3 or split failed)
# ---------------------------------------------------------------------------

# Validate prompt template exists
if [ ! -f "$PROMPT_TEMPLATE" ]; then
    echo "[STATUS] summary_error: Prompt template not found: $PROMPT_TEMPLATE"
    exit 1
fi

TEMP_PROMPT=$(mktemp)
cleanup() {
    rm -f "$TEMP_PROMPT"
}
trap cleanup EXIT

# Build prompt via standalone Python script (avoids heredoc encoding issues with CJK)
if ! python3 "$SCRIPT_DIR/build_single_summary_prompt.py" \
        "$PROMPT_TEMPLATE" "$ARTICLE_PATH" "$TEMP_PROMPT" \
        "$FOCUS" "$OUTPUT_LANG"; then
    echo "[STATUS] summary_error: Failed to build summary prompt"
    exit 1
fi

# Call the writing engine to generate summary output.
if WRITING_ENGINE="${WRITING_ENGINE:-}" bash "$SCRIPT_DIR/llm_engine.sh" \
    --input "$TEMP_PROMPT" \
    --output "$OUTPUT_PATH"; then
    update_step "$TASK_ID" "summary" "completed"
    echo "[STATUS] summary_done"
    exit 0
else
    update_step "$TASK_ID" "summary" "failed" "generation failed"
    echo "[STATUS] summary_error: Summary generation failed"
    exit 1
fi
