#!/usr/bin/env python3
"""Convert Bilibili AI-generated SRT subtitle to WebVTT format.

Bilibili ai-zh subtitles use SRT with HH:MM:SS,mmm timestamps.
VTT differs in three ways: WEBVTT header, no sequence-number lines,
dot instead of comma for milliseconds. No other transformation needed.
"""
import re
import sys


def srt_to_vtt(srt_text: str) -> str:
    """Convert SRT text to VTT text. Returns VTT string."""
    lines_out = ["WEBVTT", ""]
    for block in re.split(r'\n\n+', srt_text.strip()):
        parts = block.strip().split('\n')
        if len(parts) < 3:
            continue
        ts_line = parts[1]
        if '-->' not in ts_line:
            continue
        ts_line = ts_line.replace(',', '.')
        text_lines = [l for l in parts[2:] if l.strip()]
        if not text_lines:
            continue
        lines_out.append(ts_line)
        lines_out.extend(text_lines)
        lines_out.append("")
    return '\n'.join(lines_out)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.srt> <output.vtt>", file=sys.stderr)
        sys.exit(1)
    srt_path, vtt_path = sys.argv[1], sys.argv[2]
    with open(srt_path, 'r', encoding='utf-8') as f:
        srt_text = f.read()
    vtt_text = srt_to_vtt(srt_text)
    with open(vtt_path, 'w', encoding='utf-8') as f:
        f.write(vtt_text)
    print(f"Converted {srt_path} -> {vtt_path}")
