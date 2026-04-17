# ASR Fallback Integration Design

**Date:** 2026-04-17
**Scope:** Integrate mlx_whisper ASR as an automatic fallback when YouTube subtitles are unavailable.

## Context

The pipeline's `subs` step fails when a video has no YouTube-provided subtitles. This blocks `vtt2md → article → summary`. The existing `experiments/whisper_asr.py` provides ASR transcription as a manual workaround. This design integrates ASR as an automatic fallback step in the pipeline.

## Design Principles

**ASR is a fallback, not part of the main chain.** `vtt2md` can be reached via two paths — YouTube subtitles (`subs`) or ASR transcription (`asr`). The node `vtt2md` has an OR predecessor: `subs=completed` OR `asr=completed`.

**Task failure is path-exhaustion, not step-failure.** `subs` failing alone does not fail the task. The task fails only when all paths to the terminal node are exhausted: both `subs=failed` and `asr=failed`.

> **TODO (future):** Replace the simplified failure check with full DAG reachability analysis — task fails when the terminal node (`summary`) is provably unreachable from the current step states.

**`download_subs.sh` is unchanged.** `subs` fails when there are no YouTube subtitles; this is semantically correct. The scheduler finds the alternative path.

## New DAG

```
fetch ──► subs ──────────────────► vtt2md ──► article ──► summary
  │                                   ▲
  ├──► video ──┐                      │
  │            ├──► asr (fallback) ───┘
  └──► audio ──┘
```

`vtt2md` predecessor logic: **OR** (`subs=completed`, `asr=completed`).

All other edges remain AND (current behaviour).

## `asr` Step

### Scheduling (dynamic exclusion in `excludedByMode`)

`asr` is excluded unless all of the following hold:

| Condition | Rule |
|-----------|------|
| `subs` ≠ `failed` | Exclude — YouTube subs succeeded, ASR not needed |
| mode = `transcript` | Exclude — no media file available |
| mode = `media`/`full`, `video` not `completed` | Exclude — wait for `video.mp4` |
| mode = `audio`, `audio` not `completed` | Exclude — wait for `audio.m4a` |

`asr` is placed in `SECONDARY_CHAIN` after `video`/`audio`, not in `PRIMARY_CHAIN`.

### Media source

The `asr_transcribe.sh` script resolves its input in order:

1. `work/<id>/media/video.mp4` — preferred
2. `work/<id>/media/audio.m4a` — fallback (audio mode, or video download failed)
3. Neither exists → exit 1

This handles `mode=media` (video.mp4), `mode=audio` (audio.m4a), and `mode=full` where `video` failed but `audio` completed.

### Output

Writes `work/<id>/transcript/subs/<id>.zh.asr.vtt` — identical format to YouTube VTT files. `vtt2md` reads all `*.vtt` files in the subs directory and picks this up automatically.

### Special case: `video=failed`, mode=media

`audio` fallback activates (`video` failed → `audio` scheduled → `audio=completed`). Since `audio=completed` satisfies the `asr` exclusion condition for audio, `asr` then activates and uses `audio.m4a`. No special handling required.

## Failure Handling

| Scenario | Outcome |
|----------|---------|
| No YouTube subs, mode=transcript | `subs=failed`, `asr` excluded → task failed (no path) |
| No YouTube subs, mode=media/audio/full, `asr` succeeds | `asr=completed` → `vtt2md` runs |
| No YouTube subs, `asr` fails (e.g. mlx_whisper not installed) | `asr=failed` → task failed |
| No YouTube subs, `asr` returns 0 segments | `asr=failed` → task failed |
| Has YouTube subs | `subs=completed` → `asr` never scheduled → existing behaviour unchanged |

**Simplified failure check (interim):** `subs=failed AND asr=failed` → task failed. Full reachability is a future TODO.

## File Changes

### Modified

