# How to Use the Debug Log Environment

This guide explains how to set up, use, and extend the debug log environment for Video-Learner. For a precise reference of paths and commands, see `harness/README.md`.

---

## What This Covers

Video-Learner has four independent log sources:

| Source | What it captures |
|--------|-----------------|
| HTTP backend | Request errors, startup, orchestrator exceptions |
| Electron main process | Window lifecycle, IPC, embedded HTTP service (`[agent-http]` prefix) |
| Electron renderer | Frontend console.log/warn/error, UI exceptions |
| Step logs per task | Shell script stdout/stderr from each pipeline step (yt-dlp, ffmpeg, LLM) |

Each source writes to its own file so you can query one layer at a time without noise from others.

---

## Two Modes

**Mode B (Electron — default):** When you start `bash start-electron.sh`, log capture is already wired into the code. No extra setup needed.
- Main process → `electron/main-process.log` (ISO 8601 timestamps via `patchConsole()`)
- Renderer → `electron/renderer-console.log`
- HTTP service (embedded) → also goes to `electron/main-process.log`, prefixed `[agent-http]`

**Mode A (Standalone HTTP — for debugging without Electron):** Use `harness/start-dev.sh` to start the HTTP service with log capture. The backend stdout is piped through a Python3 timestamp injector so every line has an ISO 8601 prefix.
- HTTP backend → `/tmp/vl-backend.log`
- Step logs → `work/<taskId>/logs/task.log.jsonl` (same in both modes)

---

## Quick Start

### If you're debugging with Electron running

Just start Electron normally:
```bash
bash start-electron.sh
```

Logs are already being captured. Check them directly:
```bash
# Main process (includes HTTP service)
tail -f electron/main-process.log

# Renderer (frontend)
tail -f electron/renderer-console.log
```

### If you're debugging with standalone HTTP (no Electron)

```bash
# Start backend + monitor + debug log aggregation
bash harness/start-dev.sh

# Watch aggregated logs
bash harness/debug/read-logs.sh --last 50

# Watch errors only
bash harness/debug/read-logs.sh --errors --last 30

# Stop when done (Ctrl-C in start-dev.sh terminal, or:)
bash harness/debug/stop.sh
kill $(cat /tmp/vl-backend.pid) 2>/dev/null
```

---

## Verifying the Environment

Before starting a long debug session, run the verification script to confirm all sources are working:

```bash
# Mode A (standalone HTTP)
bash harness/debug/verify-logs.sh

# Mode B (Electron running)
bash harness/debug/verify-logs.sh --mode B
```

Expected output: `RESULT: OK — 环境就绪`. If any source shows FAIL, fix it before running tests.

The verification script:
1. Starts the backend if not already running
2. Triggers a health check request to generate log output
3. Checks each source: file exists, updated within 60 seconds, ISO 8601 timestamps
4. Reports `OK / FAIL / SKIP` per source and exits non-zero on any FAIL

Run this after:
- Pulling new code that touches logging setup
- Moving to a new machine
- Changing the HTTP port

---

## Diagnosing a Problem

When something goes wrong, work through the layers in order:

1. **Check the step log first** — most pipeline failures (yt-dlp errors, ffmpeg crashes, LLM failures) appear here:
   ```bash
   cat work/<taskId>/logs/task.log.jsonl | grep '"level":"error"'
   ```

2. **If it's an API-level issue** — check the backend/main-process log:
   ```bash
   # Electron mode
   grep -i "error\|exception" electron/main-process.log | tail -20

   # Standalone mode
   grep -i "error\|exception" /tmp/vl-backend.log | tail -20
   ```

3. **If it's a UI issue** — check the renderer:
   ```bash
   grep "\[error\]\|\[warn\]" electron/renderer-console.log | tail -20
   ```

4. **For cross-layer timing analysis** — all log files have ISO 8601 timestamps, so you can sort them together to see the timeline:
   ```bash
   cat /tmp/vl-backend.log work/<taskId>/logs/task.log.jsonl | sort | tail -50
   ```

---

## Extending: Adding a New Log Source

If you add a new component (worker process, database, external service), follow this pattern:

1. **Identify the log output method** — does it write to stdout, a file, or a network socket?
2. **Add timestamp injection if missing** — for Node.js stdout without timestamps, wrap with Python3:
   ```bash
   my-process 2>&1 | python3 -u -c 'import sys,datetime; [print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), l.rstrip(), flush=True) for l in iter(sys.stdin.readline,"")]' >> /tmp/vl-mycomponent.log
   ```
3. **Add to `harness/debug/discover.sh`** — add an `add_source` line in the static sources section.
4. **Add to `harness/debug/verify-logs.sh`** — add a `check_source` call.
5. **Update `harness/README.md`** — add a row to the Sources table.
6. **Run verify** — confirm the new source passes.

---

## Notes and Gotchas

- `/tmp/vl-backend.log` and `/tmp/video-learner-debug.log` are in system temp and don't persist across reboots. They accumulate within a session — truncate manually if needed: `> /tmp/vl-backend.log`.
- `electron/main-process.log` and `electron/renderer-console.log` are gitignored (via `*.log`). These accumulate across sessions.
- Step logs are per-task. When you hard-delete a task (`DELETE /api/tasks/<id>?mode=hard`), its log directory is also deleted.
- The embedded HTTP service in Electron uses a randomized token on each launch. There is no way to query it externally without Electron's cooperation.
- The backend token is **never written to disk** (security design). To make authenticated API calls in Mode A, set `AGENT_EVENTS_TOKEN` to a known value before starting the backend.
- `backend.log` requires Python3 timestamp injection — direct stdout redirect (`>> log`) produces lines without timestamps, which will fail the ISO 8601 check in verify-logs.sh. Always use `harness/start-dev.sh` or the Python3 pipe pattern shown above.
