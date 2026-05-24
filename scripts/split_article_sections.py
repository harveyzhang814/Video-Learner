#!/usr/bin/env python3
"""
split_article_sections.py — Split article.md into trunks by ## section headings.

Usage:
  python3 scripts/split_article_sections.py <article_path> <output_dir>

  output_dir receives:
    sections_manifest.json  — trunk boundary metadata
    trunk_001.md            — article slice for trunk 1
    trunk_002.md            — article slice for trunk 2
    ...

Exit codes:
  0 — success; manifest written
  1 — error
"""

import sys
import json
import math
from pathlib import Path


def split_sections(lines):
    """Return list of (start_line_0idx, heading_text) for each ## section."""
    sections = []
    for i, line in enumerate(lines):
        if line.startswith('## '):
            sections.append((i, line.rstrip()))
    return sections


def compute_trunks(section_count):
    """Return target trunk count using min(6, ceil(N/20)) formula."""
    if section_count <= 0:
        return 1
    return min(6, math.ceil(section_count / 20))


def group_sections(sections, trunk_count):
    """Split section list into trunk_count evenly-sized groups.
    Returns list of (first_section_idx, last_section_idx) inclusive."""
    n = len(sections)
    trunk_size = math.ceil(n / trunk_count)
    trunks = []
    for t in range(trunk_count):
        start = t * trunk_size
        end = min(start + trunk_size, n) - 1
        if start > n - 1:
            break
        trunks.append((start, end))
    return trunks


def write_trunks(lines, sections, trunk_groups, output_dir):
    """Write one article slice file per trunk; return enriched trunk list."""
    results = []
    total_lines = len(lines)

    for idx, (sec_start, sec_end) in enumerate(trunk_groups, 1):
        # Line range: from first section's start to line before next trunk's section
        line_start = sections[sec_start][0]
        if sec_end + 1 < len(sections):
            line_end = sections[sec_end + 1][0]  # exclusive
        else:
            line_end = total_lines  # exclusive

        trunk_lines = lines[line_start:line_end]
        filename = f"trunk_{idx:03d}.md"
        (output_dir / filename).write_text(''.join(trunk_lines), encoding='utf-8')

        results.append({
            'index': idx,
            'start_line': line_start + 1,   # 1-based for humans
            'end_line': line_end,            # 1-based inclusive
            'section_count': sec_end - sec_start + 1,
            'first_heading': sections[sec_start][1],
            'last_heading': sections[sec_end][1],
            'trunk_file': filename,
        })

    return results


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <article_path> <output_dir>", file=sys.stderr)
        sys.exit(1)

    article_path = Path(sys.argv[1])
    output_dir   = Path(sys.argv[2])

    if not article_path.exists():
        print(f"Error: file not found: {article_path}", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    lines = article_path.read_text(encoding='utf-8').splitlines(keepends=True)
    sections = split_sections(lines)

    section_count = len(sections)
    trunk_count   = compute_trunks(section_count)
    trunk_groups  = group_sections(sections, trunk_count)
    trunk_meta    = write_trunks(lines, sections, trunk_groups, output_dir)

    manifest = {
        'section_count': section_count,
        'trunk_count':   len(trunk_meta),
        'trunks':        trunk_meta,
    }
    manifest_path = output_dir / 'sections_manifest.json'
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )

    print(
        f"split_article_sections: {section_count} sections → "
        f"{len(trunk_meta)} trunk(s)",
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
