# 设计：字幕下载繁体中文兜底（zh-TW/zh-Hant）

## 背景

当前字幕下载/转录链路主要通过 `yt-dlp` 进行字幕探测与下载，并按固定命名落盘到 `work/<id>/transcript/subs/`，再由后续步骤转换为：

- `work/<id>/transcript/original_en.md`
- `work/<id>/transcript/original_zh.md`

现状对中文字幕的探测/匹配较严格，且对台湾视频常见的繁体字幕语言码（如 `zh-TW`）缺乏明确兜底策略，可能出现“英文与简体都没有字幕时，繁体也未被尝试”的情况。

## 目标

新增保底规则：

- **仅当英文与简体中文都“没有成功下载到任何字幕（original 或 auto）”时**，才启用繁体中文字幕兜底。
- 兜底时优先下载 **繁体 original**；若仍不可用，再尝试 **繁体 auto**。
- 保持对下游处理的兼容：繁体兜底最终仍写入 `zh` 通道（即生成 `<id>.zh.(original|auto).vtt`，并转换为 `original_zh.md`）。

## 非目标

- 不改变文章/总结的语言选择策略（仍由现有 `article_source_lang`/优先级逻辑决定）。
- 不引入新的多语言 transcript 文件命名（例如不额外生成 `original_zhHant.md`）。

## 触发条件（精确定义）

触发判断使用 **“是否已成功下载到至少一份字幕”** 的口径（original + auto 都算“有字幕”）：

- **英文缺失**：`en-orig`（original）下载失败/缺失，且 `en`（auto）也下载失败/缺失。
- **简体缺失**：`zh-Hans`（original/auto）下载失败/缺失，且 `zh`（generic auto）也下载失败/缺失。

当且仅当：

- `en_any_downloaded == false` 且
- `zh_any_downloaded == false`

才进入繁体兜底下载流程。

## 语言码候选与下载顺序

### 英文

- original：`en-orig`（`--write-subs`）
- auto：`en`（`--write-auto-subs`）

### 简体中文

- original：`zh-Hans`（`--write-subs`）
- auto：`zh`（`--write-auto-subs`）

### 繁体中文（兜底）

只在触发条件满足时尝试：

- original：`zh-TW` → `zh-Hant`（`--write-subs`）
- auto（仅 original 不可用时）：`zh-TW` → `zh-Hant`（`--write-auto-subs`）

## 文件命名与兼容性

为保证后续转换逻辑（VTT→MD、MD→VTT、前端展示）无需改接口，统一输出到 `zh` 通道：

- 下载到：`work/<id>/transcript/subs/<id>.zh.original.vtt` 或 `<id>.zh.auto.vtt`
- 转换到：`work/<id>/transcript/original_zh.md`（以及可选的 `original_zh.vtt` 供前端展示）

即：不论简体/繁体来源，最终都只产出一个 `original_zh.md`。

## 落点（改动位置）

为保持 CLI `scripts/run.sh` 与 orchestrator `scripts/download_subs.sh` 行为一致，需要两处都落地相同规则：

- `scripts/download_subs.sh`：orchestrator 的 `subs` 步骤使用该脚本下载字幕。
- `scripts/run.sh`（`get_transcript()` 内）：“一键全流程”在转录阶段也包含字幕探测/下载逻辑。

## 测试策略（最小集）

- 单测/脚本级：扩展 `scripts/test_subtitle.sh` 或新增覆盖用例，至少验证：
  - `en` 与 `zh` 都缺失/不可下载时，且 `zh-TW` 存在，会下载到 `*.zh.original.vtt`
  - `zh-TW` original 不存在但 auto 存在时，会下载到 `*.zh.auto.vtt`
  - 当 `en`（auto）存在并可成功下载时，不会触发繁体兜底（即不会尝试 `zh-TW/zh-Hant`）
  - 当 `zh`（generic auto）存在并可成功下载时，不会触发繁体兜底（即不会尝试 `zh-TW/zh-Hant`）

