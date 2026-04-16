# Whisper ASR Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `experiments/whisper_asr.py` — a standalone script that transcribes a video with no YouTube subtitles using mlx_whisper, writes a compatible VTT file to the pipeline's `subs/` directory, updates the SQLite step status, and auto-triggers the downstream `vtt2md` step via HTTP API.

**Architecture:** Single Python script in `experiments/`. Pure functions for timestamp formatting and VTT generation (tested in isolation). Side-effect functions (ffmpeg, whisper, SQLite, HTTP) wired together in `main()`. No changes to any existing pipeline file.

**Tech Stack:** Python 3 stdlib (`sqlite3`, `subprocess`, `argparse`, `urllib.request`), `mlx_whisper` (already installed at `mlx-whisper 0.4.3`), `ffmpeg` (system).

---

### Task 1: VTT formatting — pure functions + tests

**Files:**
- Create: `experiments/whisper_asr.py`
- Create: `experiments/test_whisper_asr.py`

- [ ] **Step 1: Create `experiments/` directory and stub script**

```bash
mkdir -p /Users/harveyzhang96/Projects/Video-Learner/experiments
touch /Users/harveyzhang96/Projects/Video-Learner/experiments/whisper_asr.py
touch /Users/harveyzhang96/Projects/Video-Learner/experiments/test_whisper_asr.py
```

- [ ] **Step 2: Write the failing tests for `format_timestamp` and `segments_to_vtt`**

Write to `experiments/test_whisper_asr.py`:

```python
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from whisper_asr import format_timestamp, segments_to_vtt


def test_format_timestamp_seconds():
    assert format_timestamp(4.48) == "00:00:04.480"


def test_format_timestamp_minutes():
    assert format_timestamp(90.5) == "00:01:30.500"


def test_format_timestamp_hours():
    assert format_timestamp(3661.001) == "01:01:01.001"


def test_segments_to_vtt_header():
    result = segments_to_vtt([])
    assert result.strip() == "WEBVTT"


def test_segments_to_vtt_single():
    segs = [{"start": 4.48, "end": 7.349, "text": " 有時候語言模型"}]
    result = segments_to_vtt(segs)
    assert "WEBVTT" in result
    assert "00:00:04.480 --> 00:00:07.349" in result
    assert "有時候語言模型" in result


def test_segments_to_vtt_strips_leading_space():
    segs = [{"start": 0.0, "end": 1.0, "text": "  hello world"}]
    result = segments_to_vtt(segs)
    assert "hello world" in result
    assert result.count("  hello") == 0


def test_segments_to_vtt_multiple():
    segs = [
        {"start": 0.0, "end": 2.0, "text": " first"},
        {"start": 2.0, "end": 4.0, "text": " second"},
    ]
    result = segments_to_vtt(segs)
    lines = result.strip().splitlines()
    assert lines[0] == "WEBVTT"
    assert "00:00:00.000 --> 00:00:02.000" in result
    assert "00:00:02.000 --> 00:00:04.000" in result


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
```

- [ ] **Step 3: Run tests — expect ImportError (module empty)**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected output contains: `ImportError` or `cannot import name 'format_timestamp'`

- [ ] **Step 4: Implement `format_timestamp` and `segments_to_vtt` in `experiments/whisper_asr.py`**

Write to `experiments/whisper_asr.py`:

```python
#!/usr/bin/env python3
"""
experiments/whisper_asr.py

Standalone experiment: transcribe a video with no YouTube subtitles using
mlx_whisper, write a VTT file to the pipeline's subs/ directory, update the
SQLite step status, and trigger the downstream vtt2md step via HTTP API.

Usage:
    python3 experiments/whisper_asr.py <task_id> [--token TOKEN] [--model MODEL]
                                                   [--base-dir DIR] [--api URL]
"""

import argparse
import os
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error
import json
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def format_timestamp(seconds: float) -> str:
    """Convert float seconds to WebVTT timestamp HH:MM:SS.mmm."""
    ms = round(seconds * 1000)
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
    return "\n".join(lines)
```

