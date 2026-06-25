#!/usr/bin/env python3
"""Unit tests for translate_subs.sh Phase 1 page-splitting logic."""

def split_pages(lines, page_size):
    """Mirror of translate_subs.sh Phase 1 page-splitting."""
    content_lines = [l for l in lines if l.strip()]
    pages = []
    for start in range(0, len(content_lines), page_size):
        pages.append(content_lines[start:start + page_size])
    return pages


def test_exact_page_size():
    """200 行恰好分成 1 页"""
    lines = [f"[00:00:{i:02d}.000 --> 00:00:{i+1:02d}.000] Line {i}.\n" for i in range(200)]
    pages = split_pages(lines, page_size=200)
    assert len(pages) == 1
    assert len(pages[0]) == 200
    print("PASS: 200 lines → 1 page of 200")

def test_over_page_size():
    """250 行分成 2 页（200 + 50）"""
    lines = [f"[00:00:{i:02d}.000 --> 00:00:{i+1:02d}.000] Line {i}.\n" for i in range(250)]
    pages = split_pages(lines, page_size=200)
    assert len(pages) == 2
    assert len(pages[0]) == 200
    assert len(pages[1]) == 50
    print("PASS: 250 lines → 2 pages (200 + 50)")

def test_single_page_short_video():
    """短视频（50 行）只有 1 页"""
    lines = [f"[00:00:{i:02d}.000 --> 00:00:{i+1:02d}.000] Short.\n" for i in range(50)]
    pages = split_pages(lines, page_size=200)
    assert len(pages) == 1
    assert len(pages[0]) == 50
    print("PASS: 50 lines → 1 page")

def test_empty_lines_skipped():
    """空行不计入分页内容"""
    lines = ["[00:00:00.000 --> 00:00:01.000] Hello.\n", "\n", "\n",
             "[00:00:01.000 --> 00:00:02.000] World.\n"]
    pages = split_pages(lines, page_size=200)
    assert len(pages) == 1
    assert len(pages[0]) == 2, f"expected 2 content lines, got {len(pages[0])}"
    print("PASS: empty lines excluded from page content")

def test_large_video_page_count():
    """2 小时视频约 800 行 → 4 页（PAGE_SIZE=200）"""
    lines = [f"[{i//3600:02d}:{(i%3600)//60:02d}:{i%60:02d}.000 --> "
             f"{(i+3)//3600:02d}:{((i+3)%3600)//60:02d}:{(i+3)%60:02d}.000] L{i}.\n"
             for i in range(0, 2400, 3)]  # 800 lines, 3s each = 2400s = 40min
    pages = split_pages(lines, page_size=200)
    assert len(pages) == 4
    assert all(len(p) == 200 for p in pages)
    print("PASS: 800 lines → 4 pages of 200")

def test_page_size_configurable():
    """PAGE_SIZE 参数有效，100 行 / 页"""
    lines = [f"[00:00:{i:02d}.000 --> 00:00:{i+1:02d}.000] L{i}.\n" for i in range(300)]
    pages = split_pages(lines, page_size=100)
    assert len(pages) == 3
    assert all(len(p) == 100 for p in pages)
    print("PASS: configurable page_size=100 works")


if __name__ == '__main__':
    test_exact_page_size()
    test_over_page_size()
    test_single_page_short_video()
    test_empty_lines_skipped()
    test_large_video_page_count()
    test_page_size_configurable()
    print("\ntest_translate_subs.py: ALL PASS")
