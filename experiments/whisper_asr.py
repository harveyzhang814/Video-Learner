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
