#!/bin/bash
# VTT to Markdown conversion step script
# Usage: bash scripts/convert_vtt_md.sh <VTT_FILE> <OUTPUT_MD_FILE>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check arguments
if [ $# -lt 2 ]; then
    echo "[STATUS] vtt2md_error: Missing arguments"
    echo "Usage: $0 <VTT_FILE> <OUTPUT_MD_FILE>"
    exit 1
fi

VTT_FILE="$1"
OUTPUT_MD="$2"

# Validate input file exists
if [ ! -f "$VTT_FILE" ]; then
    echo "[STATUS] vtt2md_error: VTT file not found: $VTT_FILE"
    exit 1
fi

echo "[STATUS] vtt2md_start"
echo "Converting VTT to MD: $VTT_FILE -> $OUTPUT_MD"

# Create output directory if needed
OUTPUT_DIR="$(dirname "$OUTPUT_MD")"
mkdir -p "$OUTPUT_DIR"

# Run conversion
python3 "$SCRIPT_DIR/vtt_converter.py" "$VTT_FILE" "$OUTPUT_MD"

if [ $? -eq 0 ]; then
    echo "[STATUS] vtt2md_done"
    exit 0
else
    echo "[STATUS] vtt2md_error: Conversion failed"
    exit 1
fi
