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

# Create temporary prompt file with replaced placeholders
TEMP_PROMPT=$(mktemp)
sed -e "s|{{FOCUS}}|$FOCUS|g" \
    -e "s|{{ARTICLE_PATH}}|$ARTICLE_PATH|g" \
    -e "s|{{OUTPUT_PATH}}|$OUTPUT_PATH|g" \
    -e "s|OUTPUT_LANG=zh-CN|OUTPUT_LANG=$OUTPUT_LANG|g" \
    "$PROMPT_TEMPLATE" > "$TEMP_PROMPT"

# Call Claude CLI to generate summary (unset CLAUDECODE to allow nested sessions)
unset CLAUDECODE
# Some environments (e.g. IDE-launched processes) may set ANTHROPIC_BASE_URL to a proxy
# that is unreachable for Claude Code CLI, causing "Connection error" retries and apparent hangs.
env ANTHROPIC_BASE_URL="https://api.anthropic.com" claude -p --dangerously-skip-permissions < "$TEMP_PROMPT" > "$OUTPUT_PATH"

# Clean up temp file
rm -f "$TEMP_PROMPT"

if [ $? -eq 0 ]; then
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
