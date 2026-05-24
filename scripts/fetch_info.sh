#!/bin/bash
#
# Fetch video metadata (title, duration, thumbnail, etc.)
# Usage: bash scripts/fetch_info.sh "URL" "DIR" [ID]
#

set -e

URL="$1"
DIR="$2"
ID="$3"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR> [ID]"
    exit 1
fi

# Use provided ID or generate from URL
if [ -z "$ID" ]; then
    ID=$(echo "$URL" | sha1sum | cut -c1-12)
fi

# Database path
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/work/database.sqlite"

# Initialize database
source "$SCRIPT_DIR/db.sh"
source "$SCRIPT_DIR/yt-dlp-cookies.sh"
init_db

# Create task in database
create_task "$ID" "$URL"

# Create output directories
mkdir -p "$DIR/transcript"
mkdir -p "$DIR/media"
mkdir -p "$DIR/writing"

echo "[STATUS] fetch_start"

# Update step to running
update_step "$ID" "fetch" "running"

# Get video info as JSON (keep stderr so failures show in log)
video_info=$(yt-dlp $YT_DLP_COOKIE_OPTS --dump-json --no-download "$URL") || true

if [ -z "$video_info" ] || ! echo "$video_info" | jq -e . >/dev/null 2>&1; then
    echo "Error: Failed to fetch video info"
    [ -n "$video_info" ] && echo "$video_info"
    exit 1
fi

# Extract key fields
title=$(echo "$video_info" | jq -r '.title // "Untitled"' 2>/dev/null)
duration=$(echo "$video_info" | jq -r '.duration // 0' 2>/dev/null)
thumbnail=$(echo "$video_info" | jq -r '.thumbnail // ""' 2>/dev/null)
description=$(echo "$video_info" | jq -r '.description // ""' 2>/dev/null)
uploader=$(echo "$video_info" | jq -r '.uploader // ""' 2>/dev/null)

echo "Title: $title"
echo "Duration: $duration seconds"
echo "Uploader: $uploader"

# Update task in database with metadata
# Escape single quotes for SQLite (replace ' with '')
_title_esc=$(echo "$title" | sed "s/'/''/g")
_duration_esc=$(echo "$duration" | sed "s/'/''/g")
_uploader_esc=$(echo "$uploader" | sed "s/'/''/g")
sqlite3 "$DB_PATH" "UPDATE tasks SET title = '$_title_esc', duration = '$_duration_esc', uploader = '$_uploader_esc', updated_at = datetime('now') WHERE id = '$ID';"

# Update step to completed
update_step "$ID" "fetch" "completed"

echo "[STATUS] fetch_done"
exit 0
