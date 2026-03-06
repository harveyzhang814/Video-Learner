#!/bin/bash
# Markdown to VTT conversion step script
# Usage: bash scripts/convert_md_vtt.sh <MD_FILE> <OUTPUT_VTT_FILE>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check arguments
if [ $# -lt 2 ]; then
    echo "[STATUS] md2vtt_error: Missing arguments"
    echo "Usage: $0 <MD_FILE> <OUTPUT_VTT_FILE>"
    exit 1
fi

MD_FILE="$1"
OUTPUT_VTT="$2"

# Validate input file exists
if [ ! -f "$MD_FILE" ]; then
    echo "[STATUS] md2vtt_error: MD file not found: $MD_FILE"
    exit 1
fi

echo "[STATUS] md2vtt_start"
echo "Converting MD to VTT: $MD_FILE -> $OUTPUT_VTT"

# Create output directory if needed
OUTPUT_DIR="$(dirname "$OUTPUT_VTT")"
mkdir -p "$OUTPUT_DIR"

# Run conversion
python3 "$SCRIPT_DIR/md2subtitle.py" "$MD_FILE" -f vtt -o "$OUTPUT_VTT"

if [ $? -eq 0 ]; then
    echo "[STATUS] md2vtt_done"
    exit 0
else
    echo "[STATUS] md2vtt_error: Conversion failed"
    exit 1
fi
