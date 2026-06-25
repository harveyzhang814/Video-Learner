#!/usr/bin/env python3
"""Format validation and repair for translate_subs.sh output.

CLI: python3 translate_validator.py \
       --input <zh_combined.txt> \
       --output <original_zh.md> \
       --en-line-count N \
       --min-coverage N   (default 90)

Exit codes: 0 = pass, 1 = coverage below threshold
"""
import re, sys, argparse

_LINE_RE = re.compile(
    r'^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$'
)


def _ts_to_secs(ts: str) -> float:
    h, m, s = ts.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def _secs_to_ts(secs: float) -> str:
    secs = max(0.0, secs)
    h = int(secs) // 3600
    m = (int(secs) % 3600) // 60
    s_int = int(secs) % 60
    ms = int(round((secs - int(secs)) * 1000)) % 1000
    return f"{h:02d}:{m:02d}:{s_int:02d}.{ms:03d}"


def validate_and_repair(
    lines: list,
    en_line_count: int,
    coverage_threshold: int = 90,
) -> tuple:
    """Parse, repair, sort, and validate coverage of translated subtitle lines.

    Returns:
        (repaired_lines: list[str], coverage_pct: int, warnings: list[str])
    """
    entries = []   # list of [status, start_secs, end_secs, text, orig_index]
    warnings = []

    for i, raw in enumerate(lines):
        line = raw.rstrip()
        if not line:
            continue
        m = _LINE_RE.match(line)
        if m:
            entries.append(['ok', _ts_to_secs(m.group(1)), _ts_to_secs(m.group(2)), m.group(3), i])
        else:
            # Strip any bracket-like fragments; take the rest as content
            content = re.sub(r'\[.*?\]', '', line).strip()
            if content:
                entries.append(['bad', None, None, content, i])
                warnings.append(f"[WARN] malformed line {i+1}: needs ts inference")
            else:
                warnings.append(f"[WARN] dropped line {i+1}: no recoverable content")

    # Infer timestamps for 'bad' entries
    for j, entry in enumerate(entries):
        if entry[0] != 'bad':
            continue

        prev_end = None
        next_start = None
        for k in range(j - 1, -1, -1):
            if entries[k][0] == 'ok':
                prev_end = entries[k][2]
                break
        for k in range(j + 1, len(entries)):
            if entries[k][0] == 'ok':
                next_start = entries[k][1]
                break

        if prev_end is not None and next_start is not None:
            start_s = prev_end
            end_s = min(prev_end + 25.0, next_start)
        elif next_start is not None:
            start_s = max(0.0, next_start - 25.0)
            end_s = next_start
        elif prev_end is not None:
            start_s = prev_end
            end_s = prev_end + 25.0
        else:
            start_s, end_s = 0.0, 25.0

        orig_idx = entry[4]
        warnings.append(
            f"[WARN] repaired line {orig_idx+1}: inferred ts "
            f"{_secs_to_ts(start_s)} --> {_secs_to_ts(end_s)}"
        )
        entries[j] = ['ok', start_s, end_s, entry[3], orig_idx]

    # Sort by start time
    ok_entries = [e for e in entries if e[0] == 'ok']
    ok_entries.sort(key=lambda e: e[1])

    output_lines = [f"[{_secs_to_ts(e[1])} --> {_secs_to_ts(e[2])}] {e[3]}" for e in ok_entries]

    coverage = int(len(output_lines) * 100 / en_line_count) if en_line_count > 0 else 0
    return output_lines, coverage, warnings


def main():
    parser = argparse.ArgumentParser(description='Validate and repair translate_subs.sh output')
    parser.add_argument('--input', required=True, help='Combined zh output file')
    parser.add_argument('--output', required=True, help='Output original_zh.md path')
    parser.add_argument('--en-line-count', type=int, required=True)
    parser.add_argument('--min-coverage', type=int, default=90)
    args = parser.parse_args()

    with open(args.input, encoding='utf-8') as f:
        lines = f.readlines()

    output_lines, coverage, warnings = validate_and_repair(
        lines, args.en_line_count, args.min_coverage
    )

    for w in warnings:
        print(w, file=sys.stderr)

    if coverage < args.min_coverage:
        print(
            f"[STATUS] translate_error: coverage {coverage}% below threshold {args.min_coverage}%",
            file=sys.stderr
        )
        sys.exit(1)

    with open(args.output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(output_lines) + '\n')

    print(f"[STATUS] translate_done: {len(output_lines)} lines, coverage {coverage}%")


if __name__ == '__main__':
    main()
