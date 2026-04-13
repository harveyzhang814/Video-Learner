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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/yt-dlp-cookies.sh"

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

FORMAT="bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
PROGRESS_TMPL="[progress] downloaded=%(progress.downloaded_bytes)d total=%(progress.total_bytes or progress.total_bytes_estimate or 0)d speed=%(progress.speed or 0.0)f eta=%(progress.eta or 0)d"

# Helper: attempt audio download with given cookie opts, capture output
try_audio() {
    local cookie_opts="$1"
    local label="$2"
    echo "[INFO] $label"
    yt-dlp $cookie_opts \
        --newline \
        --progress-template "$PROGRESS_TMPL" \
        -f "$FORMAT" \
        -o "$DIR/media/audio.temp.m4a" "$URL" 2>&1
    return $?
}

# Attempt 1: no cookies (avoids TV-client HLS path that causes 403)
_TMPOUT=$(mktemp)
try_audio "" "Downloading audio (no cookies)..." 2>&1 | tee "$_TMPOUT"
YTDLP_EXIT=${PIPESTATUS[0]}
OUTPUT=$(cat "$_TMPOUT"); rm -f "$_TMPOUT"

if [ "$YTDLP_EXIT" -eq 0 ] && [ -f "$DIR/media/audio.temp.m4a" ]; then
    temp_size=$(stat -f%z "$DIR/media/audio.temp.m4a" 2>/dev/null || stat -c%s "$DIR/media/audio.temp.m4a" 2>/dev/null || echo "0")
    if [ "$temp_size" -gt 1000 ]; then
        mv "$DIR/media/audio.temp.m4a" "$DIR/media/audio.m4a"
        echo "[STATUS] audio_done"
        exit 0
    fi
fi
rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true

# Attempt 2: with cookies only if bot-detection error and cookies are configured
if [ -n "$YT_DLP_COOKIE_OPTS" ] && echo "$OUTPUT" | grep -qi "sign in\|bot\|confirm your age\|login required"; then
    echo "[INFO] Bot detection encountered, retrying with cookies..."
    OUTPUT2=$(try_audio "$YT_DLP_COOKIE_OPTS" "Downloading audio (with cookies)...")
    YTDLP_EXIT2=$?
    if [ "$YTDLP_EXIT2" -eq 0 ] && [ -f "$DIR/media/audio.temp.m4a" ]; then
        temp_size=$(stat -f%z "$DIR/media/audio.temp.m4a" 2>/dev/null || stat -c%s "$DIR/media/audio.temp.m4a" 2>/dev/null || echo "0")
        if [ "$temp_size" -gt 1000 ]; then
            mv "$DIR/media/audio.temp.m4a" "$DIR/media/audio.m4a"
            echo "[STATUS] audio_done"
            exit 0
        fi
    fi
    rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true
fi

# Failed
echo "[STATUS] audio_error: download failed"
exit 1
