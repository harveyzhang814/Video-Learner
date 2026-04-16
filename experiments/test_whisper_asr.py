import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from whisper_asr import format_timestamp, segments_to_vtt


def test_format_timestamp_seconds():
    assert format_timestamp(4.48) == "00:00:04.480"


def test_format_timestamp_minutes():
    assert format_timestamp(90.5) == "00:01:30.500"


def test_format_timestamp_hours():
    assert format_timestamp(3661.001) == "01:01:01.001"


def test_format_timestamp_negative_clamped():
    assert format_timestamp(-0.1) == "00:00:00.000"


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


def test_extract_audio_missing_input():
    """Should raise FileNotFoundError when source video does not exist."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "out.wav")
        try:
            from whisper_asr import extract_audio
            extract_audio("/nonexistent/video.mp4", wav)
            assert False, "Expected FileNotFoundError"
        except FileNotFoundError:
            pass  # expected


def test_mark_subs_completed():
    import sqlite3, tempfile, re
    from whisper_asr import mark_subs_completed

    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        db_path = f.name

    try:
        con = sqlite3.connect(db_path)
        con.execute("""
            CREATE TABLE steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                step_name TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                error TEXT,
                started_at TEXT,
                completed_at TEXT
            )
        """)
        con.execute(
            "INSERT INTO steps (task_id, step_name, status, error) VALUES (?,?,?,?)",
            ("abc123", "subs", "failed", "No subtitles downloaded"),
        )
        con.commit()
        con.close()

        mark_subs_completed(db_path, "abc123")

        con = sqlite3.connect(db_path)
        row = con.execute(
            "SELECT status, error, completed_at FROM steps WHERE task_id=? AND step_name=?",
            ("abc123", "subs"),
        ).fetchone()
        con.close()
        assert row[0] == "completed", f"expected completed, got {row[0]}"
        assert row[1] is None, f"expected error=None, got {row[1]}"
        assert row[2] is not None, "expected completed_at to be set"
        assert re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$', row[2]), f"unexpected completed_at format: {row[2]}"
    finally:
        os.unlink(db_path)


def test_trigger_vtt2md_bad_url():
    """Should raise urllib.error.URLError on unreachable host."""
    import urllib.error
    from whisper_asr import trigger_vtt2md
    try:
        trigger_vtt2md(
            api_base="http://127.0.0.1:19999",  # nothing listening
            task_id="abc123",
            token="test-token",
        )
        assert False, "Expected URLError"
    except (urllib.error.URLError, OSError):
        pass  # expected


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
