#!/usr/bin/env python3
"""VTT to Markdown converter with deduplication."""
import re
import glob
import sys
import argparse

def convert_vtt_to_markdown(vtt_path, output_path, lang=None):
    """Convert VTT subtitle file to timestamped markdown."""
    with open(vtt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove VTT header
    content = re.sub(r'^WEBVTT.*?\n\n', '', content, flags=re.MULTILINE)

    # Extract timestamped entries
    pattern = r'(\d{2}:\d{2}:\d{2}[.,]?\d*)\s*-->\s*\d{2}:\d{2}:\d{2}[.,]?\d*\s*[^\n]*\n(.+?)(?=\n\n\d{2}:\d{2}|\n*$)'
    matches = re.findall(pattern, content, re.DOTALL)

    # Parse all entries and sort by timestamp
    entries = []
    for start, text in matches:
        text = re.sub(r'<[^>]+>', '', text)  # Remove XML tags
        text = text.strip().replace('\n', ' ')
        if text:
            parts = start.replace(',', '.').split(':')
            seconds = float(parts[0])*3600 + float(parts[1])*60 + float(parts[2])
            entries.append((seconds, start, text))

    entries.sort(key=lambda x: x[0])

    # Merge entries: two cases
    # 1. Time difference < 0.5s: keep longer text, later timestamp
    # 2. Text contains previous text: merge to longer version, later timestamp
    if entries:
        merged = []
        current_sec, current_start, current_text = entries[0]
        for sec, start, text in entries[1:]:
            time_diff = sec - current_sec
            text_contained = current_text in text or current_text.lower() in text.lower()

            if time_diff < 0.5:  # Case 1: nearby in time
                if len(text) > len(current_text):
                    current_sec, current_start, current_text = sec, start, text
            elif text_contained:  # Case 2: text contains previous
                # Keep longer text, use later timestamp
                current_sec, current_start, current_text = sec, start, text
            else:
                merged.append((current_start, current_text))
                current_sec, current_start, current_text = sec, start, text
        merged.append((current_start, current_text))  # Last one

    # Write output
    with open(output_path, 'w', encoding='utf-8') as f:
        for start, text in merged:
            f.write(f"[{start.split('.')[0]}] {text}\n")

    return len(merged), len(matches)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Convert VTT subtitle to markdown")
    parser.add_argument("input", help="Input VTT file")
    parser.add_argument("output", help="Output MD file")
    parser.add_argument("-l", "--lang", help="Language code (en/zh) for output filename generation")
    args = parser.parse_args()

    input_file = args.input
    output_file = args.output

    # If lang is provided and output doesn't have explicit name, generate based on lang
    if args.lang and not args.output:
        base = args.input.rsplit('.', 1)[0]
        output_file = f"{base}_{args.lang}.md"

    unique_count, raw_count = convert_vtt_to_markdown(input_file, output_file, args.lang)
    print(f"Written {unique_count} unique lines (from {raw_count} raw)")
