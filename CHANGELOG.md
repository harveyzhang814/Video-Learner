# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-06-29

### Added

#### Web 阅读体验美化
- `.prose-cn` 全元素样式（标题层级、链接、代码块、表格、引用、列表、图片）及语法高亮（rehype-highlight + 自定义 `.hljs` CSS，适配深浅两种模式）
- 多风格阅读主题体系：`themes.css` 存放所有 `:root[data-prose-theme="X"]` 变量块，`themes.ts` 维护注册表，新增主题只需改两个文件
- 内置两套主题：**默认**（Inter 无衬线，绿色 accent）和 **学术**（Source Serif 4 衬线，冷蓝石板配色，含深色模式覆盖）
- `ProseThemePicker` 组件（`✦` 按钮），置于任务详情页 header，可即时切换主题并持久化到 localStorage
- `web/preview/article.html` 独立渲染预览 fixture，内联全部 CSS，支持 `file://` 直接打开，含主题切换按钮

#### CLI 增强
- 本地文件导入：`vdl ./file.mp4` / `vdl /path/to/file.mp3` 支持本地音视频文件直接处理
- CLI 进度展示优化

#### 并行翻译
- 整体式分页并行翻译：200 行/页、5 路并发、页间缝合、格式校验
- AI 字幕预合并：LLM 直接将中文分配到句子级时间戳，提升可读性

### Fixed

- Web 音频播放器在任务切换时的播放状态问题
- Web postinstall 脚本修复

## [1.3.0] - 2026-06-25

### Added

#### OpenCode Session Reuse
- `opencode_session_id` column in tasks table — persists the active OpenCode session across steps
- `core/opencode-session.js` — `createOpencodeSession` / `isOpencodeSessionUsable` helpers for session lifecycle management
- Orchestrator creates a session before the article step and passes it via `VL_OPENCODE_SESSION_ID` env var; summary step reuses the same session
- `llm_engine.sh` reuses `VL_OPENCODE_SESSION_ID` when provided; chunked article path clears it to avoid cross-chunk session contamination

### Fixed

- Strip `<think>…</think>` reasoning traces from model output in both single-call and chunk-merged paths
- Bilibili subtitle download: human zh subtitles now take priority over ai-zh when both are available
- Web UI: article block left-aligns correctly on wide screens (article-notes-row layout)
- Web UI: `panel-right` max-width corrected for reading/audio/pure-read/theater modes (B/C/E/F)
- Web UI: audio player now visible in theater mode for audio tasks (Mode F)
- `updateTaskMetaFromFilesystem` no longer strips `opencode_session_id` on every filesystem sync

## [1.2.0] - 2026-06-25

### Added

#### Bilibili Support
- Platform detection utility (`is_bilibili`) — routes download/subtitle/audio logic by platform
- `download_video.sh` / `download_audio.sh` — separate Bilibili and YouTube code paths
- `download_subs.sh` — ai-zh subtitle path for Bilibili; YouTube path unchanged
- `srt2vtt.py` — SRT → WebVTT converter for Bilibili subtitles
- ASR fallback for Bilibili when ai-zh subtitles are unavailable
- Default output language set to `zh` for Bilibili URLs

#### Installation & Configuration
- `npm pack`-based global install — true file-copy install, no symlinks
- First-run wizard creates `~/.config/vdl/settings.conf` on first launch
- `vdl config get/set` reads and writes `~/.config/vdl/settings.conf`
- Shell scripts source `user-config.sh`; default work root `~/vdl-work`
- `WORK_ROOT` configurable via env var or `~/.config/vdl/settings.conf`
- `paths.js` resolves `WORK_ROOT` dynamically (env → config file → default)
- `vdl config migrate` — migrates existing task data to a new work root

### Fixed

- `WORK_ROOT` path resolution in tests — test suite now sets `WORK_ROOT` env var to temp dir to avoid polluting or depending on user's real work directory
- `vdl list` — gracefully handles missing database directory (prints "No tasks found." instead of exiting 1)
- `better-sqlite3` moved to `dependencies` for correct global install resolution

### Changed

- Install method changed from `npm link` to `npm pack` — see updated README Quick Start
- Config and work root paths moved from project directory to `~/.config/vdl/` and `~/vdl-work/`

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

[Unreleased]: https://github.com/harveyzhang96/video-learner/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/harveyzhang96/video-learner/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/harveyzhang96/video-learner/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/harveyzhang96/video-learner/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/harveyzhang96/video-learner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/harveyzhang96/video-learner/releases/tag/v1.0.0
