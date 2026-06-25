#!/usr/bin/env python3
"""E2E tests for the subtitle processing pipeline.

Covers: vtt2md (with/without pre-merge) → translate (mock LLM) → md2vtt
Uses historical VTT fixtures from tests/e2e/fixtures/.

Run: python3 tests/e2e/test_subtitle_pipeline.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCRIPTS = os.path.join(ROOT, 'scripts')
FIXTURES = os.path.join(ROOT, 'tests', 'e2e', 'fixtures')
MOCK_LLM = os.path.join(ROOT, 'tests', 'e2e', 'mock_llm_engine.sh')

VTT_WEBVTT_RE = re.compile(r'^WEBVTT')
VTT_CUE_TS_RE = re.compile(r'^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}')
MD_LINE_RE = re.compile(r'^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] .+$')


# ── helpers ───────────────────────────────────────────────────────────────────

def _ts_to_secs(ts):
    h, m, s = ts.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def run_vtt2md(vtt_path, out_md, env_extra=None):
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    r = subprocess.run(
        ['bash', os.path.join(SCRIPTS, 'convert_vtt_md.sh'), vtt_path, out_md],
        capture_output=True, text=True, env=env, cwd=ROOT
    )
    return r


def run_translate(in_md, out_md, env_extra=None):
    env = os.environ.copy()
    env['LLM_ENGINE_SCRIPT'] = MOCK_LLM
    env['TRANSLATE_PAGE_SIZE'] = '200'
    env['TRANSLATE_PARALLEL'] = '3'
    env['TRANSLATE_PAGE_TIMEOUT'] = '30'
    env['TRANSLATE_MIN_COVERAGE'] = '90'
    if env_extra:
        env.update(env_extra)
    r = subprocess.run(
        ['bash', os.path.join(SCRIPTS, 'translate_subs.sh'), in_md, out_md],
        capture_output=True, text=True, env=env, cwd=ROOT
    )
    return r


def run_md2vtt(in_md, out_vtt):
    r = subprocess.run(
        ['bash', os.path.join(SCRIPTS, 'convert_md_vtt.sh'), in_md, out_vtt],
        capture_output=True, text=True, cwd=ROOT
    )
    return r


def md_lines(path):
    with open(path, encoding='utf-8') as f:
        return [l.rstrip() for l in f if MD_LINE_RE.match(l.rstrip())]


def vtt_cues(path):
    """Return list of (start_secs, end_secs) for each cue in a VTT."""
    cues = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = VTT_CUE_TS_RE.match(line.strip())
            if m:
                parts = line.strip().split(' --> ')
                start = _ts_to_secs(parts[0].split()[0])
                end = _ts_to_secs(parts[1].split()[0])
                cues.append((start, end))
    return cues


def avg_cue_duration(cues):
    if not cues:
        return 0
    return sum(e - s for s, e in cues) / len(cues)


# ── S1: en.auto.vtt → pre-merge → translate → md2vtt ─────────────────────────

def test_s1_en_auto_full_pipeline():
    """S1: YouTube AI English — pre-merge + translate + md2vtt"""
    with tempfile.TemporaryDirectory() as d:
        vtt_in = os.path.join(d, 'video.en.auto.vtt')
        shutil.copy(os.path.join(FIXTURES, 'en_auto.vtt'), vtt_in)
        en_md = os.path.join(d, 'original_en.md')
        zh_md = os.path.join(d, 'original_zh.md')
        zh_vtt = os.path.join(d, 'original_zh.vtt')

        # vtt2md
        r = run_vtt2md(vtt_in, en_md)
        assert r.returncode == 0, f"vtt2md failed: {r.stdout}{r.stderr}"
        assert 'vtt2md_merging' in r.stdout, "expected pre-merge for .auto.vtt"
        en_lines = md_lines(en_md)
        assert len(en_lines) > 0, "en.md is empty"

        # pre-merge: average cue duration should be >= 3s
        durations = [_ts_to_secs(MD_LINE_RE.match(l).group(2)) -
                     _ts_to_secs(MD_LINE_RE.match(l).group(1)) for l in en_lines]
        avg_dur = sum(durations) / len(durations)
        assert avg_dur >= 3.0, f"avg cue duration {avg_dur:.2f}s < 3s — pre-merge may not have fired"

        # translate
        r = run_translate(en_md, zh_md)
        assert r.returncode == 0, f"translate failed: {r.stdout}{r.stderr}"
        zh_lines = md_lines(zh_md)
        assert len(zh_lines) == len(en_lines), \
            f"zh line count {len(zh_lines)} != en line count {len(en_lines)}"

        # md2vtt
        r = run_md2vtt(zh_md, zh_vtt)
        assert r.returncode == 0, f"md2vtt failed: {r.stdout}{r.stderr}"
        assert os.path.exists(zh_vtt), "zh.vtt not created"
        with open(zh_vtt) as f:
            content = f.read()
        assert content.startswith('WEBVTT'), "VTT missing WEBVTT header"
        cues = vtt_cues(zh_vtt)
        assert len(cues) > 0, "VTT has no cues"
        # timestamps monotonically increasing
        for i in range(1, len(cues)):
            assert cues[i][0] >= cues[i-1][0], \
                f"non-monotonic timestamps at cue {i}: {cues[i-1]} → {cues[i]}"

    print("PASS S1: en.auto.vtt → pre-merge + translate + md2vtt")


# ── S2: en.original.vtt → NO pre-merge → translate → md2vtt ──────────────────

def test_s2_en_original_no_merge():
    """S2: YouTube native English — no pre-merge, translate, md2vtt"""
    with tempfile.TemporaryDirectory() as d:
        vtt_in = os.path.join(d, 'video.en.original.vtt')
        shutil.copy(os.path.join(FIXTURES, 'en_original.vtt'), vtt_in)
        en_md = os.path.join(d, 'original_en.md')
        zh_md = os.path.join(d, 'original_zh.md')
        zh_vtt = os.path.join(d, 'original_zh.vtt')

        r = run_vtt2md(vtt_in, en_md)
        assert r.returncode == 0, f"vtt2md failed: {r.stderr}"
        assert 'vtt2md_merging' not in r.stdout, "unexpected pre-merge for .original.vtt"

        r = run_translate(en_md, zh_md)
        assert r.returncode == 0, f"translate failed: {r.stdout}{r.stderr}"
        zh_lines = md_lines(zh_md)
        en_lines = md_lines(en_md)
        assert len(zh_lines) == len(en_lines), \
            f"zh {len(zh_lines)} != en {len(en_lines)} lines"

        r = run_md2vtt(zh_md, zh_vtt)
        assert r.returncode == 0, f"md2vtt failed: {r.stderr}"
        cues = vtt_cues(zh_vtt)
        assert len(cues) > 0

    print("PASS S2: en.original.vtt → no pre-merge + translate + md2vtt")


# ── S3: zh.asr.vtt → pre-merge only (no translate) → md2vtt ─────────────────

def test_s3_zh_asr_premerge_only():
    """S3: Whisper ASR Chinese — pre-merge, no translation step"""
    with tempfile.TemporaryDirectory() as d:
        vtt_in = os.path.join(d, 'video.zh.asr.vtt')
        shutil.copy(os.path.join(FIXTURES, 'zh_asr.vtt'), vtt_in)
        zh_md = os.path.join(d, 'original_zh.md')
        zh_vtt = os.path.join(d, 'original_zh.vtt')

        r = run_vtt2md(vtt_in, zh_md)
        assert r.returncode == 0, f"vtt2md failed: {r.stderr}"
        assert 'vtt2md_merging' in r.stdout, "expected pre-merge for .asr.vtt"
        zh_lines = md_lines(zh_md)
        assert len(zh_lines) > 0

        durations = [_ts_to_secs(MD_LINE_RE.match(l).group(2)) -
                     _ts_to_secs(MD_LINE_RE.match(l).group(1)) for l in zh_lines]
        avg_dur = sum(durations) / len(durations)
        assert avg_dur >= 3.0, f"avg cue duration {avg_dur:.2f}s < 3s after pre-merge"

        r = run_md2vtt(zh_md, zh_vtt)
        assert r.returncode == 0, f"md2vtt failed: {r.stderr}"
        assert os.path.exists(zh_vtt)
        cues = vtt_cues(zh_vtt)
        assert len(cues) > 0

    print("PASS S3: zh.asr.vtt → pre-merge only + md2vtt")


# ── S4: zh.original.vtt → NO pre-merge, NO translate → md2vtt ───────────────

def test_s4_zh_original_passthrough():
    """S4: Native Chinese — no pre-merge, no translation, direct md2vtt"""
    with tempfile.TemporaryDirectory() as d:
        vtt_in = os.path.join(d, 'video.zh.original.vtt')
        shutil.copy(os.path.join(FIXTURES, 'zh_original.vtt'), vtt_in)
        zh_md = os.path.join(d, 'original_zh.md')
        zh_vtt = os.path.join(d, 'original_zh.vtt')

        r = run_vtt2md(vtt_in, zh_md)
        assert r.returncode == 0, f"vtt2md failed: {r.stderr}"
        assert 'vtt2md_merging' not in r.stdout, "unexpected pre-merge for .original.vtt"

        r = run_md2vtt(zh_md, zh_vtt)
        assert r.returncode == 0, f"md2vtt failed: {r.stderr}"
        cues = vtt_cues(zh_vtt)
        assert len(cues) > 0

    print("PASS S4: zh.original.vtt → no pre-merge + direct md2vtt")


# ── S5: zh.auto.vtt → pre-merge only → md2vtt ───────────────────────────────

def test_s5_zh_auto_premerge_only():
    """S5: Platform AI Chinese — pre-merge, no translation"""
    with tempfile.TemporaryDirectory() as d:
        vtt_in = os.path.join(d, 'video.zh.auto.vtt')
        shutil.copy(os.path.join(FIXTURES, 'zh_auto.vtt'), vtt_in)
        zh_md = os.path.join(d, 'original_zh.md')
        zh_vtt = os.path.join(d, 'original_zh.vtt')

        r = run_vtt2md(vtt_in, zh_md)
        assert r.returncode == 0, f"vtt2md failed: {r.stderr}"
        assert 'vtt2md_merging' in r.stdout, "expected pre-merge for .auto.vtt"

        r = run_md2vtt(zh_md, zh_vtt)
        assert r.returncode == 0, f"md2vtt failed: {r.stderr}"
        assert os.path.exists(zh_vtt)

    print("PASS S5: zh.auto.vtt → pre-merge only + md2vtt")


# ── S6: long en.auto.vtt → pre-merge → multi-page translate → md2vtt ─────────

def test_s6_long_multi_page_translation():
    """S6: Long AI subtitle (250 cues) — multi-page translation (PAGE_SIZE=200)"""
    with tempfile.TemporaryDirectory() as d:
        vtt_in = os.path.join(d, 'video.en.auto.vtt')
        shutil.copy(os.path.join(FIXTURES, 'en_auto_long.vtt'), vtt_in)
        en_md = os.path.join(d, 'original_en.md')
        zh_md = os.path.join(d, 'original_zh.md')
        zh_vtt = os.path.join(d, 'original_zh.vtt')

        r = run_vtt2md(vtt_in, en_md)
        assert r.returncode == 0, f"vtt2md failed: {r.stderr}"
        en_lines = md_lines(en_md)

        # Translate with small page size to force 2+ pages (after pre-merge, lines < 250)
        r = run_translate(en_md, zh_md, env_extra={'TRANSLATE_PAGE_SIZE': '15'})
        assert r.returncode == 0, f"translate failed: {r.stdout}{r.stderr}"
        m = re.search(r'translate_chunks: (\d+)', r.stdout)
        assert m and int(m.group(1)) >= 2, \
            f"expected multi-page (PAGE_SIZE=15), got: {r.stdout}"

        zh_lines = md_lines(zh_md)
        coverage = len(zh_lines) * 100 // len(en_lines) if en_lines else 0
        assert coverage >= 90, f"coverage {coverage}% below 90%"

        r = run_md2vtt(zh_md, zh_vtt)
        assert r.returncode == 0, f"md2vtt failed: {r.stderr}"
        cues = vtt_cues(zh_vtt)
        assert len(cues) > 0
        # timestamps monotonically non-decreasing
        for i in range(1, len(cues)):
            assert cues[i][0] >= cues[i-1][0], \
                f"non-monotonic at cue {i}: {cues[i-1]} → {cues[i]}"

    print("PASS S6: en_auto_long.vtt → multi-page translate + md2vtt")


# ── S7: malformed translate output → validator repairs → md2vtt ──────────────

def test_s7_validator_repairs_malformed_output():
    """S7: Some translation lines are malformed — validator repairs them"""
    with tempfile.TemporaryDirectory() as d:
        # Create a synthetic original_en.md (10 lines)
        en_md = os.path.join(d, 'original_en.md')
        with open(en_md, 'w') as f:
            for i in range(10):
                s, e = i * 3, i * 3 + 3
                f.write(f"[{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}.000 --> "
                        f"{e//3600:02d}:{(e%3600)//60:02d}:{e%60:02d}.000] English line {i}\n")

        # Create a "translation" with 2 malformed lines out of 10
        zh_combined = os.path.join(d, 'zh_combined.txt')
        with open(zh_combined, 'w') as f:
            for i in range(10):
                s, e = i * 3, i * 3 + 3
                if i in (3, 7):
                    f.write(f"损坏行内容 {i}\n")   # no timestamp
                else:
                    f.write(f"[{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}.000 --> "
                            f"{e//3600:02d}:{(e%3600)//60:02d}:{e%60:02d}.000] 翻译行 {i}\n")

        zh_md = os.path.join(d, 'original_zh.md')
        r = subprocess.run(
            ['python3', os.path.join(SCRIPTS, 'translate_validator.py'),
             '--input', zh_combined, '--output', zh_md,
             '--en-line-count', '10', '--min-coverage', '90'],
            capture_output=True, text=True, cwd=ROOT
        )
        assert r.returncode == 0, f"validator failed (coverage too low?): {r.stderr}"
        assert 'translate_done' in r.stdout
        out_lines = md_lines(zh_md)
        assert len(out_lines) == 10, f"expected 10 lines after repair, got {len(out_lines)}"

        zh_vtt = os.path.join(d, 'original_zh.vtt')
        r = run_md2vtt(zh_md, zh_vtt)
        assert r.returncode == 0, f"md2vtt failed: {r.stderr}"
        cues = vtt_cues(zh_vtt)
        assert len(cues) == 10

    print("PASS S7: malformed translate output repaired by validator")


# ── S8: coverage below threshold → translate step fails ──────────────────────

def test_s8_low_coverage_fails():
    """S8: Coverage below 90% causes translate step to fail"""
    with tempfile.TemporaryDirectory() as d:
        en_md = os.path.join(d, 'original_en.md')
        with open(en_md, 'w') as f:
            for i in range(20):
                s, e = i * 3, i * 3 + 3
                f.write(f"[{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}.000 --> "
                        f"{e//3600:02d}:{(e%3600)//60:02d}:{e%60:02d}.000] Line {i}\n")

        # Only 5 valid lines out of 20 → coverage 25%
        zh_combined = os.path.join(d, 'zh_bad.txt')
        with open(zh_combined, 'w') as f:
            for i in range(5):
                s, e = i * 3, i * 3 + 3
                f.write(f"[{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}.000 --> "
                        f"{e//3600:02d}:{(e%3600)//60:02d}:{e%60:02d}.000] 翻译行 {i}\n")

        zh_md = os.path.join(d, 'original_zh.md')
        r = subprocess.run(
            ['python3', os.path.join(SCRIPTS, 'translate_validator.py'),
             '--input', zh_combined, '--output', zh_md,
             '--en-line-count', '20', '--min-coverage', '90'],
            capture_output=True, text=True, cwd=ROOT
        )
        assert r.returncode == 1, f"expected exit 1 for low coverage, got {r.returncode}"
        assert 'translate_error' in r.stderr
        assert 'below threshold' in r.stderr

    print("PASS S8: low coverage (25%) correctly fails validator")


# ── runner ────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    tests = [
        test_s1_en_auto_full_pipeline,
        test_s2_en_original_no_merge,
        test_s3_zh_asr_premerge_only,
        test_s4_zh_original_passthrough,
        test_s5_zh_auto_premerge_only,
        test_s6_long_multi_page_translation,
        test_s7_validator_repairs_malformed_output,
        test_s8_low_coverage_fails,
    ]
    failed = []
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"FAIL {t.__name__}: {e}")
            failed.append(t.__name__)

    print(f"\n{'='*50}")
    total = len(tests)
    passed = total - len(failed)
    print(f"test_subtitle_pipeline.py: {passed}/{total} PASS")
    if failed:
        for f in failed:
            print(f"  FAILED: {f}")
        sys.exit(1)
