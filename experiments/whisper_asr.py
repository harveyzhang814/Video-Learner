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
import shutil
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


# ---------------------------------------------------------------------------
# Side-effect helpers
# ---------------------------------------------------------------------------

def extract_audio(video_path: str, wav_path: str) -> None:
    """Extract mono 16kHz WAV from video using ffmpeg.

    Raises RuntimeError if ffmpeg is not found on PATH.
    Raises FileNotFoundError if video_path does not exist.
    Raises RuntimeError if ffmpeg fails.
    """
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH")

    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    os.makedirs(os.path.dirname(wav_path) or ".", exist_ok=True)

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


def mark_subs_completed(db_path: str, task_id: str) -> None:
    """Update the subs step to completed in SQLite."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    con = sqlite3.connect(db_path)
    try:
        cur = con.execute(
            """UPDATE steps
               SET status = 'completed', error = NULL, completed_at = ?
               WHERE task_id = ? AND step_name = 'subs'""",
            (now, task_id),
        )
        if cur.rowcount == 0:
            raise RuntimeError(
                f"mark_subs_completed: no subs row found for task_id={task_id!r}"
            )
        con.commit()
    finally:
        con.close()


def trigger_vtt2md(api_base: str, task_id: str, token: str) -> None:
    """POST to /api/tasks/<id>/steps/vtt2md/run to trigger downstream pipeline.

    Raises urllib.error.URLError on network error.
    Raises RuntimeError if API returns non-2xx.
    """
    url = f"{api_base}/api/tasks/{task_id}/steps/vtt2md/run"
    payload = b"{}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            pass  # 2xx — success
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(f"API returned {exc.code}: {body}") from exc


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
    wav_path = None
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
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


if __name__ == "__main__":
    main()
