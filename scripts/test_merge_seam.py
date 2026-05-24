#!/usr/bin/env python3
"""
T6/T7 — Unit tests for merge_article_chunks.py seam algorithm and timestamp stripping.

Run:
  python3 scripts/test_merge_seam.py

Tests:
  T6a: normal seam cut — no duplicate content, correct split
  T6b: no paragraph at exactly seam_time, uses +buffer fallback for tail
  T6c: chunk N has no timestamps at all — byte-ratio fallback
  T6d: middle chunk: both head and tail trimmed correctly
  T7a: strip_paragraph_timestamps removes [HH:MM:SS] from paragraph lines
  T7b: strip_paragraph_timestamps preserves heading timestamps
  T7c: strip_paragraph_timestamps handles [H:MM] short form
"""

import sys
import json
import tempfile
import os
from pathlib import Path

# Import from sibling module
sys.path.insert(0, str(Path(__file__).parent))
from merge_article_chunks import (
    split_paragraphs,
    _find_cut_tail,
    _find_cut_head,
    strip_paragraph_timestamps,
    build_segments,
)

_PASS = 0
_FAIL = 0

def ok(name, condition, msg=''):
    global _PASS, _FAIL
    if condition:
        print(f'  PASS  {name}')
        _PASS += 1
    else:
        print(f'  FAIL  {name}' + (f': {msg}' if msg else ''))
        _FAIL += 1


def make_article(*paragraphs):
    """Build article text from (ts_seconds_or_None, text) pairs."""
    parts = []
    for ts, text in paragraphs:
        if ts is not None:
            h, m, s = ts // 3600, (ts % 3600) // 60, ts % 60
            parts.append(f'[{h:02d}:{m:02d}:{s:02d}] {text}')
        else:
            parts.append(text)
    return '\n\n'.join(parts)


# ---------------------------------------------------------------------------
# T6a — Normal seam cut: paragraphs on both sides of seam, no duplicate
# ---------------------------------------------------------------------------
def test_T6a():
    # seam_time = 1800 (30:00)
    # chunk N: paragraphs at 1720, 1750, 1790, 1820 (1820 > seam → excluded)
    # chunk N+1: paragraphs at 1710, 1750, 1810, 1850 (1810 > cut_ts=1790 → included)
    seam_time = 1800

    chunk_n_text = make_article(
        (1720, 'para A'),
        (1750, 'para B'),
        (1790, 'para C'),   # ← last ts <= 1800 → cut here
        (1820, 'para D'),   # ← ts > 1800 → excluded from N
    )
    chunk_n1_text = make_article(
        (1710, 'para X'),
        (1750, 'para Y'),   # ts <= cut_ts=1790 → excluded from N+1
        (1795, 'para Z'),   # ts <= 1790? No, 1795 > 1790 → included (first ts > 1790)
        (1850, 'para W'),
    )

    paras_n  = split_paragraphs(chunk_n_text)
    paras_n1 = split_paragraphs(chunk_n1_text)

    result = _find_cut_tail(paras_n, seam_time)
    ok('T6a.1 cut_tail found', result is not None)
    cut_idx, cut_ts = result
    ok('T6a.2 cut_ts = 1790', cut_ts == 1790, f'got {cut_ts}')
    ok('T6a.3 cut includes para C', 'para C' in paras_n[cut_idx][1])
    ok('T6a.4 cut excludes para D', all('para D' not in p for _, p in paras_n[:cut_idx+1]))

    start_idx = _find_cut_head(paras_n1, cut_ts, seam_time)
    ok('T6a.5 start_idx > 0 (skips overlap)', start_idx > 0, f'got {start_idx}')
    head_ts = paras_n1[start_idx][0]
    ok('T6a.6 head_ts > cut_ts (no overlap)', head_ts > cut_ts, f'head_ts={head_ts} cut_ts={cut_ts}')
    ok('T6a.7 head includes para Z', 'para Z' in paras_n1[start_idx][1])
    ok('T6a.8 head excludes para X and Y',
       all('para X' not in p and 'para Y' not in p for _, p in paras_n1[start_idx:]))


# ---------------------------------------------------------------------------
# T6b — No paragraph at seam_time; buffer fallback
# ---------------------------------------------------------------------------
def test_T6b():
    seam_time = 1800
    # No paragraph at or below seam_time — primary search finds nothing.
    # 1825 ≤ seam_time + SEAM_BUFFER (1830) → buffer fallback kicks in.
    chunk_n_text = make_article(
        (1825, 'para A'),   # > seam but ≤ seam+30 → buffer fallback
        (1900, 'para B'),   # > seam+30 → excluded from buffer too
    )
    paras = split_paragraphs(chunk_n_text)
    result = _find_cut_tail(paras, seam_time)
    ok('T6b.1 fallback to buffer finds 1825', result is not None)
    cut_idx, cut_ts = result
    ok('T6b.2 cut_ts = 1825 (buffer hit)', cut_ts == 1825, f'got {cut_ts}')

    # Verify: without buffer (strict ts ≤ 1800) nothing would be found
    strict_result = None
    for i, (ts, _) in enumerate(paras):
        if ts is not None and ts <= seam_time:
            strict_result = (i, ts)
    ok('T6b.3 strict cut finds nothing (no ts ≤ 1800)', strict_result is None)


# ---------------------------------------------------------------------------
# T6c — No timestamps in chunk article: byte-ratio fallback
# ---------------------------------------------------------------------------
def test_T6c():
    # Chunk with NO timestamps at all
    chunk_n_text = 'para A no timestamp\n\npara B no timestamp\n\npara C no timestamp'
    paras = split_paragraphs(chunk_n_text)
    has_ts = any(ts is not None for ts, _ in paras)
    ok('T6c.1 no timestamps detected', not has_ts)

    result = _find_cut_tail(paras, 1800)
    ok('T6c.2 _find_cut_tail returns None for no-ts', result is None)


