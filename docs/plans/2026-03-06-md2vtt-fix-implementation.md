# md2subtitle.py 修复实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 md2subtitle.py 使用实际时间范围、生成合法 VTT 格式、跳过无效条目

**Architecture:** 修改解析函数提取实际时间范围，修改转换函数生成单条 cue

**Tech Stack:** Python 3, 正则表达式

---

### Task 1: 修改 parse_original_md 函数

**Files:**
- Modify: `scripts/md2subtitle.py:7-29`

**Step 1: 写测试脚本验证当前行为**

创建临时测试文件 `test_input.md`:
```
[00:00:00] 00:00:03.000 --> 00:00:04.500 又来搅局了一个赛道
[00:00:04] 00:00:06.166 --> 00:00:07.800 人们想要一个通用Agent
[00:00:22] 00:00:23.833 --> 00:00:25.966 OpenAI对于通用Agent的发布
```

运行当前脚本:
```bash
python3 scripts/md2subtitle.py test_input.md -f vtt -o test_output.vtt
```

**Step 2: 修改 parse_original_md 函数**

```python
def parse_original_md(filepath):
    """Parse original.md format: [hh:mm:ss] HH:MM:SS.mmm --> HH:MM:SS.mmm text"""
    entries = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            # Match [hh:mm:ss] HH:MM:SS.mmm --> HH:MM:SS.mmm text
            match = re.match(r'\[\d{2}:\d{2}:\d{2}\]\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*(.+)', line)
            if match:
                h1, m1, s1, ms1, h2, m2, s2, ms2, text = match.groups()

                start_sec = int(h1) * 3600 + int(m1) * 60 + int(s1)
                start_ms = int(ms1)
                end_sec = int(h2) * 3600 + int(m2) * 60 + int(s2)
                end_ms = int(ms2)

                # Skip invalid entries: end <= start or empty text
                if end_sec < start_sec or (end_sec == start_sec and end_ms <= start_ms):
                    continue
                if not text.strip():
                    continue

                entries.append((start_sec, end_sec, start_ms, end_ms, text))
    return entries
```

**Step 3: 验证解析结果**

```bash
python3 -c "
from md2subtitle import parse_original_md
entries = parse_original_md('test_input.md')
for e in entries:
    print(e)
"
```

Expected:
```
(3, 4, 0, 500, '又来搅局了一个赛道')
(6, 7, 166, 800, '人们想要一个通用Agent')
(23, 25, 833, 966, 'OpenAI对于通用Agent的发布')
```

---

### Task 2: 修改 convert_to_vtt 函数

**Files:**
- Modify: `scripts/md2subtitle.py:47-57`

**Step 1: 修改函数实现**

```python
def convert_to_vtt(entries):
    """Convert to VTT format"""
    lines = ["WEBVTT", ""]
    for i, (start_sec, end_sec, start_ms, end_ms, text) in enumerate(entries, 1):
        start = format_vtt_time(start_sec, start_ms)
        end = format_vtt_time(end_sec, end_ms)
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)
```

**Step 2: 运行测试**

```bash
python3 scripts/md2subtitle.py test_input.md -f vtt -o test_output.vtt
cat test_output.vtt
```

Expected:
```
WEBVTT

1
00:00:03.000 --> 00:00:04.500
又来搅局了一个赛道

2
00:00:06.166 --> 00:00:07.800
人们想要一个通用Agent
```

---

### Task 3: 修改 convert_to_srt 函数

**Files:**
- Modify: `scripts/md2subtitle.py:59-69`

**Step 1: 修改函数实现**

```python
def convert_to_srt(entries):
    """Convert to SRT format"""
    lines = []
    for i, (start_sec, end_sec, start_ms, end_ms, text) in enumerate(entries, 1):
        start = format_srt_time(start_sec, start_ms)
        end = format_srt_time(end_sec, end_ms)
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)
```

**Step 2: 运行测试**

```bash
python3 scripts/md2subtitle.py test_input.md -f srt -o test_output.srt
cat test_output.srt
```

Expected:
```
1
00:00:03.000,000 --> 00:00:04.500,000
又来搅局了一个赛道

2
00:00:06.166,000 --> 00:00:07.800,000
人们想要一个通用Agent
```

---

### Task 4: 测试实际数据

**Step 1: 使用真实数据测试**

```bash
python3 scripts/md2subtitle.py work/452ba49dff72/transcript/original_zh.md -f vtt -o work/452ba49dff72/transcript/test_zh.vtt
head -20 work/452ba49dff72/transcript/test_zh.vtt
```

**Step 2: 验证格式正确**

每行编号下只有一条 cue，时间范围使用实际值。

---

### Task 5: 清理并提交

**Step 1: 清理测试文件**

```bash
rm -f test_input.md test_output.vtt test_output.srt work/452ba49dff72/transcript/test_zh.vtt
```

**Step 2: 提交更改**

```bash
git add scripts/md2subtitle.py
git commit -m "fix: md2subtitle.py 使用实际时间范围并生成合法 VTT 格式"
```
