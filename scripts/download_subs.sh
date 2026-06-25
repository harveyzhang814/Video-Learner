#!/bin/bash
#
# Download subtitles for a video (YouTube or Bilibili)
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

# Initialize database
source "$SCRIPT_DIR/db.sh"
source "$SCRIPT_DIR/yt-dlp-cookies.sh"
source "$SCRIPT_DIR/platform.sh"

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
update_step "$ID" "subs" "running"

# ── Bilibili ──────────────────────────────────────────────────────────────────
# Bilibili subtitle strategy:
#   1. Detect "ai-zh" via --list-subs (Bilibili AI-generated Chinese subtitles in SRT format)
#   2. If found: download SRT → convert to VTT → save as ID.zh.original.vtt
#   3. If not found: exit 1 (orchestrator activates ASR fallback)
# Note: danmaku (xml bullet comments) is intentionally ignored.
_run_bilibili() {
    echo "Detecting Bilibili subtitles..."
    local subs_list
    subs_list=$(yt-dlp $YT_DLP_COOKIE_OPTS --no-playlist --list-subs "$URL" 2>/dev/null || true)

    if ! echo "$subs_list" | grep -Eq "^ai-zh[[:space:]]"; then
        echo "No ai-zh subtitles available — ASR fallback will be activated by orchestrator"
        update_step "$ID" "subs" "failed" "no Bilibili subtitles available"
        echo "[STATUS] subs_error"
        exit 1
    fi

    echo "Found ai-zh subtitles. Downloading SRT..."

    # Download to a temp dir — yt-dlp appends language codes to filename unpredictably
    local TMP_DIR
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"; rm -f "${SUBS_DIR}/${ID}".*.temp.* 2>/dev/null' EXIT

    yt-dlp $YT_DLP_COOKIE_OPTS \
        --no-playlist \
        --skip-download \
        --write-subs \
        --sub-lang "ai-zh" \
        -o "$TMP_DIR/subtitle.%(ext)s" \
        "$URL" 2>/dev/null || true

    # yt-dlp may produce e.g. "subtitle.NA.ai-zh.srt" — find any .srt file
    local SRT_FILE
    SRT_FILE=$(find "$TMP_DIR" -name "*.srt" | head -1 || true)

    if [ -z "$SRT_FILE" ] || [ ! -s "$SRT_FILE" ]; then
        echo "ai-zh download failed or produced empty file"
        update_step "$ID" "subs" "failed" "ai-zh SRT download failed"
        echo "[STATUS] subs_error"
        exit 1
    fi

    # Convert SRT → VTT (pure Python, no ffmpeg needed)
    local VTT_OUT="$SUBS_DIR/${ID}.zh.original.vtt"
    python3 "$SCRIPT_DIR/bilibili/srt2vtt.py" "$SRT_FILE" "$VTT_OUT"

    if [ ! -s "$VTT_OUT" ]; then
        echo "SRT→VTT conversion produced empty output"
        update_step "$ID" "subs" "failed" "srt2vtt conversion failed"
        echo "[STATUS] subs_error"
        exit 1
    fi

    echo "=== Downloaded subtitles ==="
    ls -la "$SUBS_DIR/${ID}"*.vtt 2>/dev/null || echo "No VTT files"

    update_step "$ID" "subs" "completed"
    echo "[STATUS] subs_done"
    exit 0
}

