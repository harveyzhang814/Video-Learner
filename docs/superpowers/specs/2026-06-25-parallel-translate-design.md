# 字幕翻译并行化与可读性优化设计

**日期**：2026-06-25
**状态**：待实现

## 背景

当前 `translate_subs.sh` 采用串行逐块翻译：将英文字幕按 25 秒时间窗口分成约 288 块（2 小时视频），依次调用 LLM，每次只送入一个小块。这导致：

- 2 小时视频翻译耗时 20-30 分钟
- 每块上下文窗口极小（25 秒约 50-80 词），词义判断依赖 `zh_prev_tail` 接续上文
- 专有术语在跨块时容易前后不一致（典型错误："agenic pattern" → "基因模式"）

此外，AI 生成字幕（平台自动字幕、ASR 转录）的时间戳粒度极细（每条 2-3 秒），中文翻译后字幕刷新过快，观众来不及阅读。

## 目标

- 大幅降低长视频翻译 wall time
- 提升翻译质量：整体理解语义，术语前后一致
- AI 字幕预合并为句子级时间块，保证中文字幕可读性
- 输出格式与现有 `original_zh.md` 兼容，下游无感知

## 字幕来源分类

字幕有三种来源，处理策略不同：

| 来源 | 类型 | 文件名特征 | 预合并 |
|------|------|-----------|--------|
| 平台人工制作字幕 | 原生字幕 | `*.original.vtt` | ❌ 不需要，时间戳已合理 |
| 平台 AI 自动字幕 | AI 字幕 | `*.auto.vtt` | ✅ 需要 |
| 本地 ASR（Whisper）转录 | AI 字幕 | ASR 步骤输出 | ✅ 需要 |

**检测规则（在 `vtt2md.sh` 中执行）**：

```
if 来源是 ASR 步骤输出:
    → 执行预合并
elif VTT 文件名包含 ".auto.":
    → 执行预合并
elif VTT 文件名包含 ".original.":
    → 跳过预合并，直接转格式
```

此规则依赖现有 `download_subs.sh` 的文件命名约定：原生字幕下载时用 `--write-subs`，保存为 `*.original.vtt`；AI 字幕用 `--write-auto-subs`，保存为 `*.auto.vtt`。

**Bilibili 命名 bug（顺带修复）**：当前 Bilibili AI 字幕（`ai-zh`、`ai-en`）被错误地保存为 `*.original.vtt`，导致无法与人工字幕区分。修复：Bilibili AI 字幕改存为 `*.auto.vtt`。

## 变更一：AI 字幕预合并（`vtt2md.sh`）

### 目的

AI 生成字幕的时间戳粒度跟随语速（每条 2-3 秒），中文阅读速度比英语慢，直接翻译后字幕刷新过快。预合并在翻译前将细粒度行合并为句子级时间块，同时让 LLM 拿到完整语义单元，提升翻译质量。

### 时机

在 `vtt2md.sh` 内，格式转换完成后、写出 `original_en.md` 之前。应用于所有 AI 字幕，**无论是否需要翻译**。

### 合并算法（纯 Python，无 LLM）

```python
MIN_BLOCK_SECS = 3.0   # 合并块最短时长
MAX_BLOCK_SECS = 6.0   # 合并块最长时长（强制切断）
SENTENCE_END   = re.compile(r'[.?!]\s*$')

current_start = None
current_end   = None
current_texts = []
current_dur   = 0.0
merged_blocks = []

for (start, end, text) in vtt_lines:
    if current_start is None:
        current_start = start

    current_texts.append(text)
    current_end = end
    current_dur = current_end - current_start

    is_sentence_end = bool(SENTENCE_END.search(text))

    if current_dur >= MAX_BLOCK_SECS or (is_sentence_end and current_dur >= MIN_BLOCK_SECS):
        merged_blocks.append((current_start, current_end, ' '.join(current_texts)))
        current_start = None
        current_texts = []
        current_dur   = 0.0

# 收尾：剩余行追加到最后一块或单独成块
if current_texts:
    merged_blocks.append((current_start, current_end, ' '.join(current_texts)))
```

