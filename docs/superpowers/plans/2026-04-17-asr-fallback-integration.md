# ASR Fallback Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate mlx_whisper ASR as an automatic pipeline fallback when YouTube subtitles are unavailable, inserting an `asr` step with OR-predecessor logic so `vtt2md` can be reached via either `subs` or `asr`.

**Architecture:** Add `asr` to the DAG as a SECONDARY_CHAIN fallback step triggered when `subs=failed` and media is available. `vtt2md` gains OR-predecessor logic: ready when `subs=completed` OR `asr=completed`. Task failure is redefined so that `subs` failure alone does not fail the task — only `subs=failed AND asr=failed` fails the task.

**Tech Stack:** Node.js (orchestrator/schedule), Bash (shell script), Python 3 + mlx_whisper + ffmpeg (ASR transcription).

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `core/orchestrator/schedule.js` | Modify | Add `asr` to DAG, exclusion rules, OR predecessor for `vtt2md` |
| `core/orchestrator/index.js` | Modify | Register `asr` step, update failure check logic |
| `scripts/asr_transcribe.sh` | Create | Shell wrapper: validates media, calls Python, emits STATUS markers |
| `scripts/asr_transcribe.py` | Create | Core ASR: finds media file, extracts audio, transcribes, writes VTT |
| `tests/orchestrator-schedule.test.js` | Modify | Add `asr` to baseSteps, new exclusion + OR predecessor tests |
| `tests/test_asr_transcribe.py` | Create | Unit tests: media detection, timestamp formatting, VTT generation |

---

## Task 1: schedule.js — Add `asr` step, DAG edges, and exclusion rules

**Files:**
- Modify: `core/orchestrator/schedule.js`
- Modify: `tests/orchestrator-schedule.test.js`

- [ ] **Step 1: Add `asr` to `baseSteps()` in the test file**

In `tests/orchestrator-schedule.test.js`, update `baseSteps()`:

```javascript
function baseSteps() {
  return {
    fetch: pending(),
    video: pending(),
    audio: pending(),
    subs: pending(),
    asr: pending(),
    vtt2md: pending(),
    md2vtt: pending(),
    article: pending(),
    summary: pending()
  };
}
```

- [ ] **Step 2: Write failing tests for `asr` exclusion rules**

Add these test blocks inside `run()` in `tests/orchestrator-schedule.test.js`, after the existing `excludedByMode` tests:

