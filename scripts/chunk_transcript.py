#!/usr/bin/env python3
"""
chunk_transcript.py — Split transcript into time-based chunks with overlap.

Usage:
  python3 scripts/chunk_transcript.py <transcript_path> <output_dir>

  output_dir receives:
    manifest.json       — chunk boundary metadata + total_seconds
    chunk_001.md        — transcript slice for chunk 1
    chunk_002.md        — transcript slice for chunk 2
    ...

Transcript format (VTT-derived):
  [HH:MM:SS.mmm --> HH:MM:SS.mmm] text

Exit codes:
  0 — success; manifest written
  1 — error (file not found, no timestamps, etc.)
"""

import sys
import json
import re
from pathlib import Path

CHUNK_SIZE = 1800  # 30 minutes
OVERLAP    = 90    # 1.5 minutes


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_TS_RE = re.compile(r'^\[(\d{2}):(\d{2}):(\d{2})\.\d+\s+-->')

def _parse_start(line: str):
    """Return start time in seconds from a transcript line, or None."""
    m = _TS_RE.match(line)
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))


def load_transcript(path: Path):
    """Return list of (start_seconds, line) for every timestamped line."""
    rows = []
    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            line = raw.rstrip('\n')
            ts = _parse_start(line)
            if ts is not None:
                rows.append((ts, line))
    return rows


# ---------------------------------------------------------------------------
# Chunk computation
# ---------------------------------------------------------------------------

def compute_chunks(total_seconds: int, chunk_size: int = CHUNK_SIZE,
                   overlap: int = OVERLAP):
    """Return list of chunk boundary dicts (index 1-based)."""
    chunks = []
    n = 0
    while True:
        seam_start = n * chunk_size
        if seam_start >= total_seconds:
            break
        seam_end   = min((n + 1) * chunk_size, total_seconds)
        slice_start = max(0, seam_start - overlap)
        slice_end   = min(total_seconds, seam_end + overlap)
        chunks.append({
            'index':      n + 1,
            'seam_start': seam_start,
            'seam_end':   seam_end,
            'slice_start': slice_start,
            'slice_end':   slice_end,
        })
        n += 1
        if seam_end >= total_seconds:
            break
    return chunks


# ---------------------------------------------------------------------------
# File writing
# ---------------------------------------------------------------------------

def write_chunks(rows, chunks, output_dir: Path):
    """Write one transcript slice file per chunk; returns enriched chunk list."""
    results = []
    for chunk in chunks:
        lo, hi = chunk['slice_start'], chunk['slice_end']
        lines = [line for ts, line in rows if lo <= ts < hi]
        filename = f"chunk_{chunk['index']:03d}.md"
        (output_dir / filename).write_text('\n'.join(lines) + '\n', encoding='utf-8')
        results.append({**chunk, 'transcript_file': filename})
    return results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <transcript_path> <output_dir>",
              file=sys.stderr)
        sys.exit(1)

    transcript_path = Path(sys.argv[1])
    output_dir      = Path(sys.argv[2])

    if not transcript_path.exists():
        print(f"Error: file not found: {transcript_path}", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    rows = load_transcript(transcript_path)
    if not rows:
        print(f"Error: no timestamp lines in {transcript_path}", file=sys.stderr)
        sys.exit(1)

    # total_seconds: last start timestamp + 1 (inclusive)
    total_seconds = rows[-1][0] + 1

    chunks       = compute_chunks(total_seconds)
    chunk_meta   = write_chunks(rows, chunks, output_dir)

    manifest = {
        'total_seconds': total_seconds,
        'chunk_size':    CHUNK_SIZE,
        'overlap':       OVERLAP,
        'chunks':        chunk_meta,
    }
    manifest_path = output_dir / 'manifest.json'
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )

    print(
        f"chunk_transcript: {len(chunks)} chunk(s), {total_seconds}s total",
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
