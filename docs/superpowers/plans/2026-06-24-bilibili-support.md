# Bilibili Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Bilibili as a supported video source alongside YouTube by fixing 4 identified yt-dlp integration gaps, keeping Bilibili and YouTube code paths strictly separated.

**Architecture:** All Bilibili-specific download logic lives in `scripts/bilibili/` (a new subdirectory). The existing main scripts (`download_video.sh`, `download_audio.sh`, `download_subs.sh`) each get a 3-line dispatch block at the top that delegates Bilibili URLs to `scripts/bilibili/` equivalents via `exec` — the rest of the main script body is untouched. URL detection is centralized in `scripts/platform.sh`. The orchestrator, DAG scheduler, and all downstream steps (vtt2md, article, summary) require zero changes.

**Tech Stack:** bash, Python 3, yt-dlp 2026.06.09+, ffmpeg (existing deps)

## Background: Audit Findings

Full audit: `docs/explanation/bilibili-ytdlp-capability-audit.md`

Four gaps identified, fixed in dependency order:

| # | Gap | Root cause | Fix scope |
|---|-----|-----------|-----------|
| Fix 4 | Multi-part URL `--no-playlist` missing | `list=` check doesn't match `?p=` | Bilibili scripts always pass `--no-playlist` |
| Fix 3 | `language` defaults to `"en"` for Chinese content | Bilibili JSON `language` is `null` | `fetch_info.sh` detects Bilibili URL, defaults to `"zh"` |
| Fix 1 | Bot-detection retry never triggers | Bilibili returns HTTP 412 (not "sign in" text) | Bilibili scripts always use cookies on first attempt |
| Fix 2 | `ai-zh` SRT subtitles never detected/downloaded | awk parser only knows YouTube lang codes; VTT expected | New Bilibili subtitle script + `srt2vtt.py` converter |

## Global Constraints

- Never break existing YouTube pipeline — all modifications to existing scripts are additive dispatch-only
- Branch from `staging` (not `master`), branch name: `feature/bilibili-support`
- Use isolated git worktree at `../Video-Learner-bilibili/`
- Commit after every task, `git merge --no-ff` when landing
- Python tests: `unittest` in `tests/`, run with `python3 -m pytest tests/<file>.py -v` or `python3 -m unittest tests.<module> -v`
- Bash tests: run directly with `bash scripts/<test>.sh`
- No new npm dependencies, no new Python packages beyond stdlib

---

## File Map

**New files:**
- `scripts/platform.sh` — `is_bilibili()` URL detection utility (sourced by all modified scripts)
- `scripts/bilibili/download_video.sh` — Bilibili video download: cookies-first, `--no-playlist`, DASH fallback
- `scripts/bilibili/download_audio.sh` — Bilibili audio download: cookies-first, `--no-playlist`
- `scripts/bilibili/download_subs.sh` — Bilibili subtitle download: detect `ai-zh`, download SRT, convert to VTT
- `scripts/bilibili/srt2vtt.py` — Pure-Python SRT→VTT converter (no ffmpeg, no deps)
- `scripts/test_bilibili_platform.sh` — Offline unit tests for `platform.sh`
- `tests/test_bilibili_srt2vtt.py` — Unit tests for `srt2vtt.py`

**Modified files (dispatch block only, 3–4 lines added per file):**
- `scripts/download_video.sh` — add `source platform.sh` + `is_bilibili` dispatch after `SCRIPT_DIR` is set (line ~27)
- `scripts/download_audio.sh` — same, after `SCRIPT_DIR` is set (line ~14)
- `scripts/download_subs.sh` — same, after URL is parsed (after line ~28)
- `scripts/fetch_info.sh` — add `source platform.sh` + `is_bilibili`-aware `lang` default (replaces one line ~64)

---

## Task 1: Git Worktree + Feature Branch

**Files:** (git operations only)

- [ ] **Step 1.1: Ensure staging is up to date**

```bash
git fetch origin
git checkout staging
git status   # must be clean
```

Expected: `nothing to commit, working tree clean`

- [ ] **Step 1.2: Create feature branch from staging**

```bash
git checkout -b feature/bilibili-support staging
```

Expected: `Switched to a new branch 'feature/bilibili-support'`

- [ ] **Step 1.3: Create isolated worktree**

```bash
git worktree add ../Video-Learner-bilibili feature/bilibili-support
```

Expected: `Preparing worktree (checking out 'feature/bilibili-support')`

- [ ] **Step 1.4: Verify worktree**

```bash
git worktree list
```

Expected output includes both the main worktree and `../Video-Learner-bilibili  [feature/bilibili-support]`

