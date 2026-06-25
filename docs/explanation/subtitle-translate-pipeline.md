# 字幕翻译流水线原理

字幕翻译链（`vtt2md → translate → md2vtt`）包含三个有状态的处理阶段：AI 字幕预合并、并行整体式翻译、格式校验。本文解释这些阶段的设计动机与取舍。

---

## 为什么需要 AI 字幕预合并

平台 AI 字幕（`*.auto.vtt`）和 ASR 转录（`*.asr.vtt`）的时间戳粒度由语速驱动——英文通常每条 2–3 秒。翻译为中文后，中文阅读速度（大约 300–400 字/分钟）比英文慢，同等字数需要更多时间浏览，但字幕刷新间隔并未变长，导致观众来不及阅读。

预合并在翻译前将细粒度行合并为句子级时间块（`merge_ai_subs.py`）：

```
原始：
[00:00:04.480 --> 00:00:07.349] Hi, welcome back to this agendic pattern
[00:00:07.349 --> 00:00:10.320] series. In last part we cover
[00:00:10.320 --> 00:00:12.870] some use cases from single

合并后（句末切断，共 8.4 秒）：
[00:00:04.480 --> 00:00:10.320] Hi, welcome back to this agendic pattern series.
[00:00:10.320 --> 00:00:12.870] In last part we cover some use cases from single
```

合并算法：以 `MIN_BLOCK_SECS`（默认 3）为下限，到句末标点时切断；超过 `MAX_BLOCK_SECS`（默认 6）时强制切断。这样 LLM 在翻译时拿到完整语义单元，而非孤立的语音碎片，术语一致性也随之提升。

**只对 AI 字幕合并，不对人工字幕合并：** 人工字幕（`*.original.vtt`）的时间戳已经过人工校对，尊重其分句决策。

---

## 为什么从串行 25 秒窗口切换到整体式并行翻译

旧方案将字幕按 25 秒时间窗口切块，依次调用 LLM，单次调用只送入一个小块。两小时视频约产生 288 块，串行跑完需 20–30 分钟；每块上下文窗口仅约 50–80 词，跨块专有名词容易前后不一致（典型错误：`agenic pattern → 基因模式`）。

新方案将时间戳保留在 prompt 内，LLM 先通读整页（200 行，约 10 分钟视频内容）再翻译，由 LLM 将中文直接分配到各时间戳——不需要事后回填对齐：

```
[HH:MM:SS.mmm --> HH:MM:SS.mmm] 英文内容
→ LLM 整体翻译 →
[HH:MM:SS.mmm --> HH:MM:SS.mmm] 中文内容
```

多页之间并行执行（默认 5 路并发），两小时视频通常只需 5–6 页，wall time 降至约 90 秒/页。

| 维度 | 旧方案 | 新方案 |
|------|--------|--------|
| 分块单位 | 25 秒时间窗口 | 200 行/页（≈10 分钟） |
| LLM 调用次数（2h 视频） | ~288 次串行 | ~5 次并行 |
| 输出时间戳颗粒度 | 25 秒/条 | 句子级（3–6 秒/条） |
| 术语跨块一致性 | 依赖前文拼接片段 | 整页上下文 |

---

## 四阶段翻译管道

`translate_subs.sh` 将翻译分为四个阶段：

### Phase 1 — 分页

按行数切分输入（`TRANSLATE_PAGE_SIZE`，默认 200），零填充文件名（`page_000.en`）保证 macOS 下 `ls | sort` 的词典序与页序一致（GNU `sort -V` 在 macOS 不可用）。

### Phase 2 — 并行翻译

每页独立调用 `llm_engine.sh`，并发上限由 `TRANSLATE_PARALLEL`（默认 5）控制。单页失败不中断其余页，由 Phase 4 的覆盖率验证决定整步是否失败。

### Phase 3 — 页间缝合

相邻两页边界各取 3 行，调一次小 LLM 请求微调下页前 3 行，使术语和语气从上页自然接续。缝合用 `patch[:keep_from] + orig[keep_from:]` 写回——`keep_from = min(len(patch), 3)`，防止 LLM 输出行数超出预期时胀入多余行。

### Phase 4 — 格式校验与写入

`translate_validator.py` 对所有页拼合后的输出执行四 Pass 校验：

1. **解析与修复**：每行匹配 `^\[HH:MM:SS.mmm --> HH:MM:SS.mmm\] .+$`；不合规行尝试补推时间戳（取前后有效行插值）；头部孤立行用 `next_start - 25ms`，尾部孤立行用 `prev_end + 25ms`。
2. **时间戳排序**：修复后若出现小幅乱序，按起始时间重排。
3. **覆盖率验证**：有效行数 / 原始英文行数 ≥ `TRANSLATE_MIN_COVERAGE`（默认 90%）才通过；否则整步失败。
4. **合并写入**：通过后按序拼接写入 `original_zh.md`。

强制执行校验的原因：LLM 偶尔在页边界处返回格式损坏的行或丢行，无修复层会导致下游 `md2vtt` 产出损坏的 VTT 文件。

---

## 被排除的方案

**DAG 层拆步骤（动态节点）**：`schedule.js` 是静态 DAG 定义，引入动态节点需要大量重构，收益远低于成本。

**增大 25 秒分块**：时间戳粒度上限锁定了 VTT cue 长度；增大后 cue 过长，观众无法及时阅读。

**翻译后合并时间戳**：中英文无稳定词数对齐关系，事后回填不可靠。将时间戳留在 prompt 内，由 LLM 直接对应，绕开此问题。

**287 条缝合 pass（旧方案规模）**：API 调用量翻倍，而字幕使用场景下缝合收益有限。新方案仅约 4 条缝，成本可忽略。

---

## 参数参考

| 变量 | 默认 | 说明 |
|------|------|------|
| `TRANSLATE_PAGE_SIZE` | 200 | 每页行数 |
| `TRANSLATE_PARALLEL` | 5 | 最大并发 LLM 调用数 |
| `TRANSLATE_PAGE_TIMEOUT` | 600 | 单页超时（秒） |
| `TRANSLATE_MIN_COVERAGE` | 90 | 最低覆盖率（%） |
| `VTT2MD_MIN_BLOCK_SECS` | 3 | AI 字幕预合并最短块时长（秒） |
| `VTT2MD_MAX_BLOCK_SECS` | 6 | AI 字幕预合并最长块时长（秒） |
| `LLM_ENGINE_SCRIPT` | `scripts/llm_engine.sh` | 覆盖 LLM 引擎脚本路径（测试用） |

单页翻译超时后：该页标记失败，Phase 4 的覆盖率验证决定整步是否失败。

---

## 关联文档

- `explanation/asr-and-dag.md` — ASR 回退机制与 DAG 可达性（`vtt2md` 两条路径）
- `reference/architecture.md` §4.2 — 字幕下载与文件命名规则