- [ ] **Step 5: Run tests — expect all PASS**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `7 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
git add experiments/whisper_asr.py experiments/test_whisper_asr.py
git commit -m "feat(experiments): add whisper_asr pure helpers + tests"
```

---

### Task 2: Audio extraction via ffmpeg

**Files:**
- Modify: `experiments/whisper_asr.py` (add `extract_audio`)
- Modify: `experiments/test_whisper_asr.py` (add smoke test)

- [ ] **Step 1: Write the failing test for `extract_audio`**

Append to `experiments/test_whisper_asr.py`:

```python
def test_extract_audio_missing_input():
    """Should raise FileNotFoundError when source video does not exist."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "out.wav")
        try:
            from whisper_asr import extract_audio
            extract_audio("/nonexistent/video.mp4", wav)
            assert False, "Expected FileNotFoundError"
        except FileNotFoundError:
            pass  # expected
```

- [ ] **Step 2: Run test — expect ImportError or AttributeError**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `FAIL  test_extract_audio_missing_input` (function not yet defined)

- [ ] **Step 3: Implement `extract_audio` in `experiments/whisper_asr.py`**

Append to `experiments/whisper_asr.py` (after `segments_to_vtt`):

```python
# ---------------------------------------------------------------------------
# Side-effect helpers
# ---------------------------------------------------------------------------

def extract_audio(video_path: str, wav_path: str) -> None:
    """Extract mono 16kHz WAV from video using ffmpeg.

    Raises FileNotFoundError if video_path does not exist.
    Raises RuntimeError if ffmpeg fails.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ac", "1",          # mono
        "-ar", "16000",      # 16 kHz — Whisper standard
        "-vn",               # no video
        wav_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")
```

- [ ] **Step 4: Run all tests — expect all PASS**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `8 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
git add experiments/whisper_asr.py experiments/test_whisper_asr.py
git commit -m "feat(experiments): add extract_audio with ffmpeg"
```

---

### Task 3: SQLite step update

**Files:**
- Modify: `experiments/whisper_asr.py` (add `mark_subs_completed`)
- Modify: `experiments/test_whisper_asr.py` (add in-memory SQLite test)

- [ ] **Step 1: Write the failing test**

Append to `experiments/test_whisper_asr.py`:

```python
def test_mark_subs_completed():
    import sqlite3, tempfile
    from whisper_asr import mark_subs_completed

    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        db_path = f.name

    try:
        con = sqlite3.connect(db_path)
        con.execute("""
            CREATE TABLE steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                step_name TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                error TEXT,
                started_at TEXT,
                completed_at TEXT
            )
        """)
        con.execute(
            "INSERT INTO steps (task_id, step_name, status, error) VALUES (?,?,?,?)",
            ("abc123", "subs", "failed", "No subtitles downloaded"),
        )
        con.commit()
        con.close()

        mark_subs_completed(db_path, "abc123")

        con = sqlite3.connect(db_path)
        row = con.execute(
            "SELECT status, error, completed_at FROM steps WHERE task_id=? AND step_name=?",
            ("abc123", "subs"),
        ).fetchone()
        con.close()
        assert row[0] == "completed", f"expected completed, got {row[0]}"
        assert row[1] is None, f"expected error=None, got {row[1]}"
        assert row[2] is not None, "expected completed_at to be set"
    finally:
        os.unlink(db_path)
```

- [ ] **Step 2: Run test — expect FAIL (function not defined)**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `FAIL  test_mark_subs_completed`

- [ ] **Step 3: Implement `mark_subs_completed` in `experiments/whisper_asr.py`**

Append to `experiments/whisper_asr.py`:

```python
def mark_subs_completed(db_path: str, task_id: str) -> None:
    """Update the subs step to completed in SQLite."""
    now = datetime.now(timezone.utc).isoformat()
    con = sqlite3.connect(db_path)
    try:
        con.execute(
            """UPDATE steps
               SET status = 'completed', error = NULL, completed_at = ?
               WHERE task_id = ? AND step_name = 'subs'""",
            (now, task_id),
        )
        con.commit()
    finally:
        con.close()
```

