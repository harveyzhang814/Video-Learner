#!/usr/bin/env python3
"""VTT to Markdown converter with deduplication."""
import re
import glob
import sys
import argparse

def parse_timestamp(ts):
    """Parse timestamp to seconds for sorting."""
    ts = ts.replace(',', '.')
    parts = ts.split(':')
    return float(parts[0])*3600 + float(parts[1])*60 + float(parts[2])


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
    # VTT format variants:
    # 1. With word timing: "00:00:00.240 --> 00:00:01.910" + blank line + "Hi<00:...><c> everyone"
    # 2. Clean format: "00:00:01.910 --> 00:00:01.920" + "text"
    # 3. Clean format with attributes: "00:00:01.910 --> 00:00:01.920 align:start" + "text"

    # First, split into blocks by double newline
    blocks = re.split(r'\n\n+', content)

    timestamp_entries = {}
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 2:
            continue

        # First line should be timestamp
        ts_match = re.match(r'(\d{2}:\d{2}:\d{2}[.,]?\d*)\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]?\d*)', lines[0])
        if not ts_match:
            continue

        start = ts_match.group(1)
        end = ts_match.group(2)

        # Text is either on second line, or third line (if second line is blank for word timing)
        text = None
        if len(lines) >= 2:
            # Find the first non-empty line after timestamp
            for line in lines[1:]:
                if line.strip():
                    text = line.strip()
                    break

        if not text:
            continue

        # Check if this is a word timing entry (contains <00:...><c> tags)
        has_word_timing = bool(re.search(r'<\d{2}:\d{2}:\d{2}', text))

        # Remove XML/HTML tags
        text = re.sub(r'<[^>]+>', '', text)
        text = text.strip().replace('\n', ' ')

        if not text:
            continue

        # Use seconds (without ms) as key to group entries at same second
        # This allows us to prefer clean entries over word-timing entries
        ts_seconds = int(parse_timestamp(start))

        # Prefer clean entries (without word timing) over word-timing entries
        if ts_seconds not in timestamp_entries or not has_word_timing:
            timestamp_entries[ts_seconds] = (start, end, text)

    # Convert to list and sort by timestamp
    # Convert to list and sort by timestamp
    entries = [(ts_sec, start, end, text) for ts_sec, (start, end, text) in timestamp_entries.items()]
    entries.sort(key=lambda x: parse_timestamp(x[1]))

    # Merge entries with overlap removal
    # 1. Time difference < 0.5s: keep longer text, later timestamp
    # 2. Otherwise: remove overlapping prefix from current text
    merged = []
    if entries:
        ts_sec, current_start, current_end, current_text = entries[0]
        current_sec = parse_timestamp(current_start)
        for ts_sec, start, end, text in entries[1:]:
            sec = parse_timestamp(start)
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

    # Write output with both start and end times (统一格式: [HH:MM:SS.mmm --> HH:MM:SS.mmm] TEXT)
    with open(output_path, 'w', encoding='utf-8') as f:
        for start, end, text in merged:
            # Normalize to include milliseconds (default to .000 if not present)
            start_parts = start.replace(',', '.').split('.')
            end_parts = end.replace(',', '.').split('.')
            start_ms = start_parts[1].ljust(3, '0')[:3] if len(start_parts) > 1 else '000'
            end_ms = end_parts[1].ljust(3, '0')[:3] if len(end_parts) > 1 else '000'
            start_normalized = f"{start_parts[0]}.{start_ms}"
            end_normalized = f"{end_parts[0]}.{end_ms}"
            f.write(f"[{start_normalized} --> {end_normalized}] {text}\n")

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
