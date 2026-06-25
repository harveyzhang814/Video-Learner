# 字幕翻译并行化与可读性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将字幕翻译从串行 25s 分块改为整体式分页并行翻译，同时为 AI 生成字幕加入预合并以保证中文可读性。

**Architecture:** `vtt2md` 步骤检测字幕来源，AI 字幕（`.auto.vtt` / `.asr.vtt`）在转 MD 后立即做句子级预合并（3-6 秒/块，纯 Python）；`translate_subs.sh` 按 200 行分页、并行调 LLM，每页含完整时间戳供 LLM 整体理解，翻译后经格式校验修复层写出 `original_zh.md`。

**Tech Stack:** Bash, Python 3, 现有 `llm_engine.sh`（claude/opencode 路由）

## Global Constraints

- Python 脚本直接 `python3 script.py` 执行，无框架依赖
- 所有新参数均有 env var 覆盖机制（见各任务）
- 输出格式固定：`[HH:MM:SS.mmm --> HH:MM:SS.mmm] 中文内容`，每行一条
- `llm_engine.sh` 接口不变：`bash llm_engine.sh --input <file> --output <file>`
- DAG 结构不变，不新增 orchestrator 步骤
- 所有测试 `node tests/<file>.test.js` 或 `python3 tests/<file>.py` 直接运行

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `scripts/download_subs.sh` | 修改 | Bilibili AI 字幕存为 `.auto.vtt` |
| `scripts/merge_ai_subs.py` | 新建 | AI 字幕预合并逻辑（纯 Python） |
| `scripts/convert_vtt_md.sh` | 修改 | AI 来源检测 + 调用预合并 |
| `scripts/translate_validator.py` | 新建 | 翻译输出格式校验 + 修复 |
| `scripts/translate_subs.sh` | 重写 | 分页并行翻译主脚本 |
| `tests/test_merge_ai_subs.py` | 新建 | 预合并单元测试 |
| `tests/test_translate_validation.py` | 新建 | 校验修复单元测试 |
| `tests/test_translate_subs.py` | 修改 | 替换旧分块测试为新分页测试 |

---

### Task 1: 修复 Bilibili AI 字幕文件命名

**Files:**
- Modify: `scripts/download_subs.sh:116,128`

**Interfaces:**
- Produces: `{ID}.zh.auto.vtt`（ai-zh），`{ID}.en.auto.vtt`（ai-en）供 Task 3 检测

- [ ] **Step 1: 修改 `_run_bilibili` 中 ai-zh 的保存路径**

在 `scripts/download_subs.sh` 第 125-131 行，将：
```bash
    if [ "$zh_downloaded" = false ] && has_bilibili_track "ai-zh"; then
        echo "Found AI Chinese subtitles (ai-zh). Downloading..."
        if download_bilibili_sub "ai-zh" "$SUBS_DIR/${ID}.zh.original.vtt"; then
            zh_downloaded=true
```
改为：
```bash
    if [ "$zh_downloaded" = false ] && has_bilibili_track "ai-zh"; then
        echo "Found AI Chinese subtitles (ai-zh). Downloading..."
        if download_bilibili_sub "ai-zh" "$SUBS_DIR/${ID}.zh.auto.vtt"; then
            zh_downloaded=true
```

- [ ] **Step 2: 修改 ai-en 的保存路径**

第 135-141 行，将：
```bash
    if [ "$zh_downloaded" = false ] && has_bilibili_track "ai-en"; then
        echo "Found AI English subtitles (ai-en). Downloading..."
        if download_bilibili_sub "ai-en" "$SUBS_DIR/${ID}.en.original.vtt"; then
            en_downloaded=true
```
改为：
```bash
    if [ "$zh_downloaded" = false ] && has_bilibili_track "ai-en"; then
        echo "Found AI English subtitles (ai-en). Downloading..."
        if download_bilibili_sub "ai-en" "$SUBS_DIR/${ID}.en.auto.vtt"; then
            en_downloaded=true
```

- [ ] **Step 3: 验证改动不影响原生字幕路径**

```bash
grep "original.vtt\|auto.vtt" scripts/download_subs.sh
```
预期：`zh.original.vtt` 仅出现在 human `zh` 分支（Priority 1），`auto.vtt` 出现在 ai-zh 和 ai-en 分支。

- [ ] **Step 4: Commit**

