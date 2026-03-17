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
PROMPT_FILE="${TMP_DIR}/prompt.txt"
OUTPUT_FILE="${TMP_DIR}/output.txt"

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
printf '%s' 'Reply with exactly: OK' > "${PROMPT_FILE}"

WRITING_ENGINE=opencode bash scripts/llm_engine.sh --input "${PROMPT_FILE}" --output "${OUTPUT_FILE}"

RESULT="$(python3 - <<'PY' "${OUTPUT_FILE}"
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
print(text.strip())
PY
)"

if [[ "${RESULT}" != "OK" ]]; then
  echo "Assertion failed: expected exactly 'OK' but got: ${RESULT@Q}" >&2
  echo "Raw response saved at: ${OUTPUT_FILE}" >&2
  exit 1
fi

echo "${RESULT}"
