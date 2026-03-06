#!/bin/bash
# YouTube Pipeline: Download -> Transcript -> Summary
# Usage: bash scripts/run.sh "<URL>" [LANG=auto] [OUTPUT_LANG=zh-CN] [MODE=full_flow_video|full_flow_audio|full_flow_transcript|download_video|download_audio|get_transcript|write_article|summarize] [FORCE=0|1] [FOCUS="..."]

# Fix locale warning
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

# Helper function to output standardized status
status() {
    echo "[STATUS] $1"
}

# Helper functions
mode_has_video() {
    [[ "$MODE" == "full_flow_video" ]] || [[ "$MODE" == "download_video" ]]
}

mode_has_audio() {
    [[ "$MODE" == "full_flow_audio" ]] || [[ "$MODE" == "download_audio" ]]
}

mode_has_transcript() {
    [[ "$MODE" == "get_transcript" ]] || [[ "$MODE" == full_flow_* ]]
}

mode_has_article() {
    [[ "$MODE" == "write_article" ]] || [[ "$MODE" == full_flow_* ]]
}

mode_has_summary() {
    [[ "$MODE" == "summarize" ]] || [[ "$MODE" == full_flow_* ]]
}

# Parse arguments properly
URL=""
LANG="auto"
OUTPUT_LANG="zh-CN"  # 输出语言，默认简体中文 (未来支持 settings 配置)
MODE="full_flow_video"
FORCE="0"
FOCUS=""
ID=""

while [[ $# -gt 0 ]]; do
    case $1 in
        FOCUS=*)
            FOCUS="${1#*=}"
            shift
            ;;
        FORCE=*)
            FORCE="${1#*=}"
            shift
            ;;
        MODE=*)
            MODE="${1#*=}"
            shift
            ;;
        LANG=*)
            LANG="${1#*=}"
            shift
            ;;
        OUTPUT_LANG=*)
            OUTPUT_LANG="${1#*=}"
            shift
            ;;
        ID=*)
            ID="${1#*=}"
            shift
            ;;
        *)
            URL="$1"
            shift
            ;;
    esac
done

if [ -z "$URL" ] && [ -z "$ID" ]; then
    echo "Usage: bash scripts/run.sh \"<URL>\" [LANG=auto] [OUTPUT_LANG=zh-CN] [MODE=full_flow_video|full_flow_audio|full_flow_transcript|download_video|download_audio|get_transcript|write_article|summarize] [FORCE=0|1] [FOCUS=\"...\"]"
    echo "   or: bash scripts/run.sh ID=<id> [MODE=...] [FORCE=1] [FOCUS=\"...\"] [OUTPUT_LANG=zh-CN]"
    echo "   or: bash scripts/run.sh ID=<id> [MODE=...] [FORCE=1] [FOCUS=\"...\"]"
    echo ""
    echo "Examples:"
    echo '  bash scripts/run.sh "https://youtube.com/watch?v=..."'
    echo '  bash scripts/run.sh "https://youtube.com/watch?v=..." FOCUS="technical details, architecture"'
    echo '  bash scripts/run.sh "https://youtube.com/watch?v=..." MODE=transcript FOCUS="main arguments"'
    echo '  bash scripts/run.sh ID=abc123 DEF=1 FOCUS="main arguments"'
    exit 1
fi

# If ID is provided, get URL from existing work directory
if [ -n "$ID" ]; then
    id="$ID"
    DIR="work/$id"
    if [ -f "$DIR/transcript/meta.json" ]; then
        URL=$(jq -r '.url' "$DIR/transcript/meta.json")
        echo "Resuming task: $id"
        echo "URL: $URL"
    else
        echo "Error: No meta.json found for ID: $id"
        exit 1
    fi
else
    # Compute ID from URL
    id=$(printf "%s" "$URL" | shasum | awk '{print $1}' | cut -c1-12)
fi

DIR="work/$id"
mkdir -p "$DIR/media" "$DIR/transcript/subs" "$DIR/writing"

echo "=== Pipeline Start ==="
echo "URL: $URL"
echo "ID: $id"
echo "DIR: $DIR"