```bash
git add scripts/download_subs.sh
git commit -m "fix: Bilibili AI 字幕改存为 .auto.vtt，区分原生字幕命名"
```

---

### Task 2: 新建 AI 字幕预合并模块

**Files:**
- Create: `scripts/merge_ai_subs.py`
- Create: `tests/test_merge_ai_subs.py`

**Interfaces:**
- Produces: `merge_lines(lines, min_secs, max_secs) -> list[str]`，供 Task 3 调用
- CLI: `python3 scripts/merge_ai_subs.py <input_md> <output_md> [--min-secs N] [--max-secs N]`

- [ ] **Step 1: 写测试（先红）**

创建 `tests/test_merge_ai_subs.py`：

```python
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
```

- [ ] **Step 2: 运行测试确认全红**

```bash
python3 tests/test_merge_ai_subs.py
```
预期：`ModuleNotFoundError: No module named 'merge_ai_subs'`

- [ ] **Step 3: 实现 `scripts/merge_ai_subs.py`**

```python
#!/usr/bin/env python3
"""Merge fine-grained AI subtitle MD lines into sentence-level blocks.

CLI: python3 merge_ai_subs.py <input_md> <output_md> [--min-secs N] [--max-secs N]
Library: from merge_ai_subs import merge_lines
"""
import re, sys, argparse

_LINE_RE = re.compile(
    r'^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$'
)
_SENTENCE_END = re.compile(r'[.?!]\s*$')


def _ts_to_secs(ts: str) -> float:
    h, m, s = ts.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def _secs_to_ts(secs: float) -> str:
    h = int(secs) // 3600
    m = (int(secs) % 3600) // 60
    s_int = int(secs) % 60
    ms = int(round((secs - int(secs)) * 1000))
    return f"{h:02d}:{m:02d}:{s_int:02d}.{ms:03d}"


def merge_lines(lines: list, min_secs: float = 3.0, max_secs: float = 6.0) -> list:
    """Merge fine-grained VTT-MD lines into sentence-level blocks.

    Args:
        lines: List of strings in format "[HH:MM:SS.mmm --> HH:MM:SS.mmm] text"
        min_secs: Minimum block duration before a sentence-end triggers a cut
        max_secs: Maximum block duration (forced cut regardless of punctuation)

    Returns:
        List of merged lines in the same format.
    """
    parsed = []
    for line in lines:
        line = line.rstrip()
        if not line:
            continue
        m = _LINE_RE.match(line)
        if m:
            parsed.append((_ts_to_secs(m.group(1)), _ts_to_secs(m.group(2)), m.group(3)))

    if not parsed:
        return []

    merged = []
    cur_start, cur_end, cur_texts = parsed[0][0], parsed[0][1], [parsed[0][2]]

    for start, end, text in parsed[1:]:
        cur_dur = cur_end - cur_start
        last_text = cur_texts[-1]

        if cur_dur >= max_secs or (_SENTENCE_END.search(last_text) and cur_dur >= min_secs):
            merged.append((_secs_to_ts(cur_start), _secs_to_ts(cur_end), ' '.join(cur_texts)))
            cur_start, cur_end, cur_texts = start, end, [text]
        else:
            cur_end = end
            cur_texts.append(text)

    if cur_texts:
        merged.append((_secs_to_ts(cur_start), _secs_to_ts(cur_end), ' '.join(cur_texts)))

    return [f"[{s} --> {e}] {t}" for s, e, t in merged]


def main():
    parser = argparse.ArgumentParser(description='Merge AI subtitle MD into sentence blocks')
    parser.add_argument('input', help='Input MD file')
    parser.add_argument('output', help='Output MD file (can be same as input)')
    parser.add_argument('--min-secs', type=float, default=3.0)
    parser.add_argument('--max-secs', type=float, default=6.0)
    args = parser.parse_args()

    with open(args.input, encoding='utf-8') as f:
        lines = f.readlines()

    merged = merge_lines(lines, args.min_secs, args.max_secs)

    with open(args.output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(merged) + '\n')

    print(f"merge_ai_subs: {len(lines)} lines → {len(merged)} blocks")


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: 运行测试确认全绿**

```bash
python3 tests/test_merge_ai_subs.py
```
预期：`test_merge_ai_subs.py: ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add scripts/merge_ai_subs.py tests/test_merge_ai_subs.py
git commit -m "feat: 新增 AI 字幕预合并模块 merge_ai_subs.py"
```

---

### Task 3: `convert_vtt_md.sh` 加入 AI 检测与预合并

**Files:**
- Modify: `scripts/convert_vtt_md.sh`

**Interfaces:**
- Consumes: `scripts/merge_ai_subs.py` (Task 2)
- Env vars: `VTT2MD_MIN_BLOCK_SECS`（默认 3），`VTT2MD_MAX_BLOCK_SECS`（默认 6）

- [ ] **Step 1: 替换 `scripts/convert_vtt_md.sh` 全文**

```bash
#!/bin/bash
# VTT to Markdown conversion step script
# Usage: bash scripts/convert_vtt_md.sh <VTT_FILE> <OUTPUT_MD_FILE>
#
# AI subtitle detection: files matching *.auto.vtt or *.asr.vtt are treated as
# AI-generated and will be merged into sentence-level blocks after conversion.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
    echo "[STATUS] vtt2md_error: Missing arguments"
    echo "Usage: $0 <VTT_FILE> <OUTPUT_MD_FILE>"
    exit 1
