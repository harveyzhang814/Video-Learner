#!/bin/bash
set -euo pipefail

HOST="127.0.0.1"
PORT="4097"
BASE_URL="http://${HOST}:${PORT}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_cmd opencode
require_cmd curl
require_cmd jq

TMP_DIR="$(mktemp -d)"
PID_FILE="${TMP_DIR}/opencode_serve.pid"
LOG_FILE="${TMP_DIR}/opencode_serve.log"
RESP_HEALTH="${TMP_DIR}/health.json"
RESP_SESSION="${TMP_DIR}/session.json"
RESP_MESSAGE="${TMP_DIR}/message.json"

STARTED_BY_TEST="0"

cleanup() {
  if [[ "${STARTED_BY_TEST}" == "1" && -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]]; then
      kill "${pid}" >/dev/null 2>&1 || true
      wait "${pid}" >/dev/null 2>&1 || true
      for _ in 1 2 3 4 5; do
        if ! kill -0 "${pid}" >/dev/null 2>&1; then
          break
        fi
        sleep 0.2
      done
      kill -9 "${pid}" >/dev/null 2>&1 || true
      wait "${pid}" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "${TMP_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

health_check() {
  if ! curl -fsS --max-time 2 "${BASE_URL}/global/health" -o "${RESP_HEALTH}" >/dev/null 2>&1; then
    return 1
  fi
  jq -e '.healthy == true' "${RESP_HEALTH}" >/dev/null
}

if ! health_check; then
  OPENCODE_SERVER_PASSWORD="" opencode serve \
    --hostname "${HOST}" \
    --port "${PORT}" \
    --print-logs \
    --log-level INFO \
    >"${LOG_FILE}" 2>&1 &
  echo $! >"${PID_FILE}"
  STARTED_BY_TEST="1"

  for _ in {1..20}; do
    if health_check; then
      break
    fi
    sleep 0.25
  done

  health_check || {
    echo "OpenCode server did not become healthy at ${BASE_URL}/global/health" >&2
    echo "Server log saved at: ${LOG_FILE}" >&2
    exit 1
  }
fi

curl -fsS --max-time 15 \
  -H "Content-Type: application/json" \
  -d '{"title":"video-learner-opencode-smoke"}' \
  "${BASE_URL}/session" \
  -o "${RESP_SESSION}" >/dev/null

SESSION_ID="$(jq -er '.id' "${RESP_SESSION}")"

curl -fsS --max-time 120 \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"Reply with exactly: OK"}],"model":{"providerID":"minimax-cn-coding-plan","modelID":"MiniMax-M2.5"}}' \
  "${BASE_URL}/session/${SESSION_ID}/message" \
  -o "${RESP_MESSAGE}" >/dev/null

RESULT="$(
  jq -er '[.parts[]? | select(.type=="text") | .text] | join("") | gsub("^\\s+|\\s+$";"")' \
    "${RESP_MESSAGE}"
)"

if [[ "${RESULT}" != "OK" ]]; then
  echo "Assertion failed: expected exactly 'OK' but got: ${RESULT@Q}" >&2
  echo "Raw response saved at: ${RESP_MESSAGE}" >&2
  exit 1
fi

echo "${RESULT}"
