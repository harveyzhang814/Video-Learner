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
DB_PATH="$PROJECT_DIR/work/database.sqlite"
PROMPT_TEMPLATE="$SCRIPT_DIR/summary_prompt.txt"

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
TASK_ID=$(echo "$ARTICLE_PATH" | sed -E 's|.*/work/([^/]+)/writing.*|\1|')

# Validate input file exists
if [ ! -f "$ARTICLE_PATH" ]; then
    echo "[STATUS] summary_error: Article file not found: $ARTICLE_PATH"
    exit 1
fi

# Validate prompt template exists
if [ ! -f "$PROMPT_TEMPLATE" ]; then
    echo "[STATUS] summary_error: Prompt template not found: $PROMPT_TEMPLATE"
    exit 1
fi

# Create output directory if needed
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
mkdir -p "$OUTPUT_DIR"

echo "[STATUS] summary_start"
echo "Generating summary from: $ARTICLE_PATH"
echo "Focus: $FOCUS"
echo "Output language: $OUTPUT_LANG"

# Update step to running
update_step "$TASK_ID" "summary" "running"

# Build prompt by inlining article content directly (same reason as generate_article.sh:
# passing a path causes opencode agent to call Read tool, stalling MiniMax on large context).
TEMP_PROMPT=$(mktemp)
cleanup() {
    rm -f "$TEMP_PROMPT"
}
trap cleanup EXIT
python3 - "$PROMPT_TEMPLATE" "$TEMP_PROMPT" <<PYEOF
import sys

template_path, output_path = sys.argv[1], sys.argv[2]
template = open(template_path).read()
article = open("$ARTICLE_PATH").read()

result = (template
    .replace("{{ARTICLE_CONTENT}}", article)
    .replace("{{FOCUS}}", "$FOCUS")
    .replace("OUTPUT_LANG=zh-CN", "OUTPUT_LANG=$OUTPUT_LANG"))

open(output_path, "w").write(result)
PYEOF

# Call the writing engine to generate summary output.
if WRITING_ENGINE="${WRITING_ENGINE:-}" bash "$SCRIPT_DIR/llm_engine.sh" \
    --input "$TEMP_PROMPT" \
    --output "$OUTPUT_PATH"; then
    # Update database
    update_step "$TASK_ID" "summary" "completed"
    echo "[STATUS] summary_done"
    exit 0
else
    # Update database
    update_step "$TASK_ID" "summary" "failed" "generation failed"
    echo "[STATUS] summary_error: Summary generation failed"
    exit 1
fi
