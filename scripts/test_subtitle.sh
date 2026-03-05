#!/bin/bash
# Test yt-dlp subtitle download with bilingual support

URL="${1:-https://www.youtube.com/watch?v=dQw4w9WgXcQ}"
TEST_DIR="/tmp/yt_subtitle_test"
mkdir -p "$TEST_DIR"

echo "=== Testing Subtitle Download ==="
echo "URL: $URL"
echo "Test dir: $TEST_DIR"
echo ""

# Get video info
echo "=== Step 1: Get Video Info ==="
info_json=$(yt-dlp --dump-json --no-download "$URL" 2>/dev/null)
title=$(echo "$info_json" | jq -r '.title')
lang=$(echo "$info_json" | jq -r '.language')
duration=$(echo "$info_json" | jq -r '.duration')

echo "Title: $title"
echo "Language: $lang"
echo "Duration: $duration"
echo ""

# Get available subtitle languages (new logic)
echo "=== Step 2: Detect Available Subtitles (New Logic) ==="
available=$(yt-dlp --list-subs "$URL" 2>/dev/null | awk '/^[[:space:]]*(en-orig|en|zh-Hans|zh-Hant|zh)[[:space:]]/{print $1}' | head -20)
echo "Detected: ${available:-none}"
echo ""

# Download English subtitles
echo "=== Step 3: Download English Subtitles ==="
cd "$TEST_DIR"

# Try en-orig first (original)
if echo "$available" | grep -qE "^en-orig$"; then
    echo "Found en-orig, downloading original..."
    yt-dlp --skip-download --write-subs --sub-lang en-orig -o "${TEST_DIR}/%(id)s.%(ext)s" "$URL" 2>&1
    # Rename to mark as original
    [ -f "${TEST_DIR}/GDm_uH6VxPY.en.vtt" ] && mv "${TEST_DIR}/GDm_uH6VxPY.en.vtt" "${TEST_DIR}/GDm_uH6VxPY.en-orig.vtt" 2>/dev/null
fi

# Try en (auto or manual)
if echo "$available" | grep -qE "^en$"; then
    echo "Found en, downloading auto..."
    yt-dlp --skip-download --write-auto-subs --sub-lang en -o "${TEST_DIR}/%(id)s.%(ext)s" "$URL" 2>&1
fi

echo ""

# Download Chinese subtitles
echo "=== Step 4: Download Chinese Subtitles ==="

# Try zh-Hans (Simplified Chinese original)
if echo "$available" | grep -qE "^zh-Hans$"; then
    echo "Found zh-Hans, downloading original..."
    yt-dlp --skip-download --write-subs --sub-lang zh-Hans -o "${TEST_DIR}/%(id)s.zh-Hans.orig.%(ext)s" "$URL" 2>&1
fi

# Try zh-Hant (Traditional Chinese original)
if echo "$available" | grep -qE "^zh-Hant$"; then
    echo "Found zh-Hant, downloading original..."
    yt-dlp --skip-download --write-subs --sub-lang zh-Hant -o "${TEST_DIR}/%(id)s.zh-Hant.orig.%(ext)s" "$URL" 2>&1
fi

# Try zh (auto)
if echo "$available" | grep -qE "^zh$"; then
    echo "Found zh, downloading auto..."
    yt-dlp --skip-download --write-auto-subs --sub-lang zh -o "${TEST_DIR}/%(id)s.zh.auto.%(ext)s" "$URL" 2>&1
fi

echo ""

# Check downloaded files
echo "=== Downloaded Files ==="
ls -la "$TEST_DIR"

# Check if any vtt exists
if ls "$TEST_DIR"/*.vtt 1>/dev/null 2>&1; then
    echo ""
    echo "=== SUCCESS: Subtitle(s) downloaded ==="
    for f in "$TEST_DIR"/*.vtt; do
        echo ""
        echo "=== $f (first 10 lines) ==="
        head -10 "$f"
    done
else
    echo ""
    echo "=== FAILED: No subtitle file ==="
fi
