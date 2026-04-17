#!/usr/bin/env python3
"""Unit tests for scripts/asr_transcribe.py"""
import os
import sys
import tempfile
import unittest

# Add scripts/ to path so we can import asr_transcribe
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from asr_transcribe import format_timestamp, segments_to_vtt, find_media_file


class TestFormatTimestamp(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(format_timestamp(0.0), "00:00:00.000")

    def test_seconds(self):
        self.assertEqual(format_timestamp(5.5), "00:00:05.500")

    def test_minutes(self):
        self.assertEqual(format_timestamp(90.0), "00:01:30.000")

    def test_hours(self):
        self.assertEqual(format_timestamp(3661.0), "01:01:01.000")

    def test_negative_clamped_to_zero(self):
        self.assertEqual(format_timestamp(-0.5), "00:00:00.000")


class TestSegmentsToVtt(unittest.TestCase):
    def test_empty(self):
        result = segments_to_vtt([])
        self.assertEqual(result, "WEBVTT\n")

    def test_single_segment(self):
        segs = [{"start": 1.0, "end": 3.0, "text": " hello "}]
        result = segments_to_vtt(segs)
        self.assertIn("WEBVTT", result)
        self.assertIn("00:00:01.000 --> 00:00:03.000", result)
        self.assertIn("hello", result)
        self.assertNotIn(" hello ", result)   # text is stripped
        self.assertTrue(result.endswith("\n"))

    def test_multiple_segments(self):
        segs = [
            {"start": 0.0, "end": 2.0, "text": "first"},
            {"start": 2.0, "end": 4.0, "text": "second"},
        ]
        result = segments_to_vtt(segs)
        self.assertIn("first", result)
        self.assertIn("second", result)


class TestFindMediaFile(unittest.TestCase):
    def test_no_media_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = os.path.join(tmp, "media")
            os.makedirs(media_dir)
            with self.assertRaises(FileNotFoundError):
                find_media_file(tmp)

    def test_video_preferred(self):
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = os.path.join(tmp, "media")
            os.makedirs(media_dir)
            video = os.path.join(media_dir, "video.mp4")
            audio = os.path.join(media_dir, "audio.m4a")
            open(video, "w").close()
            open(audio, "w").close()
            self.assertEqual(find_media_file(tmp), video)

    def test_audio_fallback_when_no_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = os.path.join(tmp, "media")
            os.makedirs(media_dir)
            audio = os.path.join(media_dir, "audio.m4a")
            open(audio, "w").close()
            self.assertEqual(find_media_file(tmp), audio)


if __name__ == "__main__":
    unittest.main(verbosity=2)
