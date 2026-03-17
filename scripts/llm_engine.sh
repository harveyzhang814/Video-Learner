#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load global defaults from scripts/settings.conf if present.
if [[ -f "$SCRIPT_DIR/settings.conf" ]]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/settings.conf"
fi

# Precedence:
# 1. env WRITING_ENGINE（单次覆盖）
# 2. settings.conf 中的 WRITING_ENGINE_DEFAULT
# 3. 内置默认 claude
WRITING_ENGINE="${WRITING_ENGINE:-${WRITING_ENGINE_DEFAULT:-claude}}"
INPUT_FILE=""
OUTPUT_FILE=""

usage() {
  echo "Usage: WRITING_ENGINE=claude|opencode bash scripts/llm_engine.sh --input <prompt_file> --output <output_file>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      INPUT_FILE="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$INPUT_FILE" || -z "$OUTPUT_FILE" ]]; then
  usage
  exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Input file not found: $INPUT_FILE" >&2
  exit 1
fi

run_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "claude not found in PATH. Install Claude Code or make sure the claude CLI is available before using WRITING_ENGINE=claude." >&2
    exit 127
  fi

  env -u CLAUDECODE ANTHROPIC_BASE_URL="https://api.anthropic.com" \
    claude -p --dangerously-skip-permissions < "$INPUT_FILE" > "$OUTPUT_FILE"
}

run_opencode() {
  # Use opencode run via a pseudo-TTY to avoid non-interactive hangs in some environments.
  # We stream JSON events (--format json) and extract all text parts.
  python3 - "$INPUT_FILE" <<'PY' >"$OUTPUT_FILE"
import io, json, os, pty, sys

if len(sys.argv) < 2:
    sys.stderr.write("usage: llm_engine_opencode.py <prompt_file>\n")
    sys.exit(1)

prompt_path = sys.argv[1]
try:
    with open(prompt_path, "r", encoding="utf-8") as f:
        prompt = f.read()
except Exception as e:
    sys.stderr.write(f"failed to read prompt file: {e}\n")
    sys.exit(1)

cmd = [
    "opencode",
    "run",
    "-m",
    "minimax-cn-coding-plan/MiniMax-M2.5",
    "--format",
    "json",
    prompt,
]

buf = io.StringIO()

def _reader(fd):
    data = os.read(fd, 4096)
    if not data:
        return data
    try:
        text = data.decode("utf-8", errors="ignore")
    except Exception:
        return data
    buf.write(text)
    return data

code = pty.spawn(cmd, _reader)
if code != 0:
    sys.stderr.write(f"opencode run exited with code {code}\n")
    sys.exit(code)

raw = buf.getvalue()
texts = []
for line in raw.splitlines():
    line = line.strip()
    if not line or not line.startswith("{"):
        continue
    try:
        obj = json.loads(line)
    except Exception:
        continue
    part = obj.get("part") or obj
    if part.get("type") == "text" and isinstance(part.get("text"), str):
        texts.append(part["text"])

sys.stdout.write("".join(texts))
PY
}

case "$WRITING_ENGINE" in
  claude)
    run_claude
    ;;
  opencode)
    run_opencode
    ;;
  *)
    echo "Unsupported WRITING_ENGINE: $WRITING_ENGINE" >&2
    exit 1
    ;;
esac