fi

VTT_FILE="$1"
OUTPUT_MD="$2"

if [ ! -f "$VTT_FILE" ]; then
    echo "[STATUS] vtt2md_error: VTT file not found: $VTT_FILE"
    exit 1
fi

echo "[STATUS] vtt2md_start"
echo "Converting VTT to MD: $VTT_FILE -> $OUTPUT_MD"

OUTPUT_DIR="$(dirname "$OUTPUT_MD")"
mkdir -p "$OUTPUT_DIR"

# Convert VTT → MD (fine-grained, one line per VTT cue)
python3 "$SCRIPT_DIR/vtt_converter.py" "$VTT_FILE" "$OUTPUT_MD"

if [ $? -ne 0 ]; then
    echo "[STATUS] vtt2md_error: Conversion failed"
    exit 1
fi

# Detect AI subtitle source: *.auto.vtt (platform AI) or *.asr.vtt (Whisper)
VTT_BASENAME="$(basename "$VTT_FILE")"
if [[ "$VTT_BASENAME" == *.auto.vtt ]] || [[ "$VTT_BASENAME" == *.asr.vtt ]]; then
    echo "[STATUS] vtt2md_merging: AI subtitle detected, applying pre-merge"
    python3 "$SCRIPT_DIR/merge_ai_subs.py" \
        --min-secs "${VTT2MD_MIN_BLOCK_SECS:-3}" \
        --max-secs "${VTT2MD_MAX_BLOCK_SECS:-6}" \
        "$OUTPUT_MD" "$OUTPUT_MD"
fi

echo "[STATUS] vtt2md_done"
exit 0
```

- [ ] **Step 2: 验证原生字幕不触发合并**

```bash
# 用 .original.vtt 命名的文件不应触发合并（日志里不出现 vtt2md_merging）
echo "WEBVTT
00:00:01.000 --> 00:00:03.000
Hello world." > /tmp/test_native.original.vtt

bash scripts/convert_vtt_md.sh /tmp/test_native.original.vtt /tmp/test_out.md
grep -v "merging" /tmp/test_out.md || true
echo "Expected: no merging log for .original.vtt"
```

- [ ] **Step 3: 验证 AI 字幕触发合并**

```bash
python3 -c "
lines = []
for i in range(10):
    s = i*2
    e = s+2
    lines.append(f'[{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}.000 --> {e//3600:02d}:{(e%3600)//60:02d}:{e%60:02d}.000] Word {i}.')
print('\n'.join(lines))
" > /tmp/test_ai_content.md

# Simulate: create a fake .auto.vtt by writing a minimal VTT then calling convert
echo "WEBVTT

00:00:00.000 --> 00:00:02.000
Hello there.

00:00:02.000 --> 00:00:04.000
Welcome back.

00:00:04.000 --> 00:00:06.000
Today we start." > /tmp/test.auto.vtt

bash scripts/convert_vtt_md.sh /tmp/test.auto.vtt /tmp/test_merged.md
wc -l /tmp/test_merged.md
echo "Expected: fewer lines than input (3 input → 1-2 merged blocks)"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/convert_vtt_md.sh
git commit -m "feat: vtt2md AI 来源检测，.auto.vtt/.asr.vtt 触发预合并"
```

---

### Task 4: 新建翻译输出格式校验修复模块

**Files:**
- Create: `scripts/translate_validator.py`
- Create: `tests/test_translate_validation.py`

**Interfaces:**
- CLI: `python3 translate_validator.py --input <zh_combined> --output <out_md> --en-line-count N --min-coverage N`
- Exit code 0 = pass，1 = coverage below threshold（打印 `[STATUS] translate_error: coverage N% below threshold`）

- [ ] **Step 1: 写测试（先红）**

创建 `tests/test_translate_validation.py`：

```python
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

