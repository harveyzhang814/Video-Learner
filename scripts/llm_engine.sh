#!/bin/bash

set -euo pipefail

WRITING_ENGINE="${WRITING_ENGINE:-claude}"
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_SERVER_STARTED="0"

run_claude() {
  env -u CLAUDECODE ANTHROPIC_BASE_URL="https://api.anthropic.com" \
    claude -p --dangerously-skip-permissions < "$INPUT_FILE" > "$OUTPUT_FILE"
}

cleanup_opencode() {
  if [[ "$OPENCODE_SERVER_STARTED" == "1" ]]; then
    opencode_server_stop_if_started
  fi
}

run_opencode() {
  source "$SCRIPT_DIR/opencode_server.sh"
  trap cleanup_opencode EXIT

  if ! opencode_server_health; then
    opencode_server_ensure
    OPENCODE_SERVER_STARTED="1"
  fi

  local base_url session_json session_id prompt_json message_json response_text
  base_url="$(opencode_server_base_url)"
  session_json="$(mktemp)"
  message_json="$(mktemp)"
  prompt_json="$(jq -Rs '{parts:[{type:"text",text:.}], model:{providerID:"minimax-cn-coding-plan", modelID:"MiniMax-M2.5"}}' < "$INPUT_FILE")"

  curl -fsS --max-time 15 \
    -H "Content-Type: application/json" \
    -d '{"title":"video-learner-llm-engine"}' \
    "${base_url}/session" \
    -o "$session_json" >/dev/null

  session_id="$(jq -er '.id' "$session_json")"

  curl -fsS --max-time 120 \
    -H "Content-Type: application/json" \
    -d "$prompt_json" \
    "${base_url}/session/${session_id}/message" \
    -o "$message_json" >/dev/null

  response_text="$(jq -r '[.parts[]? | select(.type=="text") | .text] | join("")' "$message_json")"
  printf '%s\n' "$response_text" > "$OUTPUT_FILE"
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
