#!/bin/bash
# session_http.sh — opencode HTTP API wrapper. SOURCE ONLY.
# Functions: opencode_ensure, opencode_create_session, opencode_send_msg

set -euo pipefail

EXPERIMENT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPERIMENT_DIR="$(dirname "$EXPERIMENT_LIB_DIR")"
SCRIPTS_DIR="$(dirname "$EXPERIMENT_DIR")"
OPENCODE_SERVER_SCRIPT="$SCRIPTS_DIR/opencode_server.sh"

OPENCODE_MODEL_PROVIDER="${OPENCODE_MODEL_PROVIDER:-minimax-cn-coding-plan}"
OPENCODE_MODEL_ID="${OPENCODE_MODEL_ID:-MiniMax-M2.7}"

# Ensure opencode serve is running. Exits 1 on failure.
opencode_ensure() {
  if [[ ! -f "$OPENCODE_SERVER_SCRIPT" ]]; then
    echo "[session_http] opencode_server.sh not found: $OPENCODE_SERVER_SCRIPT" >&2
    return 1
  fi
  # shellcheck source=/dev/null
  source "$OPENCODE_SERVER_SCRIPT"
  if ! opencode_server_ensure; then
    echo "[session_http] Failed to start opencode serve." >&2
    return 1
  fi
}

# Create a new session. Prints session_id to stdout.
opencode_create_session() {
  local title="${1:-experiment-$(python3 -c "import time; print(int(time.time()))")}"
  local base_url
  # shellcheck source=/dev/null
  source "$OPENCODE_SERVER_SCRIPT"
  base_url="$(opencode_server_base_url)"

  local resp
  resp="$(curl -fsS -H "Content-Type: application/json" \
    -d "{\"title\":\"${title}\"}" \
    "${base_url}/session")"

  local sid
  sid="$(printf '%s' "$resp" | jq -r '.id // empty')"
  if [[ -z "$sid" || "$sid" == "null" ]]; then
    echo "[session_http] create_session failed: $resp" >&2
    return 1
  fi
  printf '%s' "$sid"
}

# Send one message to a session. Writes text output and metrics JSON.
# Usage: opencode_send_msg <session_id> <prompt_file> <out_text_file> <out_metrics_file>
opencode_send_msg() {
  local session_id="$1"
  local prompt_file="$2"
  local out_text="$3"
  local out_metrics="$4"

  if [[ ! -f "$prompt_file" ]]; then
    echo "[session_http] prompt_file not found: $prompt_file" >&2
    return 1
  fi

  local base_url
  # shellcheck source=/dev/null
  source "$OPENCODE_SERVER_SCRIPT"
  base_url="$(opencode_server_base_url)"

  local prompt_json
  prompt_json="$(jq -Rs . < "$prompt_file")"

  local start_ms
  start_ms="$(python3 -c "import time; print(int(time.time()*1000))")"

  local resp
  resp="$(curl -fsS -H "Content-Type: application/json" \
    -d "{\"parts\":[{\"type\":\"text\",\"text\":${prompt_json}}],\"model\":{\"providerID\":\"${OPENCODE_MODEL_PROVIDER}\",\"modelID\":\"${OPENCODE_MODEL_ID}\"}}" \
    "${base_url}/session/${session_id}/message")"

  local end_ms
  end_ms="$(python3 -c "import time; print(int(time.time()*1000))")"
  local elapsed_ms=$(( end_ms - start_ms ))

  # Extract text
  printf '%s' "$resp" | jq -r '
    .parts | map(select(.type == "text") | .text // "") | join("")
  ' > "$out_text"

  # Extract token metrics + elapsed
  printf '%s' "$resp" | jq --argjson elapsed "$elapsed_ms" '
    .info.tokens + {time_ms: $elapsed}
  ' > "$out_metrics"
}