# ── YouTube / generic ─────────────────────────────────────────────────────────
# Full fallback chain:
#   en-orig original → en original → en auto
#   zh-Hans original → zh-Hans auto → zh original → zh auto → zh-CN auto
#   Traditional fallback (zh-TW, zh-Hant) only when both en and zh channels fail.
_run_youtube() {
    # When the URL contains a playlist parameter, force single-video mode so
    # yt-dlp targets the specific `v=` video rather than the first playlist entry.
    local NO_PLAYLIST_OPT=""
    if [[ "$URL" == *"list="* ]]; then
        NO_PLAYLIST_OPT="--no-playlist"
    fi

    # Detect available subtitles
    echo "Detecting available subtitles..."
    local available_subs
    available_subs=$(yt-dlp $YT_DLP_COOKIE_OPTS $NO_PLAYLIST_OPT --list-subs "$URL" 2>/dev/null | awk '/^[[:space:]]*(en-orig|en|zh-CN|zh|zh-TW|zh-Hans|zh-Hant)[[:space:]]/{print $1}' | head -20 || true)
    if [ -z "$available_subs" ]; then
        available_subs=$(yt-dlp $YT_DLP_COOKIE_OPTS $NO_PLAYLIST_OPT --dump-json --no-download "$URL" 2>/dev/null | jq -r '.requested_subtitles | keys[]' 2>/dev/null | head -20 || true)
    fi
    echo "Available subtitles: ${available_subs:-none}"

    has_track() {
        local tok="$1"
        printf "%s\n" "$available_subs" | tr ' ' '\n' | tr '\r' '\n' | grep -Eq "^${tok}$"
    }

    download_subtitle_for_lang() {
        local target_lang="$1"
        local subs_lang="$2"
        local sub_type="$3"
        local outfile_base="$SUBS_DIR/${ID}.${target_lang}.${sub_type}"

        if [ -f "${outfile_base}.vtt" ]; then
            echo "  ${target_lang} (${sub_type}) already exists"
            return 0
        fi

        echo "  Downloading ${target_lang} (${sub_type}) with --sub-lang $subs_lang..."
        rm -f "${outfile_base}"* 2>/dev/null

        if [ "$sub_type" = "original" ]; then
            yt-dlp $YT_DLP_COOKIE_OPTS $NO_PLAYLIST_OPT --skip-download --write-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null || return 1
        else
            yt-dlp $YT_DLP_COOKIE_OPTS $NO_PLAYLIST_OPT --skip-download --write-auto-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null || return 1
        fi

        local downloaded
        downloaded=$(ls "${outfile_base}".* 2>/dev/null | head -1 || true)
        if [ -n "$downloaded" ] && [ -s "$downloaded" ]; then
            if [ "$downloaded" != "${outfile_base}.vtt" ]; then
                mv "$downloaded" "${outfile_base}.vtt" 2>/dev/null || return 1
            fi
            return 0
        else
            return 1
        fi
    }

    local en_downloaded=false
    local zh_downloaded=false

    # 1) English subtitles (en-orig → en original → en auto)
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
        echo "  Downloading English (original then auto): en"
        if download_subtitle_for_lang "en" "en" "original"; then
            en_downloaded=true
        elif download_subtitle_for_lang "en" "en" "auto"; then
            en_downloaded=true
        fi
    fi

    # 2) Chinese subtitles simplified-first: zh-Hans → zh → zh-CN
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
        echo "  Downloading generic Chinese (original then auto): zh"
        if download_subtitle_for_lang "zh" "zh" "original"; then
            zh_downloaded=true
        elif download_subtitle_for_lang "zh" "zh" "auto"; then
            zh_downloaded=true
        fi
    fi

    if [ "$zh_downloaded" = false ] && has_track "zh-CN"; then
        echo "  Downloading Chinese auto: zh-CN"
        if download_subtitle_for_lang "zh" "zh-CN" "auto"; then
            zh_downloaded=true
        fi
    fi

    # 3) Traditional fallback only when BOTH en and simplified zh failed
    if [ "$en_downloaded" = false ] && [ "$zh_downloaded" = false ]; then
        echo "=== Downloading Chinese subtitles (traditional fallback) ==="
        echo "  Gate satisfied -> Traditional fallback enabled"

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

    echo "=== Downloaded subtitles ==="
    ls -la "${SUBS_DIR}/${ID}".*.vtt 2>/dev/null || echo "No subtitles downloaded"

    if [ "$en_downloaded" = true ] || [ "$zh_downloaded" = true ]; then
        update_step "$ID" "subs" "completed"
        echo "[STATUS] subs_done"
        exit 0
    else
        update_step "$ID" "subs" "failed" "no subtitles available"
        echo "[STATUS] subs_error"
        exit 1
    fi
}

# ── Entry point ───────────────────────────────────────────────────────────────
if is_bilibili "$URL"; then
    _run_bilibili
else
    _run_youtube
fi
