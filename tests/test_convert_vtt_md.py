#!/usr/bin/env python3
"""Integration tests for convert_vtt_md.sh AI subtitle detection logic."""
import os
import subprocess
import tempfile
import re

SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'convert_vtt_md.sh')

# 6 cues × 2s = 12s total; with min=3, max=6 → should merge into 2 blocks
FINE_GRAINED_VTT = """\
WEBVTT

00:00:00.000 --> 00:00:02.000
Hello welcome back.

00:00:02.000 --> 00:00:04.000
Today we cover agents.

00:00:04.000 --> 00:00:06.000
First let me explain.

00:00:06.000 --> 00:00:08.000
The architecture looks like this.

00:00:08.000 --> 00:00:10.000
We have three components.

00:00:10.000 --> 00:00:12.000
Let us begin.
"""

LINE_RE = re.compile(r'^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\] .+$')


def _count_content_lines(md_path):
    with open(md_path, encoding='utf-8') as f:
        return sum(1 for l in f if LINE_RE.match(l.strip()))


def _run(vtt_path, md_path):
    result = subprocess.run(
        ['bash', SCRIPT, vtt_path, md_path],
        capture_output=True, text=True
    )
    return result


def test_auto_vtt_triggers_merge():
    """.auto.vtt triggers pre-merge: output has fewer lines than input cues"""
    with tempfile.TemporaryDirectory() as d:
        vtt = os.path.join(d, 'video.en.auto.vtt')
        md = os.path.join(d, 'original_en.md')
        with open(vtt, 'w') as f:
            f.write(FINE_GRAINED_VTT)
        r = _run(vtt, md)
        assert r.returncode == 0, f"script failed: {r.stderr}"
        assert 'vtt2md_merging' in r.stdout, "expected vtt2md_merging status for .auto.vtt"
        n = _count_content_lines(md)
        assert n < 6, f"expected merged output (<6 lines), got {n}"
    print("PASS: .auto.vtt triggers pre-merge")


def test_asr_vtt_triggers_merge():
    """.asr.vtt triggers pre-merge"""
    with tempfile.TemporaryDirectory() as d:
        vtt = os.path.join(d, 'video.en.asr.vtt')
        md = os.path.join(d, 'original_en.md')
        with open(vtt, 'w') as f:
            f.write(FINE_GRAINED_VTT)
        r = _run(vtt, md)
        assert r.returncode == 0, f"script failed: {r.stderr}"
        assert 'vtt2md_merging' in r.stdout, "expected vtt2md_merging status for .asr.vtt"
        n = _count_content_lines(md)
        assert n < 6, f"expected merged output (<6 lines), got {n}"
    print("PASS: .asr.vtt triggers pre-merge")


def test_original_vtt_skips_merge():
    """.original.vtt does NOT trigger pre-merge"""
    with tempfile.TemporaryDirectory() as d:
        vtt = os.path.join(d, 'video.en.original.vtt')
        md = os.path.join(d, 'original_en.md')
        with open(vtt, 'w') as f:
            f.write(FINE_GRAINED_VTT)
        r = _run(vtt, md)
        assert r.returncode == 0, f"script failed: {r.stderr}"
        assert 'vtt2md_merging' not in r.stdout, "unexpected merge for .original.vtt"
        n = _count_content_lines(md)
        assert n == 6, f"expected 6 lines (no merge), got {n}"
    print("PASS: .original.vtt skips pre-merge")


def test_missing_args_exits_nonzero():
    """Missing arguments → exit 1 with usage message"""
    r = subprocess.run(['bash', SCRIPT], capture_output=True, text=True)
    assert r.returncode != 0
    assert 'Usage' in r.stdout or 'Usage' in r.stderr
    print("PASS: missing args exits non-zero with usage")


def test_missing_vtt_file_exits_nonzero():
    """Non-existent VTT file → exit 1"""
    with tempfile.TemporaryDirectory() as d:
        r = subprocess.run(
            ['bash', SCRIPT, '/nonexistent/file.auto.vtt', os.path.join(d, 'out.md')],
            capture_output=True, text=True
        )
        assert r.returncode != 0
    print("PASS: missing VTT file exits non-zero")


def test_output_format_correct():
    """All output lines match [HH:MM:SS.mmm --> HH:MM:SS.mmm] text format"""
    with tempfile.TemporaryDirectory() as d:
        vtt = os.path.join(d, 'video.en.auto.vtt')
        md = os.path.join(d, 'original_en.md')
        with open(vtt, 'w') as f:
            f.write(FINE_GRAINED_VTT)
        r = _run(vtt, md)
        assert r.returncode == 0
        with open(md, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    assert LINE_RE.match(line), f"bad format: {line}"
    print("PASS: output format correct for .auto.vtt")


if __name__ == '__main__':
    test_auto_vtt_triggers_merge()
    test_asr_vtt_triggers_merge()
    test_original_vtt_skips_merge()
    test_missing_args_exits_nonzero()
    test_missing_vtt_file_exits_nonzero()
    test_output_format_correct()
    print("\ntest_convert_vtt_md.py: ALL PASS")
