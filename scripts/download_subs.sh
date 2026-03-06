#!/bin/bash
#
# Download subtitles for a YouTube video
# Usage: bash scripts/download_subs.sh "URL" "DIR" [ID]
#

set -e

URL="$1"
DIR="$2"
ID="${3:-}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR> [ID]"
    exit 1
fi

# Use provided ID or generate from URL
if [ -z "$ID" ]; then
    ID=$(echo "$URL" | sha1sum | cut -c1-12) || true
fi

# Database path
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/work/database.sqlite"

# Initialize database
source "$SCRIPT_DIR/db.sh"

# Create output directory
SUBS_DIR="$DIR/transcript/subs"
if ! mkdir -p "$SUBS_DIR"; then
    echo "Error: Failed to create directory $SUBS_DIR"
    exit 1
fi

# Trap for cleanup on interrupt (after SUBS_DIR is defined)
trap 'rm -f "$SUBS_DIR"/${ID}.*.temp.* 2>/dev/null; exit 1' INT TERM

echo "[STATUS] subs_start"

# Update step to running
update_step "$ID" "subs" "running"

# Detect available subtitles
echo "Detecting available subtitles..."
available_subs=$(yt-dlp --list-subs "$URL" 2>/dev/null | awk '/^[[:space:]]*(en-orig|en|zh-Hans|zh-Hant|zh)[[:space:]]/{print $1}' | head -20)
if [ -z "$available_subs" ]; then
    available_subs=$(yt-dlp --dump-json --no-download "$URL" 2>/dev/null | jq -r '.requested_subtitles | keys[]' 2>/dev/null | head -20)
fi
echo "Available subtitles: ${available_subs:-none}"

# Function to download subtitle for a language
# Returns 0 only if file was actually created
download_subtitle_for_lang() {
    local target_lang="$1"
    local subs_lang="$2"
    local sub_type="$3"

    local outfile_base="$SUBS_DIR/${ID}.${target_lang}.${sub_type}"

    # Skip if already exists
    if [ -f "${outfile_base}.vtt" ]; then
        echo "  ${target_lang} (${sub_type}) already exists"
        return 0
    fi

    echo "  Downloading ${target_lang} (${sub_type}) with --sub-lang $subs_lang..."

    # Clean up any leftover files
    rm -f "${outfile_base}"* 2>/dev/null

    if [ "$sub_type" = "original" ]; then
        # Use --write-subs for original subtitles
        yt-dlp --skip-download --write-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null || return 1
    else
        # Use --write-auto-subs for auto-generated subtitles
        yt-dlp --skip-download --write-auto-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null || return 1
    fi

    # Find and rename the downloaded file
    local downloaded
    downloaded=$(ls "${outfile_base}".* 2>/dev/null | head -1)
    if [ -n "$downloaded" ] && [ -s "$downloaded" ]; then
        # Rename to .vtt if not already
        if [ "$downloaded" != "${outfile_base}.vtt" ]; then
            mv "$downloaded" "${outfile_base}.vtt" 2>/dev/null || return 1
        fi
        return 0
    else
        return 1
    fi
}

# Track download status
en_downloaded=false
zh_downloaded=false

# Download English subtitles (only ONE: original OR auto)
echo "=== Downloading English subtitles ==="

# Step 1: Try English original (en-orig)
local_en_orig=$(echo "$available_subs" | grep -E "^en-orig$" | head -1) || true
if [ -n "$local_en_orig" ]; then
    echo "  Found English original: $local_en_orig"
    if download_subtitle_for_lang "en" "$local_en_orig" "original"; then
        en_downloaded=true
    else
        echo "  Warning: $local_en_orig download failed"
    fi
fi

# Step 2: If no original, try auto (only if original not available or failed)
if [ "$en_downloaded" = false ]; then
    local_en=$(echo "$available_subs" | grep -E "^en$" | head -1) || true
    if [ -n "$local_en" ]; then
        echo "  No original, downloading English auto: $local_en"
        if download_subtitle_for_lang "en" "$local_en" "auto"; then
            en_downloaded=true
        fi
    fi
fi

# Download Chinese subtitles (only ONE: original OR auto)
echo "=== Downloading Chinese subtitles ==="

# Step 1: Try Chinese original (zh-Hans or zh-Hant)
local_zh_orig=$(echo "$available_subs" | grep -E "^zh-Hans$|^zh-Hant$" | head -1) || true
if [ -n "$local_zh_orig" ]; then
    echo "  Found Chinese original: $local_zh_orig"
    if download_subtitle_for_lang "zh" "$local_zh_orig" "original"; then
        zh_downloaded=true
    else
        echo "  Warning: $local_zh_orig download failed, trying auto..."
        # Fallback to auto with the same language code
        if download_subtitle_for_lang "zh" "$local_zh_orig" "auto"; then
            zh_downloaded=true
        fi
    fi
fi

# Step 2: If no original, try auto (zh only)
if [ "$zh_downloaded" = false ]; then
    local_zh=$(echo "$available_subs" | grep -E "^zh$" | head -1) || true
    if [ -n "$local_zh" ]; then
        echo "  No original, downloading Chinese auto: $local_zh"
        if download_subtitle_for_lang "zh" "$local_zh" "auto"; then
            zh_downloaded=true
        fi
    fi
fi

# List downloaded files
echo "=== Downloaded subtitles ==="
ls -la "$SUBS_DIR"/${ID}.*.vtt 2>/dev/null || echo "No subtitles downloaded"

# Output status
if [ "$en_downloaded" = true ] || [ "$zh_downloaded" = true ]; then
    # Update database
    update_step "$ID" "subs" "completed"
    echo "[STATUS] subs_done"
    exit 0
else
    # Update database
    update_step "$ID" "subs" "failed" "no subtitles available"
    echo "[STATUS] subs_error"
    exit 1
fi
