#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$SCRIPT_DIR/settings.conf"

if [ -f "$SETTINGS_FILE" ]; then
  # shellcheck source=/dev/null
  source "$SETTINGS_FILE"
fi

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

# Resolve final writing engine with precedence:
# 1) explicit WRITING_ENGINE
# 2) WRITING_ENGINE_DEFAULT from settings.conf
# 3) hard fallback: opencode
raw_engine="${WRITING_ENGINE:-${WRITING_ENGINE_DEFAULT:-opencode}}"
case "$raw_engine" in
  claude|opencode)
    WRITING_ENGINE="$raw_engine"
    ;;
  *)
    WRITING_ENGINE="opencode"
    ;;
esac

run_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "claude not found in PATH. Install Claude Code or make sure the claude CLI is available before using WRITING_ENGINE=claude." >&2
    exit 127
  fi

  env -u CLAUDECODE ANTHROPIC_BASE_URL="https://api.anthropic.com" \
    claude -p --dangerously-skip-permissions < "$INPUT_FILE" > "$OUTPUT_FILE"
}

run_opencode() {
  # Use opencode serve + HTTP instead of opencode run + PTY.

  # Ensure helper script is available
  local server_script="$SCRIPT_DIR/opencode_server.sh"
  if [[ ! -f "$server_script" ]]; then
    echo "opencode_server.sh not found next to llm_engine.sh: $server_script" >&2
    exit 1
  fi

  # shellcheck source=/dev/null
  source "$server_script"

  # Ensure server is up
  if ! opencode_server_ensure; then
    echo "Failed to start or reach opencode serve HTTP server." >&2
    exit 1
  fi

  local base_url
  base_url="$(opencode_server_base_url)"

  # Create a session
  local session_json session_id
  if ! session_json="$(curl -fsS -H "Content-Type: application/json" \
    -d "{\"title\":\"video-learner-writing-$(date -u +%Y%m%dT%H%M%SZ)\"}" \
    "${base_url}/session")"; then
    echo "Failed to create OpenCode session via HTTP." >&2
    exit 1
  fi

  session_id="$(printf '%s\n' "$session_json" | jq -r '.id // empty')" || session_id=""
  if [[ -z "$session_id" || "$session_id" == "null" ]]; then
    echo "OpenCode session response missing id: $session_json" >&2
    exit 1
  fi

  # Read prompt file and JSON-encode as a string
  local prompt_json
  if ! prompt_json="$(jq -Rs . < "$INPUT_FILE")"; then
    echo "Failed to JSON-encode prompt from $INPUT_FILE" >&2
    exit 1
  fi

  # Send message and capture response
  local msg_json
  if ! msg_json="$(curl -fsS -H "Content-Type: application/json" \
    -d "{\"parts\":[{\"type\":\"text\",\"text\":${prompt_json}}],\"model\":{\"providerID\":\"minimax-cn-coding-plan\",\"modelID\":\"MiniMax-M2.5\"}}" \
    "${base_url}/session/${session_id}/message")"; then
    echo "Failed to send message to OpenCode session ${session_id}." >&2
    exit 1
  fi

  # Extract all text parts and write to output
  if ! printf '%s\n' "$msg_json" | jq -r '
    .parts
    | map(select(.type == "text") | .text // "")
    | join("")
  ' > "$OUTPUT_FILE"; then
    echo "Failed to parse OpenCode response JSON." >&2
    exit 1
  fi
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
