#!/bin/bash
# Article generation step script
# Usage: bash scripts/generate_article.sh <ORIGINAL_PATH> <OUTPUT_PATH> [OUTPUT_LANG]
#   ORIGINAL_PATH: Path to original.md (original_en.md or original_zh.md)
#   OUTPUT_PATH: Path to output article.md
#   OUTPUT_LANG: Output language (optional, default zh-CN)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROMPT_TEMPLATE="$SCRIPT_DIR/article_prompt.txt"

# Initialize database
source "$SCRIPT_DIR/db.sh"

# Check arguments
if [ $# -lt 2 ]; then
    echo "[STATUS] article_error: Missing arguments"
    echo "Usage: $0 <ORIGINAL_PATH> <OUTPUT_PATH> [OUTPUT_LANG]"
    exit 1
fi

ORIGINAL_PATH="$1"
OUTPUT_PATH="$2"
OUTPUT_LANG="${3:-zh-CN}"  # Default to zh-CN

# Extract task ID from original path (e.g., work/<id>/transcript/original.md)
# Convert to absolute path first to ensure regex matches correctly
ORIGINAL_PATH="$(cd "$(dirname "$ORIGINAL_PATH")" && pwd)/$(basename "$ORIGINAL_PATH")"
TASK_ID=$(echo "$ORIGINAL_PATH" | sed -E 's|.*/([^/]+)/transcript/.*|\1|')

# Validate input file exists
if [ ! -f "$ORIGINAL_PATH" ]; then
    echo "[STATUS] article_error: Original file not found: $ORIGINAL_PATH"
    exit 1
fi

# Prefer English transcript as article input when available.
# This matters because the article step often benefits from original terminology and code identifiers.
ORIGINAL_DIR="$(cd "$(dirname "$ORIGINAL_PATH")" && pwd)"
EN_ORIGINAL_PATH="$ORIGINAL_DIR/original_en.md"
if [[ "$ORIGINAL_PATH" == *"/original_zh.md" ]] && [ -f "$EN_ORIGINAL_PATH" ] && [ -s "$EN_ORIGINAL_PATH" ]; then
    ORIGINAL_PATH="$EN_ORIGINAL_PATH"
fi

# Validate prompt template exists
if [ ! -f "$PROMPT_TEMPLATE" ]; then
    echo "[STATUS] article_error: Prompt template not found: $PROMPT_TEMPLATE"
    exit 1
fi

# Detect source language from filename
SOURCE_LANG="en"
if [[ "$ORIGINAL_PATH" == *"original_zh.md" ]]; then
    SOURCE_LANG="zh"
elif [[ "$ORIGINAL_PATH" == *"original_en.md" ]]; then
    SOURCE_LANG="en"
else
    # Try to detect from file content (first line)
    FIRST_LINE=$(head -n 1 "$ORIGINAL_PATH" 2>/dev/null || echo "")
    if [[ "$FIRST_LINE" =~ ^[^\x00-\x7F] ]]; then
        SOURCE_LANG="zh"
    fi
fi

# Create output directory if needed
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
mkdir -p "$OUTPUT_DIR"

echo "[STATUS] article_start"
echo "Generating article from: $ORIGINAL_PATH"
echo "Output language: $OUTPUT_LANG"
echo "Source language: $SOURCE_LANG"

# Update step to running
update_step "$TASK_ID" "article" "running"

# ---------------------------------------------------------------------------
# Chunking detection — always build manifest, then decide path
# ---------------------------------------------------------------------------
TRANSCRIPT_DIR="$(dirname "$ORIGINAL_PATH")"
CHUNK_TRANSCRIPT_DIR="$TRANSCRIPT_DIR/chunks"
CHUNK_ARTICLE_DIR="$OUTPUT_DIR/chunks"
MANIFEST_PATH="$CHUNK_TRANSCRIPT_DIR/manifest.json"

mkdir -p "$CHUNK_TRANSCRIPT_DIR"
if ! python3 "$SCRIPT_DIR/chunk_transcript.py" "$ORIGINAL_PATH" "$CHUNK_TRANSCRIPT_DIR" 2>&1; then
    echo "Warning: chunk_transcript.py failed, falling back to single-call path" >&2
    TOTAL_SECONDS=0
else
    TOTAL_SECONDS=$(python3 -c "import json; print(json.load(open('$MANIFEST_PATH'))['total_seconds'])" 2>/dev/null || echo "0")
fi

# ---------------------------------------------------------------------------
# CHUNKED PATH  (≥ 60 min / 3600 s)
# ---------------------------------------------------------------------------
if [ "${TOTAL_SECONDS:-0}" -ge 3600 ]; then
    CHUNK_COUNT=$(python3 -c "import json; print(len(json.load(open('$MANIFEST_PATH'))['chunks']))" 2>/dev/null || echo "0")
    echo "Long video (${TOTAL_SECONDS}s): generating ${CHUNK_COUNT} article chunks"

    mkdir -p "$CHUNK_ARTICLE_DIR"

    # Format seconds → HH:MM:SS helper
    _fmt_ts() { printf '%02d:%02d:%02d' $(($1/3600)) $((($1%3600)/60)) $(($1%60)); }

    # Build per-chunk prompt header + article for each chunk
    TOTAL_TS=$(_fmt_ts "$TOTAL_SECONDS")
    CHUNK_FAILED=0

    for IDX in $(python3 -c "import json; [print(c['index']) for c in json.load(open('$MANIFEST_PATH'))['chunks']]" 2>/dev/null); do
        CHUNK_ARTICLE="$CHUNK_ARTICLE_DIR/chunk_$(printf '%03d' $IDX)_article.md"

        # Resume: skip already-generated chunks
        if [ -s "$CHUNK_ARTICLE" ]; then
            echo "  chunk $IDX: already exists, skipping"
            continue
        fi

        # Read chunk boundaries from manifest
        read SEAM_START SEAM_END SLICE_START SLICE_END <<< $(python3 -c "
import json
c = [x for x in json.load(open('$MANIFEST_PATH'))['chunks'] if x['index']==$IDX][0]
print(c['seam_start'], c['seam_end'], c['slice_start'], c['slice_end'])
")
        CHUNK_TRANSCRIPT="$CHUNK_TRANSCRIPT_DIR/chunk_$(printf '%03d' $IDX).md"
        SEAM_START_TS=$(_fmt_ts "$SEAM_START")
        SEAM_END_TS=$(_fmt_ts "$SEAM_END")
        SLICE_START_TS=$(_fmt_ts "$SLICE_START")
        SLICE_END_TS=$(_fmt_ts "$SLICE_END")

        echo "  chunk $IDX/$CHUNK_COUNT (${SEAM_START_TS}–${SEAM_END_TS})"

        # Build per-chunk prompt via standalone Python script (avoids heredoc encoding issues)
        TEMP_PROMPT=$(mktemp)
        if ! python3 "$SCRIPT_DIR/build_chunk_prompt.py" \
                "$PROMPT_TEMPLATE" "$CHUNK_TRANSCRIPT" "$TEMP_PROMPT" \
                "$TOTAL_TS" "$IDX" "$CHUNK_COUNT" \
                "$SEAM_START_TS" "$SEAM_END_TS" \
                "$SLICE_START_TS" "$SLICE_END_TS" \
                "$SOURCE_LANG" "$OUTPUT_LANG"; then
            echo "[STATUS] article_error: failed to build prompt for chunk $IDX"
            rm -f "$TEMP_PROMPT"
            CHUNK_FAILED=1
            break
        fi

        # Call writing engine for this chunk
        if ! WRITING_ENGINE="${WRITING_ENGINE:-}" bash "$SCRIPT_DIR/llm_engine.sh" \
                --input "$TEMP_PROMPT" \
                --output "$CHUNK_ARTICLE"; then
            echo "[STATUS] article_error: chunk $IDX generation failed"
            rm -f "$TEMP_PROMPT"
            CHUNK_FAILED=1
            break
        fi
        rm -f "$TEMP_PROMPT"
    done

    if [ "$CHUNK_FAILED" -eq 1 ]; then
        update_step "$TASK_ID" "article" "failed" "chunk generation failed"
        echo "[STATUS] article_error: Article generation failed (chunk error)"
        exit 1
    fi

    # Merge all chunk articles
    echo "Merging $CHUNK_COUNT chunks → $OUTPUT_PATH"
    if ! python3 "$SCRIPT_DIR/merge_article_chunks.py" \
            "$MANIFEST_PATH" "$CHUNK_ARTICLE_DIR" "$OUTPUT_PATH"; then
        update_step "$TASK_ID" "article" "failed" "merge failed"
        echo "[STATUS] article_error: Article merge failed"
        exit 1
    fi

    update_step "$TASK_ID" "article" "completed"
    echo "[STATUS] article_done"
    exit 0
fi

# ---------------------------------------------------------------------------
# SINGLE-CALL PATH  (< 60 min) — original code, unchanged
# ---------------------------------------------------------------------------

# Build prompt by inlining transcript content directly.
# Passing a file path to opencode (agent mode) causes it to use the Read tool,
# which loads the full content into the context and makes MiniMax stall.
TEMP_PROMPT=$(mktemp)
# Use Python to safely substitute multiline content into the template
python3 - "$PROMPT_TEMPLATE" "$TEMP_PROMPT" <<PYEOF
import sys

template_path, output_path = sys.argv[1], sys.argv[2]
template = open(template_path).read()
transcript = open("$ORIGINAL_PATH").read()

result = (template
    .replace("{{TRANSCRIPT_CONTENT}}", transcript)
    .replace("{{SOURCE_LANG}}", "$SOURCE_LANG"))

open(output_path, "w").write(result)
PYEOF

# Call the writing engine to generate article output.
WRITING_ENGINE="${WRITING_ENGINE:-}" bash "$SCRIPT_DIR/llm_engine.sh" \
    --input "$TEMP_PROMPT" \
    --output "$OUTPUT_PATH"

# Clean up temp file
rm -f "$TEMP_PROMPT"

if [ $? -eq 0 ]; then
    # Update database
    update_step "$TASK_ID" "article" "completed"
    echo "[STATUS] article_done"
    exit 0
else
    # Update database
    update_step "$TASK_ID" "article" "failed" "generation failed"
    echo "[STATUS] article_error: Article generation failed"
    exit 1
fi