# Tool versions
YT_DLP_VER=$(yt-dlp --version 2>/dev/null || echo "unknown")
FFMPEG_VER=$(ffmpeg -version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "unknown")
JQ_VER=$(jq --version 2>/dev/null || echo "unknown")

# Load existing meta or init new
if [ -f "$DIR/transcript/meta.json" ]; then
    META=$(cat "$DIR/transcript/meta.json")
    echo "Loaded existing meta.json"
else
    # Determine download_video based on MODE
    download_video="true"
    if [ "$MODE" = "transcript" ]; then
        download_video="false"
    fi

    META=$(jq -n \
        --arg url "$URL" \
        --arg id "$id" \
        --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg title "" \
        --arg duration "" \
        --arg lang "$LANG" \
        --arg output_lang "$OUTPUT_LANG" \
        --arg download_status "pending" \
        --arg download_attempts "0" \
        --arg download_error "" \
        --arg transcript_source "" \
        --arg transcript_done "false" \
        --arg article_done "false" \
        --arg summary_done "false" \
        --arg download_video "$download_video" \
        --arg yt_dlp_ver "$YT_DLP_VER" \
        --arg ffmpeg_ver "$FFMPEG_VER" \
        --arg jq_ver "$JQ_VER" \
        '{
            url: $url, id: $id, ts: $ts, title: $title, duration: $duration, lang: $lang, output_lang: $output_lang,
            download_status: $download_status, download_attempts: ($download_attempts | tonumber),
            download_error: $download_error, transcript_source: $transcript_source,
            transcript_done: ($transcript_done == "true"), article_done: ($article_done == "true"),
            summary_done: ($summary_done == "true"), download_video: ($download_video == "true"),
            tool_versions: { yt_dlp: $yt_dlp_ver, ffmpeg: $ffmpeg_ver, jq: $jq_ver }
        }')

    # === IMMEDIATE SAVE: Save meta.json and index.jsonl right after initialization ===
    # This ensures the task appears in History even if pipeline is interrupted
    echo "$META" > "$DIR/transcript/meta.json"
    index_line=$(echo "$META" | jq -c '{url, id, ts, title, download_status, transcript_done, article_done, summary_done}')
    # Check if this ID already exists in index.jsonl to avoid duplicates
    if ! grep -q "\"id\":\"$id\"" work/index.jsonl 2>/dev/null; then
        echo "$index_line" >> work/index.jsonl
    fi
fi

# === STEP 0: Get Video Info ===
if [ "$FORCE" = "1" ] || [ "$(echo "$META" | jq -r '.title')" = "" ]; then
    status "info_start"
    info_json=$(yt-dlp --dump-json --no-download "$URL" 2>/dev/null || echo "{}")
    title=$(echo "$info_json" | jq -r '.title // ""')
    duration=$(echo "$info_json" | jq -r '.duration // ""')
    lang=$(echo "$info_json" | jq -r '.language // "auto"')

    META=$(echo "$META" | jq --arg title "$title" '.title = $title')
    META=$(echo "$META" | jq --arg duration "$duration" '.duration = $duration')
    if [ "$LANG" = "auto" ]; then
        META=$(echo "$META" | jq --arg lang "$lang" '.lang = $lang')
    fi
    echo "Title: $title, Duration: $duration"
    status "info_done"

    # Update index.jsonl immediately after getting title
    echo "$META" > "$DIR/transcript/meta.json"
    index_line=$(echo "$META" | jq -c '{url, id, ts, title, download_status, transcript_done, article_done, summary_done}')
    if grep -q "\"id\":\"$id\"" work/index.jsonl 2>/dev/null; then
        # Use jq to update existing record (convert JSONL to array with -s, then back to JSONL)
        jq -s --arg id "$id" --argjson line "$index_line" 'map(if .id == $id then $line else . end) | .[]' work/index.jsonl > work/index.jsonl.tmp && mv work/index.jsonl.tmp work/index.jsonl
    else
        echo "$index_line" >> work/index.jsonl
    fi
fi

