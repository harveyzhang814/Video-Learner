#!/usr/bin/env python3
"""Convert original.md to subtitle formats (VTT/SRT)."""
import sys
import re
import argparse

def parse_original_md(filepath):
    """Parse original.md format: supports:
    - [HH:MM:SS.mmm --> HH:MM:SS.mmm] text (统一格式，带毫秒)
    - [hh:mm:ss] HH:MM:SS.mmm --> HH:MM:SS.mmm text (旧格式，带毫秒)
    - [hh:mm:ss --> hh:mm:ss] text (旧格式，无毫秒)
    """
    entries = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            # Try unified format with milliseconds: [HH:MM:SS.mmm --> HH:MM:SS.mmm] text
            match = re.match(r'\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+(.+)', line)
            if match:
                h1, m1, s1, ms1, h2, m2, s2, ms2, text = match.groups()

                start_sec = int(h1) * 3600 + int(m1) * 60 + int(s1)
                start_ms = int(ms1)
                end_sec = int(h2) * 3600 + int(m2) * 60 + int(s2)
                end_ms = int(ms2)

                # Skip invalid entries: end <= start or empty text
                if end_sec < start_sec or (end_sec == start_sec and end_ms <= start_ms):
                    continue
                if not text.strip():
                    continue

                entries.append((start_sec, end_sec, start_ms, end_ms, text))
                continue

            # Try format with milliseconds: [hh:mm:ss] HH:MM:SS.mmm --> HH:MM:SS.mmm text
            match = re.match(r'\[\d{2}:\d{2}:\d{2}\]\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(.+)', line)
            if match:
                h1, m1, s1, ms1, h2, m2, s2, ms2, text = match.groups()

                start_sec = int(h1) * 3600 + int(m1) * 60 + int(s1)
                start_ms = int(ms1)
                end_sec = int(h2) * 3600 + int(m2) * 60 + int(s2)
                end_ms = int(ms2)

                # Skip invalid entries: end <= start or empty text
                if end_sec < start_sec or (end_sec == start_sec and end_ms <= start_ms):
                    continue
                if not text.strip():
                    continue

                entries.append((start_sec, end_sec, start_ms, end_ms, text))
                continue

            # Try format without milliseconds: [hh:mm:ss --> hh:mm:ss] text
            match = re.match(r'\[(\d{2}):(\d{2}):(\d{2})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\]\s+(.+)', line)
            if match:
                h1, m1, s1, h2, m2, s2, text = match.groups()

                start_sec = int(h1) * 3600 + int(m1) * 60 + int(s1)
                end_sec = int(h2) * 3600 + int(m2) * 60 + int(s2)

                # Skip invalid entries: end <= start or empty text
                if end_sec < start_sec:
                    continue
                if not text.strip():
                    continue

                # Default to 0ms for start, 999ms for end (1 second duration)
                entries.append((start_sec, end_sec, 0, 999, text))
    return entries

def format_vtt_time(seconds, ms):
    """Format time for VTT: HH:MM:SS.mmm"""
    hh = seconds // 3600
    mm = (seconds % 3600) // 60
    ss = seconds % 60
    ms_str = str(ms).zfill(3) if isinstance(ms, int) else ms.zfill(3)
    return f"{hh:02d}:{mm:02d}:{ss:02d}.{ms_str}"

def format_srt_time(seconds, ms):
    """Format time for SRT: HH:MM:SS,mmm"""
    hh = seconds // 3600
    mm = (seconds % 3600) // 60
    ss = seconds % 60
    ms_str = str(ms).zfill(3) if isinstance(ms, int) else ms.zfill(3)
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms_str}"

def convert_to_vtt(entries):
    """Convert to VTT format"""
    lines = ["WEBVTT", ""]
    for i, (start_sec, end_sec, start_ms, end_ms, text) in enumerate(entries, 1):
        start = format_vtt_time(start_sec, start_ms)
        end = format_vtt_time(end_sec, end_ms)
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)

def convert_to_srt(entries):
    """Convert to SRT format"""
    lines = []
    for i, (start_sec, end_sec, start_ms, end_ms, text) in enumerate(entries, 1):
        start = format_srt_time(start_sec, start_ms)
        end = format_srt_time(end_sec, end_ms)
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description="Convert original.md to subtitle formats")
    parser.add_argument("input", help="Input original.md file")
    parser.add_argument("-f", "--format", choices=["vtt", "srt"], default="vtt", help="Output format")
    parser.add_argument("-o", "--output", help="Output file (default: original.<format>)")
    parser.add_argument("-l", "--lang", help="Language code (en/zh) for output filename generation")
    args = parser.parse_args()

    # Parse input
    entries = parse_original_md(args.input)
    if not entries:
        print("No entries found in input file")
        sys.exit(1)

    # Convert
    if args.format == "vtt":
        output = convert_to_vtt(entries)
        if args.output:
            outfile = args.output
        elif args.lang:
            base = args.input.replace(".md", "")
            outfile = f"{base}_{args.lang}.vtt"
        else:
            outfile = args.input.replace(".md", ".vtt")
    else:
        output = convert_to_srt(entries)
        if args.output:
            outfile = args.output
        elif args.lang:
            base = args.input.replace(".md", "")
            outfile = f"{base}_{args.lang}.srt"
        else:
            outfile = args.input.replace(".md", ".srt")

    # Write output
    with open(outfile, 'w', encoding='utf-8') as f:
        f.write(output)

    print(f"Written {len(entries)} entries to {outfile}")

if __name__ == "__main__":
    main()