# ---------------------------------------------------------------------------
# T6d — Middle chunk: head and tail both trimmed
# ---------------------------------------------------------------------------
def test_T6d():
    # Middle chunk seam_start=1800, seam_end=3600
    # prev_cut_ts = 1790 (set by previous seam)
    chunk_text = make_article(
        (1710, 'overlap-before'),   # ts ≤ prev_cut_ts=1790 → excluded
        (1780, 'overlap-also'),     # ts ≤ 1790 → excluded
        (1800, 'core-start'),       # ts > 1790 → included (head starts here)
        (2700, 'core-middle'),
        (3590, 'core-end'),         # ts ≤ 3600 → included
        (3650, 'overlap-after'),    # ts > 3600 → excluded
    )
    prev_cut_ts = 1790
    seam_start  = 1800
    seam_end    = 3600

    paras = split_paragraphs(chunk_text)
    start_idx = _find_cut_head(paras, prev_cut_ts, seam_start)
    paras_head = paras[start_idx:]
    ok('T6d.1 head starts at core-start', 'core-start' in paras_head[0][1])
    ok('T6d.2 overlap-before excluded',
       all('overlap-before' not in p for _, p in paras_head))

    result = _find_cut_tail(paras_head, seam_end)
    ok('T6d.3 cut found for tail', result is not None)
    cut_idx, cut_ts = result
    segment = '\n\n'.join(p for _, p in paras_head[:cut_idx + 1])
    ok('T6d.4 core-end included', 'core-end' in segment)
    ok('T6d.5 overlap-after excluded', 'overlap-after' not in segment)


# ---------------------------------------------------------------------------
# T6e — build_segments integration: 2-chunk merge
# ---------------------------------------------------------------------------
def test_T6e():
    seam_time = 1800
    chunk0_meta = {
        'index': 1, 'seam_start': 0, 'seam_end': seam_time,
        'slice_start': 0, 'slice_end': seam_time + 90,
    }
    chunk1_meta = {
        'index': 2, 'seam_start': seam_time, 'seam_end': 3600,
        'slice_start': seam_time - 90, 'slice_end': 3600,
    }
    chunk0_text = make_article(
        (100, 'alpha'), (1750, 'beta'), (1790, 'gamma'), (1830, 'delta-overlap'),
    )
    chunk1_text = make_article(
        (1710, 'phi-overlap'), (1750, 'chi-overlap'), (1800, 'psi-start'), (3500, 'omega'),
    )

    segments = build_segments([(chunk0_meta, chunk0_text), (chunk1_meta, chunk1_text)])
    merged = '\n\n'.join(s.strip() for s in segments if s.strip())

    ok('T6e.1 alpha in merged', 'alpha' in merged)
    ok('T6e.2 gamma in merged', 'gamma' in merged)
    ok('T6e.3 psi-start in merged', 'psi-start' in merged)
    ok('T6e.4 omega in merged', 'omega' in merged)
    # delta-overlap from chunk0 may or may not be included depending on buffer;
    # phi-overlap / chi-overlap should not appear (ts ≤ cut_ts from chunk0)
    ok('T6e.5 phi-overlap not in chunk1 portion', 'phi-overlap' not in segments[1])
    ok('T6e.6 chi-overlap not in chunk1 portion', 'chi-overlap' not in segments[1])


# ---------------------------------------------------------------------------
# T7a — strip_paragraph_timestamps: removes [HH:MM:SS] leading timestamps
# ---------------------------------------------------------------------------
def test_T7a():
    text = '[00:01:30] Some content here\n\n[01:23:45] Another paragraph'
    result = strip_paragraph_timestamps(text)
    ok('T7a.1 [00:01:30] removed', '[00:01:30]' not in result)
    ok('T7a.2 [01:23:45] removed', '[01:23:45]' not in result)
    ok('T7a.3 text preserved', 'Some content here' in result)
    ok('T7a.4 text preserved 2', 'Another paragraph' in result)


# ---------------------------------------------------------------------------
# T7b — strip_paragraph_timestamps: preserves heading timestamps
# ---------------------------------------------------------------------------
def test_T7b():
    text = '## Section Title [00:30:00]\n\n[00:30:15] Content under section'
    result = strip_paragraph_timestamps(text)
    ok('T7b.1 heading timestamp preserved', '[00:30:00]' in result)
    ok('T7b.2 paragraph timestamp stripped', '[00:30:15]' not in result)
    ok('T7b.3 heading intact', '## Section Title [00:30:00]' in result)
    ok('T7b.4 content preserved', 'Content under section' in result)


# ---------------------------------------------------------------------------
# T7c — strip_paragraph_timestamps: short [MM:SS] form
# ---------------------------------------------------------------------------
def test_T7c():
    text = '[05:30] Short form timestamp\n\n## Heading [10:00]\n\n[15:45] Another'
    result = strip_paragraph_timestamps(text)
    ok('T7c.1 [05:30] stripped', not result.startswith('[05:30]'))
    ok('T7c.2 [10:00] in heading preserved', '[10:00]' in result)
    ok('T7c.3 [15:45] stripped', '[15:45] Another' not in result)
    ok('T7c.4 Short form text preserved', 'Short form timestamp' in result)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    tests = [test_T6a, test_T6b, test_T6c, test_T6d, test_T6e, test_T7a, test_T7b, test_T7c]
    for fn in tests:
        print(f'\n{fn.__name__}:')
        fn()

    print(f'\n{"="*40}')
    print(f'PASS: {_PASS}  FAIL: {_FAIL}')
    if _FAIL:
        sys.exit(1)
