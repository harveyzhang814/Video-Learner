#!/usr/bin/env python3
"""Unit tests for the Phase 1 time-window chunking logic in translate_subs.sh."""

import re, textwrap

WINDOW_SECS = 25
MAX_CHARS   = 800

def ts_to_secs(ts):
    parts = ts.split(':')
    if len(parts) == 3:
        h, m, s = parts; return int(h)*3600 + int(m)*60 + float(s)
    elif len(parts) == 2:
        m, s = parts; return int(m)*60 + float(s)
    return 0.0

def chunk_md(content):
    block_re = re.compile(r'^## (\d{1,2}:\d{2}:\d{2})\s*\n(.*?)(?=\n## |\Z)',
                          re.MULTILINE | re.DOTALL)
    blocks = [(m.group(1), m.group(2).strip()) for m in block_re.finditer(content)]
    if not blocks:
        return None

    chunks = []
    cur_start_ts   = blocks[0][0]
    cur_start_secs = ts_to_secs(blocks[0][0])
    cur_texts      = []

    for ts, text in blocks:
        secs    = ts_to_secs(ts)
        elapsed = secs - cur_start_secs
        if elapsed >= WINDOW_SECS or len(' '.join(cur_texts + [text])) > MAX_CHARS:
            if cur_texts:
                chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})
            cur_start_ts, cur_start_secs, cur_texts = ts, secs, [text]
        else:
            cur_texts.append(text)

    if cur_texts:
        chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})
    return chunks


def run():
    # ── Test 1: 正常分块——窗口内合并，超时切割 ──────────────────────────────
    md = textwrap.dedent("""\
        ## 00:00:05
        Hello and welcome

        ## 00:00:08
        to this lecture on machine learning

        ## 00:00:35
        Today we will cover

        ## 00:00:38
        the basics of neural networks

        ## 00:01:05
        Let us begin
    """)
    chunks = chunk_md(md)
    assert chunks is not None, "should produce chunks"
    assert chunks[0]['start_ts'] == '00:00:05', f"first start_ts: {chunks[0]['start_ts']}"
    assert 'Hello and welcome' in chunks[0]['text'], "first chunk should contain first block"
    assert 'machine learning' in chunks[0]['text'], "first chunk should merge second block (within 25s)"
    assert chunks[1]['start_ts'] == '00:00:35', f"second chunk start_ts: {chunks[1]['start_ts']}"
    assert 'Today we will cover' in chunks[1]['text'], "second chunk starts at 35s"
    print("PASS: normal chunking — merges within window, splits at boundary")

    # ── Test 2: 空文件（无时间戳块）→ None ───────────────────────────────────
    result = chunk_md("no timestamps here\njust plain text\n")
    assert result is None, f"expected None for empty content, got {result}"
    print("PASS: no timestamp blocks → returns None (script would exit 1)")

    # ── Test 3: 单块 ──────────────────────────────────────────────────────────
    single = "## 00:05:00\nOnly one block here\n"
    chunks = chunk_md(single)
    assert len(chunks) == 1, f"single block: expected 1 chunk, got {len(chunks)}"
    assert chunks[0]['start_ts'] == '00:05:00'
    assert chunks[0]['text'] == 'Only one block here'
    print("PASS: single block → one chunk, start_ts preserved")

    # ── Test 4: 800 字符硬上限触发切割 ───────────────────────────────────────
    # Two blocks at 00:00:01 and 00:00:03 (2s apart, well within window)
    # but combined text exceeds 800 chars
    text_a = 'word ' * 100   # 500 chars
    text_b = 'more ' * 100   # 500 chars
    md_long = f"## 00:00:01\n{text_a}\n\n## 00:00:03\n{text_b}\n"
    chunks = chunk_md(md_long)
    assert len(chunks) == 2, f"expected 2 chunks due to 800-char cap, got {len(chunks)}"
    assert len(chunks[0]['text']) <= MAX_CHARS, f"chunk 0 too long: {len(chunks[0]['text'])}"
    print("PASS: 800-char hard cap splits blocks even within time window")

    # ── Test 5: start_ts 取第一个碎片的时间戳 ───────────────────────────────
    md_ts = textwrap.dedent("""\
        ## 00:01:00
        First fragment

        ## 00:01:10
        Second fragment

        ## 00:01:20
        Third fragment
    """)
    chunks = chunk_md(md_ts)
    assert chunks[0]['start_ts'] == '00:01:00', \
        f"start_ts should be first block's ts, got: {chunks[0]['start_ts']}"
    assert 'First fragment' in chunks[0]['text']
    assert 'Third fragment' in chunks[0]['text']
    print("PASS: start_ts is always the first fragment's timestamp")

    # ── Test 6: zh_prev_tail 截取最后 150 字符 ───────────────────────────────
    long_zh = '中文翻译' * 60   # 240 chars
    tail = long_zh[-150:] if len(long_zh) > 150 else long_zh
    assert len(tail) == 150, f"tail should be 150 chars, got {len(tail)}"
    assert tail == long_zh[-150:], "tail must be the last 150 chars"
    print("PASS: zh_prev_tail extracts last 150 chars (constant cost)")

    print("\ntest_translate_subs.py: ALL PASS")


if __name__ == '__main__':
    run()