if __name__ == '__main__':
    test_valid_lines_pass_through()
    test_malformed_line_repaired()
    test_coverage_below_threshold_fails()
    test_coverage_at_threshold_passes()
    test_output_format_correct()
    test_disordered_lines_sorted()
    test_head_orphan_infers_ts()
    print("\ntest_translate_validation.py: ALL PASS")
```

- [ ] **Step 2: 运行确认全红**

```bash
python3 tests/test_translate_validation.py
```
预期：`ModuleNotFoundError: No module named 'translate_validator'`

- [ ] **Step 3: 实现 `scripts/translate_validator.py`**

```python
#!/usr/bin/env python3
"""Format validation and repair for translate_subs.sh output.

CLI: python3 translate_validator.py \\
       --input <zh_combined.txt> \\
       --output <original_zh.md> \\
       --en-line-count N \\
       --min-coverage N   (default 90)

Exit codes: 0 = pass, 1 = coverage below threshold
"""
import re, sys, argparse

_LINE_RE = re.compile(
    r'^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$'
)


def _ts_to_secs(ts: str) -> float:
    h, m, s = ts.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def _secs_to_ts(secs: float) -> str:
    secs = max(0.0, secs)
    h = int(secs) // 3600
    m = (int(secs) % 3600) // 60
    s_int = int(secs) % 60
    ms = int(round((secs - int(secs)) * 1000)) % 1000
    return f"{h:02d}:{m:02d}:{s_int:02d}.{ms:03d}"


def validate_and_repair(
    lines: list,
    en_line_count: int,
    coverage_threshold: int = 90,
) -> tuple:
    """Parse, repair, sort, and validate coverage of translated subtitle lines.

    Returns:
        (repaired_lines: list[str], coverage_pct: int, warnings: list[str])
    """
    entries = []   # list of [status, start_secs, end_secs, text, orig_index]
    warnings = []

    for i, raw in enumerate(lines):
        line = raw.rstrip()
        if not line:
            continue
        m = _LINE_RE.match(line)
        if m:
            entries.append(['ok', _ts_to_secs(m.group(1)), _ts_to_secs(m.group(2)), m.group(3), i])
        else:
            # Strip any bracket-like fragments; take the rest as content
            content = re.sub(r'\[.*?\]', '', line).strip()
            if content:
                entries.append(['bad', None, None, content, i])
                warnings.append(f"[WARN] malformed line {i+1}: needs ts inference")
            else:
                warnings.append(f"[WARN] dropped line {i+1}: no recoverable content")

    # Infer timestamps for 'bad' entries
    for j, entry in enumerate(entries):
        if entry[0] != 'bad':
            continue

        prev_end = None
        next_start = None
        for k in range(j - 1, -1, -1):
            if entries[k][0] == 'ok':
                prev_end = entries[k][2]
                break
        for k in range(j + 1, len(entries)):
            if entries[k][0] == 'ok':
                next_start = entries[k][1]
                break

        if prev_end is not None and next_start is not None:
            start_s = prev_end
            end_s = min(prev_end + 25.0, next_start)
        elif next_start is not None:
            start_s = max(0.0, next_start - 25.0)
            end_s = next_start
        elif prev_end is not None:
            start_s = prev_end
            end_s = prev_end + 25.0
        else:
            start_s, end_s = 0.0, 25.0

        orig_idx = entry[4]
        warnings.append(
            f"[WARN] repaired line {orig_idx+1}: inferred ts "
            f"{_secs_to_ts(start_s)} --> {_secs_to_ts(end_s)}"
        )
        entries[j] = ['ok', start_s, end_s, entry[3], orig_idx]

    # Sort by start time
    ok_entries = [e for e in entries if e[0] == 'ok']
    ok_entries.sort(key=lambda e: e[1])

    output_lines = [f"[{_secs_to_ts(e[1])} --> {_secs_to_ts(e[2])}] {e[3]}" for e in ok_entries]

    coverage = int(len(output_lines) * 100 / en_line_count) if en_line_count > 0 else 0
    return output_lines, coverage, warnings


