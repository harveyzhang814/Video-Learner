#!/usr/bin/env python3
"""
merge_article_chunks.py — Merge per-chunk article files into a single article.md.

Strict seam algorithm (no duplicate content):
  For the seam between chunk N (seam_end = T) and chunk N+1 (seam_start = T):
    cut_ts  = timestamp of the last paragraph in chunk N with ts ≤ T
              (falls back to ts ≤ T+30s if none found)
    start   = first paragraph in chunk N+1 with ts > cut_ts   (strict — no overlap)
              (falls back to ts ≥ T-30s if none found)

  Fallback when a chunk article has no usable timestamps near the seam:
    byte-ratio split at the proportional position of seam_time within the
    chunk's time range, snapped to the nearest blank line.

After merging, paragraph-leading [HH:MM:SS] timestamps are stripped;
section heading timestamps (## Title [HH:MM:SS]) are preserved.

Usage:
  python3 scripts/merge_article_chunks.py \\
      <manifest_path> <chunk_article_dir> <output_path>

  chunk_article_dir: directory containing chunk_001_article.md, …
  output_path: path to write the final merged article.md

Exit codes:
  0 — success
  1 — error
"""

import sys
import re
import json
from pathlib import Path

SEAM_BUFFER = 30  # seconds — tolerance window for seam search


# ---------------------------------------------------------------------------
# Timestamp parsing
# ---------------------------------------------------------------------------

_PARA_TS_RE = re.compile(
    r'^\[(\d{1,2}):(\d{2}):(\d{2})\]'     # [H:MM:SS] or [HH:MM:SS]
    r'|^\[(\d{1,2}):(\d{2})\]'            # [M:SS] or [MM:SS]
)
_HEAD_TS_RE = re.compile(
    r'\[(\d{1,2}):(\d{2}):(\d{2})\]\s*$'  # heading trailing [HH:MM:SS]
    r'|\[(\d{1,2}):(\d{2})\]\s*$'         # heading trailing [HH:MM]
)


def _ts_to_s(h_or_m, m_or_s, s=None):
    if s is not None:
        return int(h_or_m) * 3600 + int(m_or_s) * 60 + int(s)
    return int(h_or_m) * 60 + int(m_or_s)


def _line_ts(line: str):
    """Return seconds for the first timestamp found on a line, or None."""
    m = _PARA_TS_RE.match(line)
    if m:
        if m.group(1) is not None:
            return _ts_to_s(m.group(1), m.group(2), m.group(3))
        return _ts_to_s(m.group(4), m.group(5))
    # For heading lines, check for trailing timestamp
    if re.match(r'^#+\s', line):
        m2 = _HEAD_TS_RE.search(line)
        if m2:
            if m2.group(1) is not None:
                return _ts_to_s(m2.group(1), m2.group(2), m2.group(3))
            return _ts_to_s(m2.group(4), m2.group(5))
    return None


# ---------------------------------------------------------------------------
# Paragraph splitting
# ---------------------------------------------------------------------------

def split_paragraphs(text: str):
    """Split article text into (first_ts | None, paragraph_text) tuples.
    Paragraphs are separated by one or more blank lines.
    """
    paras = []
    current_lines = []
    current_ts = None

    for line in text.splitlines():
        if not line.strip():
            if current_lines:
                paras.append((current_ts, '\n'.join(current_lines)))
                current_lines = []
                current_ts = None
        else:
            ts = _line_ts(line)
            if current_ts is None and ts is not None:
                current_ts = ts
            current_lines.append(line)

    if current_lines:
        paras.append((current_ts, '\n'.join(current_lines)))

    return paras


# ---------------------------------------------------------------------------
# Seam finding (strict, no overlap)
# ---------------------------------------------------------------------------

