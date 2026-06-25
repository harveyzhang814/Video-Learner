# ADR: 字幕翻译并行化与 AI 字幕预合并

**日期：** 2026-06-26  
**状态：** 已实施

## 背景

旧版 `translate_subs.sh` 按 25 秒时间窗口将字幕切成约 288 块，依次串行调用 LLM。两小时视频翻译耗时 20–30 分钟；每块上下文仅约 50–80 词，专有术语跨块容易前后不一致。

此外，平台 AI 字幕和 ASR 转录的时间戳粒度为 2–3 秒，翻译为中文后字幕刷新过快，观众来不及阅读。

## 决策

### 1. AI 字幕预合并（`vtt2md` 阶段，`merge_ai_subs.py`）

在 `vtt2md` 格式转换后、写出 `original_en.md` 之前，对 AI 来源字幕（`*.auto.vtt`、`*.asr.vtt`）执行句子级合并：

- 在句末标点处切断，前提是当前块已达 `MIN_BLOCK_SECS`（默认 3s）
- 超过 `MAX_BLOCK_SECS`（默认 6s）时强制切断
- 人工字幕（`*.original.vtt`）跳过合并，尊重其已校对的分句

**同时修复 Bilibili AI 字幕命名 bug：** Bilibili AI 字幕（`ai-zh`、`ai-en`）此前错误地存为 `*.original.vtt`，无法被自动检测为 AI 字幕。改存为 `*.auto.vtt`。

### 2. 整体式并行翻译（`translate_subs.sh` 重写）

将时间戳保留在 prompt 内，LLM 先通读整页再翻译，直接将中文分配到各时间戳行——无需事后回填对齐。

四阶段管道：

```
Phase 1 — 按行数分页（默认 200 行/页，零填充文件名供 macOS sort 使用）
Phase 2 — 并发翻译（默认 5 路，单页超时 600s，失败不阻断其余页）
Phase 3 — 页间缝合（相邻两页各取 3 行，1 次小 LLM 调用，patch[:keep_from] 防胀行）
Phase 4 — 格式校验与写入（translate_validator.py：修复 → 排序 → 覆盖率验证 → 写出）
```

覆盖率验证：有效行数 / 原始英文行数 ≥ `TRANSLATE_MIN_COVERAGE`（默认 90%）；不足则整步失败。修复策略：取前后有效行时间戳插值；头部孤立行用 `next_start - 25ms`，尾部孤立行用 `prev_end + 25ms`。

### 3. 测试可注入的 LLM 引擎

`translate_subs.sh` 通过 `LLM_ENGINE_SCRIPT` 覆盖 LLM 调用路径，E2E 测试注入 `tests/e2e/mock_llm_engine.sh`（从 prompt 提取时间戳行，输出确定性占位译文），无需真实 LLM 即可覆盖全链路。

## 理由

- **时间戳留在 prompt**：中英文无稳定词数对齐，事后回填不可靠；整页上下文让 LLM 自主决策每行填多少字，绕开对齐问题。
- **行数分页而非时间窗口**：页面大小稳定（200 行），不受字幕稀疏度影响；零填充文件名解决 macOS 无 `sort -V` 问题。
- **预合并在翻译前**：合并边界依赖时长约束（3–6s），与 LLM 无关；合并后的句子块同时提升 LLM 翻译质量和中文字幕可读性。
- **DAG 层不拆步骤**：`schedule.js` 是静态 DAG；四阶段均在单个 `translate` 步骤脚本内完成，重构代价最低。
- **Phase 3 `patch[:keep_from]` 修正**：原写法 `patch + orig[keep_from:]` 在 LLM 返回超过 3 行时会胀入多余行；`patch[:keep_from]` 严格限定替换范围。

## 影响

| 文件 | 变更 |
|------|------|
| `scripts/download_subs.sh` | Bilibili AI 字幕改存 `*.auto.vtt` |
| `scripts/merge_ai_subs.py` | 新建：AI 字幕预合并逻辑 |
| `scripts/convert_vtt_md.sh` | 新增 AI 字幕检测 + 调用 `merge_ai_subs.py` |
| `scripts/translate_subs.sh` | 完全重写：整体式分页并行翻译 |
| `scripts/translate_validator.py` | 新建：格式校验 + 修复 + 覆盖率验证 |
| `tests/e2e/mock_llm_engine.sh` | 新建：E2E 测试用确定性 mock LLM |
| `tests/e2e/test_subtitle_pipeline.py` | 新建：8 个 E2E 场景（全链路覆盖） |
| `tests/test_merge_ai_subs.py` | 新建：6 个预合并单元测试 |
| `tests/test_translate_validation.py` | 新建：8 个校验层单元测试 |
| `tests/test_convert_vtt_md.py` | 新建：6 个 bash 集成测试 |

DAG 拓扑、`llm_engine.sh` 接口、下游 `md2vtt`、编排层超时机制均不变。

## 不在范围内

- `llm_engine.sh` 引擎实现（Claude/OpenCode 路由）
- GUI 侧翻译进度可视化
- 多语言翻译（目前仅 EN→ZH-CN）
- Whisper ASR 输出的标点注入（预合并在标点缺失时退化为纯时长切断，可接受）
