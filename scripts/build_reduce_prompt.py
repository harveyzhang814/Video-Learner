#!/usr/bin/env python3
"""
build_reduce_prompt.py — Build the final reduce-phase summary prompt
by concatenating all trunk mini-summaries.

Usage:
  python3 scripts/build_reduce_prompt.py \\
      <template_path> <chunks_dir> <trunk_count> <output_path> \\
      <focus> <output_lang>
"""

import sys
from pathlib import Path


def main():
    if len(sys.argv) < 7:
        print(
            f"Usage: {sys.argv[0]} <template> <chunks_dir> <trunk_count> "
            "<output_path> <focus> <output_lang>",
            file=sys.stderr,
        )
        sys.exit(1)

    template_path = sys.argv[1]
    chunks_dir    = Path(sys.argv[2])
    trunk_count   = int(sys.argv[3])
    output_path   = sys.argv[4]
    focus         = sys.argv[5]
    output_lang   = sys.argv[6]

    template = open(template_path, encoding='utf-8').read()

    parts = []
    for idx in range(1, trunk_count + 1):
        trunk_summary_path = chunks_dir / f"trunk_{idx:03d}_summary.md"
        if not trunk_summary_path.exists():
            print(f"WARNING: trunk summary not found: {trunk_summary_path}", file=sys.stderr)
            continue
        text = trunk_summary_path.read_text(encoding='utf-8').strip()
        if not text:
            print(f"WARNING: trunk summary is empty: {trunk_summary_path}", file=sys.stderr)
            continue
        parts.append(f"### 第 {idx}/{trunk_count} 部分\n\n{text}")

    combined = '\n\n---\n\n'.join(parts)

    result = (template
              .replace('{{MINI_SUMMARIES}}', combined)
              .replace('{{TRUNK_COUNT}}',    str(trunk_count))
              .replace('{{FOCUS}}',          focus)
              .replace('OUTPUT_LANG=zh-CN',  f'OUTPUT_LANG={output_lang}'))

    open(output_path, 'w', encoding='utf-8').write(result)


if __name__ == '__main__':
    main()