def _find_cut_tail(paras, seam_time: int):
    """Index of the last paragraph with ts ≤ seam_time (primary),
    or ts ≤ seam_time + SEAM_BUFFER (fallback). Returns (index, ts) or None."""
    best = None
    for i, (ts, _) in enumerate(paras):
        if ts is not None and ts <= seam_time:
            best = (i, ts)
    if best is not None:
        return best
    # fallback
    for i, (ts, _) in enumerate(paras):
        if ts is not None and ts <= seam_time + SEAM_BUFFER:
            best = (i, ts)
    return best   # may still be None


def _find_cut_head(paras, after_ts, seam_time: int):
    """Index of the first paragraph with ts > after_ts (strict, no overlap).
    Falls back to ts ≥ seam_time - SEAM_BUFFER when after_ts is None.
    Returns index (0 if nothing found)."""
    if after_ts is not None:
        for i, (ts, _) in enumerate(paras):
            if ts is not None and ts > after_ts:
                return i
    # fallback
    for i, (ts, _) in enumerate(paras):
        if ts is not None and ts >= seam_time - SEAM_BUFFER:
            return i
    return 0  # no timestamps near seam — take from beginning


# ---------------------------------------------------------------------------
# Byte-ratio fallback
# ---------------------------------------------------------------------------

def _snap_blank(text: str, pos: int, forward: bool):
    """Snap pos to the nearest blank-line boundary."""
    if forward:
        idx = text.find('\n\n', pos)
        return idx + 2 if idx >= 0 else pos
    else:
        idx = text.rfind('\n\n', 0, pos)
        return idx if idx >= 0 else pos


def _byte_ratio_tail(text: str, seam_time: int, slice_start: int, slice_end: int):
    span = max(slice_end - slice_start, 1)
    ratio = (seam_time - slice_start) / span
    cut = int(len(text) * ratio)
    cut = _snap_blank(text, cut, forward=False)
    return text[:cut]


def _byte_ratio_head(text: str, seam_time: int, slice_start: int, slice_end: int):
    span = max(slice_end - slice_start, 1)
    ratio = (seam_time - slice_start) / span
    cut = int(len(text) * ratio)
    cut = _snap_blank(text, cut, forward=True)
    return text[cut:]


# ---------------------------------------------------------------------------
# Timestamp stripping (post-merge cleanup)
# ---------------------------------------------------------------------------

_STRIP_PARA_TS = re.compile(
    r'^\[(\d{1,2}):(\d{2}):(\d{2})\]\s*'
    r'|^\[(\d{1,2}):(\d{2})\]\s*'
)


def strip_paragraph_timestamps(text: str) -> str:
    """Remove leading [HH:MM:SS] / [H:MM:SS] / [MM:SS] from non-heading lines.
    Section heading timestamps (## Title [HH:MM:SS]) are preserved intact.
    """
    result = []
    for line in text.splitlines():
        if re.match(r'^#+\s', line):
            result.append(line)          # heading — keep unchanged
        else:
            result.append(_STRIP_PARA_TS.sub('', line))
    return '\n'.join(result)


# ---------------------------------------------------------------------------
# Core merge
# ---------------------------------------------------------------------------

def _paras_to_text(paras):
    return '\n\n'.join(p for _, p in paras)


