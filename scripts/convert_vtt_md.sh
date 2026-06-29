#!/bin/bash
# VTT to Markdown conversion step script
# Usage: bash scripts/convert_vtt_md.sh <VTT_FILE> <OUTPUT_MD_FILE>
#
# AI subtitle detection: files matching *.auto.vtt or *.asr.vtt are treated as
# AI-generated and will be merged into sentence-level blocks after conversion.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
    echo "[STATUS] vtt2md_error: Missing arguments"
    echo "Usage: $0 <VTT_FILE> <OUTPUT_MD_FILE>"
    exit 1
fi

VTT_FILE="$1"
OUTPUT_MD="$2"

if [ ! -f "$VTT_FILE" ]; then
    echo "[STATUS] vtt2md_error: VTT file not found: $VTT_FILE"
    exit 1
fi

echo "[STATUS] vtt2md_start"
echo "Converting VTT to MD: $VTT_FILE -> $OUTPUT_MD"

OUTPUT_DIR="$(dirname "$OUTPUT_MD")"
mkdir -p "$OUTPUT_DIR"

# Convert VTT → MD (fine-grained, one line per VTT cue)
python3 "$SCRIPT_DIR/vtt_converter.py" "$VTT_FILE" "$OUTPUT_MD"

if [ $? -ne 0 ]; then
    echo "[STATUS] vtt2md_error: Conversion failed"
    exit 1
fi

# Detect AI subtitle source: *.auto.vtt (platform AI) or *.asr.vtt (Whisper)
VTT_BASENAME="$(basename "$VTT_FILE")"
if [[ "$VTT_BASENAME" == *.auto.vtt ]] || [[ "$VTT_BASENAME" == *.asr.vtt ]]; then
    echo "[STATUS] vtt2md_merging: AI subtitle detected, applying pre-merge"
    python3 "$SCRIPT_DIR/merge_ai_subs.py" \
        --min-secs "${VTT2MD_MIN_BLOCK_SECS:-3}" \
        --max-secs "${VTT2MD_MAX_BLOCK_SECS:-6}" \
        "$OUTPUT_MD" "$OUTPUT_MD"
fi

echo "[STATUS] vtt2md_done"
exit 0