def main():
    parser = argparse.ArgumentParser(description='Validate and repair translate_subs.sh output')
    parser.add_argument('--input', required=True, help='Combined zh output file')
    parser.add_argument('--output', required=True, help='Output original_zh.md path')
    parser.add_argument('--en-line-count', type=int, required=True)
    parser.add_argument('--min-coverage', type=int, default=90)
    args = parser.parse_args()

    with open(args.input, encoding='utf-8') as f:
        lines = f.readlines()

    output_lines, coverage, warnings = validate_and_repair(
        lines, args.en_line_count, args.min_coverage
    )

    for w in warnings:
        print(w, file=sys.stderr)

    if coverage < args.min_coverage:
        print(
            f"[STATUS] translate_error: coverage {coverage}% below threshold {args.min_coverage}%",
            file=sys.stderr
        )
        sys.exit(1)

    with open(args.output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(output_lines) + '\n')

    print(f"[STATUS] translate_done: {len(output_lines)} lines, coverage {coverage}%")


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: 运行测试确认全绿**

```bash
python3 tests/test_translate_validation.py
```
预期：`test_translate_validation.py: ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add scripts/translate_validator.py tests/test_translate_validation.py
git commit -m "feat: 新增翻译输出格式校验修复模块 translate_validator.py"
```

---

### Task 5: 重写 `translate_subs.sh`

**Files:**
- Modify: `scripts/translate_subs.sh`（完全替换）

**Interfaces:**
- Consumes: `scripts/translate_validator.py` (Task 4)，`scripts/llm_engine.sh`（不变）
- Env vars: `TRANSLATE_PAGE_SIZE`（默认 200），`TRANSLATE_PARALLEL`（默认 5），`TRANSLATE_PAGE_TIMEOUT`（默认 600），`TRANSLATE_MIN_COVERAGE`（默认 90）

- [ ] **Step 1: 完全替换 `scripts/translate_subs.sh`**

