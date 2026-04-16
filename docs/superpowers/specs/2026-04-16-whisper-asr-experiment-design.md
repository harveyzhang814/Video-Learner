# Whisper ASR Experiment Design

**Date:** 2026-04-16  
**Scope:** Independent experiment — no changes to existing pipeline code  
**Goal:** Use mlx_whisper to transcribe a video that has no YouTube subtitles, produce a VTT file compatible with the existing `vtt2md` step, then auto-trigger the downstream pipeline.

## Context

The pipeline's `subs` step fails when a video has no YouTube-provided subtitles (neither manual nor auto-generated). This blocks the entire transcript chain (`vtt2md → article → summary`). This experiment provides an ASR-based bypass for such videos.

## Scope

Single standalone script: `experiments/whisper_asr.py`

No changes to:
- `scripts/download_subs.sh`
- `core/orchestrator/`
- `services/http-server/`
- Any existing test

## Flow

```
experiments/whisper_asr.py <task_id> [--token <bearer>] [--model <hf_repo>]
    │
    ├─ 1. Resolve paths: work/<id>/media/video.mp4, work/<id>/transcript/subs/
    ├─ 2. Extract audio via ffmpeg → /tmp/<id>_asr.wav (16kHz mono)
    ├─ 3. mlx_whisper.transcribe(wav, path_or_hf_repo=model, language=None)
    ├─ 4. Convert segments → WEBVTT
    ├─ 5. Write work/<id>/transcript/subs/<id>.zh.asr.vtt
    ├─ 6. SQLite: UPDATE steps SET status='completed', error=NULL WHERE task_id=<id> AND step='subs'
    └─ 7. POST /api/tasks/<id>/steps/vtt2md/run  (Bearer token)
```

## VTT Output Format

Standard WEBVTT with one cue per whisper segment:

```
WEBVTT

00:00:04.480 --> 00:00:07.349
有時候語言模型不是不夠聰明

00:00:07.349 --> 00:00:12.000
只是沒有人類好好引導
```

Filename: `<id>.zh.asr.vtt`

- Language code `zh` → `vtt2md` produces `original_zh.md`, downstream uses it as transcript
- Type `asr` is novel but harmless — `vtt2md` only globs `*.vtt`

## Parameters

| Arg | Default | Notes |
|-----|---------|-------|
| `task_id` | required | 12-char task ID |
| `--token` | `dev-token-local` | HTTP Bearer token |
| `--model` | `mlx-community/whisper-large-v3` | mlx_whisper HF repo |
| `--base-dir` | `./work` | Work directory root |
| `--api` | `http://127.0.0.1:3000` | HTTP service base URL |

## SQLite Update

```sql
UPDATE steps
SET status = 'completed', error = NULL, completed_at = <now_iso>
WHERE task_id = '<id>' AND step_name = 'subs';
```

Uses Python `sqlite3` stdlib — no extra dependencies.

## Error Handling

- Missing `video.mp4` → exit with clear message, no SQLite/API side-effects
- ffmpeg failure → exit, no side-effects
- mlx_whisper failure → exit, no side-effects
- Zero segments transcribed → exit with warning, no side-effects
- SQLite update fails → exit before calling API
- HTTP API call fails → print error, exit non-zero (SQLite already updated; user can manually re-trigger)

## Temporary Files

`/tmp/<id>_asr.wav` — deleted on success and on error (via `finally` block).

## Not In Scope

- Integration into the orchestrator as a real step
- Language auto-detection written back to meta.json
- GUI trigger for ASR
- Whisper model caching / download progress UI
