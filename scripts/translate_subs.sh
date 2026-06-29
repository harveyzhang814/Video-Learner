#!/bin/bash
# Subtitle translation step - holistic page-level parallel translation
# Usage: bash scripts/translate_subs.sh <INPUT_EN_MD> <OUTPUT_ZH_MD>
#
# Env vars (all optional):
#   TRANSLATE_PAGE_SIZE     lines per page          (default 200)
#   TRANSLATE_PARALLEL      max concurrent LLM calls (default 5)
#   TRANSLATE_PAGE_TIMEOUT  seconds per page call   (default 600)
#   TRANSLATE_MIN_COVERAGE  minimum coverage %      (default 90)

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

PAGE_SIZE="${TRANSLATE_PAGE_SIZE:-200}"
PARALLEL="${TRANSLATE_PARALLEL:-5}"
PAGE_TIMEOUT="${TRANSLATE_PAGE_TIMEOUT:-600}"
MIN_COVERAGE="${TRANSLATE_MIN_COVERAGE:-90}"
LLM_ENGINE="${LLM_ENGINE_SCRIPT:-$SCRIPT_DIR/llm_engine.sh}"

echo "[STATUS] translate_start"
mkdir -p "$(dirname "$OUTPUT_MD")"

TMPDIR_TRANS=$(mktemp -d /tmp/translate-XXXXXXXX)
trap 'rm -rf "$TMPDIR_TRANS"' EXIT INT TERM

PAGES_DIR="$TMPDIR_TRANS/pages"
mkdir -p "$PAGES_DIR"

# ── Phase 1: 分页 ─────────────────────────────────────────────────────────────
EN_LINE_COUNT=$(grep -c '^\[' "$INPUT_MD" || true)

python3 - "$INPUT_MD" "$PAGES_DIR" "$PAGE_SIZE" <<'PYTHON_EOF'
import sys

input_md, pages_dir, page_size = sys.argv[1], sys.argv[2], int(sys.argv[3])

with open(input_md, encoding='utf-8') as f:
    lines = [l for l in f.readlines() if l.strip()]

for page_num, start in enumerate(range(0, len(lines), page_size)):
    chunk = lines[start:start + page_size]
    # Zero-padded filenames for macOS-compatible lexicographic sort (no sort -V needed)
    with open(f"{pages_dir}/page_{page_num:03d}.en", 'w', encoding='utf-8') as f:
        f.writelines(chunk)

print(f"Phase1: {len(lines)} lines → {(len(lines) + page_size - 1) // page_size} pages")
PYTHON_EOF

