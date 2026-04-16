# Traditional Chinese Subtitle Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When both English original (`en-orig`) and Simplified Chinese original (`zh-Hans`) subtitles are unavailable, fallback to Traditional Chinese (`zh-TW`/`zh-Hant`) subtitles (original first, then auto) while keeping downstream outputs compatible (`*.zh.*` → `original_zh.md`).

**Architecture:** Keep the existing “download to `en`/`zh` channels” naming contract. Add a strict fallback gate (both originals missing) and expand subtitle language-code detection to include `zh-TW`. Apply the same rule in both orchestrator (`scripts/download_subs.sh`) and the all-in-one CLI path (`scripts/run.sh` inside `get_transcript()`).

**Tech Stack:** Bash (`yt-dlp`, `grep`, `awk`), existing bash test scripts.

---

### Task 1: Add a deterministic selection test harness (no network)

**Files:**
- Modify: `scripts/download_subs.sh`
- Modify: `scripts/run.sh`
- Create: `scripts/test_subtitle_fallback_logic.sh`

**Step 1: Write the failing test**

Create `scripts/test_subtitle_fallback_logic.sh` that runs purely locally by injecting a simulated `available_subs` list and asserting which subtitle language codes would be attempted.

- Approach: add a small pure function in each script (or a shared snippet sourced by both) that accepts `available_subs` text and outputs an ordered list of “attempts”, e.g.:
  - `attempt en-orig original`
  - `attempt en auto`
  - `attempt zh-Hans original`
  - `attempt zh auto`
  - `attempt zh-TW original` (only when gated)
  - `attempt zh-Hant original`
  - `attempt zh-TW auto`
  - `attempt zh-Hant auto`

Test cases (at minimum):
- Case A: `available_subs="zh-TW"` only → expect attempts include `zh-TW original` **ONLY AFTER** confirming both `en-orig` and `zh-Hans` are missing; and that it would go to the `zh` channel.
- Case B: `available_subs="en-orig\nzh-TW"` → expect **no** Traditional fallback attempts (gate not met).
- Case C: `available_subs="zh-Hans\nzh-TW"` → expect **no** Traditional fallback attempts (gate not met).
- Case D: `available_subs="zh-TW"` but “original fails” path simulated → expect Traditional auto attempts next.

**Step 2: Run test to verify it fails**

Run:

```bash
bash scripts/test_subtitle_fallback_logic.sh
```

Expected: FAIL (because the selection function and gate don’t exist yet).

**Step 3: Write minimal implementation to make test pass**

- Introduce an injectable override for tests:
  - If env `AVAILABLE_SUBS_OVERRIDE` is set, use it instead of calling `yt-dlp --list-subs`.
- Implement a pure “planning” function that computes attempt order and prints it; used by the test harness.

**Step 4: Run test to verify it passes**

Run:

```bash
bash scripts/test_subtitle_fallback_logic.sh
```

Expected: PASS.

---

### Task 2: Implement Traditional fallback in `scripts/download_subs.sh`

**Files:**
- Modify: `scripts/download_subs.sh`

**Step 1: Write a failing integration-ish test (still offline)**

Extend `scripts/test_subtitle_fallback_logic.sh` to assert that `scripts/download_subs.sh`’s “planning output” matches expected attempt order for each case.

**Step 2: Run to verify it fails**

Run:

```bash
bash scripts/test_subtitle_fallback_logic.sh
```

Expected: FAIL for at least one Traditional fallback case.

**Step 3: Implement minimal changes**

Implement:
- **Detection expansion**: include `zh-TW` in the “available subtitles” filter list.
- **Gate**: compute `en_original_downloaded` and `zh_hans_original_downloaded` booleans.
- **Fallback logic**: when gate is met, attempt `zh-TW` then `zh-Hant` with `--write-subs` first; on failure/absence then attempt `--write-auto-subs` for the same codes.
- **Naming contract**: regardless of which Traditional code wins, download into `target_lang="zh"` so the resulting file is `<id>.zh.(original|auto).vtt`.

**Step 4: Run tests**

Run:

```bash
bash scripts/test_subtitle_fallback_logic.sh
```

Expected: PASS.

---

### Task 3: Implement the same fallback in `scripts/run.sh` (`get_transcript()`)

**Files:**
- Modify: `scripts/run.sh`

**Step 1: Add failing assertions**

Extend `scripts/test_subtitle_fallback_logic.sh` to cover the analogous planning output for `scripts/run.sh`.

**Step 2: Run to verify it fails**

Run:

```bash
bash scripts/test_subtitle_fallback_logic.sh
```

Expected: FAIL.

**Step 3: Implement minimal changes**

Mirror the same:
- `zh-TW` detection
- gate (both originals missing)
- Traditional fallback attempt order (original then auto)
- keep `zh` channel outputs unchanged

**Step 4: Run tests**

Run:

```bash
bash scripts/test_subtitle_fallback_logic.sh
```

Expected: PASS.

---

### Task 4: End-to-end smoke test (optional, networked)

**Files:**
- Modify: `scripts/test_subtitle.sh` (optional) or document a manual run

**Step 1: Choose a known Taiwan video URL with `zh-TW` subtitles**

Run:

```bash
bash scripts/run.sh "<URL>" MODE=transcript FORCE=1
ls -la work/*/transcript/subs | rg "\\.zh\\.(original|auto)\\.vtt"
```

Expected:
- `*.zh.original.vtt` exists (or `*.zh.auto.vtt` if only auto is present)
- `work/<id>/transcript/original_zh.md` exists and is non-empty

---

### Task 5: Documentation touch-ups

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md` (if it documents language priority list and currently omits `zh-TW`)

**Step 1: Update documented priority**

Add `zh-TW` under the Traditional Chinese bucket for subtitles detection/priority.

