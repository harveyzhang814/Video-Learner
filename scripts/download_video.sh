#!/bin/bash
# Video downloader - runs as independent background process
# Usage: bash scripts/download_video.sh <URL> <DIR> [FORCE]

URL="$1"
DIR="$2"
FORCE="${3:-0}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: download_video.sh <URL> <DIR> [FORCE]"
    exit 1
fi

mkdir -p "$DIR"

echo "[Video DL] Starting download for $URL"
echo "[Video DL] DIR: $DIR, FORCE: $FORCE"

# Check if already exists
if [ "$FORCE" = "0" ] && [ -f "$DIR/media/video.mp4" ]; then
    size=$(stat -f%z "$DIR/media/video.mp4" 2>/dev/null || stat -c%s "$DIR/media/video.mp4" 2>/dev/null || echo "0")
    if [ "$size" -gt 1000 ]; then
        echo "[Video DL] video.mp4 exists, skipping"
        jq '.download_status = "skipped_existing"' > "$DIR/media/meta_temp.json" < "$DIR/transcript/meta.json"
        mv "$DIR/media/meta_temp.json" "$DIR/transcript/meta.json" 2>/dev/null || true
        exit 0
    fi
fi

# Clean temp files
rm -f "$DIR/media/video.temp.mp4" "$DIR/media/v_tempvideo"* "$DIR/media/v_tempaudio"* 2>/dev/null || true

# Attempt 1: Combined format
echo "[Video DL] Attempt 1: Combined format..."
yt-dlp -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best" \
    -o "$DIR/media/video.temp.mp4" --merge-output-format mp4 "$URL" 2>&1 | tail -3

if [ -f "$DIR/media/video.temp.mp4" ]; then
    mv "$DIR/media/video.temp.mp4" "$DIR/media/video.mp4"
    echo "[Video DL] Success: Downloaded video.mp4"
    jq '.download_status = "success"' > "$DIR/media/meta_temp.json" < "$DIR/transcript/meta.json"
    mv "$DIR/media/meta_temp.json" "$DIR/transcript/meta.json" 2>/dev/null || true
    exit 0
fi

# Attempt 2: DASH fallback
echo "[Video DL] Attempt 2: DASH fallback..."
yt-dlp -f "bestvideo[height<=1080][ext=mp4]" -o "$DIR/media/v_tempvideo.mp4" "$URL" 2>/dev/null || true
yt-dlp -f "bestaudio[ext=m4a]" -o "$DIR/media/v_tempaudio.m4a" "$URL" 2>/dev/null || true

if [ -f "$DIR/media/v_tempvideo.mp4" ] && [ -f "$DIR/media/v_tempaudio.m4a" ]; then
    ffmpeg -i "$DIR/media/v_tempvideo.mp4" -i "$DIR/media/v_tempaudio.m4a" -c copy -y "$DIR/media/video.mp4" 2>/dev/null
    rm -f "$DIR/media/v_tempvideo.mp4" "$DIR/media/v_tempaudio.m4a"
    if [ -f "$DIR/media/video.mp4" ]; then
        echo "[Video DL] Success: Merged to video.mp4"
        jq '.download_status = "success"' > "$DIR/media/meta_temp.json" < "$DIR/transcript/meta.json"
        mv "$DIR/media/meta_temp.json" "$DIR/transcript/meta.json" 2>/dev/null || true
        exit 0
    fi
fi

# Failed
echo "[Video DL] Failed"
rm -f "$DIR/media/v_tempvideo.mp4" "$DIR/media/v_tempaudio.m4a" "$DIR/media/video.temp.mp4" 2>/dev/null || true
jq '.download_status = "failed"' > "$DIR/media/meta_temp.json" < "$DIR/transcript/meta.json"
mv "$DIR/media/meta_temp.json" "$DIR/transcript/meta.json" 2>/dev/null || true
exit 1
