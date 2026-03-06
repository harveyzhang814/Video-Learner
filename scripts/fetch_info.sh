#!/bin/bash
#
# Fetch video metadata (title, duration, thumbnail, etc.)
# Usage: bash scripts/fetch_info.sh "URL" "DIR"
#

set -e

URL="$1"
DIR="$2"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR>"
    exit 1
fi

# Create output directories
mkdir -p "$DIR/transcript"
mkdir -p "$DIR/media"
mkdir -p "$DIR/writing"

META_FILE="$DIR/transcript/meta.json"

echo "[STATUS] fetch_start"

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

# Update meta.json if it exists, otherwise create it
if [ -f "$META_FILE" ]; then
    # Update existing meta.json
    jq --arg title "$title" \
       --argjson duration "$duration" \
       --arg thumbnail "$thumbnail" \
       --arg description "$description" \
       --arg uploader "$uploader" \
       '.title = $title | .duration = $duration | .thumbnail = $thumbnail | .description = $description | .uploader = $uploader' \
       "$META_FILE" > "${META_FILE}.tmp" && mv "${META_FILE}.tmp" "$META_FILE"
else
    # Create new meta.json
    echo "{}" | jq --arg id "$(echo "$URL" | sha1sum | cut -c1-12)" \
                  --arg url "$URL" \
                  --arg title "$title" \
                  --argjson duration "$duration" \
                  --arg thumbnail "$thumbnail" \
                  --arg description "$description" \
                  --arg uploader "$uploader" \
                  --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
                  '.id = $id | .url = $url | .title = $title | .duration = $duration | .thumbnail = $thumbnail | .description = $description | .uploader = $uploader | .ts = $ts' \
                  > "$META_FILE"
fi

echo "[STATUS] fetch_done"
exit 0