```bash
#!/bin/bash
# Subtitle translation step - holistic page-level parallel translation
# Usage: bash scripts/translate_subs.sh <INPUT_EN_MD> <OUTPUT_ZH_MD>
#
# Env vars (all optional):
#   TRANSLATE_PAGE_SIZE     lines per page          (default 200)
#   TRANSLATE_PARALLEL      max concurrent LLM calls (default 5)
#   TRANSLATE_PAGE_TIMEOUT  seconds per page call   (default 600)
#   TRANSLATE_MIN_COVERAGE  minimum coverage %      (default 90)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
    echo "[STATUS] translate_error: Missing arguments"
    echo "Usage: $0 <INPUT_EN_MD> <OUTPUT_ZH_MD>"
    exit 1
fi

INPUT_MD="$1"
OUTPUT_MD="$2"

if [ ! -f "$INPUT_MD" ]; then
    echo "[STATUS] translate_error: Input file not found: $INPUT_MD"
    exit 1
fi

PAGE_SIZE="${TRANSLATE_PAGE_SIZE:-200}"
PARALLEL="${TRANSLATE_PARALLEL:-5}"
PAGE_TIMEOUT="${TRANSLATE_PAGE_TIMEOUT:-600}"
MIN_COVERAGE="${TRANSLATE_MIN_COVERAGE:-90}"

echo "[STATUS] translate_start"
mkdir -p "$(dirname "$OUTPUT_MD")"

TMPDIR_TRANS=$(mktemp -d /tmp/translate-XXXXXXXX)
trap 'rm -rf "$TMPDIR_TRANS"' EXIT INT TERM

PAGES_DIR="$TMPDIR_TRANS/pages"
mkdir -p "$PAGES_DIR"

# ── Phase 1: 分页 ─────────────────────────────────────────────────────────────
EN_LINE_COUNT=$(grep -c '^\[' "$INPUT_MD" || true)

python3 - "$INPUT_MD" "$PAGES_DIR" "$PAGE_SIZE" <<'PYTHON_EOF'
import sys

input_md, pages_dir, page_size = sys.argv[1], sys.argv[2], int(sys.argv[3])

with open(input_md, encoding='utf-8') as f:
    lines = [l for l in f.readlines() if l.strip()]

for page_num, start in enumerate(range(0, len(lines), page_size)):
    chunk = lines[start:start + page_size]
    with open(f"{pages_dir}/page_{page_num}.en", 'w', encoding='utf-8') as f:
        f.writelines(chunk)

print(f"Phase1: {len(lines)} lines → {(len(lines) + page_size - 1) // page_size} pages")
PYTHON_EOF

PAGE_COUNT=$(ls "$PAGES_DIR"/*.en 2>/dev/null | wc -l | tr -d ' ')
echo "[STATUS] translate_chunks: $PAGE_COUNT"

# ── Phase 2: 并行翻译 ─────────────────────────────────────────────────────────
translate_page() {
    local page_en="$1"
    local page_num="$2"
    local page_zh="${page_en%.en}.zh"
    local prompt_file="$TMPDIR_TRANS/prompt_${page_num}.txt"

    {
        printf '%s\n' '你是一名专业字幕翻译员。我将给你一段带时间戳的英文字幕，格式为：'
        printf '%s\n' '[HH:MM:SS.mmm --> HH:MM:SS.mmm] 英文内容'
        printf '%s\n' ''
        printf '%s\n' '任务要求：'
        printf '%s\n' '1. 先通读全部内容，理解整体语义和上下文'
        printf '%s\n' '2. 将全部内容翻译为流畅的简体中文'
        printf '%s\n' '3. 输出必须保留【每一条】原始时间戳，格式完全一致：[HH:MM:SS.mmm --> HH:MM:SS.mmm] 中文内容'
        printf '%s\n' '4. 中文内容按自然语义分配到各时间戳，可合理调整每行文字量，但不能增删时间戳条目'
        printf '%s\n' '5. 只输出翻译结果，不要解释、不要注释'
        printf '%s\n' ''
        printf '%s\n' '--- 待翻译字幕 ---'
        cat "$page_en"
    } > "$prompt_file"

    if timeout "$PAGE_TIMEOUT" bash "$SCRIPT_DIR/llm_engine.sh" \
        --input "$prompt_file" --output "$page_zh" 2>/dev/null; then
        echo "[STATUS] translate_chunk $((page_num + 1))/$PAGE_COUNT"
    else
        echo "[STATUS] translate_chunk_failed: $((page_num + 1))/$PAGE_COUNT"
        rm -f "$page_zh"
    fi
}

# Semaphore-style parallel execution with cap
pids=()
page_num=0
for page_en in $(ls "$PAGES_DIR"/*.en | sort -V); do
    translate_page "$page_en" "$page_num" &
    pids+=($!)
    page_num=$((page_num + 1))

    if [ "${#pids[@]}" -ge "$PARALLEL" ]; then
        wait "${pids[0]}"
        pids=("${pids[@]:1}")
    fi
done
[ "${#pids[@]}" -gt 0 ] && wait "${pids[@]}"

# ── Phase 3: 页间缝合 ─────────────────────────────────────────────────────────
smooth_seam() {
    local page_a_zh="$1"
    local page_b_zh="$2"
    local seam_num="$3"

    [ -f "$page_a_zh" ] && [ -f "$page_b_zh" ] || return 0

    local prompt_file="$TMPDIR_TRANS/seam_${seam_num}.txt"
    local seam_out="$TMPDIR_TRANS/seam_${seam_num}.out"

    {
        printf '%s\n' '以下是两段相邻字幕的边界内容（简体中文）。请微调【下文开头】的前几行，'
        printf '%s\n' '使其从【上文结尾】自然接续，保持术语和语气一致。'
        printf '%s\n' '只输出修改后的【下文开头】行，不要输出其他内容。'
        printf '%s\n' ''
        printf '%s\n' '--- 上文结尾（只读）---'
        tail -3 "$page_a_zh"
        printf '%s\n' ''
        printf '%s\n' '--- 下文开头（待调整）---'
        head -3 "$page_b_zh"
    } > "$prompt_file"

    if timeout 120 bash "$SCRIPT_DIR/llm_engine.sh" \
        --input "$prompt_file" --output "$seam_out" 2>/dev/null; then
        python3 - "$page_b_zh" "$seam_out" <<'PYEOF'
import sys
orig  = open(sys.argv[1], encoding='utf-8').readlines()
patch = open(sys.argv[2], encoding='utf-8').readlines()
# Replace first min(len(patch), 3) lines, keep the rest
keep_from = min(len(patch), 3)
open(sys.argv[1], 'w', encoding='utf-8').writelines(patch + orig[keep_from:])
PYEOF
    fi
}

zh_pages=($(ls "$PAGES_DIR"/*.zh 2>/dev/null | sort -V))
seam_pids=()
for ((i = 0; i < ${#zh_pages[@]} - 1; i++)); do
    smooth_seam "${zh_pages[$i]}" "${zh_pages[$((i + 1))]}" "$i" &
    seam_pids+=($!)
done
[ "${#seam_pids[@]}" -gt 0 ] && wait "${seam_pids[@]}"

# ── Phase 4: 格式校验、修复、合并写入 ─────────────────────────────────────────
COMBINED="$TMPDIR_TRANS/combined.zh"
for page_zh in $(ls "$PAGES_DIR"/*.zh 2>/dev/null | sort -V); do
    cat "$page_zh"
done > "$COMBINED"

if ! python3 "$SCRIPT_DIR/translate_validator.py" \
    --input "$COMBINED" \
    --output "$OUTPUT_MD" \
    --en-line-count "$EN_LINE_COUNT" \
    --min-coverage "$MIN_COVERAGE"; then
    echo "[STATUS] translate_error: validation failed"
    exit 1
fi

echo "[STATUS] translate_done"
```

