#!/usr/bin/env python3
"""
build_section_prompt.py — Build a per-trunk mini-summary prompt.

Usage:
  python3 scripts/build_section_prompt.py \\
      <template_path> <trunk_path> <output_path> \\
      <idx> <trunk_count> <focus> <output_lang>
"""

import sys


def main():
    if len(sys.argv) < 8:
        print(
            f"Usage: {sys.argv[0]} <template> <trunk> <output> "
            "<idx> <trunk_count> <focus> <output_lang>",
            file=sys.stderr,
        )
        sys.exit(1)

    template_path, trunk_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]
    idx, trunk_count, focus, output_lang   = sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7]

    template = open(template_path, encoding='utf-8').read()
    trunk    = open(trunk_path,    encoding='utf-8').read()

    result = (template
              .replace('{{TRUNK_CONTENT}}',  trunk)
              .replace('{{IDX}}',            idx)
              .replace('{{TRUNK_COUNT}}',    trunk_count)
              .replace('{{FOCUS}}',          focus)
              .replace('OUTPUT_LANG=zh-CN',  f'OUTPUT_LANG={output_lang}'))

    open(output_path, 'w', encoding='utf-8').write(result)


if __name__ == '__main__':
    main()
