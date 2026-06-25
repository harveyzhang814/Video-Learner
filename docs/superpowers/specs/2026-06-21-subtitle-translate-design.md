---
migrated: 2026-06-26
docs:
  - reference/architecture.md  # §4 Step 3.5 translate 步骤说明（DAG 位置、跳过条件）
superseded_by:
  - 2026-06-25-parallel-translate-design.md  # 翻译算法（串行 25s 窗口 → 并行整体式）、格式校验层、AI 字幕预合并
---

# 字幕翻译步骤（translate）设计文档

## 概述

在 DAG 侧链中，`vtt2md` 和 `md2vtt` 之间插入新节点 `translate`：当字幕只有英文（`original_en.md` 存在、`original_zh.md` 不存在）时，调用 LLM 将英文 Markdown 转录翻译为中文，输出 `original_zh.md`，供 `md2vtt` 生成中文 VTT 字幕文件。

**核心前提：输出文件的时间戳无需与原文对齐。** `original_zh.md` 的时间戳数量和位置可以与 `original_en.md` 完全不同，这是预期行为。

## 背景

视频同时包含视觉信息和音频信息。现有流水线在纯英文视频上只产出英文转录，用户需要中文字幕来降低理解成本。此步骤作为侧链最低优先级节点，不阻塞主链（article → summary）的执行。

参考：Vimeo Engineering Blog《How We Built AI-Powered Subtitles at Vimeo》（2026-01）提供了三阶段分离架构的实践验证。本方案借鉴其 Phase 1（智能分块）和 Phase 2（创意翻译），因时间戳无需对齐，跳过其 Phase 3（行数映射）。

## 更新后的 DAG

```
fetch → subs ┐
fetch → asr  ┘→ vtt2md (OR gate) → translate → md2vtt   ← 侧链（串行）
                               └─→ article → summary     ← 主链
```

**边变更**：

| 操作 | 边 |
|------|----|
| 移除 | `['vtt2md', 'md2vtt']` |
| 新增 | `['vtt2md', 'translate']` |
| 新增 | `['translate', 'md2vtt']` |

## 步骤行为

### 跳过条件（在步骤启动时检查，标记 skipped）

1. `transcript/original_zh.md` 已存在 → 已有中文，无需翻译
2. `transcript/original_en.md` 不存在 → 无英文源，无法翻译

两个条件均不满足时（有英文、无中文）→ 执行翻译。

**已 skipped 的 translate 节点仍然解除 `md2vtt` 的前置封锁**，因为编排器将 `skipped` 状态视为"已满足"，与 `completed` 等价。

### 执行流程（三阶段）

#### Phase 1：分块（Python 预处理）

`original_en.md` 的每个 `## HH:MM:SS` 块通常只是句子的一个碎片，直接逐块翻译会造成语义割裂。ASR 输出可能完全没有标点，因此分块不依赖标点检测。

分块算法：
1. 解析所有 `## HH:MM:SS` 块，得到 `[(timestamp, text), ...]` 列表
2. 按**时间窗口**（20-30 秒）合并相邻碎片为一块；若块内存在标点则优先在句末切，无标点则纯按时间切
3. 每块包含：`start_ts`（第一个碎片的时间戳）、`merged_en_text`（合并后的英文）

#### Phase 2：顺序翻译（LLM，无结构约束）

**必须顺序执行**，每块 prompt 中传入上一块翻译结果的末尾片段（约 100-200 字符），解决块间句子切断问题：

```
你是一名字幕翻译员。将【待翻译】内容翻译为简体中文。
要求：语义准确、中文流畅，不限行数和结构。
从【已翻译上文】结束的语义节点自然接续，不重复上文内容。

--- 已翻译上文（末尾，接续参考）---
{zh_prev_tail}          ← 上一块中文输出的最后 100-200 字符

--- 待翻译 ---
{merged_en_text}

--- 下文参考（只读，不翻译）---
{next_chunk_en}         ← 下一块英文，帮助 LLM 预判语义走向
```

- `zh_prev_tail`：上一块末尾片段，**不随块数增加而增长**，成本恒定
- 第一块无上文，`zh_prev_tail` 为空

#### Phase 3：时间戳标注（Python 后处理）

```
每个思想块的翻译结果 → ## {start_ts}\n{zh_text}
```

输出的 `original_zh.md` 时间戳数量远少于原文（每 20-30 秒一个 vs 原文每 2-3 秒一个），这是预期行为，`md2vtt` 可正常处理。

### 对 md2vtt 的影响

`md2vtt` 遍历所有 `original_*.md` 文件生成对应 VTT。`translate` 完成后，`original_zh.md` 会被 `md2vtt` 转换为 `original_zh.vtt`，即中文 VTT 字幕文件。时间戳颗粒度比原文粗（每句一个时间点 vs 原文每 2-3 秒一个），对学习场景完全够用。