```javascript
// excludedByMode: asr — excluded when subs not failed
{
  const subsNotFailed = { subs: { status: 'pending' }, video: { status: 'completed' } };
  assert.ok(excludedByMode('media', subsNotFailed).has('asr'), 'asr excluded when subs not failed');
}

// excludedByMode: asr — excluded in transcript mode even if subs failed
{
  const subsFailed = { subs: { status: 'failed' }, video: { status: 'completed' } };
  assert.ok(excludedByMode('transcript', subsFailed).has('asr'), 'asr excluded in transcript mode');
}

// excludedByMode: asr — excluded in media mode when video not yet completed
{
  const subsFailed = { subs: { status: 'failed' }, video: { status: 'pending' } };
  assert.ok(excludedByMode('media', subsFailed).has('asr'), 'asr excluded when video pending');
}

// excludedByMode: asr — NOT excluded in media mode when subs failed and video completed
{
  const subsFailed = { subs: { status: 'failed' }, video: { status: 'completed' } };
  assert.ok(!excludedByMode('media', subsFailed).has('asr'), 'asr allowed when subs failed + video completed');
}

// excludedByMode: asr — NOT excluded in media mode when video failed but audio completed
{
  const steps = { subs: { status: 'failed' }, video: { status: 'failed' }, audio: { status: 'completed' } };
  assert.ok(!excludedByMode('media', steps).has('asr'), 'asr allowed when video failed + audio completed');
}

// excludedByMode: asr — excluded in audio mode when audio not yet completed
{
  const steps = { subs: { status: 'failed' }, audio: { status: 'pending' } };
  assert.ok(excludedByMode('audio', steps).has('asr'), 'asr excluded in audio mode when audio pending');
}

// excludedByMode: asr — NOT excluded in audio mode when subs failed and audio completed
{
  const steps = { subs: { status: 'failed' }, audio: { status: 'completed' } };
  assert.ok(!excludedByMode('audio', steps).has('asr'), 'asr allowed in audio mode when audio completed');
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: FAIL (asr property not recognized by excludedByMode).

- [ ] **Step 4: Update `ALL_STEPS` in `schedule.js`**

In `core/orchestrator/schedule.js`, change `ALL_STEPS`:

```javascript
const ALL_STEPS = [
  'fetch',
  'video',
  'audio',
  'subs',
  'asr',
  'vtt2md',
  'md2vtt',
  'article',
  'summary'
];
```

- [ ] **Step 5: Add `asr` DAG edges to `STEP_EDGES`**

In `core/orchestrator/schedule.js`, add two new edges to `STEP_EDGES`:

```javascript
const STEP_EDGES = [
  ['fetch', 'video'],
  ['fetch', 'audio'],
  ['fetch', 'subs'],
  ['fetch', 'asr'],      // NEW: asr depends on fetch
  ['subs', 'vtt2md'],
  ['asr', 'vtt2md'],     // NEW: asr completion enables vtt2md
  ['vtt2md', 'md2vtt'],
  ['vtt2md', 'article'],
  ['article', 'summary']
];
```

- [ ] **Step 6: Add `asr` to `SECONDARY_CHAIN_BASE`**

```javascript
const SECONDARY_CHAIN_BASE = ['video', 'audio', 'asr', 'md2vtt'];
```

- [ ] **Step 7: Add `asr` exclusion rules to `excludedByMode`**

In the `excludedByMode` function, add `asr` rules. Insert after the `if (m === 'audio')` block:

```javascript
function excludedByMode(mode, steps) {
  const m = normalizeMode(mode);
  const ex = new Set();
  if (m === 'media') {
    const videoFailed = steps && steps.video && steps.video.status === 'failed';
    if (!videoFailed) ex.add('audio');
  }
  if (m === 'audio') {
    ex.add('video');
  }
  if (m === 'transcript') {
    ex.add('video');
    ex.add('audio');
  }

  // asr: fallback step — only runs when subs failed AND media is available
  const subsFailed = steps && steps.subs && steps.subs.status === 'failed';
  if (!subsFailed || m === 'transcript') {
    ex.add('asr');
  } else if (m === 'audio') {
    const audioOk = steps && steps.audio && steps.audio.status === 'completed';
    if (!audioOk) ex.add('asr');
  } else {
    // media and full: need video.mp4 or audio.m4a (audio fallback in media mode)
    const videoOk = steps && steps.video && steps.video.status === 'completed';
    const audioOk = steps && steps.audio && steps.audio.status === 'completed';
    if (!videoOk && !audioOk) ex.add('asr');
  }

  return ex;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(schedule): add asr step to DAG with exclusion rules"
```

---

## Task 2: schedule.js — OR predecessor for `vtt2md`

**Files:**
- Modify: `core/orchestrator/schedule.js`
- Modify: `tests/orchestrator-schedule.test.js`

- [ ] **Step 1: Write failing tests for `vtt2md` OR predecessor logic**

Add inside `run()` in `tests/orchestrator-schedule.test.js`:

```javascript
// vtt2md OR: subs=completed → vtt2md ready (asr stays pending/excluded)
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('vtt2md'), 'vtt2md ready when subs=completed');
}

// vtt2md OR: subs=failed + asr=completed → vtt2md ready
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = failed();
  steps.asr = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('vtt2md'), 'vtt2md ready when asr=completed');
}

