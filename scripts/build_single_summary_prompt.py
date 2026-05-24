#!/usr/bin/env python3
"""
build_single_summary_prompt.py — Build the single-pass summary prompt.

Usage:
  python3 scripts/build_single_summary_prompt.py \\
      <template_path> <article_path> <output_path> <focus> <output_lang>
"""

import sys


def main():
    if len(sys.argv) < 6:
        print(
            f"Usage: {sys.argv[0]} <template> <article> <output> <focus> <output_lang>",
            file=sys.stderr,
        )
        sys.exit(1)

    template_path, article_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]
    focus, output_lang = sys.argv[4], sys.argv[5]

    template = open(template_path, encoding='utf-8').read()
    article  = open(article_path,  encoding='utf-8').read()

    result = (template
              .replace('{{ARTICLE_CONTENT}}', article)
              .replace('{{FOCUS}}',           focus)
              .replace('OUTPUT_LANG=zh-CN',   f'OUTPUT_LANG={output_lang}'))

    open(output_path, 'w', encoding='utf-8').write(result)


if __name__ == '__main__':
    main()
