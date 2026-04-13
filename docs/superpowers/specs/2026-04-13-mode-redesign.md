# Mode System Redesign

**Date:** 2026-04-13
**Branch:** feature/fix-task-status-on-video-fail (or new feature branch)
**Status:** Approved

---

## Background

The existing mode system (`both` / `video` / `audio` / `transcript`) had two problems:

1. `both` and `video` were functionally identical — the `audio` step was excluded from scheduling in `both` mode, so no standalone `audio.m4a` was ever produced.
2. There was no "smart fallback" mode: if video download failed, the task had no media output at all.

The core pipeline (Transcript + Article + Summary) is always required. Modes only control **which media files are downloaded**.

---

## New Mode Semantics

| Mode | Media behavior | Frequency | Default |
|------|---------------|-----------|:-------:|
| `media` | Download video first; if video fails or is missing, fall back to audio | Highest | ✓ |
| `audio` | Download audio only | Medium | |
| `transcript` | No media download | Medium | |
| `full` | Download video AND audio independently (both steps run, neither blocks the other) | Lowest | |

---

## Migration

### Old → New name mapping

| Old name | New name |
|----------|----------|
| `both` | `media` |
| `video` | `media` |
| `audio` | `audio` (unchanged) |
| `transcript` | `transcript` (unchanged) |

### `normalizeMode(raw)` function

Added to orchestrator. Applied on every read path (HTTP request body, DB load):

```
'both' | 'video' | 'media' → 'media'
'audio'                    → 'audio'
'transcript'               → 'transcript'
'full'                     → 'full'
unknown / empty            → 'media'  (default)
```

### One-time DB migration script

`scripts/migrate-mode-names.js` — idempotent, runs automatically on HTTP server startup:
```sql
UPDATE tasks SET mode = 'media' WHERE mode IN ('both', 'video');
```

---

## Scheduler Changes (`core/orchestrator/schedule.js`)

### `excludedByMode(mode, steps?)` — updated signature

`steps` is optional context (the task's current step statuses). Used to dynamically unblock `audio` in `media` mode when `video` has failed.

```
media mode:
  - video not yet failed → audio excluded
  - video failed         → audio included (fallback triggered)

audio mode:      video excluded
transcript mode: video + audio excluded
full mode:       nothing excluded (video and audio both schedulable; video has higher priority)
```

### `computeReadySteps(task)`

No signature change. Passes `task.steps` to `excludedByMode` internally.

### `pickNextStep` secondary chain

`full` mode secondary chain: `[video, audio, md2vtt]` — video runs before audio.

### Step state flow in `media` mode

```
fetch: completed
  → video: pending → running → failed
      ↓  (next computeReadySteps call detects video.failed)
  → audio: pending → running → completed | failed
```

Audio is a full independent step with its own DB record, log file, and `reset_scope` support.

---

## Orchestrator Changes (`core/orchestrator/index.js`)

### `runStep` mode-skip logic

| Step | Skip when |
|------|-----------|
| `video` | `mode === 'audio'` or `mode === 'transcript'` |
| `audio` | `mode === 'transcript'`; in `media` mode, excluded by scheduler until video fails (never reaches `runStep` pre-failure) |

### Task overall status

Unchanged from problem-1 fix: only `CONTENT_STEPS` failures mark a task as `failed`. Video and audio failures do not affect overall task status.

---

## API Changes (`services/http-server/index.js`)

- `POST /api/tasks` body: `mode` accepts `media | audio | transcript | full`
- Old values `both | video` silently normalized via `normalizeMode()` — no error returned
- Response `meta.mode` always contains the normalized new name

---

## DB Migration Script

**File:** `scripts/migrate-mode-names.js`

- Scans `tasks` table, updates `mode IN ('both', 'video')` → `'media'`
- Idempotent (safe to run multiple times)
- Runs automatically once on HTTP server startup before accepting requests

---

## Test Changes

| File | Change |
|------|--------|
| `tests/orchestrator-schedule.test.js` | Add: `media` mode video-failed → audio triggers; `full` mode both steps ready simultaneously |
| `tests/apply-reset-scope.test.js` | Add: `media` mode with video failed → audio can be used as reset anchor |
| `tests/reset-scope-all-steps-http.test.js` | Update `excludedByMode` assertions: audio no longer permanently excluded in `media` mode |
| `tests/agent-http.test.js` | Add: old names `both` and `video` are accepted and normalized silently |

---

## Out of Scope

- GUI mode selector label changes (separate UI task)
- `download_audio.sh` `force` parameter bug (separate known issue in PROJECT_KNOWLEDGE.md)
- Parallel execution of `video` + `audio` in `full` mode (current serial scheduler; true parallelism is a future enhancement)