// vtt2md OR: subs=failed + asr=failed → vtt2md NOT ready
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = failed();
  steps.asr = failed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(!ready.has('vtt2md'), 'vtt2md not ready when both subs and asr failed');
}

// asr scheduled after subs=failed + video=completed (media mode)
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = failed();
  steps.video = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('asr'), 'asr ready when subs=failed + video=completed');
  assert.ok(!ready.has('vtt2md'), 'vtt2md not ready until asr completes');
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: FAIL (vtt2md still uses AND logic).

- [ ] **Step 3: Replace the vtt2md predecessor check with OR logic in `computeReadySteps`**

In `core/orchestrator/schedule.js`, modify `computeReadySteps`:

```javascript
function computeReadySteps(task) {
  const mode = normalizeMode((task.params && task.params.mode) || 'media');
  const excluded = excludedByMode(mode, task.steps);
  const ready = new Set();

  for (const name of ALL_STEPS) {
    if (excluded.has(name)) continue;
    const step = task.steps && task.steps[name];
    if (!step || step.status !== 'pending') continue;

    let ok;
    if (name === 'vtt2md') {
      // OR predecessor: subs completed OR asr completed
      const subsOk = predecessorSatisfied(task, 'subs');
      const asrOk = predecessorSatisfied(task, 'asr');
      ok = subsOk || asrOk;
    } else {
      ok = true;
      const preds = PREDECESSORS[name] || [];
      for (const p of preds) {
        if (!predecessorSatisfied(task, p)) {
          ok = false;
          break;
        }
      }
    }

    if (ok) ready.add(name);
  }

  return ready;
}
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: PASS — all old tests still pass, all new tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(schedule): OR predecessor for vtt2md — asr or subs"
```

---

## Task 3: `scripts/asr_transcribe.py` + unit tests

**Files:**
- Create: `scripts/asr_transcribe.py`
- Create: `tests/test_asr_transcribe.py`

- [ ] **Step 1: Write failing unit tests**

Create `tests/test_asr_transcribe.py`:

```python
#!/usr/bin/env python3
"""Unit tests for scripts/asr_transcribe.py"""
import os
import sys
import sqlite3
import tempfile
import unittest

# Add scripts/ to path so we can import asr_transcribe
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from asr_transcribe import format_timestamp, segments_to_vtt, find_media_file


class TestFormatTimestamp(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(format_timestamp(0.0), "00:00:00.000")

    def test_seconds(self):
        self.assertEqual(format_timestamp(5.5), "00:00:05.500")

    def test_minutes(self):
        self.assertEqual(format_timestamp(90.0), "00:01:30.000")

    def test_hours(self):
        self.assertEqual(format_timestamp(3661.0), "01:01:01.000")

    def test_negative_clamped_to_zero(self):
        self.assertEqual(format_timestamp(-0.5), "00:00:00.000")


class TestSegmentsToVtt(unittest.TestCase):
    def test_empty(self):
        result = segments_to_vtt([])
        self.assertEqual(result, "WEBVTT\n")

    def test_single_segment(self):
        segs = [{"start": 1.0, "end": 3.0, "text": " hello "}]
        result = segments_to_vtt(segs)
        self.assertIn("WEBVTT", result)
        self.assertIn("00:00:01.000 --> 00:00:03.000", result)
        self.assertIn("hello", result)
        self.assertNotIn(" hello ", result)   # text is stripped
        self.assertTrue(result.endswith("\n"))

    def test_multiple_segments(self):
        segs = [
            {"start": 0.0, "end": 2.0, "text": "first"},
            {"start": 2.0, "end": 4.0, "text": "second"},
        ]
        result = segments_to_vtt(segs)
        self.assertIn("first", result)
        self.assertIn("second", result)


class TestFindMediaFile(unittest.TestCase):
    def test_no_media_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = os.path.join(tmp, "media")
            os.makedirs(media_dir)
            with self.assertRaises(FileNotFoundError):
                find_media_file(tmp)

    def test_video_preferred(self):
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = os.path.join(tmp, "media")
            os.makedirs(media_dir)
            video = os.path.join(media_dir, "video.mp4")
            audio = os.path.join(media_dir, "audio.m4a")
            open(video, "w").close()
            open(audio, "w").close()
            self.assertEqual(find_media_file(tmp), video)

    def test_audio_fallback_when_no_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = os.path.join(tmp, "media")
            os.makedirs(media_dir)
            audio = os.path.join(media_dir, "audio.m4a")
            open(audio, "w").close()
            self.assertEqual(find_media_file(tmp), audio)


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 tests/test_asr_transcribe.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'asr_transcribe'`.

