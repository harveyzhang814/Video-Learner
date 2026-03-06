#!/bin/bash
# Audio downloader - runs as independent background process
# Usage: bash scripts/download_audio.sh <URL> <DIR> [FORCE]

URL="$1"
DIR="$2"
FORCE="${3:-0}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: download_audio.sh <URL> <DIR> [FORCE]"
    exit 1
fi

mkdir -p "$DIR"

echo "[STATUS] audio_start"

# Check if already exists
if [ "$FORCE" = "0" ] && [ -f "$DIR/media/audio.m4a" ]; then
    size=$(stat -f%z "$DIR/media/audio.m4a" 2>/dev/null || stat -c%s "$DIR/media/audio.m4a" 2>/dev/null || echo "0")
    if [ "$size" -gt 1000 ]; then
        echo "[STATUS] audio_done"
        exit 0
    fi
fi

# Clean temp files
rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true

# Download audio using yt-dlp
yt-dlp -f "bestaudio[ext=m4a]/bestaudio/best" \
    -o "$DIR/media/audio.temp.m4a" "$URL" 2>&1 | tail -3

if [ -f "$DIR/media/audio.temp.m4a" ]; then
    mv "$DIR/media/audio.temp.m4a" "$DIR/media/audio.m4a"
    echo "[STATUS] audio_done"
    exit 0
fi

# Failed
echo "[STATUS] audio_error: download failed"
rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true
exit 1
