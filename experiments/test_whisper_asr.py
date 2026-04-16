import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from whisper_asr import format_timestamp, segments_to_vtt


def test_format_timestamp_seconds():
    assert format_timestamp(4.48) == "00:00:04.480"


def test_format_timestamp_minutes():
    assert format_timestamp(90.5) == "00:01:30.500"


def test_format_timestamp_hours():
    assert format_timestamp(3661.001) == "01:01:01.001"


def test_segments_to_vtt_header():
    result = segments_to_vtt([])
    assert result.strip() == "WEBVTT"


def test_segments_to_vtt_single():
    segs = [{"start": 4.48, "end": 7.349, "text": " 有時候語言模型"}]
    result = segments_to_vtt(segs)
    assert "WEBVTT" in result
    assert "00:00:04.480 --> 00:00:07.349" in result
    assert "有時候語言模型" in result


def test_segments_to_vtt_strips_leading_space():
    segs = [{"start": 0.0, "end": 1.0, "text": "  hello world"}]
    result = segments_to_vtt(segs)
    assert "hello world" in result
    assert result.count("  hello") == 0


def test_segments_to_vtt_multiple():
    segs = [
        {"start": 0.0, "end": 2.0, "text": " first"},
        {"start": 2.0, "end": 4.0, "text": " second"},
    ]
    result = segments_to_vtt(segs)
    lines = result.strip().splitlines()
    assert lines[0] == "WEBVTT"
    assert "00:00:00.000 --> 00:00:02.000" in result
    assert "00:00:02.000 --> 00:00:04.000" in result


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
