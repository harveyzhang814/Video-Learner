#!/bin/bash
#
# ASR fallback transcription step
# Usage: bash scripts/asr_transcribe.sh "URL" "DIR" "ID"
#
# Transcribes video.mp4 or audio.m4a using mlx_whisper and writes a VTT file
# to DIR/transcript/subs/ID.zh.asr.vtt
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

URL="${1:-}"
DIR="${2:-}"
ID="${3:-}"

if [ -z "$DIR" ] || [ -z "$ID" ]; then
    echo "Usage: $0 <URL> <DIR> <ID>"
    exit 1
fi

source "$SCRIPT_DIR/db.sh"

echo "[STATUS] asr_start"
update_step "$ID" "asr" "running"

ASR_MODEL="${ASR_MODEL:-mlx-community/whisper-large-v3-turbo}"

if python3 "$SCRIPT_DIR/asr_transcribe.py" "$ID" "$DIR" --model "$ASR_MODEL"; then
    update_step "$ID" "asr" "completed"
    echo "[STATUS] asr_done"
    exit 0
else
    update_step "$ID" "asr" "failed" "ASR transcription failed"
    echo "[STATUS] asr_error"
    exit 1
fi
