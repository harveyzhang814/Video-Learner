#!/bin/bash
# Subtitle translation step
# Usage: bash scripts/translate_subs.sh <INPUT_EN_MD> <OUTPUT_ZH_MD>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
    echo "[STATUS] translate_error: Missing arguments"
    echo "Usage: $0 <INPUT_EN_MD> <OUTPUT_ZH_MD>"
    exit 1
fi

INPUT_MD="$1"
OUTPUT_MD="$2"

if [ ! -f "$INPUT_MD" ]; then
    echo "[STATUS] translate_error: Input file not found: $INPUT_MD"
    exit 1
fi

echo "[STATUS] translate_start"
mkdir -p "$(dirname "$OUTPUT_MD")"

TMPDIR_TRANS=$(mktemp -d /tmp/translate-XXXXXXXX)
trap 'rm -rf "$TMPDIR_TRANS"' EXIT INT TERM

# ── Phase 1: 时间窗口分块 ──────────────────────────────────────────────────────
CHUNKS_JSON="$TMPDIR_TRANS/chunks.json"

python3 - "$INPUT_MD" "$CHUNKS_JSON" <<'PYTHON_EOF'
import sys, json, re

WINDOW_SECS = 25   # 目标窗口 20-30s
MAX_CHARS   = 800  # 单块字符硬上限

def ts_to_secs(ts):
    # Strip milliseconds if present: "00:01:23.456" → "00:01:23"
    ts = ts.split('.')[0]
    parts = ts.split(':')
    if len(parts) == 3:
        h, m, s = parts; return int(h)*3600 + int(m)*60 + int(s)
    elif len(parts) == 2:
        m, s = parts; return int(m)*60 + int(s)
    return 0.0

content = open(sys.argv[1], encoding='utf-8').read()

# Support two formats:
#   1. [HH:MM:SS.mmm --> HH:MM:SS.mmm] text   (vtt_converter.py output)
#   2. ## HH:MM:SS\ntext                        (legacy heading format)
vtt_line_re = re.compile(r'^\[(\d{2}:\d{2}:\d{2})[^\]]*\]\s+(.*)')
heading_re  = re.compile(r'^## (\d{1,2}:\d{2}:\d{2})\s*\n(.*?)(?=\n## |\Z)',
                         re.MULTILINE | re.DOTALL)

blocks = []
for line in content.splitlines():
    m = vtt_line_re.match(line.strip())
    if m:
        blocks.append((m.group(1), m.group(2).strip()))

if not blocks:
    # Fallback: try heading format
    blocks = [(m.group(1), m.group(2).strip())
              for m in heading_re.finditer(content)]

if not blocks:
    print("ERROR: no timestamp blocks found", file=sys.stderr)
    sys.exit(1)

chunks = []
cur_start_ts   = blocks[0][0]
cur_start_secs = ts_to_secs(blocks[0][0])
cur_texts      = []

for ts, text in blocks:
    secs    = ts_to_secs(ts)
    elapsed = secs - cur_start_secs
    if elapsed >= WINDOW_SECS or len(' '.join(cur_texts + [text])) > MAX_CHARS:
        if cur_texts:
            chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})
        cur_start_ts, cur_start_secs, cur_texts = ts, secs, [text]
    else:
        cur_texts.append(text)

if cur_texts:
    chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})

json.dump(chunks, open(sys.argv[2], 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print(f"Phase1: {len(chunks)} chunks from {len(blocks)} blocks")
PYTHON_EOF

CHUNK_COUNT=$(python3 -c "import json; print(len(json.load(open('$CHUNKS_JSON'))))")
echo "[STATUS] translate_chunks: $CHUNK_COUNT"

# ── Phase 2: 顺序 LLM 翻译 ───────────────────────────────────────────────────
ZH_DIR="$TMPDIR_TRANS/results"
mkdir -p "$ZH_DIR"
zh_prev_tail=""
failed_count=0

for i in $(seq 0 $((CHUNK_COUNT - 1))); do
    echo "[STATUS] translate_chunk $((i+1))/$CHUNK_COUNT"

    MERGED_EN=$(python3 -c "import json; print(json.load(open('$CHUNKS_JSON'))[$i]['text'])")
    NEXT_EN=""
    if [ "$i" -lt "$((CHUNK_COUNT - 1))" ]; then
        NEXT_EN=$(python3 -c "import json; print(json.load(open('$CHUNKS_JSON'))[$((i+1))]['text'])")
    fi

    PROMPT_FILE="$TMPDIR_TRANS/prompt_$i.txt"
    {
        echo '你是一名字幕翻译员。只输出简体中文翻译结果，不要重复英文原文，不要添加任何解释、分隔线或额外标记。'
        echo '将【待翻译】内容翻译为简体中文，要求：语义准确、中文流畅，不限行数和结构。'
        if [ -n "$zh_prev_tail" ]; then
            echo '从【已翻译上文】结束的语义节点自然接续，不重复上文内容。'
            echo ''
            echo '--- 已翻译上文（末尾，接续参考）---'
            printf '%s\n' "$zh_prev_tail"
        fi
        echo ''
        echo '--- 待翻译 ---'
        printf '%s\n' "$MERGED_EN"
        if [ -n "$NEXT_EN" ]; then
            echo ''
            echo '--- 下文参考（只读，不翻译）---'
            printf '%s\n' "$NEXT_EN"
        fi
    } > "$PROMPT_FILE"

    ZH_OUT="$ZH_DIR/chunk_$i.txt"
    if bash "$SCRIPT_DIR/llm_engine.sh" --input "$PROMPT_FILE" --output "$ZH_OUT" 2>/dev/null; then
        # Strip <think>...</think> blocks (extended thinking leakage)
        python3 -c "
import re, sys
raw = open('$ZH_OUT', encoding='utf-8').read()
clean = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()
open('$ZH_OUT', 'w', encoding='utf-8').write(clean)
"
        zh_prev_tail=$(python3 -c "
t = open('$ZH_OUT', encoding='utf-8').read().strip()
print(t[-150:] if len(t) > 150 else t)
")
    else
        echo "[STATUS] translate_error: chunk $((i+1)) LLM failed, skipping"
        zh_prev_tail=""
        failed_count=$((failed_count + 1))
    fi
done

if [ "$failed_count" -eq "$CHUNK_COUNT" ]; then
    echo "[STATUS] translate_error: all $CHUNK_COUNT chunks failed"
    exit 1
fi

# ── Phase 3: 组装 original_zh.md ─────────────────────────────────────────────
python3 - "$CHUNKS_JSON" "$ZH_DIR" "$OUTPUT_MD" <<'PYTHON_EOF'
import sys, json, os

chunks = json.load(open(sys.argv[1], encoding='utf-8'))
results_dir, output_md = sys.argv[2], sys.argv[3]

lines = []
for i, chunk in enumerate(chunks):
    rf = os.path.join(results_dir, f'chunk_{i}.txt')
    if not os.path.exists(rf):
        continue
    zh = open(rf, encoding='utf-8').read().strip()
    if zh:
        lines.append(f"## {chunk['start_ts']}\n{zh}")

if not lines:
    print("ERROR: no translated chunks to write", file=sys.stderr)
    sys.exit(1)

open(output_md, 'w', encoding='utf-8').write('\n\n'.join(lines) + '\n')
print(f"Phase3: wrote {len(lines)} chunks to {output_md}")
PYTHON_EOF

echo "[STATUS] translate_done"
