# 优化 VTT 转 Markdown 的重叠问题

## 问题描述

当前 `vtt_converter.py` 在转换 VTT 字幕时，输出存在前后内容重叠的问题。

### 问题示例

**原始 VTT cues:**
```
00:00:04.470 --> 00:00:06.710
All right, so Apple is doing a week of new release stuff and it's all headlined

00:00:06.720 --> 00:00:08.230
new release stuff and it's all headlined by what I saw today, which is the
```

**当前输出（有重叠）:**
```
[00:00:04] All right, so Apple is doing a week of new release stuff and it's all headlined
[00:00:06] new release stuff and it's all headlined by what I saw today, which is the
[00:00:08] by what I saw today, which is the newest, cheapest entry to the MacBook
```

### 根本原因

VTT 格式有两种 cues：
1. **长 cue**（~2秒）：完整的句子，带单词级别时间戳
2. **短 cue**（10-100ms）：纯文本过渡，用于平滑显示

当前代码在合并时，会保留这些过渡性 cues，导致每个输出行都包含前面内容的开头。

## 方案：去除重叠前缀

### 核心思路

1. 解析所有 VTT cues，保留时间戳
2. 按时间排序
3. 对每个 entry，检查其文本开头是否被前一个 entry 的文本包含
4. 如果是，去除重复的前缀部分

### 算法设计

```python
def remove_overlap(current_text, previous_text, min_overlap=3):
    """去除 current_text 开头的重叠部分"""
    # 找到最长公共前缀
    overlap = ""
    for i in range(len(previous_text)):
        if current_text.startswith(previous_text[i:]):
            overlap = previous_text[i:]
            break

    if len(overlap) >= min_overlap:
        return current_text[len(overlap):]
    return current_text
```

### 示例转换

**优化后输出（无重叠）:**
```
[00:00:04] All right, so Apple is doing a week of new release stuff and it's all headlined
[00:00:06] by what I saw today, which is the
[00:00:08] newest, cheapest entry to the MacBook
```

### 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| 第一个 entry | 无前一个，跳过处理 |
| 重叠 < 3 字符 | 认为是新内容，保留原文本 |
| 纯空格/标点开头 | 去除后再比较 |
| 时间差 > 2 秒 | 不处理（不同段落） |

## 修改文件

- `scripts/vtt_converter.py`

## 验证方式

使用同一 VTT 文件转换，对比修改前后的 `original_en.md`：
- 修改前：有重叠内容
- 修改后：无重叠，每行是独立的完整句子