# === STEP 1: Video Download (Independent Background Process) ===
if mode_has_video; then
    status=$(echo "$META" | jq -r '.download_status')
    if [ "$FORCE" = "1" ] || [ "$status" = "pending" ] || [ "$status" = "failed" ]; then
        status "video_start"
        # Save meta first so download script can update it
        echo "$META" > "$DIR/transcript/meta.json"
        SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
        # Start video download in background
        nohup bash "$SCRIPT_DIR/download_video.sh" "$URL" "$DIR" "$FORCE" > "$DIR/media/video_download.log" 2>&1 &
        echo "Video download PID: $! (running in background)"
        echo "Progress: see $DIR/media/video_download.log"
    else
        echo "=== Skip: Video download status = $status"
    fi
fi

# === STEP 2: Audio Extraction ===
if mode_has_audio; then
    if ! ls "$DIR/media/audio."* 1>/dev/null 2>&1; then
        status "audio_start"
        yt-dlp -x --audio-format m4a -o "$DIR/media/audio.%(ext)s" "$URL" 2>/dev/null || echo "Audio extraction failed (non-blocking)"
        if ls "$DIR/media/audio."* 1>/dev/null 2>&1; then
            status "audio_done"
        fi
    else
        status "audio_done"
    fi
fi

# === STEP 3: Transcript ===
get_transcript() {
    status "transcript_start"

    # Check existing bilingual transcripts (skip only if FORCE=0)
    if [ "$FORCE" = "0" ]; then
        if [ -f "$DIR/transcript/original_en.md" ] && [ -s "$DIR/transcript/original_en.md" ]; then
            content=$(cat "$DIR/transcript/original_en.md")
        elif [ -f "$DIR/transcript/original_zh.md" ] && [ -s "$DIR/transcript/original_zh.md" ]; then
            content=$(cat "$DIR/transcript/original_zh.md")
        else
            content=""
        fi
        if [ ${#content} -gt 100 ]; then
            echo "Transcript exists (en/zh), skipping"
            META=$(echo "$META" | jq '.transcript_source = "existing"')
            META=$(echo "$META" | jq '.transcript_done = true')
            status "transcript_done"
            return 0
        fi
    fi

    # Detect available subtitles
    echo "Detecting available subtitles..."
    # Match specific language codes: en, en-orig, zh, zh-Hans, zh-Hant
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

        local outfile_base="$DIR/transcript/subs/${id}.${target_lang}.${sub_type}"

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
            yt-dlp --skip-download --write-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null
        else
            # Use --write-auto-subs for auto-generated subtitles
            yt-dlp --skip-download --write-auto-subs --sub-lang "$subs_lang" -o "${outfile_base}.%(ext)s" "$URL" 2>/dev/null
        fi

        # Find and rename the downloaded file
        local downloaded
        downloaded=$(ls "${outfile_base}".* 2>/dev/null | head -1)
        if [ -n "$downloaded" ] && [ -s "$downloaded" ]; then
            # Rename to .vtt if not already
            if [ "$downloaded" != "${outfile_base}.vtt" ]; then
                mv "$downloaded" "${outfile_base}.vtt" 2>/dev/null
            fi
            return 0
        else
            return 1
        fi
    }

    # Download English subtitles (only ONE: original OR auto)
    echo "=== Downloading English subtitles ==="
    en_downloaded=false
    en_type=""

    # Step 1: Try English original (en-orig)
    local_en_orig=$(echo "$available_subs" | grep -E "^en-orig$" | head -1)
    if [ -n "$local_en_orig" ]; then
        echo "  Found English original: $local_en_orig"
        if download_subtitle_for_lang "en" "$local_en_orig" "original"; then
            en_downloaded=true
            en_type="original"
        else
            echo "  Warning: $local_en_orig download failed"
        fi
    fi

    # Step 2: If no original, try auto (only if original not available or failed)
    if [ "$en_downloaded" = false ]; then
        local_en=$(echo "$available_subs" | grep -E "^en$" | head -1)
        if [ -n "$local_en" ]; then
            echo "  No original, downloading English auto: $local_en"
            if download_subtitle_for_lang "en" "$local_en" "auto"; then
                en_downloaded=true
                en_type="auto"
            fi
        fi
    fi

    # Download Chinese subtitles (only ONE: original OR auto)
    echo "=== Downloading Chinese subtitles ==="
    zh_downloaded=false
    zh_type=""

    # Step 1: Try Chinese original (zh-Hans or zh-Hant)
    local_zh_orig=$(echo "$available_subs" | grep -E "^zh-Hans$|^zh-Hant$" | head -1)
    if [ -n "$local_zh_orig" ]; then
        echo "  Found Chinese original: $local_zh_orig"
        if download_subtitle_for_lang "zh" "$local_zh_orig" "original"; then
            zh_downloaded=true
            zh_type="original"
        else
            echo "  Warning: $local_zh_orig download failed, trying auto..."
            # Fallback to auto with the same language code
            if download_subtitle_for_lang "zh" "$local_zh_orig" "auto"; then
                zh_downloaded=true
                zh_type="auto"
            fi
        fi
    fi

    # Step 2: If no original, try auto (zh only)
    if [ "$zh_downloaded" = false ]; then
        local_zh=$(echo "$available_subs" | grep -E "^zh$" | head -1)
        if [ -n "$local_zh" ]; then
            echo "  No original, downloading Chinese auto: $local_zh"
            if download_subtitle_for_lang "zh" "$local_zh" "auto"; then
                zh_downloaded=true
                zh_type="auto"
            fi
        fi
    fi

    # Convert subtitles to markdown
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

    echo "=== Converting subtitles to markdown ==="

    # Convert English
    en_subfile=""
    en_type=""
    if [ -f "$DIR/transcript/subs/${id}.en.original.vtt" ]; then
        en_subfile="$DIR/transcript/subs/${id}.en.original.vtt"
        en_type="original"
    elif [ -f "$DIR/transcript/subs/${id}.en.auto.vtt" ]; then
        en_subfile="$DIR/transcript/subs/${id}.en.auto.vtt"
        en_type="auto"
    fi

    if [ -n "$en_subfile" ]; then
        echo "Converting English: $en_subfile (type: $en_type)"
        python3 "$SCRIPT_DIR/vtt_converter.py" "$en_subfile" "$DIR/transcript/original_en.md"
        # Generate original_en.vtt for frontend display
        python3 "$SCRIPT_DIR/md2subtitle.py" "$DIR/transcript/original_en.md" -f vtt -o "$DIR/transcript/original_en.vtt" 2>/dev/null
    fi

    # Convert Chinese
    zh_subfile=""
    zh_type=""
    if [ -f "$DIR/transcript/subs/${id}.zh.original.vtt" ]; then
        zh_subfile="$DIR/transcript/subs/${id}.zh.original.vtt"
        zh_type="original"
    elif [ -f "$DIR/transcript/subs/${id}.zh.auto.vtt" ]; then
        zh_subfile="$DIR/transcript/subs/${id}.zh.auto.vtt"
        zh_type="auto"
    fi

    if [ -n "$zh_subfile" ]; then
        echo "Converting Chinese: $zh_subfile (type: $zh_type)"
        python3 "$SCRIPT_DIR/vtt_converter.py" "$zh_subfile" "$DIR/transcript/original_zh.md"
        # Generate original_zh.vtt for frontend display
        python3 "$SCRIPT_DIR/md2subtitle.py" "$DIR/transcript/original_zh.md" -f vtt -o "$DIR/transcript/original_zh.vtt" 2>/dev/null
    fi

    # Determine source language for article.md based on priority:
    # 1. Original > Auto
    # 2. If both original or both auto: prefer English
    echo "=== Determining article source language ==="

    source_lang=""
    source_type=""
    transcript_source_val=""

    if [ -n "$en_type" ] && [ -n "$zh_type" ]; then
        # Both exist, choose by priority
        if [ "$en_type" = "original" ] && [ "$zh_type" = "original" ]; then
            source_lang="en"  # Both original, prefer English
            source_type="original"
        elif [ "$en_type" = "original" ]; then
            source_lang="en"
            source_type="original"
        elif [ "$zh_type" = "original" ]; then
            source_lang="zh"
            source_type="original"
        else
            # Both auto
            source_lang="en"  # Both auto, prefer English
            source_type="auto"
        fi
        transcript_source_val="subtitle"
    elif [ -n "$en_type" ]; then
        source_lang="en"
        source_type="$en_type"
        transcript_source_val="subtitle"
    elif [ -n "$zh_type" ]; then
        source_lang="zh"
        source_type="$zh_type"
        transcript_source_val="subtitle"
    fi

    if [ -n "$source_lang" ]; then
        echo "Using ${source_lang} (${source_type}) for article generation"

        META=$(echo "$META" | jq --arg src "$transcript_source_val" '.transcript_source = $src')
        META=$(echo "$META" | jq '.transcript_done = true')
        status "transcript_done"

        # Update meta with transcripts info
        META=$(echo "$META" | jq --argjson en_done "$( [ -f "$DIR/transcript/original_en.md" ] && echo true || echo false )" \
            --argjson zh_done "$( [ -f "$DIR/transcript/original_zh.md" ] && echo true || echo false )" \
            --arg en_t "$en_type" --arg zh_t "$zh_type" \
            --arg src_lang "$source_lang" --arg src_type "$source_type" \
            '.transcripts = {
                en: { type: $en_t, done: $en_done, path: "origin_en.md" },
                zh: { type: $zh_t, done: $zh_done, path: "origin_zh.md" }
            } | .article_source_lang = $src_lang')

        echo "Generated original.md from ${source_lang} subtitles"
        return 0
    fi

    # ASR fallback
    if ls "$DIR/media/audio."* 1>/dev/null 2>&1; then
        echo "Audio exists but no transcript - marking asr_missing"
        META=$(echo "$META" | jq '.transcript_source = "asr_missing"')
        return 1
    fi

    echo "No transcript available"
    META=$(echo "$META" | jq '.transcript_source = "none"')
    return 1
}

if mode_has_transcript; then
    transcript_done=$(echo "$META" | jq -r '.transcript_done')
    if [ "$FORCE" = "1" ] || [ "$transcript_done" != "true" ]; then
        get_transcript
    else
        echo "=== Skip: Transcript already done ==="
    fi
fi

# === STEP 3.5: Article Generation ===
if mode_has_transcript; then
    article_done=$(echo "$META" | jq -r '.article_done')
    if [ "$FORCE" = "1" ] || [ "$article_done" != "true" ]; then
        # 读取 article_source_lang
        article_lang=$(echo "$META" | jq -r '.article_source_lang // "en"')
        transcript_file="$DIR/transcript/original_${article_lang}.md"

        if [ -f "$transcript_file" ] && [ -s "$transcript_file" ]; then
            status "article_start"
            SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

            # Generate article using Claude CLI
            ARTICLE_PROMPT_PATH="$SCRIPT_DIR/article_prompt.txt"
            article_prompt=$(sed -e "s|{{ORIGINAL_PATH}}|$transcript_file|g" \
                -e "s|{{OUTPUT_PATH}}|$DIR/writing/article.md|g" \
                -e "s|{{SOURCE_LANG}}|$article_lang|g" \
                -e "s|OUTPUT_LANG=zh-CN|OUTPUT_LANG=$OUTPUT_LANG|g" \
                "$ARTICLE_PROMPT_PATH")
            echo "$article_prompt" | env -u CLAUDECODE claude -p --dangerously-skip-permissions > "$DIR/writing/article.md"

            if [ -f "$DIR/writing/article.md" ] && [ -s "$DIR/writing/article.md" ]; then
                echo "Article generated successfully"
                META=$(echo "$META" | jq '.article_done = true')
                status "article_done"
                META=$(echo "$META" | jq --arg path "$ARTICLE_PROMPT_PATH" '.article_prompt_path = $path')
            else
                echo "Failed to generate article"
            fi
        else
            echo "=== Skip: No ${article_lang} transcript for article ==="
        fi
    else
        echo "=== Skip: Article already done ==="
    fi
fi

# === STEP 4: Summary ===
if mode_has_transcript; then
    summary_done=$(echo "$META" | jq -r '.summary_done')
    if [ "$FORCE" = "1" ] || [ "$summary_done" != "true" ]; then
        if [ -f "$DIR/writing/article.md" ] && [ -s "$DIR/writing/article.md" ]; then

            # Save FOCUS to meta if provided
            if [ -n "$FOCUS" ]; then
                META=$(echo "$META" | jq --arg focus "$FOCUS" '.focus = $focus')
                echo "Focus provided: $FOCUS"
            fi

            current_focus=$(echo "$META" | jq -r '.focus // ""')
            status "summary_start"

            # Generate summary using Claude CLI
            SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
            summary_prompt=$(sed -e "s/{{FOCUS}}/$current_focus/g" \
                -e "s|{{ARTICLE_PATH}}|$DIR/writing/article.md|g" \
                -e "s|{{OUTPUT_PATH}}|$DIR/writing/summary.md|g" \
                -e "s|OUTPUT_LANG=zh-CN|OUTPUT_LANG=$OUTPUT_LANG|g" \
                "$SCRIPT_DIR/summary_prompt.txt")
            echo "$summary_prompt" | env -u CLAUDECODE claude -p --dangerously-skip-permissions > "$DIR/writing/summary.md"

            if [ -f "$DIR/writing/summary.md" ] && [ -s "$DIR/writing/summary.md" ]; then
                echo "Summary generated successfully"
                META=$(echo "$META" | jq '.summary_done = true')
                status "summary_done"
            else
                echo "Failed to generate summary"
            fi
        else
            echo "=== Skip: No article.md for summary ==="
        fi
    else
        echo "=== Skip: Summary already done ==="
    fi
fi

# === STEP 5: Save Meta ===
# Merge with existing meta.json to preserve download_status updated by background download_video.sh
if [ -f "$DIR/transcript/meta.json" ]; then
    EXISTING_META=$(cat "$DIR/transcript/meta.json")
    # Preserve download_status and download_attempts from existing meta (updated by background process)
    META=$(echo "$META" | jq --argjson existing "$EXISTING_META" '
        .download_status = ($existing.download_status // "pending") |
        .download_attempts = ($existing.download_attempts // 0) |
        .download_error = ($existing.download_error // "")
    ')
fi
echo "$META" > "$DIR/transcript/meta.json"
index_line=$(echo "$META" | jq -c '{url, id, ts, title, download_status, transcript_done, article_done, summary_done}')
# Update index.jsonl - replace existing line or append new
if grep -q "\"id\":\"$id\"" work/index.jsonl 2>/dev/null; then
    # Use jq to update existing record (convert JSONL to array with -s, then back to JSONL)
    jq -s --arg id "$id" --argjson line "$index_line" 'map(if .id == $id then $line else . end) | .[]' work/index.jsonl > work/index.jsonl.tmp && mv work/index.jsonl.tmp work/index.jsonl
else
    echo "$index_line" >> work/index.jsonl
fi

# === Self Check ===
echo ""
echo "=== Self Check ==="
ls -la "$DIR"
echo ""
echo "--- original.md (first 10 lines) ---"
head -10 "$DIR/transcript/original.md" 2>/dev/null || echo "(not found)"
echo ""
echo "--- article.md (first 10 lines) ---"
head -10 "$DIR/writing/article.md" 2>/dev/null || echo "(not found)"
echo ""
echo "--- summary.md (first 10 lines) ---"
head -10 "$DIR/writing/summary.md" 2>/dev/null || echo "(not found)"

TRANSCRIPT_DONE=$(echo "$META" | jq -r '.transcript_done')
ARTICLE_DONE=$(echo "$META" | jq -r '.article_done')
SUMMARY_DONE=$(echo "$META" | jq -r '.summary_done')

if [ "$TRANSCRIPT_DONE" = "true" ] || [ "$SUMMARY_DONE" = "true" ]; then
    echo ""
    status "complete"
    exit 0
else
    echo ""
    status "incomplete"
    exit 1
fi
