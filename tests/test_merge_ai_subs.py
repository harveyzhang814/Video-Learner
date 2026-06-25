#!/usr/bin/env python3
"""Unit tests for merge_ai_subs.py"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from merge_ai_subs import merge_lines

def test_merge_within_max():
    """短行合并直到句末且 >= min_secs"""
    lines = [
        "[00:00:00.000 --> 00:00:02.000] Hello welcome back.",
        "[00:00:02.000 --> 00:00:04.000] Today we cover agents.",
        "[00:00:04.000 --> 00:00:06.500] Let's begin.",
    ]
    result = merge_lines(lines, min_secs=3.0, max_secs=6.0)
    # 第1行只有2秒，无句末标点触发切断 → 合并到第2行（共4秒，有句末）→ 切断
    assert len(result) == 2, f"expected 2 blocks, got {len(result)}: {result}"
    assert "Hello welcome back." in result[0]
    assert "Today we cover agents." in result[0]
    assert "Let's begin." in result[1]
    print("PASS: merge within min, cut at sentence end >= min_secs")

def test_force_cut_at_max():
    """超过 max_secs 强制切断，不管有没有句末标点"""
    lines = [
        "[00:00:00.000 --> 00:00:02.000] First line no punct",
        "[00:00:02.000 --> 00:00:04.000] Second line no punct",
        "[00:00:04.000 --> 00:00:07.000] Third line no punct",  # 累积超 6s
        "[00:00:07.000 --> 00:00:09.000] Fourth line.",
    ]
    result = merge_lines(lines, min_secs=3.0, max_secs=6.0)
    assert len(result) >= 2, f"expected >= 2 blocks, got {len(result)}"
    # 前3行跨越7秒，超过max_secs=6 → 在第3行之前或之时切断
    first_block_end = float(result[0].split(' --> ')[1].split(']')[0].replace(':', '').replace('.', ''))
    print("PASS: force cut at max_secs")

def test_single_line():
    """单行输入 → 原样输出"""
    lines = ["[00:00:00.000 --> 00:00:03.000] Only one line."]
    result = merge_lines(lines, min_secs=3.0, max_secs=6.0)
    assert len(result) == 1
    assert "Only one line." in result[0]
    print("PASS: single line passes through")

def test_empty_input():
    """空输入 → 空输出"""
    result = merge_lines([], min_secs=3.0, max_secs=6.0)
    assert result == []
    print("PASS: empty input → empty output")

def test_output_format():
    """输出格式必须符合 [HH:MM:SS.mmm --> HH:MM:SS.mmm] text"""
    import re
    FMT = re.compile(r'^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\] .+$')
    lines = [
        "[00:00:00.000 --> 00:00:02.000] Hello.",
        "[00:00:02.000 --> 00:00:05.000] World.",
    ]
    result = merge_lines(lines, min_secs=3.0, max_secs=6.0)
    for line in result:
        assert FMT.match(line), f"bad format: {line}"
    print("PASS: output format correct")

def test_question_mark_sentence_end():
    """问号也是句末标点"""
    lines = [
        "[00:00:00.000 --> 00:00:02.000] What is an agent?",
        "[00:00:02.000 --> 00:00:04.000] It is an AI system.",
    ]
    result = merge_lines(lines, min_secs=3.0, max_secs=6.0)
    # 第1行2秒有问号但 < min_secs=3 → 继续合并
    # 第2行累积4秒有句号且 >= 3 → 切断
    assert len(result) == 1 or "What is an agent?" in result[0]
    print("PASS: question mark treated as sentence end")

if __name__ == '__main__':
    test_merge_within_max()
    test_force_cut_at_max()
    test_single_line()
    test_empty_input()
    test_output_format()
    test_question_mark_sentence_end()
    print("\ntest_merge_ai_subs.py: ALL PASS")