PAGE_COUNT=$(ls "$PAGES_DIR"/*.en 2>/dev/null | wc -l | tr -d ' ')
echo "[STATUS] translate_chunks: $PAGE_COUNT"

# ── Phase 2: 并行翻译 ─────────────────────────────────────────────────────────
translate_page() {
    local page_en="$1"
    local page_num="$2"
    local page_zh="${page_en%.en}.zh"
    local prompt_file="$TMPDIR_TRANS/prompt_${page_num}.txt"

    {
        printf '%s\n' '你是一名专业字幕翻译员。我将给你一段带时间戳的英文字幕，格式为：'
        printf '%s\n' '[HH:MM:SS.mmm --> HH:MM:SS.mmm] 英文内容'
        printf '%s\n' ''
        printf '%s\n' '任务要求：'
        printf '%s\n' '1. 先通读全部内容，理解整体语义和上下文'
        printf '%s\n' '2. 将全部内容翻译为流畅的简体中文'
        printf '%s\n' '3. 输出必须保留【每一条】原始时间戳，格式完全一致：[HH:MM:SS.mmm --> HH:MM:SS.mmm] 中文内容'
        printf '%s\n' '4. 中文内容按自然语义分配到各时间戳，可合理调整每行文字量，但不能增删时间戳条目'
        printf '%s\n' '5. 只输出翻译结果，不要解释、不要注释'
        printf '%s\n' ''
        printf '%s\n' '--- 待翻译字幕 ---'
        cat "$page_en"
    } > "$prompt_file"

    if timeout "$PAGE_TIMEOUT" bash "$LLM_ENGINE" \
        --input "$prompt_file" --output "$page_zh" 2>/dev/null; then
        echo "[STATUS] translate_chunk $((page_num + 1))/$PAGE_COUNT"
    else
        echo "[STATUS] translate_chunk_failed: $((page_num + 1))/$PAGE_COUNT"
        rm -f "$page_zh"
    fi
}

# Semaphore-style parallel execution with cap
pids=()
page_num=0
for page_en in $(ls "$PAGES_DIR"/*.en | sort); do
    translate_page "$page_en" "$page_num" &
    pids+=($!)
    page_num=$((page_num + 1))

    if [ "${#pids[@]}" -ge "$PARALLEL" ]; then
        wait "${pids[0]}"
        pids=("${pids[@]:1}")
    fi
done
[ "${#pids[@]}" -gt 0 ] && wait "${pids[@]}"

# ── Phase 3: 页间缝合 ─────────────────────────────────────────────────────────
smooth_seam() {
    local page_a_zh="$1"
    local page_b_zh="$2"
    local seam_num="$3"

    [ -f "$page_a_zh" ] && [ -f "$page_b_zh" ] || return 0

    local prompt_file="$TMPDIR_TRANS/seam_${seam_num}.txt"
    local seam_out="$TMPDIR_TRANS/seam_${seam_num}.out"

    {
        printf '%s\n' '以下是两段相邻字幕的边界内容（简体中文）。请微调【下文开头】的前几行，'
        printf '%s\n' '使其从【上文结尾】自然接续，保持术语和语气一致。'
        printf '%s\n' '只输出修改后的【下文开头】行，不要输出其他内容。'
        printf '%s\n' ''
        printf '%s\n' '--- 上文结尾（只读）---'
        tail -3 "$page_a_zh"
        printf '%s\n' ''
        printf '%s\n' '--- 下文开头（待调整）---'
        head -3 "$page_b_zh"
    } > "$prompt_file"

    if timeout 120 bash "$LLM_ENGINE" \
        --input "$prompt_file" --output "$seam_out" 2>/dev/null; then
        python3 - "$page_b_zh" "$seam_out" <<'PYEOF'
import sys
orig  = open(sys.argv[1], encoding='utf-8').readlines()
patch = open(sys.argv[2], encoding='utf-8').readlines()
# Replace first min(len(patch), 3) lines with the same number of patch lines, keep the rest
keep_from = min(len(patch), 3)
open(sys.argv[1], 'w', encoding='utf-8').writelines(patch[:keep_from] + orig[keep_from:])
PYEOF
    fi
}

zh_pages=($(ls "$PAGES_DIR"/*.zh 2>/dev/null | sort))
seam_pids=()
for ((i = 0; i < ${#zh_pages[@]} - 1; i++)); do
    smooth_seam "${zh_pages[$i]}" "${zh_pages[$((i + 1))]}" "$i" &
    seam_pids+=($!)
done
[ "${#seam_pids[@]}" -gt 0 ] && wait "${seam_pids[@]}"

# ── Phase 4: 格式校验、修复、合并写入 ─────────────────────────────────────────
COMBINED="$TMPDIR_TRANS/combined.zh"
for page_zh in $(ls "$PAGES_DIR"/*.zh 2>/dev/null | sort); do
    cat "$page_zh"
done > "$COMBINED"

if ! python3 "$SCRIPT_DIR/translate_validator.py" \
    --input "$COMBINED" \
    --output "$OUTPUT_MD" \
    --en-line-count "$EN_LINE_COUNT" \
    --min-coverage "$MIN_COVERAGE"; then
    echo "[STATUS] translate_error: validation failed"
    exit 1
fi

echo "[STATUS] translate_done"
