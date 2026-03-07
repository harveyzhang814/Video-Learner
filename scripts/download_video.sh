#!/bin/bash
# Video downloader - runs as independent background process
# Usage: bash scripts/download_video.sh <URL> <DIR> [ID] [FORCE]

URL="$1"
DIR="$2"
ID="${3:-}"
FORCE="${4:-0}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: download_video.sh <URL> <DIR> [ID] [FORCE]"
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

mkdir -p "$DIR"

echo "[STATUS] video_start"

# Update step to running
update_step "$ID" "video" "running"

# Check if already exists
if [ "$FORCE" = "0" ] && [ -f "$DIR/media/video.mp4" ]; then
    size=$(stat -f%z "$DIR/media/video.mp4" 2>/dev/null || stat -c%s "$DIR/media/video.mp4" 2>/dev/null || echo "0")
    if [ "$size" -gt 1000 ]; then
        echo "[STATUS] video_done"
        # Update database
        update_step "$ID" "video" "skipped"
        update_download "$ID" "skipped_existing"
        exit 0
    fi
fi

# Clean temp files
rm -f "$DIR/media/video.temp.mp4" "$DIR/media/v_tempvideo"* "$DIR/media/v_tempaudio"* 2>/dev/null || true

# Attempt 1: Combined format
yt-dlp -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best" \
    -o "$DIR/media/video.temp.mp4" --merge-output-format mp4 "$URL" 2>&1 | tail -3

if [ -f "$DIR/media/video.temp.mp4" ]; then
    mv "$DIR/media/video.temp.mp4" "$DIR/media/video.mp4"
    echo "[STATUS] video_done"
    # Update database
    update_step "$ID" "video" "completed"
    update_download "$ID" "success" "" "$DIR/media/video.mp4"
    exit 0
fi

# Attempt 2: DASH fallback
yt-dlp -f "bestvideo[height<=1080][ext=mp4]" -o "$DIR/media/v_tempvideo.mp4" "$URL" 2>/dev/null || true
yt-dlp -f "bestaudio[ext=m4a]" -o "$DIR/media/v_tempaudio.m4a" "$URL" 2>/dev/null || true

if [ -f "$DIR/media/v_tempvideo.mp4" ] && [ -f "$DIR/media/v_tempaudio.m4a" ]; then
    ffmpeg -i "$DIR/media/v_tempvideo.mp4" -i "$DIR/media/v_tempaudio.m4a" -c copy -y "$DIR/media/video.mp4" 2>/dev/null
    rm -f "$DIR/media/v_tempvideo.mp4" "$DIR/media/v_tempaudio.m4a"
    if [ -f "$DIR/media/video.mp4" ]; then
        echo "[STATUS] video_done"
        # Update database
        update_step "$ID" "video" "completed"
        update_download "$ID" "success" "" "$DIR/media/video.mp4"
        exit 0
    fi
fi

# Failed
echo "[STATUS] video_error: download failed"
rm -f "$DIR/media/v_tempvideo.mp4" "$DIR/media/v_tempaudio.m4a" "$DIR/media/video.temp.mp4" 2>/dev/null || true
# Update database
update_step "$ID" "video" "failed" "download failed"
update_download "$ID" "failed" "download failed"
exit 1
