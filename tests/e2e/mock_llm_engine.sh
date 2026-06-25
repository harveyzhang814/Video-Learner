#!/bin/bash
# Mock LLM engine for e2e testing.
# Reads a subtitle prompt, extracts timestamp lines, outputs deterministic Chinese placeholders.
# Usage: bash mock_llm_engine.sh --input <file> --output <file>

INPUT=""
OUTPUT=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --input)  INPUT="$2";  shift 2 ;;
        --output) OUTPUT="$2"; shift 2 ;;
        *) shift ;;
    esac
done

if [ -z "$INPUT" ] || [ -z "$OUTPUT" ]; then
    echo "mock_llm_engine: missing --input or --output" >&2
    exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"

# Extract timestamp lines from prompt and generate placeholder Chinese translation
python3 - "$INPUT" "$OUTPUT" << 'PYTHON'
import re, sys

LINE_RE = re.compile(r'^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] .+$')

with open(sys.argv[1], encoding='utf-8') as f:
    lines = f.readlines()

out = []
n = 0
for line in lines:
    m = LINE_RE.match(line.rstrip())
    if m:
        n += 1
        out.append(f"[{m.group(1)} --> {m.group(2)}] 测试翻译内容 {n}")

with open(sys.argv[2], 'w', encoding='utf-8') as f:
    f.write('\n'.join(out) + '\n')
PYTHON
