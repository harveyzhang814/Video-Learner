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

# Get video info as JSON
video_info=$(yt-dlp --dump-json --no-download "$URL" 2>/dev/null)

if [ -z "$video_info" ]; then
    echo "Error: Failed to fetch video info"
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
sqlite3 "$DB_PATH" "UPDATE tasks SET title = '$title', duration = '$duration', updated_at = datetime('now') WHERE id = '$ID';"

# Update step to completed
update_step "$ID" "fetch" "completed"

echo "[STATUS] fetch_done"
exit 0