- [ ] **Step 3: Create `scripts/asr_transcribe.py`**

Create `scripts/asr_transcribe.py`:

```python
#!/usr/bin/env python3
"""
scripts/asr_transcribe.py

ASR transcription using mlx_whisper. Finds video.mp4 or audio.m4a,
extracts audio, transcribes, writes VTT to subs directory.

Usage:
    python3 scripts/asr_transcribe.py <task_id> <work_dir> [--model MODEL]
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


def format_timestamp(seconds: float) -> str:
    """Convert float seconds to WebVTT timestamp HH:MM:SS.mmm."""
    ms = round(max(seconds, 0.0) * 1000)
    h = ms // 3_600_000
    ms %= 3_600_000
    m = ms // 60_000
    ms %= 60_000
    s = ms // 1_000
    ms %= 1_000
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def segments_to_vtt(segments: list) -> str:
    """Convert mlx_whisper segment dicts to a WEBVTT string."""
    lines = ["WEBVTT"]
    for seg in segments:
        start = format_timestamp(seg["start"])
        end = format_timestamp(seg["end"])
        text = seg["text"].strip()
        lines.append("")
        lines.append(f"{start} --> {end}")
        lines.append(text)
    return "\n".join(lines) + "\n"


def find_media_file(work_dir: str) -> str:
    """Return path to video.mp4 (preferred) or audio.m4a. Raises FileNotFoundError if neither exists."""
    video = os.path.join(work_dir, "media", "video.mp4")
    audio = os.path.join(work_dir, "media", "audio.m4a")
    if os.path.exists(video):
        return video
    if os.path.exists(audio):
        return audio
    raise FileNotFoundError(
        f"No media file found in {work_dir}/media/ — expected video.mp4 or audio.m4a"
    )


def extract_audio(media_path: str, wav_path: str) -> None:
    """Extract mono 16kHz WAV from a media file using ffmpeg."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH")
    cmd = ["ffmpeg", "-y", "-i", media_path, "-ac", "1", "-ar", "16000", "-vn", wav_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe media with mlx_whisper, write VTT.")
    parser.add_argument("task_id", help="12-character task ID")
    parser.add_argument("work_dir", help="Path to work/<task_id>/")
    parser.add_argument(
        "--model",
        default="mlx-community/whisper-large-v3-turbo",
        help="mlx_whisper HF repo or local path",
    )
    args = parser.parse_args()

    task_id = args.task_id
    work_dir = args.work_dir
    subs_dir = os.path.join(work_dir, "transcript", "subs")
    vtt_path = os.path.join(subs_dir, f"{task_id}.zh.asr.vtt")

    # Validate preconditions
    media_path = find_media_file(work_dir)  # raises FileNotFoundError if missing
    os.makedirs(subs_dir, exist_ok=True)

    # Extract audio to temp WAV
    wav_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", prefix=f"{task_id}_asr_", delete=False) as f:
            wav_path = f.name

        print(f"[1/3] Extracting audio from {media_path} …", flush=True)
        extract_audio(media_path, wav_path)

        print(f"[2/3] Transcribing with {args.model} …", flush=True)
        import mlx_whisper
        result = mlx_whisper.transcribe(wav_path, path_or_hf_repo=args.model, verbose=False)

        segments = result.get("segments", [])
        if not segments:
            print("ERROR: Whisper returned zero segments.", file=sys.stderr)
            sys.exit(1)

        print(f"      {len(segments)} segments transcribed.", flush=True)

        print(f"[3/3] Writing VTT to {vtt_path} …", flush=True)
        with open(vtt_path, "w", encoding="utf-8") as f:
            f.write(segments_to_vtt(segments))

        print("Done.", flush=True)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 tests/test_asr_transcribe.py
```