def build_segments(valid):
    """
    valid: list of (chunk_meta_dict, article_text)
    Returns list of text segments to concatenate (one per chunk).
    """
    if len(valid) == 1:
        return [valid[0][1]]

    segments = []
    prev_cut_ts = None   # timestamp of the last paragraph taken from previous chunk

    for i, (chunk, text) in enumerate(valid):
        paras = split_paragraphs(text)
        has_ts = any(ts is not None for ts, _ in paras)

        is_first = (i == 0)
        is_last  = (i == len(valid) - 1)

        if is_first:
            seam_time = chunk['seam_end']
            result = _find_cut_tail(paras, seam_time)
            if result is None or not has_ts:
                # Byte fallback for entire chunk N
                print(
                    f"WARNING: chunk {chunk['index']} has no timestamps near seam "
                    f"{seam_time}s — using byte-ratio fallback",
                    file=sys.stderr,
                )
                segment = _byte_ratio_tail(
                    text, seam_time, chunk['slice_start'], chunk['slice_end']
                )
                prev_cut_ts = None
            else:
                cut_idx, cut_ts = result
                segment = _paras_to_text(paras[:cut_idx + 1])
                prev_cut_ts = cut_ts
            segments.append(segment)

        elif is_last:
            seam_time = chunk['seam_start']
            if not has_ts:
                print(
                    f"WARNING: chunk {chunk['index']} has no timestamps near seam "
                    f"{seam_time}s — using byte-ratio fallback",
                    file=sys.stderr,
                )
                segment = _byte_ratio_head(
                    text, seam_time, chunk['slice_start'], chunk['slice_end']
                )
            else:
                start_idx = _find_cut_head(paras, prev_cut_ts, seam_time)
                segment = _paras_to_text(paras[start_idx:])
            segments.append(segment)

        else:
            # Middle chunk: trim both head and tail
            seam_start = chunk['seam_start']
            seam_end   = chunk['seam_end']

            if not has_ts:
                print(
                    f"WARNING: chunk {chunk['index']} has no timestamps — "
                    f"using byte-ratio fallback",
                    file=sys.stderr,
                )
                head_text = _byte_ratio_head(
                    text, seam_start, chunk['slice_start'], chunk['slice_end']
                )
                segment = _byte_ratio_tail(
                    head_text, seam_end, seam_start, chunk['slice_end']
                )
                prev_cut_ts = None
            else:
                # Trim head
                start_idx  = _find_cut_head(paras, prev_cut_ts, seam_start)
                paras_head = paras[start_idx:]

                # Trim tail (operate on trimmed list, timestamps still absolute)
                result = _find_cut_tail(paras_head, seam_end)
                if result is None:
                    segment = _paras_to_text(paras_head)
                    prev_cut_ts = paras_head[-1][0] if paras_head else None
                else:
                    cut_idx, cut_ts = result
                    segment = _paras_to_text(paras_head[:cut_idx + 1])
                    prev_cut_ts = cut_ts

            segments.append(segment)

    return segments


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def read_chunk_article(chunks_dir: Path, index: int):
    """Read a chunk article. Returns text or None if missing/empty."""
    path = chunks_dir / f"chunk_{index:03d}_article.md"
    if not path.exists():
        print(f"WARNING: chunk article not found: {path}", file=sys.stderr)
        return None
    text = path.read_text(encoding='utf-8').strip()
    if not text:
        print(f"WARNING: chunk article is empty: {path}", file=sys.stderr)
        return None
    return text


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 4:
        print(
            f"Usage: {sys.argv[0]} <manifest_path> <chunk_article_dir> <output_path>",
            file=sys.stderr,
        )
        sys.exit(1)

    manifest_path  = Path(sys.argv[1])
    chunks_dir     = Path(sys.argv[2])
    output_path    = Path(sys.argv[3])

    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    chunks   = manifest['chunks']

    if not chunks:
        print("Error: manifest has no chunks", file=sys.stderr)
        sys.exit(1)

    # Load chunk articles (skip missing/empty with warning)
    valid = []
    for chunk in chunks:
        text = read_chunk_article(chunks_dir, chunk['index'])
        if text is not None:
            valid.append((chunk, text))

    if not valid:
        print("Error: all chunk articles are empty or missing", file=sys.stderr)
        sys.exit(1)

    segments = build_segments(valid)
    merged   = '\n\n'.join(s.strip() for s in segments if s.strip())
    final    = strip_paragraph_timestamps(merged)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(final.rstrip('\n') + '\n', encoding='utf-8')

    print(
        f"merge_article_chunks: merged {len(valid)} chunk(s) → {output_path}",
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
