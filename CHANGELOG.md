# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-19

### Added

#### Task Abort & Resume
- `abortTask()` orchestrator function — sends SIGTERM to the running process group, waits for exit, persists `aborted` status to SQLite `tasks.status` column
- `abortStep()` orchestrator function — cancels a single running step; step resets to `pending`, DAG continues scheduling remaining steps
- `POST /api/tasks/:taskId/cancel` — synchronously abort a running task (200 on success, 409 `NOT_RUNNING` if not running)
- `POST /api/tasks/:taskId/steps/:stepName/cancel` — synchronously cancel a running step (200, 409 `STEP_NOT_RUNNING` / `STEP_ABORT_IN_PROGRESS`)
- `resumeTask()` orchestrator function — re-enters `runTask()` from any `aborted` task; skips `completed`/`skipped` steps, re-schedules from pending predecessors
- `POST /api/tasks/:taskId/resume` — trigger resume for an `aborted` task (202 fire-and-forget, 409 `NOT_ABORTED`)
- Abort button in GUI toolbar for running tasks
- Resume button in GUI, shown when task status is `aborted`
- `aborted` task state persists across process restarts via `tasks.status` column

#### `vdl` CLI
- `vdl run <url>` — interactive focus prompt, creates task, polls progress with live step display
- `vdl status <id>` — print task status and step list
- `vdl result <id>` — print output paths (article, summary, etc.)
- `vdl rerun <id>` — re-run an existing task
- `vdl list` — list all tasks in the local database
- Server lifecycle manager: auto-starts HTTP service if not running, writes token to `/tmp/vl-agent-token` for discovery
- TTY-aware progress rendering

#### ASR Fallback
- Whisper ASR pipeline step (`asr_transcribe.py` + `asr_transcribe.sh`) as fallback when YouTube subtitles are unavailable or fail
- OR-gate in DAG: `vtt2md` accepts either `subs` or `asr` as predecessor, whichever succeeds
- Dynamic step exclusion: `asr` is excluded when subtitles succeed; `subs` is excluded in `transcript` mode without media

#### DAG Reachability
- `GATE_TYPE` / `TERMINAL_NODE` / `CRITICAL_PATH` declarations on step edges
- `isNodeReachable(stepName, mode, steps)` — computes reachability under OR-gate semantics
- `isTaskFailed()` / `isTaskCompleted()` — replaces hardcoded failure detection logic

#### Mode Redesign
- New canonical mode names: `media` | `audio` | `transcript` | `full`
- `normalizeMode()` — silently maps legacy names (`both` → `media`, `video` → `media`) for backward compatibility
- `migrate-mode-names` script runs on HTTP server startup to update existing DB records

#### Developer Experience
- Unified dev harness (`harness/start-dev.sh`) — single command starts backend + log aggregator + error monitor, optional `--electron` flag
- Log aggregation daemon aggregates all sources (backend, electron-main, electron-renderer, per-task logs) into `/tmp/video-learner-debug.log`
- Electron main process now writes console output to `main-process.log` for agent inspection

#### Security
- HTTP service binds to `127.0.0.1` (localhost only)
- Bearer token authentication on all API routes; token written to `/tmp/vl-agent-token` on startup
- `marked.js` vendored locally (removes remote CDN dependency)
- SQLite `busy_timeout` set to prevent lock contention

### Changed

- MiniMax writing engine model upgraded from M2.5 to M2.7
- DAG schedule loop moved to orchestrator `runTask()` (B-layer), enabling shared scheduling between GUI and HTTP paths
- `video`/`audio` step failure no longer marks the entire task as `failed` — transcript pipeline continues independently
- Documentation migrated to Diataxis structure (`reference/` / `how-to/` / `explanation/` / `adr/`)

### Fixed

- `yt-dlp` stderr separated from JSON capture to prevent false parse failures on info fetch
- YouTube 403 on TV-client requests — now retries without cookies first
- Player stale media when switching between tasks in GUI
- Bearer token missing from `open-task-folder` IPC request in Electron main process
- SQL injection in `db.sh` — values are now properly escaped
- `title`/`duration`/`lang` fields lost during `updateTaskMetaFromFilesystem` updates
- Concurrent `abortStep` calls guarded to prevent double-kill race condition
- Abort flag cleanup moved outside inner try block to prevent stuck `aborting` state
- Spurious `task.updated` SSE event no longer emitted during abort sequence
- `killall Electron` removed from startup script to avoid killing unrelated Electron apps

## [1.0.0] - 2026-03-22

Initial release.

- YouTube URL → download / transcript / summary pipeline
- Electron GUI with task management, article/summary viewer, local video player with subtitle tracks
- HTTP Agent Service (`POST /api/tasks`, polling, SSE event stream)
- `reset_scope` step execution: `off` | `step` | `downstream`
- SQLite state persistence (`work/database.sqlite`)
- Multi-engine writing: Claude Code CLI or OpenCode (MiniMax)
- zh-CN subtitle fallback and traditional Chinese subtitle support

[1.1.0]: https://github.com/harveyzhang96/video-learner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/harveyzhang96/video-learner/releases/tag/v1.0.0