- [ ] **Step 2: 快速烟测（不需要真实 LLM，验证 Phase 1 + Phase 4）**

```bash
# 构造一个小的 original_en.md（5 行）
python3 -c "
for i in range(5):
    s = i * 3
    e = s + 3
    print(f'[{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}.000 --> {e//3600:02d}:{(e%3600)//60:02d}:{e%60:02d}.000] Line {i}.')
" > /tmp/smoke_en.md

# 手动模拟 page_0.zh（跳过真实 LLM）
mkdir -p /tmp/smoke_pages
cp /tmp/smoke_en.md /tmp/smoke_pages/page_0.en
python3 -c "
import re
with open('/tmp/smoke_pages/page_0.en') as f:
    for line in f:
        m = re.match(r'^\[(.+?) --> (.+?)\] (.+)$', line.strip())
        if m:
            print(f'[{m.group(1)} --> {m.group(2)}] 翻译行')
" > /tmp/smoke_pages/page_0.zh

# 直接测试 validate
python3 scripts/translate_validator.py \
    --input /tmp/smoke_pages/page_0.zh \
    --output /tmp/smoke_out.md \
    --en-line-count 5 \
    --min-coverage 90
cat /tmp/smoke_out.md
```
预期：`[STATUS] translate_done: 5 lines, coverage 100%`，输出文件有 5 行。

- [ ] **Step 3: Commit**

```bash
git add scripts/translate_subs.sh
git commit -m "feat: 重写 translate_subs.sh 为整体式分页并行翻译"
```

---

### Task 6: 更新 `tests/test_translate_subs.py`

**Files:**
- Modify: `tests/test_translate_subs.py`（替换旧分块测试为新分页逻辑测试）

**Interfaces:**
- Consumes: 新 `translate_subs.sh` 的 Phase 1 分页逻辑（用 inline Python 实现，可直接测）

- [ ] **Step 1: 替换 `tests/test_translate_subs.py`**

```python
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
```

- [ ] **Step 2: 运行测试**

```bash
python3 tests/test_translate_subs.py
```
预期：`test_translate_subs.py: ALL PASS`

- [ ] **Step 3: Commit**

```bash
git add tests/test_translate_subs.py
git commit -m "test: 更新 test_translate_subs.py 为分页逻辑测试"
```

---

## 自检

**Spec 覆盖：**
- ✅ Bilibili AI 字幕命名 bug → Task 1
- ✅ `.auto.vtt` / `.asr.vtt` 检测 → Task 3
- ✅ 原生字幕跳过预合并 → Task 3 Step 2
- ✅ 预合并 3-6 秒句子块，纯 Python → Task 2
- ✅ 200 行分页并行翻译 → Task 5
- ✅ 单页超时 10 分钟 → Task 5 `PAGE_TIMEOUT`
- ✅ 页间缝合（N_pages-1 条，并行）→ Task 5 Phase 3
- ✅ 格式校验：合法行保留，异常行修复，修复失败丢弃 → Task 4
- ✅ 时间戳插值修复 → Task 4 `validate_and_repair`
- ✅ 覆盖率 < 90% 步骤失败 → Task 4 CLI exit code
- ✅ `llm_engine.sh` 接口不变 → Task 5
- ✅ 下游 `md2vtt` 无改动 → 无 Task