| File | Change |
|------|--------|
| `core/orchestrator/schedule.js` | Add `asr` to `ALL_STEPS`, `SECONDARY_CHAIN_BASE`; add `['fetch', 'asr']`, `['asr', 'vtt2md']` edges; add `asr` exclusion rules to `excludedByMode`; change `vtt2md` predecessor logic to OR in `computeReadySteps` |
| `core/orchestrator/index.js` | Add `asr` to `STEPS` and `STEP_SCRIPTS`; add `asr` case in `runStep`; modify task failure check: `subs=failed AND asr=failed` |
| `tests/orchestrator-schedule.test.js` | Add test cases for OR predecessor logic and `asr` exclusion rules |

### Created

| File | Purpose |
|------|---------|
| `scripts/asr_transcribe.sh` | Shell wrapper; resolves media file, emits `[STATUS]` markers, calls `asr_transcribe.py` |
| `scripts/asr_transcribe.py` | Core ASR logic extracted from `experiments/whisper_asr.py`; args: `<task_id> <work_dir> [--model MODEL]` |

### Unchanged

- `scripts/download_subs.sh`
- `experiments/whisper_asr.py`
- All HTTP routes and GUI code

## `asr_transcribe.sh` Interface

```bash
bash scripts/asr_transcribe.sh "<url>" "<work_dir>" "<task_id>"
```

Emits:
- `[STATUS] asr_start`
- `[STATUS] asr_done` on success
- `[STATUS] asr_error` on failure

Calls `update_step "$ID" "asr" "running/completed/failed"` via `db.sh`.

## `asr_transcribe.py` Interface

```
python3 scripts/asr_transcribe.py <task_id> <work_dir> [--model <hf_repo>]
```

| Arg | Default |
|-----|---------|
| `task_id` | required |
| `work_dir` | required |
| `--model` | `mlx-community/whisper-large-v3-turbo` |

Exits 0 on success (VTT written). Exits non-zero with message on any failure. Does not update SQLite (handled by orchestrator via `db.sh`).

## `schedule.js` Changes Detail

```javascript
// ALL_STEPS: add 'asr'
const ALL_STEPS = ['fetch', 'video', 'audio', 'subs', 'asr', 'vtt2md', 'md2vtt', 'article', 'summary'];

// STEP_EDGES: add asr edges
['fetch', 'asr'],
['asr', 'vtt2md'],
// keep ['subs', 'vtt2md'] — used by OR check in computeReadySteps

// SECONDARY_CHAIN_BASE: add 'asr' after video/audio
const SECONDARY_CHAIN_BASE = ['video', 'audio', 'asr', 'md2vtt'];

// excludedByMode: asr rules
const subsNotFailed = !(steps?.subs?.status === 'failed');
if (subsNotFailed || m === 'transcript') {
  ex.add('asr');
} else if (m === 'media' || m === 'full') {
  if (steps?.video?.status !== 'completed') ex.add('asr');
} else if (m === 'audio') {
  if (steps?.audio?.status !== 'completed') ex.add('asr');
}

// computeReadySteps: OR logic for vtt2md
if (name === 'vtt2md') {
  const subsOk = predecessorSatisfied(task, 'subs');
  const asrOk = predecessorSatisfied(task, 'asr');
  if (!subsOk && !asrOk) ok = false;
  else ok = true;
}
```

## Tests

### `orchestrator-schedule.test.js`

- `computeReadySteps`: subs=completed → vtt2md ready (asr pending/excluded)
- `computeReadySteps`: asr=completed → vtt2md ready (subs failed)
- `computeReadySteps`: subs=failed, asr=pending → vtt2md not ready
- `excludedByMode`: subs=failed + video=completed + mode=media → asr NOT excluded
- `excludedByMode`: subs=failed + video=pending + mode=media → asr excluded
- `excludedByMode`: subs=failed + mode=transcript → asr excluded
- `excludedByMode`: subs=completed → asr excluded

### `asr_transcribe.py` (extend `experiments/test_whisper_asr.py`)

- Missing video.mp4 and audio.m4a → exit non-zero
- video.mp4 present → used as input
- audio.m4a present, video.mp4 absent → used as input

## Not In Scope

- GUI trigger or status display for `asr` step
- Language auto-detection written back to `meta.json`
- Whisper model configuration per task (uses global default)
- Full DAG reachability-based failure detection (future TODO)
- Changes to `experiments/whisper_asr.py`
