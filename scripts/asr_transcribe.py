#!/usr/bin/env python3
"""
scripts/asr_transcribe.py

ASR transcription using mlx_whisper. Finds video.mp4 or audio.m4a,
extracts audio, transcribes, writes VTT to subs directory.

Usage:
    python3 scripts/asr_transcribe.py <task_id> <work_dir> [--model MODEL]
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile


def format_timestamp(seconds: float) -> str:
    """Convert float seconds to WebVTT timestamp HH:MM:SS.mmm."""
    ms = round(max(seconds, 0.0) * 1000)
    h = ms // 3_600_000
    ms %= 3_600_000
    m = ms // 60_000
    ms %= 60_000
    s = ms // 1_000
    ms %= 1_000
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def segments_to_vtt(segments: list) -> str:
    """Convert mlx_whisper segment dicts to a WEBVTT string."""
    lines = ["WEBVTT"]
    for seg in segments:
        start = format_timestamp(seg["start"])
        end = format_timestamp(seg["end"])
        text = seg["text"].strip()
        lines.append("")
        lines.append(f"{start} --> {end}")
        lines.append(text)
    return "\n".join(lines) + "\n"


def find_media_file(work_dir: str) -> str:
    """Return path to video.mp4 (preferred) or audio.m4a. Raises FileNotFoundError if neither exists."""
    video = os.path.join(work_dir, "media", "video.mp4")
    audio = os.path.join(work_dir, "media", "audio.m4a")
    if os.path.exists(video):
        return video
    if os.path.exists(audio):
        return audio
    raise FileNotFoundError(
        f"No media file found in {work_dir}/media/ — expected video.mp4 or audio.m4a"
    )


def extract_audio(media_path: str, wav_path: str) -> None:
    """Extract mono 16kHz WAV from a media file using ffmpeg."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH")
    cmd = ["ffmpeg", "-y", "-i", media_path, "-ac", "1", "-ar", "16000", "-vn", wav_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe media with mlx_whisper, write VTT.")
    parser.add_argument("task_id", help="12-character task ID")
    parser.add_argument("work_dir", help="Path to work/<task_id>/")
    parser.add_argument(
        "--model",
        default="mlx-community/whisper-large-v3-turbo",
        help="mlx_whisper HF repo or local path",
    )
    parser.add_argument(
        "--lang",
        default="en",
        help="Video language code used for output filename (e.g. en, zh)",
    )
    args = parser.parse_args()

    task_id = args.task_id
    work_dir = args.work_dir
    subs_dir = os.path.join(work_dir, "transcript", "subs")
    vtt_path = os.path.join(subs_dir, f"{task_id}.{args.lang}.asr.vtt")

    # Extract audio to temp WAV
    wav_path = None
    try:
        media_path = find_media_file(work_dir)
        os.makedirs(subs_dir, exist_ok=True)

        with tempfile.NamedTemporaryFile(suffix=".wav", prefix=f"{task_id}_asr_", delete=False) as f:
            wav_path = f.name

        print("[PROGRESS] step=1/3 label=extracting_audio", flush=True)
        extract_audio(media_path, wav_path)

        print("[PROGRESS] step=2/3 label=transcribing", flush=True)
        import mlx_whisper
        result = mlx_whisper.transcribe(wav_path, path_or_hf_repo=args.model, verbose=False)

        segments = result.get("segments", [])
        if not segments:
            print("ERROR: Whisper returned zero segments.", file=sys.stderr)
            sys.exit(1)

        print(f"[PROGRESS] step=3/3 label=writing_vtt segments={len(segments)}", flush=True)
        with open(vtt_path, "w", encoding="utf-8") as f:
            f.write(segments_to_vtt(segments))

        print("Done.", flush=True)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


if __name__ == "__main__":
    main()
