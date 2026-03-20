#!/bin/bash
#
# Download subtitles for a YouTube video
# Usage: bash scripts/download_subs.sh "URL" "DIR" [ID]
#

set -euo pipefail

# SCRIPT_DIR is needed even for offline planning mode.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Offline/unit-test planning mode:
# When AVAILABLE_SUBS_OVERRIDE is non-empty, we must only emit the planning output
# (and never call yt-dlp download functions).
if [ -n "${AVAILABLE_SUBS_OVERRIDE:-}" ]; then
    # shellcheck source=/dev/null
    source "$SCRIPT_DIR/subtitle_fallback_plan.sh"
    plan_subtitle_fallback_attempts "${AVAILABLE_SUBS_OVERRIDE:-}"
    exit 0
fi

URL="${1:-}"
DIR="${2:-}"
ID="${3:-}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR> [ID]"
    exit 1
fi

# Use provided ID or generate from URL
if [ -z "$ID" ]; then
    if command -v sha1sum >/dev/null 2>&1; then
        ID=$(printf "%s" "$URL" | sha1sum | cut -c1-12) || true
    else
        # macOS typically ships `shasum` but not `sha1sum`.
        ID=$(printf "%s" "$URL" | shasum -a 1 | cut -c1-12) || true
    fi
fi

# Database path
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/work/database.sqlite"

# Initialize database
source "$SCRIPT_DIR/db.sh"
source "$SCRIPT_DIR/yt-dlp-cookies.sh"

# With `set -u`, ensure cookie opts are always defined (may be empty).
YT_DLP_COOKIE_OPTS="${YT_DLP_COOKIE_OPTS:-}"

# Create output directory
SUBS_DIR="$DIR/transcript/subs"
if ! mkdir -p "$SUBS_DIR"; then
    echo "Error: Failed to create directory $SUBS_DIR"
    exit 1
fi

# Trap for cleanup on interrupt (after SUBS_DIR is defined)
trap 'rm -f "${SUBS_DIR}/${ID}".*.temp.* 2>/dev/null; exit 1' INT TERM

echo "[STATUS] subs_start"

# Update step to running
update_step "$ID" "subs" "running"

# Detect available subtitles
echo "Detecting available subtitles..."
available_subs=$(yt-dlp $YT_DLP_COOKIE_OPTS --list-subs "$URL" 2>/dev/null | awk '/^[[:space:]]*(en-orig|en|zh|zh-TW|zh-Hans|zh-Hant)[[:space:]]/{print $1}' | head -20 || true)
if [ -z "$available_subs" ]; then
    available_subs=$(yt-dlp $YT_DLP_COOKIE_OPTS --dump-json --no-download "$URL" 2>/dev/null | jq -r '.requested_subtitles | keys[]' 2>/dev/null | head -20 || true)
fi
echo "Available subtitles: ${available_subs:-none}"

has_track() {
    local tok="$1"
    # available_subs is a whitespace-separated token list (often newline-separated).
    printf "%s\n" "$available_subs" | tr ' ' '\n' | tr '\r' '\n' | grep -Fxq "$tok"
}

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
        yt-dlp $YT_DLP_COOKIE_OPTS --skip-download --write-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null || return 1
    else
        # Use --write-auto-subs for auto-generated subtitles
        yt-dlp $YT_DLP_COOKIE_OPTS --skip-download --write-auto-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null || return 1
    fi

    # Find and rename the downloaded file
    local downloaded
    downloaded=$(ls "${outfile_base}".* 2>/dev/null | head -1 || true)
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

# 1) Download English subtitles (en-orig -> en auto)
echo "=== Downloading English subtitles ==="
if has_track "en-orig"; then
    echo "  Found English original: en-orig"
    if download_subtitle_for_lang "en" "en-orig" "original"; then
        en_downloaded=true
    else
        echo "  Warning: en-orig download failed, trying en auto..."
    fi
fi

if [ "$en_downloaded" = false ] && has_track "en"; then
    echo "  Downloading English auto: en"
    if download_subtitle_for_lang "en" "en" "auto"; then
        en_downloaded=true
    fi
fi

# 2) Download Chinese subtitles (simplified-first):
#    zh-Hans original -> (fail) zh-Hans auto -> (still fail && available) generic zh auto
echo "=== Downloading Chinese subtitles (simplified) ==="
if has_track "zh-Hans"; then
    echo "  Found Chinese original: zh-Hans"
    if download_subtitle_for_lang "zh" "zh-Hans" "original"; then
        zh_downloaded=true
    else
        echo "  Warning: zh-Hans original download failed, trying auto..."
        if download_subtitle_for_lang "zh" "zh-Hans" "auto"; then
            zh_downloaded=true
        fi
    fi
fi

if [ "$zh_downloaded" = false ] && has_track "zh"; then
    echo "  Downloading generic Chinese auto: zh"
    if download_subtitle_for_lang "zh" "zh" "auto"; then
        zh_downloaded=true
    fi
fi

# 3) Traditional fallback (zh-TW -> zh-Hant) only when BOTH English and simplified zh are still not downloaded.
if [ "$en_downloaded" = false ] && [ "$zh_downloaded" = false ]; then
    echo "=== Downloading Chinese subtitles (traditional fallback) ==="
    echo "  Gate satisfied -> Traditional fallback enabled"

    # zh-TW original -> if fails zh-TW auto
    if has_track "zh-TW"; then
        echo "  Traditional: trying zh-TW original"
        if download_subtitle_for_lang "zh" "zh-TW" "original"; then
            zh_downloaded=true
        else
            echo "  Traditional: zh-TW original failed, trying zh-TW auto"
            if download_subtitle_for_lang "zh" "zh-TW" "auto"; then
                zh_downloaded=true
            fi
        fi
    fi

    # zh-Hant original -> if fails zh-Hant auto
    if [ "$zh_downloaded" = false ] && has_track "zh-Hant"; then
        echo "  Traditional: trying zh-Hant original"
        if download_subtitle_for_lang "zh" "zh-Hant" "original"; then
            zh_downloaded=true
        else
            echo "  Traditional: zh-Hant original failed, trying zh-Hant auto"
            if download_subtitle_for_lang "zh" "zh-Hant" "auto"; then
                zh_downloaded=true
            fi
        fi
    fi
else
    echo "Skipping Traditional fallback (English or Simplified already downloaded)"
fi

# List downloaded files
echo "=== Downloaded subtitles ==="
ls -la "${SUBS_DIR}/${ID}".*.vtt 2>/dev/null || echo "No subtitles downloaded"

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