- [ ] **Step 1.5: All remaining work happens in the worktree**

```bash
cd ../Video-Learner-bilibili
```

All subsequent steps assume CWD is `/path/to/Video-Learner-bilibili/`.

---

## Task 2: Platform Detection Utility

**Files:**
- Create: `scripts/platform.sh`
- Create: `scripts/test_bilibili_platform.sh`

**Interfaces:**
- Produces: `is_bilibili <url>` — exits 0 if URL contains `bilibili.com`, 1 otherwise. Source this file to use it.

- [ ] **Step 2.1: Write the test first**

Create `scripts/test_bilibili_platform.sh`:

```bash
#!/bin/bash
# Offline unit tests for scripts/platform.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/platform.sh"

pass=0; fail=0
ok()   { echo "PASS: $1"; ((pass++)); }
fail() { echo "FAIL: $1"; ((fail++)); }

# Bilibili URLs — must return true (exit 0)
is_bilibili "https://www.bilibili.com/video/BV1xx411c7mD"        && ok "www.bilibili.com" || fail "www.bilibili.com"
is_bilibili "https://bilibili.com/video/BV1xx"                   && ok "bilibili.com (no www)" || fail "bilibili.com (no www)"
is_bilibili "https://www.bilibili.com/video/BV1BJ411W7pX?p=3"   && ok "bilibili.com with ?p=" || fail "bilibili.com with ?p="
is_bilibili "https://m.bilibili.com/video/BV1xx"                 && ok "m.bilibili.com" || fail "m.bilibili.com"

# Non-Bilibili URLs — must return false (exit 1)
is_bilibili "https://www.youtube.com/watch?v=dQw4w9WgXcQ" && fail "youtube should be false" || ok "youtube is false"
is_bilibili "https://youtu.be/dQw4w9WgXcQ"                && fail "youtu.be should be false" || ok "youtu.be is false"
is_bilibili "https://vimeo.com/123456"                     && fail "vimeo should be false"   || ok "vimeo is false"
is_bilibili ""                                             && fail "empty should be false"   || ok "empty is false"

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
```

