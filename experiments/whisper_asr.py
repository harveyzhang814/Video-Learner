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
