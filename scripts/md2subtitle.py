#!/usr/bin/env python3
"""Convert original.md to subtitle formats (VTT/SRT)."""
import sys
import re
import argparse

def parse_original_md(filepath):
    """Parse original.md format: [hh:mm:ss] or [mm:ss] text"""
    entries = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # Match [hh:mm:ss] or [mm:ss] text - handle both formats
            match = re.match(r'\[(\d{2}):(\d{2}):(\d{2})\]\s*(.+)', line)
            if match:
                hh, mm, ss, text = match.groups()
                seconds = int(hh) * 3600 + int(mm) * 60 + int(ss)
                entries.append((seconds, '0', text))
                continue

            # Try [mm:ss] format
            match = re.match(r'\[(\d{2}):(\d{2})\]\s*(.+)', line)
            if match:
                mm, ss, text = match.groups()
                seconds = int(mm) * 60 + int(ss)
                entries.append((seconds, '0', text))
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
    for i, (seconds, ms, text) in enumerate(entries, 1):
        start = format_vtt_time(seconds, ms)
        end = format_vtt_time(seconds + 3, ms)  # Default 3s duration
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)

def convert_to_srt(entries):
    """Convert to SRT format"""
    lines = []
    for i, (seconds, ms, text) in enumerate(entries, 1):
        start = format_srt_time(seconds, ms)
        end = format_srt_time(seconds + 3, ms)
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