- [ ] **Step 2.2: Run test — confirm it fails (platform.sh doesn't exist yet)**

```bash
bash scripts/test_bilibili_platform.sh
```

Expected: `scripts/platform.sh: No such file or directory` or similar error.

- [ ] **Step 2.3: Implement `scripts/platform.sh`**

```bash
#!/bin/bash
# Platform detection utilities for yt-dlp download scripts.
# Source this file, then call: is_bilibili "$URL"

# Returns 0 (true) if URL is from bilibili.com (any subdomain)
is_bilibili() {
    local url="${1:-}"
    [[ "$url" == *bilibili.com* ]]
}
```

- [ ] **Step 2.4: Run test — confirm all pass**

```bash
bash scripts/test_bilibili_platform.sh
```

Expected:
```
PASS: www.bilibili.com
PASS: bilibili.com (no www)
PASS: bilibili.com with ?p=
PASS: m.bilibili.com
PASS: youtube is false
PASS: youtu.be is false
PASS: vimeo is false
PASS: empty is false

Results: 8 passed, 0 failed
```

- [ ] **Step 2.5: Commit**

```bash
git add scripts/platform.sh scripts/test_bilibili_platform.sh
git commit -m "feat(bilibili): add platform detection utility (is_bilibili)"
```

---

## Task 3: SRT→VTT Converter

**Files:**
- Create: `scripts/bilibili/srt2vtt.py`
- Create: `tests/test_bilibili_srt2vtt.py`

**Interfaces:**
- Produces: `srt_to_vtt(srt_text: str) -> str` — converts SRT text to VTT text
- Produces: CLI `python3 scripts/bilibili/srt2vtt.py <input.srt> <output.vtt>`

**Why this is its own task:** The converter is pure logic with no I/O side effects, fully testable offline. It unblocks Task 6 (subtitle download).

- [ ] **Step 3.1: Write failing tests**

Create `tests/test_bilibili_srt2vtt.py`:

```python
#!/usr/bin/env python3
"""Unit tests for scripts/bilibili/srt2vtt.py"""
import os
import sys
import textwrap
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'bilibili'))
from srt2vtt import srt_to_vtt


class TestSrtToVtt(unittest.TestCase):

    def test_header_present(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\nHello\n"
        result = srt_to_vtt(srt)
        self.assertTrue(result.startswith("WEBVTT"))

    def test_sequence_numbers_removed(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\nHello\n\n2\n00:00:04,150 --> 00:00:07,280\nWorld\n"
        result = srt_to_vtt(srt)
        self.assertNotIn("\n1\n", result)
        self.assertNotIn("\n2\n", result)

    def test_comma_replaced_with_dot(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\nHello\n"
        result = srt_to_vtt(srt)
        self.assertIn("00:00:00.160 --> 00:00:04.150", result)
        self.assertNotIn(",", result.split("WEBVTT")[1])  # no commas after header

    def test_text_preserved(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\n零基础学it月薪过万\n"
        result = srt_to_vtt(srt)
        self.assertIn("零基础学it月薪过万", result)

    def test_multiple_entries(self):
        srt = textwrap.dedent("""\
            1
            00:00:00,160 --> 00:00:04,150
            First line

            2
            00:00:04,150 --> 00:00:07,280
            Second line

            3
            00:00:07,980 --> 00:00:09,620
            Third line
        """)
        result = srt_to_vtt(srt)
        self.assertIn("First line", result)
        self.assertIn("Second line", result)
        self.assertIn("Third line", result)
        # Timestamps converted
        self.assertIn("00:00:00.160 --> 00:00:04.150", result)
        self.assertIn("00:00:04.150 --> 00:00:07.280", result)

    def test_empty_input(self):
        result = srt_to_vtt("")
        self.assertEqual(result.strip(), "WEBVTT")

    def test_malformed_block_skipped(self):
        # Block with no text line is silently skipped
        srt = "1\n00:00:00,000 --> 00:00:01,000\n\n2\n00:00:01,000 --> 00:00:02,000\nGood line\n"
        result = srt_to_vtt(srt)
        self.assertIn("Good line", result)

    def test_hours_preserved(self):
        # Timestamps with non-zero hours must be preserved
        srt = "1\n01:30:00,000 --> 01:30:05,000\nLong video\n"
        result = srt_to_vtt(srt)
        self.assertIn("01:30:00.000 --> 01:30:05.000", result)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3.2: Run tests — confirm they fail**

```bash
python3 -m pytest tests/test_bilibili_srt2vtt.py -v
```

Expected: `ModuleNotFoundError: No module named 'srt2vtt'`

- [ ] **Step 3.3: Create `scripts/bilibili/` directory and implement converter**

```bash
mkdir -p scripts/bilibili
```

Create `scripts/bilibili/srt2vtt.py`:

```python
#!/usr/bin/env python3
"""Convert Bilibili AI-generated SRT subtitle to WebVTT format.

Bilibili ai-zh subtitles use SRT with HH:MM:SS,mmm timestamps.
VTT differs in three ways: WEBVTT header, no sequence-number lines, dot
instead of comma for milliseconds. No other transformation is needed.
"""
import re
import sys


def srt_to_vtt(srt_text: str) -> str:
    """Convert SRT text to VTT text. Returns VTT string."""
    lines_out = ["WEBVTT", ""]
    for block in re.split(r'\n\n+', srt_text.strip()):
        parts = block.strip().split('\n')
        if len(parts) < 3:
            continue
        ts_line = parts[1]
        if '-->' not in ts_line:
            continue
        ts_line = ts_line.replace(',', '.')
        text_lines = [l for l in parts[2:] if l.strip()]
        if not text_lines:
            continue
        lines_out.append(ts_line)
        lines_out.extend(text_lines)
        lines_out.append("")
    return '\n'.join(lines_out)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.srt> <output.vtt>", file=sys.stderr)
        sys.exit(1)
    srt_path, vtt_path = sys.argv[1], sys.argv[2]
    with open(srt_path, 'r', encoding='utf-8') as f:
        srt_text = f.read()
    vtt_text = srt_to_vtt(srt_text)
    with open(vtt_path, 'w', encoding='utf-8') as f:
        f.write(vtt_text)
    print(f"Converted {srt_path} -> {vtt_path}")
```

- [ ] **Step 3.4: Run tests — confirm all pass**

```bash
python3 -m pytest tests/test_bilibili_srt2vtt.py -v
```

Expected: 8 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add scripts/bilibili/srt2vtt.py tests/test_bilibili_srt2vtt.py
git commit -m "feat(bilibili): add SRT→VTT converter (srt2vtt.py)"
```

---

## Task 4: Bilibili Video Downloader

**Files:**
- Create: `scripts/bilibili/download_video.sh`
- Modify: `scripts/download_video.sh` — add 4-line dispatch block only

**Interfaces:**
- Consumes: `scripts/platform.sh:is_bilibili()` (Task 2)
- Consumes: `scripts/db.sh`, `scripts/yt-dlp-cookies.sh` (existing)
- Produces: same exit codes and `[STATUS]` tokens as `download_video.sh`

**Key differences from YouTube path:**
- No attempt-1-without-cookies (Bilibili returns 412 without cookies)
- Always `--no-playlist` (handles `?p=N` multi-part URLs)
- DASH fallback also uses cookies + `--no-playlist`

- [ ] **Step 4.1: Create `scripts/bilibili/download_video.sh`**

```bash
#!/bin/bash
# Bilibili video downloader.
# Usage: bash scripts/bilibili/download_video.sh <URL> <DIR> [ID] [FORCE]
#
# Differences from YouTube path (download_video.sh):
#   - Always uses cookies on first attempt (Bilibili returns HTTP 412 without them)
#   - Always passes --no-playlist (handles ?p= multi-part URLs correctly)

set -euo pipefail

URL="${1:-}"
DIR="${2:-}"
ID="${3:-}"
FORCE="${4:-0}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR> [ID] [FORCE]"
    exit 1
fi

if [ -z "$ID" ]; then
    if command -v sha1sum >/dev/null 2>&1; then
        ID=$(printf "%s\n" "$URL" | sha1sum | cut -c1-12)
    else
        ID=$(printf "%s\n" "$URL" | shasum -a 1 | cut -c1-12)
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

source "$PARENT_DIR/db.sh"
source "$PARENT_DIR/yt-dlp-cookies.sh"

mkdir -p "$DIR/media"

echo "[STATUS] video_start"
update_step "$ID" "video" "running"

# Skip if already exists and not forced
if [ "$FORCE" = "0" ] && [ -f "$DIR/media/video.mp4" ]; then
    size=$(stat -f%z "$DIR/media/video.mp4" 2>/dev/null || stat -c%s "$DIR/media/video.mp4" 2>/dev/null || echo "0")
    if [ "$size" -gt 1000 ]; then
        echo "[STATUS] video_done"
        update_step "$ID" "video" "skipped"
        update_download "$ID" "skipped_existing"
        exit 0
    fi
fi

rm -f "$DIR/media/video.temp.mp4" "$DIR/media/v_tempvideo"* "$DIR/media/v_tempaudio"* 2>/dev/null || true

FORMAT="bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
PROGRESS_TMPL="[progress] downloaded=%(progress.downloaded_bytes)d total=%(progress.total_bytes or progress.total_bytes_estimate or 0)d speed=%(progress.speed or 0.0)f eta=%(progress.eta or 0)d"

# Attempt 1: combined format with cookies (Bilibili requires cookies; --no-playlist targets single video)
echo "[INFO] Attempting Bilibili download (with cookies, --no-playlist)..."
yt-dlp $YT_DLP_COOKIE_OPTS \
    --no-playlist \
    --newline \
    --progress-template "$PROGRESS_TMPL" \
    -f "$FORMAT" \
    -o "$DIR/media/video.temp.mp4" --merge-output-format mp4 "$URL" 2>&1 || true

if [ -f "$DIR/media/video.temp.mp4" ]; then
    mv "$DIR/media/video.temp.mp4" "$DIR/media/video.mp4"
    echo "[STATUS] video_done"
    update_step "$ID" "video" "completed"
    update_download "$ID" "success" "" "$DIR/media/video.mp4"
    exit 0
fi

# Attempt 2: DASH fallback — separate video + audio streams, then ffmpeg merge
echo "[INFO] Combined format failed, trying DASH fallback..."
echo "[INFO] Downloading video stream..."
yt-dlp $YT_DLP_COOKIE_OPTS --no-playlist \
    --newline --progress-template "$PROGRESS_TMPL" \
    -f "bestvideo[height<=1080][ext=mp4]" -o "$DIR/media/v_tempvideo.mp4" "$URL" 2>&1 || true
echo "[INFO] Downloading audio stream..."
yt-dlp $YT_DLP_COOKIE_OPTS --no-playlist \
    --newline --progress-template "$PROGRESS_TMPL" \
    -f "bestaudio[ext=m4a]" -o "$DIR/media/v_tempaudio.m4a" "$URL" 2>&1 || true

if [ -f "$DIR/media/v_tempvideo.mp4" ] && [ -f "$DIR/media/v_tempaudio.m4a" ]; then
    echo "[INFO] Merging with ffmpeg..."
    ffmpeg -i "$DIR/media/v_tempvideo.mp4" -i "$DIR/media/v_tempaudio.m4a" -c copy -y "$DIR/media/video.mp4" 2>&1
    rm -f "$DIR/media/v_tempvideo.mp4" "$DIR/media/v_tempaudio.m4a"
    if [ -f "$DIR/media/video.mp4" ]; then
        echo "[STATUS] video_done"
        update_step "$ID" "video" "completed"
        update_download "$ID" "success" "" "$DIR/media/video.mp4"
        exit 0
    fi
fi

rm -f "$DIR/media/v_tempvideo.mp4" "$DIR/media/v_tempaudio.m4a" "$DIR/media/video.temp.mp4" 2>/dev/null || true
echo "[STATUS] video_error: download failed"
update_step "$ID" "video" "failed" "download failed"
update_download "$ID" "failed" "download failed"
exit 1
```

- [ ] **Step 4.2: Add dispatch block to `scripts/download_video.sh`**

Find the section after `SCRIPT_DIR` and `PROJECT_DIR` are set (lines ~27–28) and before `source "$SCRIPT_DIR/db.sh"` (line ~30). Insert exactly these 4 lines:

```bash
# Platform dispatch — Bilibili URLs handled by dedicated script
source "$SCRIPT_DIR/platform.sh"
if is_bilibili "$URL"; then
    exec bash "$SCRIPT_DIR/bilibili/download_video.sh" "$URL" "$DIR" "$ID" "$FORCE"
fi
```

The block goes here (existing code shown for context):
```bash
# Database path
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ---- INSERT DISPATCH BLOCK HERE ----

# Initialize database
source "$SCRIPT_DIR/db.sh"
source "$SCRIPT_DIR/yt-dlp-cookies.sh"
```

- [ ] **Step 4.3: Verify YouTube path unchanged (offline check)**

Run this — it should print "Attempting download (no cookies)..." which confirms the YouTube path is being taken, not Bilibili:

```bash
bash -c '
URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
DIR="/tmp/yt-test"
ID="test000"
FORCE=0
# Stub out yt-dlp to echo what it would do
yt-dlp() { echo "[STUB] yt-dlp $*"; return 1; }
export -f yt-dlp
# Stub out db functions
update_step() { :; }; update_download() { :; }
export -f update_step; export -f update_download
bash scripts/download_video.sh "$URL" "$DIR" "$ID" "$FORCE" 2>&1 | head -5
'
```

Expected output contains `Attempting download (no cookies)...` (not `with cookies`).

- [ ] **Step 4.4: Commit**

```bash
git add scripts/bilibili/download_video.sh scripts/download_video.sh
git commit -m "feat(bilibili): add video downloader; dispatch in download_video.sh"
```

---

## Task 5: Bilibili Audio Downloader

**Files:**
- Create: `scripts/bilibili/download_audio.sh`
- Modify: `scripts/download_audio.sh` — add 4-line dispatch block only

**Interfaces:**
- Consumes: `scripts/platform.sh:is_bilibili()` (Task 2), `scripts/yt-dlp-cookies.sh`
- Produces: same exit codes and `[STATUS]` tokens as `download_audio.sh`

- [ ] **Step 5.1: Create `scripts/bilibili/download_audio.sh`**

```bash
#!/bin/bash
# Bilibili audio downloader.
# Usage: bash scripts/bilibili/download_audio.sh <URL> <DIR> [FORCE]
#
# Differences from YouTube path (download_audio.sh):
#   - Always uses cookies (Bilibili returns 412 without them)
#   - Always passes --no-playlist

set -euo pipefail

URL="${1:-}"
DIR="${2:-}"
FORCE="${3:-0}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR> [FORCE]"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

source "$PARENT_DIR/yt-dlp-cookies.sh"

trap 'rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null; exit 1' INT TERM

mkdir -p "$DIR/media" || { echo "[STATUS] audio_error: cannot create directory"; exit 1; }

echo "[STATUS] audio_start"

if [ "$FORCE" = "0" ] && [ -f "$DIR/media/audio.m4a" ]; then
    size=$(stat -f%z "$DIR/media/audio.m4a" 2>/dev/null || stat -c%s "$DIR/media/audio.m4a" 2>/dev/null || echo "0")
    if [ "$size" -gt 1000 ]; then
        echo "[STATUS] audio_done"
        exit 0
    fi
fi

rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true

FORMAT="bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/worst[ext=mp4]/worst"
PROGRESS_TMPL="[progress] downloaded=%(progress.downloaded_bytes)d total=%(progress.total_bytes or progress.total_bytes_estimate or 0)d speed=%(progress.speed or 0.0)f eta=%(progress.eta or 0)d"

# Bilibili: always use cookies, always --no-playlist
echo "[INFO] Downloading Bilibili audio (with cookies, --no-playlist)..."
yt-dlp $YT_DLP_COOKIE_OPTS \
    --no-playlist \
    --newline \
    --progress-template "$PROGRESS_TMPL" \
    -f "$FORMAT" \
    -o "$DIR/media/audio.temp.m4a" "$URL" 2>&1
YTDLP_EXIT=$?

if [ "$YTDLP_EXIT" -eq 0 ] && [ -f "$DIR/media/audio.temp.m4a" ]; then
    temp_size=$(stat -f%z "$DIR/media/audio.temp.m4a" 2>/dev/null || stat -c%s "$DIR/media/audio.temp.m4a" 2>/dev/null || echo "0")
    if [ "$temp_size" -gt 1000 ]; then
        mv "$DIR/media/audio.temp.m4a" "$DIR/media/audio.m4a"
        echo "[STATUS] audio_done"
        exit 0
    fi
fi

rm -f "$DIR/media/audio.temp.m4a" 2>/dev/null || true
echo "[STATUS] audio_error: download failed"
exit 1
```

- [ ] **Step 5.2: Add dispatch block to `scripts/download_audio.sh`**

Find `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"` (around line 14). Insert the 4-line dispatch block immediately after it, before `source "$SCRIPT_DIR/yt-dlp-cookies.sh"`:

```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---- INSERT DISPATCH BLOCK HERE ----

source "$SCRIPT_DIR/yt-dlp-cookies.sh"
```

Insert:
```bash
# Platform dispatch — Bilibili URLs handled by dedicated script
source "$SCRIPT_DIR/platform.sh"
if is_bilibili "$URL"; then
    exec bash "$SCRIPT_DIR/bilibili/download_audio.sh" "$URL" "$DIR" "$FORCE"
fi
```

- [ ] **Step 5.3: Commit**

```bash
git add scripts/bilibili/download_audio.sh scripts/download_audio.sh
git commit -m "feat(bilibili): add audio downloader; dispatch in download_audio.sh"
```

---

## Task 6: Bilibili Subtitle Downloader

**Files:**
- Create: `scripts/bilibili/download_subs.sh`
- Modify: `scripts/download_subs.sh` — add 4-line dispatch block only

**Interfaces:**
- Consumes: `scripts/platform.sh:is_bilibili()` (Task 2), `scripts/bilibili/srt2vtt.py` (Task 3)
- Produces: `$SUBS_DIR/${ID}.zh.original.vtt` when `ai-zh` available; exit 1 otherwise (triggers ASR fallback)

**Bilibili subtitle strategy:**
1. `--list-subs --no-playlist` to detect `ai-zh`
2. If `ai-zh` present: download SRT to temp dir, convert to VTT, save as `${ID}.zh.original.vtt`
3. If absent: exit 1 — orchestrator already handles this case via ASR fallback

**Why exit 1 when no ai-zh:** The existing orchestrator `schedule.js:292-293` checks `steps.subs.status === 'failed'` to activate the ASR step. Exiting 1 (which `update_step` marks as `failed`) is exactly the right signal.

- [ ] **Step 6.1: Create `scripts/bilibili/download_subs.sh`**

```bash
#!/bin/bash
# Bilibili subtitle downloader.
# Usage: bash scripts/bilibili/download_subs.sh <URL> <DIR> [ID]
#
# Strategy:
#   1. --list-subs to detect "ai-zh" (Bilibili AI-generated Chinese subtitles)
#   2. If found: download SRT → convert to VTT → save as ID.zh.original.vtt
#   3. If not found: exit 1 (orchestrator activates ASR fallback)
#
# Note: danmaku (xml bullet comments) is intentionally ignored.

set -euo pipefail

URL="${1:-}"
DIR="${2:-}"
ID="${3:-}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR> [ID]"
    exit 1
fi

if [ -z "$ID" ]; then
    if command -v sha1sum >/dev/null 2>&1; then
        ID=$(printf "%s" "$URL" | sha1sum | cut -c1-12)
    else
        ID=$(printf "%s" "$URL" | shasum -a 1 | cut -c1-12)
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

source "$PARENT_DIR/db.sh"
source "$PARENT_DIR/yt-dlp-cookies.sh"

YT_DLP_COOKIE_OPTS="${YT_DLP_COOKIE_OPTS:-}"

SUBS_DIR="$DIR/transcript/subs"
mkdir -p "$SUBS_DIR" || { echo "Error: cannot create $SUBS_DIR"; exit 1; }

echo "[STATUS] subs_start"
update_step "$ID" "subs" "running"

# Detect available subtitles (--no-playlist = target this specific video, not its series)
echo "Detecting Bilibili subtitles for: $URL"
subs_list=$(yt-dlp $YT_DLP_COOKIE_OPTS --no-playlist --list-subs "$URL" 2>/dev/null || true)

has_ai_zh() {
    echo "$subs_list" | grep -Eq "^ai-zh[[:space:]]"
}

if ! has_ai_zh; then
    echo "No ai-zh subtitles available — ASR fallback will be activated by orchestrator"
    update_step "$ID" "subs" "failed" "no Bilibili subtitles available"
    echo "[STATUS] subs_error"
    exit 1
fi

echo "Found ai-zh subtitles. Downloading SRT..."

# Download to a temp dir to avoid yt-dlp appending extra language codes to filename
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

yt-dlp $YT_DLP_COOKIE_OPTS \
    --no-playlist \
    --skip-download \
    --write-subs \
    --sub-lang "ai-zh" \
    -o "$TMP_DIR/subtitle.%(ext)s" \
    "$URL" 2>/dev/null || true

# yt-dlp may produce e.g. "subtitle.NA.ai-zh.srt" — find any .srt file
SRT_FILE=$(find "$TMP_DIR" -name "*.srt" | head -1 || true)

if [ -z "$SRT_FILE" ] || [ ! -s "$SRT_FILE" ]; then
    echo "ai-zh download failed or produced empty file"
    update_step "$ID" "subs" "failed" "ai-zh SRT download failed"
    echo "[STATUS] subs_error"
    exit 1
fi

# Convert SRT → VTT using pure-Python converter (no ffmpeg needed)
VTT_OUT="$SUBS_DIR/${ID}.zh.original.vtt"
python3 "$SCRIPT_DIR/srt2vtt.py" "$SRT_FILE" "$VTT_OUT"

if [ ! -s "$VTT_OUT" ]; then
    echo "SRT→VTT conversion produced empty output"
    update_step "$ID" "subs" "failed" "srt2vtt conversion failed"
    echo "[STATUS] subs_error"
    exit 1
fi

echo "=== Downloaded subtitles ==="
ls -la "$SUBS_DIR/${ID}"*.vtt 2>/dev/null || echo "No VTT files"

update_step "$ID" "subs" "completed"
echo "[STATUS] subs_done"
exit 0
```

- [ ] **Step 6.2: Add dispatch block to `scripts/download_subs.sh`**

The dispatch must go **after** URL is parsed (line ~22) and after the `if [ -z "$URL" ]` check (line ~26), so `is_bilibili "$URL"` has a value to test. It must go **before** the YouTube-specific awk parsing logic. Insert after line ~28 (`if [ -z "$ID" ]` block ends):

```bash
URL="${1:-}"
DIR="${2:-}"
ID="${3:-}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: $0 <URL> <DIR> [ID]"
    exit 1
fi

# Use provided ID or generate from URL
if [ -z "$ID" ]; then
    ...
fi

# ---- INSERT DISPATCH BLOCK HERE ----

# Database path
source "$SCRIPT_DIR/db.sh"
```

Insert:
```bash
# Platform dispatch — Bilibili URLs handled by dedicated script
source "$SCRIPT_DIR/platform.sh"
if is_bilibili "$URL"; then
    exec bash "$SCRIPT_DIR/bilibili/download_subs.sh" "$URL" "$DIR" "$ID"
fi
```

- [ ] **Step 6.3: Verify existing subtitle fallback tests still pass**

```bash
bash scripts/test_subtitle_fallback_logic.sh
```

Expected: all tests pass (the `AVAILABLE_SUBS_OVERRIDE` offline path is unaffected because it fires before the URL-parsing code where the dispatch lives).

- [ ] **Step 6.4: Commit**

```bash
git add scripts/bilibili/download_subs.sh scripts/download_subs.sh
git commit -m "feat(bilibili): add subtitle downloader (ai-zh SRT→VTT); dispatch in download_subs.sh"
```

---

## Task 7: Language Default Fix in fetch_info.sh

**Files:**
- Modify: `scripts/fetch_info.sh` — 2 surgical changes (add `source platform.sh`, replace 1-line `lang` default)

**Context:** Bilibili JSON returns `language: null`. The existing code defaults to `"en"` when empty, causing ASR to transcribe Chinese content in English mode.

**Interfaces:**
- Consumes: `scripts/platform.sh:is_bilibili()` (Task 2)

- [ ] **Step 7.1: Add `source platform.sh` to `fetch_info.sh`**

Find the section after `SCRIPT_DIR` is set and `init_db` is called. Add the source line immediately after `source "$SCRIPT_DIR/yt-dlp-cookies.sh"`:

Existing lines ~28–31:
```bash
source "$SCRIPT_DIR/db.sh"
source "$SCRIPT_DIR/yt-dlp-cookies.sh"
init_db
```

Change to:
```bash
source "$SCRIPT_DIR/db.sh"
source "$SCRIPT_DIR/yt-dlp-cookies.sh"
source "$SCRIPT_DIR/platform.sh"
init_db
```

- [ ] **Step 7.2: Replace single-line `lang` default with Bilibili-aware version**

Find line ~64 (immediately after `lang` is normalized from `lang_raw`):
```bash
[ -z "$lang" ] && lang="en"
```

Replace with:
```bash
if [ -z "$lang" ]; then
    is_bilibili "$URL" && lang="zh" || lang="en"
fi
```

- [ ] **Step 7.3: Verify change is minimal — confirm only 2 hunks changed**

```bash
git diff scripts/fetch_info.sh
```

Expected: exactly 2 diff hunks — one adding `source platform.sh`, one replacing the `lang` default line.

- [ ] **Step 7.4: Commit**

```bash
git add scripts/fetch_info.sh
git commit -m "fix(bilibili): default language to zh for Bilibili URLs (was always en)"
```

---

## Task 8: Integration Test

**Goal:** Verify the complete pipeline works end-to-end with a real Bilibili URL, and that a YouTube URL still works normally.

**Test URLs:**
- Bilibili (with ai-zh): `https://www.bilibili.com/video/BV1BJ411W7pX` (56-part Uni-App course — `?p=1` only)
- Bilibili (no ai-zh): `https://www.bilibili.com/video/BV1xx411c7mD` (old video, danmaku only → ASR fallback)

- [ ] **Step 8.1: Run all existing tests to confirm no regression**

```bash
npm run test:agent:core
npm run test:orchestrator:unit
bash scripts/test_subtitle_fallback_logic.sh
bash scripts/test_bilibili_platform.sh
python3 -m pytest tests/test_bilibili_srt2vtt.py -v
```

Expected: all pass.

- [ ] **Step 8.2: Test Bilibili video with ai-zh subtitles**

```bash
vdl "https://www.bilibili.com/video/BV1BJ411W7pX?p=1" --mode transcript
```

Watch for:
- `[STATUS] fetch_done` — metadata fetched, `lang=zh` (not `en`)
- `[STATUS] subs_done` — ai-zh detected, SRT downloaded and converted to VTT
- `[STATUS] vtt2md_done` — VTT converted to markdown
- Final result contains Chinese transcript text

Verify output:
```bash
vdl result "https://www.bilibili.com/video/BV1BJ411W7pX?p=1"
```

- [ ] **Step 8.3: Test Bilibili video without subtitles (ASR fallback)**

```bash
vdl "https://www.bilibili.com/video/BV1xx411c7mD" --mode transcript
```

Watch for:
- `[STATUS] subs_error` — no ai-zh → subs step fails (expected)
- `[STATUS] asr_start` / `[STATUS] asr_done` — ASR activates as fallback

- [ ] **Step 8.4: Test YouTube URL still works (regression check)**

```bash
vdl "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --mode transcript
```

Watch for:
- `[STATUS] fetch_done`
- Download uses no-cookie-first path (YouTube behavior unchanged)
- `[STATUS] subs_done` or `[STATUS] subs_error` (depends on video subs availability)

- [ ] **Step 8.5: Final commit and branch ready for review**

```bash
git log feature/bilibili-support --oneline
```

Expected: 7 commits (Tasks 2–7 above) on top of `staging`.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Fix 1 (bot detection / cookies-first) — Tasks 4, 5
- ✅ Fix 2 (ai-zh SRT subtitles) — Tasks 3, 6
- ✅ Fix 3 (language default) — Task 7
- ✅ Fix 4 (--no-playlist for Bilibili) — Tasks 4, 5, 6 (all Bilibili scripts always pass `--no-playlist`)
- ✅ Code separation constraint — all Bilibili logic in `scripts/bilibili/`; main scripts are dispatch-only
- ✅ No-regression constraint — existing script bodies untouched; offline tests verified in Task 6.3

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `is_bilibili()` defined in Task 2, used in Tasks 4–7 ✅
- `srt_to_vtt()` defined in Task 3, called via CLI in Task 6 ✅
- VTT output filename `${ID}.zh.original.vtt` — matches convention in `download_subs.sh:96` ✅
