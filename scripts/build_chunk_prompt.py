#!/usr/bin/env python3
"""
build_chunk_prompt.py — Build a per-chunk article prompt without embedding
Chinese text inside a bash heredoc (which causes encoding issues on some systems).

Usage:
  python3 scripts/build_chunk_prompt.py \\
      <template_path> <transcript_path> <output_path> \\
      <total_ts> <idx> <chunk_count> \\
      <seam_start_ts> <seam_end_ts> \\
      <slice_start_ts> <slice_end_ts> \\
      <source_lang> <output_lang>
"""

import sys

def main():
    if len(sys.argv) < 13:
        print(f"Usage: {sys.argv[0]} <template> <transcript> <output> "
              "<total_ts> <idx> <chunk_count> "
              "<seam_start> <seam_end> <slice_start> <slice_end> "
              "<source_lang> <output_lang>",
              file=sys.stderr)
        sys.exit(1)

    (template_path, transcript_path, output_path,
     total_ts, idx, chunk_count,
     seam_start_ts, seam_end_ts,
     slice_start_ts, slice_end_ts,
     source_lang, output_lang) = sys.argv[1:13]

    template   = open(template_path,   encoding='utf-8').read()
    transcript = open(transcript_path, encoding='utf-8').read()

    chunk_header = (
        f"【分段处理】完整视频时长 {total_ts}，本段为第 {idx}/{chunk_count} 块\n"
        f"（核心范围 {seam_start_ts}–{seam_end_ts}，"
        f"含 1.5 分缓冲区 {slice_start_ts}–{slice_end_ts}）。\n"
        "合并要求：每个正文段落前必须标注时间戳，格式 [HH:MM:SS]（取该段第一句话的时间）。\n\n"
    )

    result = (chunk_header + template
              .replace("{{TRANSCRIPT_CONTENT}}", transcript)
              .replace("{{SOURCE_LANG}}", source_lang))

    open(output_path, 'w', encoding='utf-8').write(result)


if __name__ == '__main__':
    main()