### 预合并效果示意

```
原始 AI 字幕（每条 2-3 秒）：
[00:00:04.480 --> 00:00:07.349] Hi, welcome back to this agendic pattern
[00:00:07.349 --> 00:00:10.320] series. In last part we cover
[00:00:10.320 --> 00:00:12.870] some use cases from single

合并后（句子边界切断，共 6 秒）：
[00:00:04.480 --> 00:00:10.320] Hi, welcome back to this agendic pattern series.
[00:00:10.320 --> 00:00:12.870] In last part we cover some use cases from single
```

### 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `VTT2MD_MIN_BLOCK_SECS` | 3 | 合并块最短时长（秒） |
| `VTT2MD_MAX_BLOCK_SECS` | 6 | 合并块最长时长（秒） |

## 变更二：并行整体式翻译（`translate_subs.sh`）

### 与原方案的根本区别

| 维度 | 原方案 | 新方案 |
|------|--------|--------|
| 输入 | 细粒度 VTT 行（2-3 秒/条） | 预合并后的句子块（3-6 秒/条） |
| 分块单位 | 25 秒时间窗口 | 200 行/页（≈10 分钟视频内容） |
| 每次 LLM 调用内容 | 1 个小块（无时间戳） | 1 整页（保留所有时间戳） |
| LLM 调用次数（2h 视频） | ~288 次串行 | ~5 次并行 |
| 输出时间戳颗粒度 | 25 秒/条 | 句子级（3-6 秒/条，已满足可读性） |
| 页间缝合需求 | 287 条 | 4 条 |

将时间戳保留在 prompt 内，LLM 先通读整页再翻译，按原时间戳分配中文内容——LLM 有结构参考，可以智能决策每个时间窗口填多少中文，不需要事后对齐。

实验验证（172 行，约 8 分钟视频）：单次调用 90 秒，时间戳覆盖率 99.4%，格式 100% 合规，术语一致性明显优于原方案。

### 架构

```
输入: original_en.md（预合并后的句子块，3-6 秒/条）

Phase 1 — 分页
  按行数切分，每页 PAGE_SIZE 行（默认 200，TRANSLATE_PAGE_SIZE 可覆盖）
  → /tmp/translate-XXXX/pages/page_N.en

Phase 2 — 并行翻译
  每页：1 次 LLM 调用，时间戳留在 prompt 里
  并发上限 TRANSLATE_PARALLEL（默认 5，可覆盖）
  单页超时 TRANSLATE_PAGE_TIMEOUT（默认 10 分钟，可覆盖）
  超时/失败的页标记为失败，不中断其他页
  → /tmp/translate-XXXX/pages/page_N.zh（原始 LLM 输出）

Phase 3 — 页间缝合（默认开启）
  N_pages-1 条边界，全部并行
  每条缝：tail(page_N.zh 后 3 行) + head(page_{N+1}.zh 前 3 行)
  → 1 个小 LLM 调用，仅修改 page_{N+1}.zh 的前 3 行

Phase 4 — 格式校验、修复、合并写入（强制）
  见"校验层"章节；通过后按序拼接所有页写入 original_zh.md
```

### Prompt 设计

每页翻译 prompt：

```
你是一名专业字幕翻译员。我将给你一段带时间戳的英文字幕，格式为：
[HH:MM:SS.mmm --> HH:MM:SS.mmm] 英文内容

任务要求：
1. 先通读全部内容，理解整体语义和上下文
2. 将全部内容翻译为流畅的简体中文
3. 输出必须保留【每一条】原始时间戳，格式完全一致：[HH:MM:SS.mmm --> HH:MM:SS.mmm] 中文内容
4. 中文内容按自然语义分配到各时间戳，可合理调整每行文字量，但不能增删时间戳条目
5. 只输出翻译结果，不要解释、不要注释

--- 待翻译字幕 ---
{page_content}
```

缝合 prompt（Phase 3）：

```
以下是两段相邻字幕的边界内容（简体中文）。请微调【下文开头】的前几行，
使其从【上文结尾】自然接续，保持术语和语气一致。
只输出修改后的【下文开头】行，不要输出其他内容。

--- 上文结尾（只读）---
{tail_lines}

--- 下文开头（待调整）---
{head_lines}
```

