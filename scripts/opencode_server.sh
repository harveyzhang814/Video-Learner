#!/bin/bash

set -euo pipefail

opencode_server_base_url() {
  local host="${OPENCODE_HOST:-127.0.0.1}"
  local port="${OPENCODE_PORT:-4097}"
  echo "http://${host}:${port}"
}

opencode_server_pid_file() {
  echo "work/.opencode-serve.pid"
}

opencode_server_health() {
  local base
  base="$(opencode_server_base_url)"
  curl -fsS --max-time 2 "${base}/global/health" >/dev/null
}

opencode_server_ensure() {
  if opencode_server_health; then
    return 0
  fi

  mkdir -p work
  local pid_file
  pid_file="$(opencode_server_pid_file)"

  # If a pid file exists but server isn't healthy, treat it as stale.
  if [ -f "$pid_file" ]; then
    rm -f "$pid_file"
  fi

  # Start server in background; keep it unsecured (localhost only).
  OPENCODE_SERVER_PASSWORD="" opencode serve \
    --hostname "${OPENCODE_HOST:-127.0.0.1}" \
    --port "${OPENCODE_PORT:-4097}" \
    --log-level INFO >/dev/null 2>&1 &
  local pid="$!"

  echo "$pid" >"$pid_file"

  # Wait up to ~5s for health.
  local i
  for i in $(seq 1 10); do
    if opencode_server_health; then
      return 0
    fi
    sleep 0.5
  done

  # Startup failed; best-effort cleanup.
  kill "$pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
  return 1
}

opencode_server_stop_if_started() {
  local pid_file
  pid_file="$(opencode_server_pid_file)"
  if [ ! -f "$pid_file" ]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    rm -f "$pid_file"
    return 0
  fi

  # Only kill if the pid looks like an opencode serve process.
  if ps -p "$pid" -o command= 2>/dev/null | rg -q "opencode(\\-cli)? .*serve"; then
    kill "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$pid_file"
}