- [ ] **Step 4: Run all tests — expect all PASS**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
git add experiments/whisper_asr.py experiments/test_whisper_asr.py
git commit -m "feat(experiments): add mark_subs_completed SQLite update"
```

---

### Task 4: HTTP API trigger

**Files:**
- Modify: `experiments/whisper_asr.py` (add `trigger_vtt2md`)
- Modify: `experiments/test_whisper_asr.py` (add test)

- [ ] **Step 1: Write the failing test**

Append to `experiments/test_whisper_asr.py`:

```python
def test_trigger_vtt2md_bad_url():
    """Should raise urllib.error.URLError on unreachable host."""
    import urllib.error
    from whisper_asr import trigger_vtt2md
    try:
        trigger_vtt2md(
            api_base="http://127.0.0.1:19999",  # nothing listening
            task_id="abc123",
            token="test-token",
        )
        assert False, "Expected URLError"
    except (urllib.error.URLError, OSError):
        pass  # expected
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `FAIL  test_trigger_vtt2md_bad_url`

- [ ] **Step 3: Implement `trigger_vtt2md` in `experiments/whisper_asr.py`**

Append to `experiments/whisper_asr.py`:

```python
def trigger_vtt2md(api_base: str, task_id: str, token: str) -> None:
    """POST to /api/tasks/<id>/steps/vtt2md/run to trigger downstream pipeline.

    Raises urllib.error.URLError on network error.
    Raises RuntimeError if API returns non-2xx.
    """
    url = f"{api_base}/api/tasks/{task_id}/steps/vtt2md/run"
    payload = json.dumps({}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 300:
            body = resp.read().decode()
            raise RuntimeError(f"API returned {resp.status}: {body}")
```

- [ ] **Step 4: Run all tests — expect all PASS**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `10 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
git add experiments/whisper_asr.py experiments/test_whisper_asr.py
git commit -m "feat(experiments): add trigger_vtt2md HTTP helper"
```

---

### Task 5: `main()` — wiring + CLI entrypoint

**Files:**
- Modify: `experiments/whisper_asr.py` (add `main` and `if __name__ == "__main__"`)

No new tests (main is integration-level; tested in Task 6).

- [ ] **Step 1: Append `main()` and CLI entrypoint to `experiments/whisper_asr.py`**

```python
# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Transcribe a video with mlx_whisper and inject VTT into pipeline."
    )
    parser.add_argument("task_id", help="12-character task ID (e.g. f2e496a3de1b)")
    parser.add_argument("--token", default="dev-token-local", help="HTTP Bearer token")
    parser.add_argument(
        "--model",
        default="mlx-community/whisper-large-v3",
        help="mlx_whisper HF repo or local path",
    )
    parser.add_argument("--base-dir", default="./work", help="Work directory root")
    parser.add_argument("--api", default="http://127.0.0.1:3000", help="HTTP API base URL")
    args = parser.parse_args()

    task_id = args.task_id
    work_dir = os.path.join(args.base_dir, task_id)
    video_path = os.path.join(work_dir, "media", "video.mp4")
    subs_dir = os.path.join(work_dir, "transcript", "subs")
    vtt_path = os.path.join(subs_dir, f"{task_id}.zh.asr.vtt")

    # Resolve DB path relative to this script's project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    db_path = os.path.join(project_root, "work", "database.sqlite")

    # Validate preconditions
    if not os.path.exists(video_path):
        print(f"ERROR: video not found at {video_path}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(db_path):
        print(f"ERROR: database not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(subs_dir, exist_ok=True)

    # Step 1: extract audio to temp file
    with tempfile.NamedTemporaryFile(suffix=".wav", prefix=f"{task_id}_asr_", delete=False) as f:
        wav_path = f.name

    try:
        print(f"[1/5] Extracting audio from {video_path} …")
        extract_audio(video_path, wav_path)

        # Step 2: transcribe
        print(f"[2/5] Transcribing with {args.model} …")
        import mlx_whisper
        result = mlx_whisper.transcribe(
            wav_path,
            path_or_hf_repo=args.model,
            verbose=False,
        )

        segments = result.get("segments", [])
        if not segments:
            print("ERROR: Whisper returned zero segments — nothing to write.", file=sys.stderr)
            sys.exit(1)

        print(f"      {len(segments)} segments transcribed.")

        # Step 3: write VTT
        print(f"[3/5] Writing VTT to {vtt_path} …")
        vtt_content = segments_to_vtt(segments)
        with open(vtt_path, "w", encoding="utf-8") as f:
            f.write(vtt_content)

        # Step 4: update SQLite
        print(f"[4/5] Marking subs step as completed in SQLite …")
        mark_subs_completed(db_path, task_id)

        # Step 5: trigger vtt2md
        print(f"[5/5] Triggering vtt2md via API …")
        trigger_vtt2md(args.api, task_id, args.token)
        print("Done. vtt2md and downstream steps are now running.")

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run existing tests — still all PASS**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/test_whisper_asr.py
```

