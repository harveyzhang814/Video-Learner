#!/usr/bin/env python3
"""Merge fine-grained AI subtitle MD lines into sentence-level blocks.

CLI: python3 merge_ai_subs.py <input_md> <output_md> [--min-secs N] [--max-secs N]
Library: from merge_ai_subs import merge_lines
"""
import re, sys, argparse

_LINE_RE = re.compile(
    r'^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$'
)
_SENTENCE_END = re.compile(r'[.?!]\s*$')


def _ts_to_secs(ts: str) -> float:
    h, m, s = ts.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def _secs_to_ts(secs: float) -> str:
    h = int(secs) // 3600
    m = (int(secs) % 3600) // 60
    s_int = int(secs) % 60
    ms = int(round((secs - int(secs)) * 1000)) % 1000
    return f"{h:02d}:{m:02d}:{s_int:02d}.{ms:03d}"


def merge_lines(lines: list, min_secs: float = 3.0, max_secs: float = 6.0) -> list:
    """Merge fine-grained VTT-MD lines into sentence-level blocks.

    Args:
        lines: List of strings in format "[HH:MM:SS.mmm --> HH:MM:SS.mmm] text"
        min_secs: Minimum block duration before a sentence-end triggers a cut
        max_secs: Maximum block duration (forced cut regardless of punctuation)

    Returns:
        List of merged lines in the same format.
    """
    parsed = []
    for line in lines:
        line = line.rstrip()
        if not line:
            continue
        m = _LINE_RE.match(line)
        if m:
            parsed.append((_ts_to_secs(m.group(1)), _ts_to_secs(m.group(2)), m.group(3)))

    if not parsed:
        return []

    merged = []
    cur_start, cur_end, cur_texts = parsed[0][0], parsed[0][1], [parsed[0][2]]

    for start, end, text in parsed[1:]:
        cur_dur = cur_end - cur_start
        last_text = cur_texts[-1]

        if cur_dur >= max_secs or (_SENTENCE_END.search(last_text) and cur_dur >= min_secs):
            merged.append((_secs_to_ts(cur_start), _secs_to_ts(cur_end), ' '.join(cur_texts)))
            cur_start, cur_end, cur_texts = start, end, [text]
        else:
            cur_end = end
            cur_texts.append(text)

    if cur_texts:
        merged.append((_secs_to_ts(cur_start), _secs_to_ts(cur_end), ' '.join(cur_texts)))

    return [f"[{s} --> {e}] {t}" for s, e, t in merged]


def main():
    parser = argparse.ArgumentParser(description='Merge AI subtitle MD into sentence blocks')
    parser.add_argument('input', help='Input MD file')
    parser.add_argument('output', help='Output MD file (can be same as input)')
    parser.add_argument('--min-secs', type=float, default=3.0)
    parser.add_argument('--max-secs', type=float, default=6.0)
    args = parser.parse_args()

    with open(args.input, encoding='utf-8') as f:
        lines = f.readlines()

    merged = merge_lines(lines, args.min_secs, args.max_secs)

    with open(args.output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(merged) + '\n')

    print(f"merge_ai_subs: {len(lines)} lines → {len(merged)} blocks")


if __name__ == '__main__':
    main()
