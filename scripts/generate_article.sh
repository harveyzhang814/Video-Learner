#!/bin/bash
# Article generation step script
# Usage: bash scripts/generate_article.sh <ORIGINAL_PATH> <OUTPUT_PATH> [OUTPUT_LANG]
#   ORIGINAL_PATH: Path to original.md (original_en.md or original_zh.md)
#   OUTPUT_PATH: Path to output article.md
#   OUTPUT_LANG: Output language (optional, default zh-CN)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/work/database.sqlite"
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
# Get the directory containing the transcript folder
TASK_ID=$(echo "$ORIGINAL_PATH" | sed -E 's|.*/work/([^/]+)/transcript.*|\1|')

# Validate input file exists
if [ ! -f "$ORIGINAL_PATH" ]; then
    echo "[STATUS] article_error: Original file not found: $ORIGINAL_PATH"
    exit 1
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

# Create temporary prompt file with replaced placeholders
TEMP_PROMPT=$(mktemp)
sed -e "s|{{ORIGINAL_PATH}}|$ORIGINAL_PATH|g" \
    -e "s|{{OUTPUT_PATH}}|$OUTPUT_PATH|g" \
    -e "s|{{SOURCE_LANG}}|$SOURCE_LANG|g" \
    -e "s|OUTPUT_LANG=zh-CN|OUTPUT_LANG=$OUTPUT_LANG|g" \
    "$PROMPT_TEMPLATE" > "$TEMP_PROMPT"

# Call the writing engine to generate article output.
WRITING_ENGINE="${WRITING_ENGINE:-claude}" bash "$SCRIPT_DIR/llm_engine.sh" \
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