Expected: `10 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
git add experiments/whisper_asr.py
git commit -m "feat(experiments): add main() CLI entrypoint for whisper_asr"
```

---

### Task 6: End-to-end run on real video

No code changes — this task runs the script against the already-downloaded video (`f2e496a3de1b`).

**Preconditions:**
- `work/f2e496a3de1b/media/video.mp4` exists (already downloaded)
- Backend is running on port 3000 with token `dev-token-local`
- `subs` step is currently `failed` in SQLite (confirmed above)

- [ ] **Step 1: Confirm backend is healthy**

```bash
curl -s http://127.0.0.1:3000/healthz
```

Expected: `{"ok":true}`

If not running:
```bash
cd /Users/harveyzhang96/Projects/Video-Learner
AGENT_EVENTS_TOKEN=dev-token-local node services/http-server/index.js >> /tmp/vl-backend.log 2>&1 &
sleep 2 && curl -s http://127.0.0.1:3000/healthz
```

- [ ] **Step 2: Run the experiment script** *(this takes several minutes — whisper-large-v3 on ~89MB video)*

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
python3 experiments/whisper_asr.py f2e496a3de1b
```

Expected output:
```
[1/5] Extracting audio from work/f2e496a3de1b/media/video.mp4 …
[2/5] Transcribing with mlx-community/whisper-large-v3 …
      <N> segments transcribed.
[3/5] Writing VTT to work/f2e496a3de1b/transcript/subs/f2e496a3de1b.zh.asr.vtt …
[4/5] Marking subs step as completed in SQLite …
[5/5] Triggering vtt2md via API …
Done. vtt2md and downstream steps are now running.
```

- [ ] **Step 3: Verify VTT file was written**

```bash
head -20 work/f2e496a3de1b/transcript/subs/f2e496a3de1b.zh.asr.vtt
```

Expected: starts with `WEBVTT`, followed by timestamp lines and Chinese text.

- [ ] **Step 4: Poll pipeline progress until done**

```bash
for i in $(seq 1 30); do
  sleep 10
  curl -s -H "Authorization: Bearer dev-token-local" \
    http://127.0.0.1:3000/api/tasks/f2e496a3de1b \
    | python3 -c "import sys,json; t=json.load(sys.stdin); print(t['status'], {k:v['status'] for k,v in t['steps'].items()})"
done
```

Expected: steps `vtt2md → article → summary` progress to `completed`.

- [ ] **Step 5: Inspect final output**

```bash
head -30 work/f2e496a3de1b/transcript/original_zh.md
echo "---"
head -30 work/f2e496a3de1b/writing/summary.md 2>/dev/null || echo "summary not yet generated"
```

- [ ] **Step 6: Final commit**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
git add experiments/
git commit -m "feat(experiments): whisper_asr.py complete — ASR subtitle injection experiment"
```
