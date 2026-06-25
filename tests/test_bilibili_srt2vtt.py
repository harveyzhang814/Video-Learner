#!/usr/bin/env python3
"""Unit tests for scripts/bilibili/srt2vtt.py"""
import os
import sys
import textwrap
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'bilibili'))
from srt2vtt import srt_to_vtt


class TestSrtToVtt(unittest.TestCase):

    def test_header_present(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\nHello\n"
        result = srt_to_vtt(srt)
        self.assertTrue(result.startswith("WEBVTT"))

    def test_sequence_numbers_removed(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\nHello\n\n2\n00:00:04,150 --> 00:00:07,280\nWorld\n"
        result = srt_to_vtt(srt)
        # sequence numbers should not appear as standalone lines
        lines = result.split('\n')
        self.assertNotIn("1", lines)
        self.assertNotIn("2", lines)

    def test_comma_replaced_with_dot(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\nHello\n"
        result = srt_to_vtt(srt)
        self.assertIn("00:00:00.160 --> 00:00:04.150", result)
        body = result.split("WEBVTT", 1)[1]
        self.assertNotIn(",", body)

    def test_text_preserved(self):
        srt = "1\n00:00:00,160 --> 00:00:04,150\n零基础学it月薪过万\n"
        result = srt_to_vtt(srt)
        self.assertIn("零基础学it月薪过万", result)

    def test_multiple_entries(self):
        srt = textwrap.dedent("""\
            1
            00:00:00,160 --> 00:00:04,150
            First line

            2
            00:00:04,150 --> 00:00:07,280
            Second line

            3
            00:00:07,980 --> 00:00:09,620
            Third line
        """)
        result = srt_to_vtt(srt)
        self.assertIn("First line", result)
        self.assertIn("Second line", result)
        self.assertIn("Third line", result)
        self.assertIn("00:00:00.160 --> 00:00:04.150", result)
        self.assertIn("00:00:04.150 --> 00:00:07.280", result)

    def test_empty_input(self):
        result = srt_to_vtt("")
        self.assertEqual(result.strip(), "WEBVTT")

    def test_malformed_block_skipped(self):
        srt = "1\n00:00:00,000 --> 00:00:01,000\n\n2\n00:00:01,000 --> 00:00:02,000\nGood line\n"
        result = srt_to_vtt(srt)
        self.assertIn("Good line", result)

    def test_hours_preserved(self):
        srt = "1\n01:30:00,000 --> 01:30:05,000\nLong video\n"
        result = srt_to_vtt(srt)
        self.assertIn("01:30:00.000 --> 01:30:05.000", result)


if __name__ == '__main__':
    unittest.main()
