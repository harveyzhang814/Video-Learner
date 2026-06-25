#!/usr/bin/env python3
"""Unit tests for translate_validator.py"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from translate_validator import validate_and_repair

def test_valid_lines_pass_through():
    """合法行原样保留"""
    lines = [
        "[00:00:00.000 --> 00:00:03.000] 大家好",
        "[00:00:03.000 --> 00:00:06.000] 欢迎回来",
    ]
    out, coverage, warnings = validate_and_repair(lines, en_line_count=2)
    assert len(out) == 2
    assert coverage == 100
    assert warnings == []
    print("PASS: valid lines pass through unchanged")

def test_malformed_line_repaired():
    """异常行推断时间戳后修复"""
    lines = [
        "[00:00:00.000 --> 00:00:03.000] 正常行",
        "没有时间戳的中文内容",           # 异常行
        "[00:00:06.000 --> 00:00:09.000] 另一正常行",
    ]
    out, coverage, warnings = validate_and_repair(lines, en_line_count=3)
    assert len(out) == 3, f"expected 3 lines, got {len(out)}: {out}"
    # 修复行的时间戳应在 00:00:03 ~ 00:00:06 之间
    assert "00:00:03" in out[1] or "00:00:04" in out[1] or "00:00:05" in out[1], \
        f"repaired ts not in expected range: {out[1]}"
    assert any("repaired" in w for w in warnings)
    print("PASS: malformed line gets timestamp inferred from context")

def test_coverage_below_threshold_fails():
    """覆盖率低于阈值时返回覆盖率 < threshold"""
    lines = [
        "[00:00:00.000 --> 00:00:03.000] 仅一行",
    ]
    out, coverage, warnings = validate_and_repair(lines, en_line_count=10, coverage_threshold=90)
    assert coverage < 90, f"coverage should be < 90, got {coverage}"
    print("PASS: low coverage correctly reported")

def test_coverage_at_threshold_passes():
    """覆盖率达到阈值时通过"""
    lines = [f"[00:00:{i:02d}.000 --> 00:00:{i+1:02d}.000] 行{i}" for i in range(9)]
    out, coverage, warnings = validate_and_repair(lines, en_line_count=10, coverage_threshold=90)
    assert coverage >= 90, f"coverage should be >= 90, got {coverage}"
    print("PASS: coverage at threshold passes")

def test_output_format_correct():
    """所有输出行符合格式"""
    import re
    FMT = re.compile(r'^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\] .+$')
    lines = [
        "[00:00:00.000 --> 00:00:03.000] 行一",
        "破损内容无时间戳",
        "[00:00:06.000 --> 00:00:09.000] 行三",
    ]
    out, _, _ = validate_and_repair(lines, en_line_count=3)
    for line in out:
        assert FMT.match(line), f"bad format: {line}"
    print("PASS: all output lines match required format")

def test_disordered_lines_sorted():
    """乱序行修复后按时间戳排序"""
    lines = [
        "[00:00:06.000 --> 00:00:09.000] 第三行",
        "[00:00:00.000 --> 00:00:03.000] 第一行",
        "[00:00:03.000 --> 00:00:06.000] 第二行",
    ]
    out, _, _ = validate_and_repair(lines, en_line_count=3)
    assert "第一行" in out[0]
    assert "第二行" in out[1]
    assert "第三行" in out[2]
    print("PASS: disordered lines are sorted by timestamp")

def test_head_orphan_infers_ts():
    """头部孤立异常行用 next_start - 25 推断时间戳"""
    lines = [
        "孤立头部行",
        "[00:00:30.000 --> 00:00:33.000] 后续正常行",
    ]
    out, _, warnings = validate_and_repair(lines, en_line_count=2)
    assert len(out) == 2
    assert any("repaired" in w for w in warnings)
    print("PASS: head orphan line gets ts inferred from next_start - 25")

def test_tail_orphan_infers_ts():
    """尾部孤立异常行用 prev_end + 25 推断时间戳"""
    lines = [
        "[00:01:05.000 --> 00:01:10.000] 前面正常行",
        "孤立尾部行",
    ]
    out, _, warnings = validate_and_repair(lines, en_line_count=2)
    assert len(out) == 2
    # repaired ts start should be prev_end = 00:01:10
    assert "00:01:10" in out[1], f"tail orphan start should be prev_end: {out[1]}"
    assert any("repaired" in w for w in warnings)
    print("PASS: tail orphan line gets ts inferred from prev_end + 25")

if __name__ == '__main__':
    test_valid_lines_pass_through()
    test_malformed_line_repaired()
    test_coverage_below_threshold_fails()
    test_coverage_at_threshold_passes()
    test_output_format_correct()
    test_disordered_lines_sorted()
    test_head_orphan_infers_ts()
    test_tail_orphan_infers_ts()
    print("\ntest_translate_validation.py: ALL PASS")