Expected: PASS (all 9 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/asr_transcribe.py tests/test_asr_transcribe.py
git commit -m "feat(asr): add asr_transcribe.py with unit tests"
```

---

## Task 4: `scripts/asr_transcribe.sh`

**Files:**
- Create: `scripts/asr_transcribe.sh`

- [ ] **Step 1: Create the shell wrapper**

Create `scripts/asr_transcribe.sh`:

```bash
#!/bin/bash
#
# ASR fallback transcription step
# Usage: bash scripts/asr_transcribe.sh "URL" "DIR" "ID"
#
# Transcribes video.mp4 or audio.m4a using mlx_whisper and writes a VTT file
# to DIR/transcript/subs/ID.zh.asr.vtt
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

URL="${1:-}"
DIR="${2:-}"
ID="${3:-}"

if [ -z "$DIR" ] || [ -z "$ID" ]; then
    echo "Usage: $0 <URL> <DIR> <ID>"
    exit 1
fi

source "$SCRIPT_DIR/db.sh"

echo "[STATUS] asr_start"
update_step "$ID" "asr" "running"

ASR_MODEL="${ASR_MODEL:-mlx-community/whisper-large-v3-turbo}"

if python3 "$SCRIPT_DIR/asr_transcribe.py" "$ID" "$DIR" --model "$ASR_MODEL"; then
    update_step "$ID" "asr" "completed"
    echo "[STATUS] asr_done"
    exit 0
else
    update_step "$ID" "asr" "failed" "ASR transcription failed"
    echo "[STATUS] asr_error"
    exit 1
fi
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/asr_transcribe.sh
```

- [ ] **Step 3: Smoke-test the failure path (no media file)**

In a terminal, create a temp task directory with no media file and run:

```bash
mkdir -p /tmp/asr_test/media
bash scripts/asr_transcribe.sh "" /tmp/asr_test test123 2>&1 || true
```

Expected output contains:
```
[STATUS] asr_start
ERROR: No media file found in /tmp/asr_test/media/
[STATUS] asr_error
```

Then clean up:
```bash
rm -rf /tmp/asr_test
```

- [ ] **Step 4: Commit**

```bash
git add scripts/asr_transcribe.sh
git commit -m "feat(asr): add asr_transcribe.sh shell wrapper"
```

---

## Task 5: `index.js` — Wire up `asr` step and update failure logic

**Files:**
- Modify: `core/orchestrator/index.js`

- [ ] **Step 1: Add `asr` to `STEPS` and `STEP_SCRIPTS`**

In `core/orchestrator/index.js`, update both constants:

```javascript
// Steps whose failure marks the overall task as failed (media steps are non-blocking).
const CONTENT_STEPS = new Set(['fetch', 'subs', 'asr', 'vtt2md', 'md2vtt', 'article', 'summary']);

// Step definitions (aligned with scripts/*)
const STEPS = ['fetch', 'video', 'audio', 'subs', 'asr', 'vtt2md', 'md2vtt', 'article', 'summary'];

const STEP_SCRIPTS = {
  fetch: 'fetch_info.sh',
  video: 'download_video.sh',
  audio: 'download_audio.sh',
  subs: 'download_subs.sh',
  asr: 'asr_transcribe.sh',
  vtt2md: 'convert_vtt_md.sh',
  md2vtt: 'convert_md_vtt.sh',
  article: 'generate_article.sh',
  summary: 'generate_summary.sh'
};
```

- [ ] **Step 2: Add `asr` case to the `runStep` switch statement**

In `core/orchestrator/index.js`, inside the `switch (stepName)` block, add after `case 'subs'`:

```javascript
case 'asr':
  args = [url, dir, id];
  break;
```

- [ ] **Step 3: Update the failure check in `runTask` to implement subs+asr joint failure**

In `core/orchestrator/index.js`, find the block after the guard loop in `runTask`:

```javascript
// Mark overall task status: only content step failures count as task failure.
const contentStepFailed = Object.entries(task.steps || {}).some(
  ([name, s]) => CONTENT_STEPS.has(name) && s.status === 'failed'
);
task.status = contentStepFailed ? 'failed' : 'completed';
```

Replace it with:

```javascript
// Mark overall task status.
// subs failure alone does not fail the task — only subs+asr both failed does.
const contentStepFailed = Object.entries(task.steps || {}).some(([name, s]) => {
  if (!CONTENT_STEPS.has(name) || s.status !== 'failed') return false;
  if (name === 'subs') {
    // subs failure is recoverable if asr completed
    return (task.steps.asr && task.steps.asr.status) !== 'completed';
  }
  return true;
});
task.status = contentStepFailed ? 'failed' : 'completed';
```

- [ ] **Step 4: Update `contentDone` in `loadTaskFromDb` to handle subs=failed + asr=completed**

In `core/orchestrator/index.js`, find:

```javascript
const contentDone = ['fetch', 'subs', 'vtt2md', 'article', 'summary'].every(
  (n) => steps[n]?.status === 'completed' || steps[n]?.status === 'skipped'
);
```

Replace with:

```javascript
const subsOrAsrDone =
  steps.subs?.status === 'completed' || steps.subs?.status === 'skipped' ||
  steps.asr?.status === 'completed';
const contentDone =
  ['fetch', 'vtt2md', 'article', 'summary'].every(
    (n) => steps[n]?.status === 'completed' || steps[n]?.status === 'skipped'
  ) && subsOrAsrDone;
```

- [ ] **Step 5: Run existing tests to verify nothing is broken**

```bash
node tests/orchestrator-schedule.test.js
npm run test:agent:core
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): wire asr step, update failure and completion logic"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Covered by |
|-----------------|-----------|
| `asr` added to DAG with `fetch → asr` and `asr → vtt2md` edges | Task 1 step 5 |
| `asr` in SECONDARY_CHAIN (not PRIMARY_CHAIN) | Task 1 step 6 |
| `asr` excluded unless subs=failed + media ready | Task 1 step 7 |
| transcript mode excludes asr | Task 1 step 7 |
| media/full mode: asr waits for video or audio | Task 1 step 7 |
| audio mode: asr waits for audio | Task 1 step 7 |
| `vtt2md` OR predecessor (subs OR asr) | Task 2 step 3 |
| `subs + asr` joint failure → task failed | Task 5 step 3 |
| `subs=failed + asr=completed` → task succeeded | Task 5 step 4 |
| `download_subs.sh` unchanged | Not in plan (correct — no changes needed) |
| `scripts/asr_transcribe.sh` created | Task 4 |
| `scripts/asr_transcribe.py` created | Task 3 |
| `experiments/whisper_asr.py` unchanged | Not in plan (correct) |

### Placeholder scan — none found.

### Type/name consistency check
- `format_timestamp` and `segments_to_vtt` defined in Task 3 step 3, tested in Task 3 step 1. ✓
- `find_media_file` defined in Task 3 step 3, tested in Task 3 step 1. ✓
- `asr_transcribe.sh` script interface `(url, dir, id)` matches `runStep` `args = [url, dir, id]` in Task 5 step 2. ✓
- `CONTENT_STEPS` updated before `runTask` failure check uses it (same file). ✓
- `task.steps.asr` accessed in failure check — `asr` is in `STEPS` so `initSteps()` initialises it automatically. ✓
