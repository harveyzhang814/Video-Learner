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

# Trap for cleanup on interrupt
trap 'rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null; exit 1' INT TERM

# Create directory with error check
mkdir -p "$DIR/media" || { echo "[STATUS] audio_error: cannot create directory"; exit 1; }

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
# Priority: m4a > webm > any audio
echo "[INFO] Downloading audio..."
yt-dlp -f "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio" \
    -o "$DIR/media/audio.temp.m4a" "$URL" 2>&1
PIPESTATUS_CODE=(${PIPESTATUS[@]})
YTDLP_EXIT_CODE=${PIPESTATUS_CODE[0]}

# Check yt-dlp exit code
if [ "$YTDLP_EXIT_CODE" -ne 0 ]; then
    echo "[STATUS] audio_error: yt-dlp failed with exit code $YTDLP_EXIT_CODE"
    rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true
    exit 1
fi

# Verify file size (prevent partial downloads)
if [ -f "$DIR/media/audio.temp.m4a" ]; then
    temp_size=$(stat -f%z "$DIR/media/audio.temp.m4a" 2>/dev/null || stat -c%s "$DIR/media/audio.temp.m4a" 2>/dev/null || echo "0")
    if [ "$temp_size" -le 1000 ]; then
        echo "[STATUS] audio_error: downloaded file too small ($temp_size bytes)"
        rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true
        exit 1
    fi
    mv "$DIR/media/audio.temp.m4a" "$DIR/media/audio.m4a"
    echo "[STATUS] audio_done"
    exit 0
fi

# Failed
echo "[STATUS] audio_error: download failed"
rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true
exit 1
