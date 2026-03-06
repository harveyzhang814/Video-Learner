#!/usr/bin/env python3
"""VTT to Markdown converter with deduplication."""
import re
import glob
import sys
import argparse

def remove_overlap_prefix(current_text, previous_text, min_overlap=3):
    """Remove overlapping prefix from current text."""
    if not previous_text or not current_text:
        return current_text

    # Find longest common prefix by trying different offsets
    for i in range(len(previous_text)):
        if current_text.startswith(previous_text[i:]):
            overlap = previous_text[i:]
            break
    else:
        overlap = ""

    # Only remove if overlap is significant (>= min_overlap chars)
    if len(overlap) >= min_overlap:
        return current_text[len(overlap):].lstrip()
    return current_text


def convert_vtt_to_markdown(vtt_path, output_path, lang=None):
    """Convert VTT subtitle file to timestamped markdown."""
    with open(vtt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove VTT header
    content = re.sub(r'^WEBVTT.*?\n\n', '', content, flags=re.MULTILINE)

    # Extract timestamped entries
    # YouTube VTT has two parts per block:
    # 1. Word-level timing: "00:00:00.240 --> 00:00:01.910" with HTML tags like <00:...><c>
    # 2. Clean version: "00:00:01.910 --> 00:00:01.920" without HTML tags
    # We prefer the clean version (without word timing tags)
    pattern = r'(\d{2}:\d{2}:\d{2}[.,]?\d*)\s*-->\s*\d{2}:\d{2}:\d{2}[.,]?\d*\s*[^\n]*\n(.+?)(?=\n\n\d{2}:\d{2}|\n*$)'
    matches = re.findall(pattern, content, re.DOTALL)

    # Group by timestamp and prefer clean text (without word timing tags)
    # Also capture end times from the VTT entries
    timestamp_entries = {}
    full_pattern = r'(\d{2}:\d{2}:\d{2}[.,]?\d*)\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]?\d*)\s*[^\n]*\n(.+?)(?=\n\n\d{2}:\d{2}|\n*$)'
    full_matches = re.findall(full_pattern, content, re.DOTALL)

    for start, end, text in full_matches:
        # Check if this is a clean entry (no word timing like <00:...><c>)
        has_word_timing = bool(re.search(r'<\d{2}:\d{2}:\d{2}', text))
        text = re.sub(r'<[^>]+>', '', text)  # Remove XML tags
        text = text.strip().replace('\n', ' ')

        if not text:
            continue

        parts = start.replace(',', '.').split(':')
        seconds = float(parts[0])*3600 + float(parts[1])*60 + float(parts[2])

        # Prefer clean entries (without word timing) over word-timing entries
        if seconds not in timestamp_entries or not has_word_timing:
            timestamp_entries[seconds] = (start, end, text)

    # Convert to list and sort
    entries = [(sec, start, end, text) for sec, (start, end, text) in timestamp_entries.items()]
    entries.sort(key=lambda x: x[0])

    # Merge entries with overlap removal
    # 1. Time difference < 0.5s: keep longer text, later timestamp
    # 2. Otherwise: remove overlapping prefix from current text
    merged = []
    if entries:
        current_sec, current_start, current_end, current_text = entries[0]
        for sec, start, end, text in entries[1:]:
            time_diff = sec - current_sec

            # Check if text is contained in current_text (duplicate or subset)
            text_contained = text in current_text or text.lower() in current_text.lower()

            if time_diff < 0.5:
                # Case 1: nearby in time - use longer text
                if len(text) > len(current_text):
                    current_sec, current_start, current_end, current_text = sec, start, end, text
            elif text_contained:
                # Case 2: text is contained in current - skip (already covered)
                pass
            else:
                # Case 3: far apart in time - remove overlap and add
                cleaned_text = remove_overlap_prefix(text, current_text)
                final_text = cleaned_text if cleaned_text else text
                merged.append((current_start, current_end, current_text))
                current_sec, current_start, current_end, current_text = sec, start, end, final_text
        merged.append((current_start, current_end, current_text))

    # Write output with both start and end times
    with open(output_path, 'w', encoding='utf-8') as f:
        for start, end, text in merged:
            f.write(f"[{start.split('.')[0]} --> {end.split('.')[0]}] {text}\n")

    return len(merged), len(entries)


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