## 实现改动清单

### `core/orchestrator/schedule.js`

```js
// ALL_STEPS：加入 translate
const ALL_STEPS = [
  'fetch', 'video', 'audio', 'subs', 'asr',
  'vtt2md', 'translate', 'md2vtt', 'article', 'summary'
];

// STEP_EDGES：移除 vtt2md→md2vtt，新增两条边
const STEP_EDGES = [
  ['fetch', 'video'],
  ['fetch', 'audio'],
  ['fetch', 'subs'],
  ['fetch', 'asr'],
  ['subs',  'vtt2md'],
  ['asr',   'vtt2md'],
  ['vtt2md', 'translate'],   // 新增
  ['translate', 'md2vtt'],   // 新增（原 vtt2md→md2vtt 替换）
  ['vtt2md', 'article'],
  ['article', 'summary'],
];

// SECONDARY_CHAIN_BASE：translate 插在 md2vtt 前
const SECONDARY_CHAIN_BASE = ['video', 'audio', 'asr', 'translate', 'md2vtt'];

// 超时：60 分钟（与 article/summary 一致）
translate: 60 * 60 * 1000,
```

### `core/orchestrator/index.js`

新增 `case 'translate'` 处理器：

- 检查 `original_zh.md` / `original_en.md` 存在性，决定 skip 或 run
- skip 路径：`db.updateStep(id, 'translate', 'skipped')`，返回 `{ success: true }`
- run 路径：调用 `runStepScript(rootDir, 'translate', [enMdPath, zhMdPath], ...)`

`STEPS` 常量加入 `'translate'`，`STEP_SCRIPTS` 加入映射 `translate: 'translate_subs.sh'`。

### `scripts/translate_subs.sh`（新文件）

```
Usage: bash scripts/translate_subs.sh <INPUT_EN_MD> <OUTPUT_ZH_MD>
```

核心逻辑（调用内嵌 Python）：
1. **Phase 1**：解析 `## HH:MM:SS` 块，按标点合并为思想块，输出 `[(start_ts, merged_en)]` JSON
2. **Phase 2**：逐块写 prompt 文件（含前后上下文），调用 `llm_engine.sh`，收集中文翻译
3. **Phase 3**：将 `(start_ts, zh_text)` 对序列化为 `## HH:MM:SS\n{zh_text}` 格式写入输出文件

状态输出格式：`[STATUS] translate_start` / `translate_chunk N/M` / `translate_done` / `translate_error: <msg>`

## 错误处理

| 场景 | 行为 |
|------|------|
| LLM 调用失败（非零退出码） | 该块标记失败，记录错误，继续处理后续块；全部块失败则步骤标记 failed |
| 分块后无有效内容 | 步骤标记 failed |
| `original_en.md` 在执行中被删除 | 步骤标记 failed |
| 任务/步骤 abort 信号 | 清理临时文件后退出，与其他步骤一致 |
| 部分 chunk LLM 失败 | 跳过失败块，继续处理后续块；输出的 `original_zh.md` 包含较少字幕条目（而非损坏的 VTT），`md2vtt` 可正常处理 |

## 测试策略

- **单元**：Python 分块逻辑用 fixture MD 验证：碎片正确合并、start_ts 取第一个碎片、上下文窗口正确截取
- **集成**：mock `llm_engine.sh`，验证 skip 条件（有中文/无英文）和完整三阶段 run 路径
- **DAG 调度**：在 `orchestrator-schedule.test.js` 中验证：
  - `vtt2md` 完成后 `translate` 进入 ready
  - `translate` 完成/skipped 后 `md2vtt` 进入 ready
  - `article` 不等待 `translate`（两者并发 ready）
- **下游兼容**：`md2vtt` 在有 `original_zh.md`（时间戳稀疏）时能正确输出 `original_zh.vtt`

## 风险

| 风险 | 缓解 |
|------|------|
| ASR 输出无标点，时间窗口切割恰好切断句子 | Phase 2 传入上一块中文末尾片段（100-200 字符），LLM 从该语义节点自然接续 |
| 时间窗口过大导致单块过长，LLM 输出质量下降 | 窗口上限 30 秒，同时按字符数（≤ 800）兜底截断 |
| 既有任务无 translate 步骤记录 | 编排器初始化时为缺失步骤写入 pending，与现有步骤迁移逻辑一致 |
| translate 失败导致 md2vtt 永久阻塞 | 需使用适当 timeout_scale；可通过 reset_scope=step 重置并重试 |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 3 | CLEAR (PLAN) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