### 格式校验层（Phase 4）

校验在合并写入前强制执行，分四个 Pass：

**Pass 1：解析与修复**

对每一行：

- **合法行**：匹配 `^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$`，直接保留
- **异常行**：尝试修复
  1. 提取内容：从行中抽取非时间戳的中文文本
  2. 推断时间戳：取前一有效行的结束时间 `prev_end`，后一有效行的开始时间 `next_start`，在区间内按位置均匀插值
  3. 边缘情况：头部孤立行用 `next_start - 25`（秒），尾部孤立行用 `prev_end + 25`（秒）
  4. 重建为标准格式行，记录 `[WARN] repaired line {n}: inferred ts {start} --> {end}`
- **修复失败**（内容完全不可解析）：丢弃，记录 `[WARN] dropped line {n}`

**Pass 2：时间戳排序**

修复后若出现小幅乱序（插值导致），按时间戳重新排序。

**Pass 3：覆盖率验证**

```
覆盖率 = 有效行数（合法 + 修复成功）/ 原始 en.md 行数
```

- `>= 90%`：通过，继续
- `< 90%`：`[STATUS] translate_error: coverage {N}% below threshold`，整步失败

覆盖率阈值 `TRANSLATE_MIN_COVERAGE`，默认 90%，可覆盖。

**Pass 4：合并写入**

按序拼接所有有效行，写入 `original_zh.md`，输出 `[STATUS] translate_done: {N} lines, coverage {pct}%`。

### 超时策略

| 超时类型 | 默认值 | 覆盖方式 |
|----------|--------|----------|
| 单页 LLM 调用 | 10 分钟 | `TRANSLATE_PAGE_TIMEOUT=<秒>` |
| 步骤总超时 | 60min × scale | `VL_TIMEOUT_TRANSLATE=<ms>`（现有机制） |

单页超时后：该页标记失败，其余页继续。所有页完成后统一进入 Phase 4 校验，由覆盖率决定整步是否失败。

### 参数汇总

| 参数 | 默认 | 说明 |
|------|------|------|
| `TRANSLATE_PAGE_SIZE` | 200 | 每页行数 |
| `TRANSLATE_PARALLEL` | 5 | 并发 LLM 调用数 |
| `TRANSLATE_PAGE_TIMEOUT` | 600 | 单页超时（秒） |
| `TRANSLATE_MIN_COVERAGE` | 90 | 最低覆盖率（%） |

## 改动文件汇总

| 文件 | 改动 |
|------|------|
| `scripts/vtt2md.sh` | 新增 AI 字幕检测 + 预合并逻辑 |
| `scripts/download_subs.sh` | Bilibili AI 字幕改存为 `*.auto.vtt`（bug fix） |
| `scripts/translate_subs.sh` | 重写为整体式分页并行翻译 + 格式校验层 |

## 不改动的部分

- `llm_engine.sh` 接口不变，复用现有 claude/opencode 路由
- `translate` 步骤在 DAG 中的位置不变（`vtt2md → translate → md2vtt`）
- orchestrator 步骤超时机制不变（`getStepTimeoutMs('translate', scale)`）
- 下游 `md2vtt` 无需任何改动

## 已排除的方案

- **DAG 层拆步骤**：需要动态 DAG 节点，`schedule.js` 是静态定义，重构代价远超收益
- **增大 25s 分块**：字幕显示粒度锁定了时间戳上限，增大后 VTT cue 过长不可用
- **缝合 pass 287 条**：API 调用量翻倍，缝合对字幕使用场景的体感提升有限；新方案缝合降至 4 条，成本可忽略
- **大块翻译后回填时间戳**：中英文无稳定对齐关系，回填不可靠；新方案将时间戳留在 prompt 内，由 LLM 直接对应，绕开此问题
- **翻译后合并时间戳**：合并应在翻译前完成，使 LLM 拿到完整语义单元；合并边界依赖实际中文字数的需求被预合并的时长约束（3-6 秒）充分覆盖
