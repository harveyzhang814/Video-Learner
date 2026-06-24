# Bilibili yt-dlp 能力审计报告

**日期**：2026-06-24  
**yt-dlp 版本**：2026.06.09  
**测试视频**：`BV1xx411c7mD`（旧视频）、`BV1BJ411W7pX`（教程系列，含 AI 字幕）  
**状态**：待修复

---

## 背景

本项目原为 YouTube 流水线（URL → 下载/转录/总结）。本次审计评估将 Bilibili 作为新来源接入时，yt-dlp 层面的兼容性。

---

## 触发此调查的 Goal Prompt

```
评估 yt-dlp 对 Bilibili 的支持能力，对比本项目（/Users/harveyzhang96/Projects/Video-Learner）
现有 YouTube 流水线的全部 yt-dlp 依赖需求，识别满足/不满足/需适配的部分。

具体要做的事：
1. 读取 scripts/ 中所有涉及 yt-dlp 的调用脚本，整理完整的参数和能力需求列表
2. 实际测试 yt-dlp 对 Bilibili URL 的支持（视频下载、字幕提取含各种回退、登录认证）
3. 逐条对比每个需求在 Bilibili 上的支持状态
4. 输出能力矩阵：✅直接复用 / ⚠️需调整参数 / ❌不支持，附每个缺口的具体说明

验收标准：报告能覆盖项目现有的全部 yt-dlp 能力依赖，并明确 Bilibili 上的满足情况。
```

---

## 能力矩阵

| 能力需求 | YouTube 行为 | Bilibili 实测 | 状态 | 说明 |
|---------|-------------|--------------|------|------|
| 元数据获取 (`--dump-json`) | ✅ | ✅ | ✅ 直接复用 | title/duration/uploader/upload_date 全部存在 |
| 视频下载 (1080P mp4) | ✅ | ✅ | ✅ 直接复用 | 格式串 `bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]` 完全兼容 |
| 音频下载 (bestaudio m4a) | ✅ | ✅ | ✅ 直接复用 | `bestaudio[ext=m4a]` 正常工作 |
| DASH 分流合并 | ✅ | ✅ | ✅ 直接复用 | video/audio 分离流 + ffmpeg 合并，结构相同 |
| 进度模板 (`--progress-template`) | ✅ | ✅ | ✅ 直接复用 | yt-dlp 通用功能 |
| Cookie 认证 (`--cookies-from-browser`) | 按需触发 | 必须 | ⚠️ 需调整 | Bilibili 无 cookie 直接 HTTP 412，不同于 YouTube 的文字提示 |
| Bot 检测重试逻辑 | `sign in\|bot\|...` | `412 Precondition Failed` | ❌ 不支持 | `download_video.sh` 和 `download_audio.sh` 的 grep 条件不匹配 412，cookie 回退永远不触发 |
| 字幕语言检测 (`--list-subs` → awk) | `en/en-orig/zh-Hans/zh-CN/...` | `danmaku`、`ai-zh` | ❌ 不支持 | awk 解析器只匹配已知 YouTube 语言码，`ai-zh` 永远不被检测到 |
| 字幕下载 (`--write-subs`) | VTT 格式 | SRT 格式（`ai-zh`） | ⚠️ 需调整 | `ai-zh` 是有效字幕，但需 `--sub-lang ai-zh --write-subs`，格式为 SRT 非 VTT |
| VTT → Markdown 转换 | `*.vtt` | `*.srt` | ❌ 不支持 | `convert_vtt_md.sh` 仅处理 VTT；Bilibili AI 字幕输出 SRT 无法进入转换流程 |
| `language` 字段 | `"en"` / `"zh"` 等 | `null` | ⚠️ 需调整 | `fetch_info.sh` 空值默认为 `"en"`；中文内容 lang 将错误标记为英文，影响 ASR 语言选择 |
| 多P URL 检测 (`?p=N`) | `?list=` → `--no-playlist` | `?p=N` 不触发 | ⚠️ 需调整 | `download_subs.sh` 仅检测 `list=`；`?p=N` URL 会导致 yt-dlp 下载整个系列 |
| URL 验证/拦截 | 无限制 | 无限制 | ✅ 直接复用 | core orchestrator、CLI 无 YouTube 专属 URL 过滤 |
| 任务 ID 生成 (`sha1(url+\n)`) | ✅ | ✅ | ✅ 直接复用 | SHA1 是 URL 无关的 |

---

## 缺口详解与修复方案

### 缺口 1：Bot 检测重试条件不匹配 412 错误（高优先级）

**问题文件**：`scripts/download_video.sh:81`、`scripts/download_audio.sh:70`

```bash
# 现有条件（不匹配 Bilibili）
echo "$OUTPUT" | grep -qi "sign in\|bot\|confirm your age\|login required"
```

Bilibili 未登录时返回 `HTTP Error 412: Precondition Failed`，完全不命中以上条件，导致 cookie 回退永远不触发，下载直接失败。

**修复方案**：对 Bilibili URL，将 cookies 作为第一次尝试（attempt 1），而非重试兜底。检测 URL 是否为 `bilibili.com` 并相应调整尝试顺序。或在 grep 条件加入 `412`。

---

### 缺口 2：字幕系统无法识别 Bilibili 格式（高优先级）

**问题文件**：`scripts/download_subs.sh:76`

```bash
# 现有 awk 解析器（不识别 ai-zh）
awk '/^[[:space:]]*(en-orig|en|zh-CN|zh|zh-TW|zh-Hans|zh-Hant)[[:space:]]/{print $1}'
```

Bilibili 字幕实测情况：
- 所有视频：`danmaku xml`（弹幕，不适用于转录）
- 部分视频（有创作者上传字幕或 B 站 AI 转录）：`ai-zh srt`

`ai-zh` 不在 awk 匹配列表中，永远被忽略，所有 Bilibili 视频的 `subs` 步骤必然失败并 fallback 到 ASR。

**修复方案**：
1. 在 `download_subs.sh` 中增加对 `ai-zh` 的检测和下载分支
2. 新增 SRT → Markdown 的转换脚本（或扩展 `convert_vtt_md.sh` 支持 SRT 输入）
3. 在 orchestrator 的 `vtt2md` 步骤支持 SRT 输入路径

> **注意**：即使不修复此缺口，功能上仍可接受——ASR fallback 是设计内的兜底路径。但有 `ai-zh` 字幕的视频会浪费高质量免费字幕。

---

### 缺口 3：`language` 字段默认 `"en"` 误导 ASR（中优先级）

**问题文件**：`scripts/fetch_info.sh:63-64`

```bash
lang_raw=$(echo "$video_info" | jq -r '.language // ""' 2>/dev/null)
lang=$(echo "$lang_raw" | cut -d'-' -f1 ...)
[ -z "$lang" ] && lang="en"   # ← Bilibili 返回 null，命中此行
```

Bilibili JSON 的 `language` 字段为 `null`，导致中文视频被标记为 `lang=en`，ASR 将用英文语音识别模式转录中文内容，准确率大幅下降。

**修复方案**：检测到 Bilibili URL 时，`language` 为空时默认设为 `"zh"` 而非 `"en"`。

---

### 缺口 4：多P URL 的 `--no-playlist` 缺失（中优先级）

**问题文件**：`scripts/download_subs.sh:53-56`（同样影响 `download_video.sh`、`download_audio.sh`）

```bash
# 现有检测（只处理 YouTube playlist 参数）
if [[ "$URL" == *"list="* ]]; then
    NO_PLAYLIST_OPT="--no-playlist"
```

Bilibili 多集视频使用 `?p=N`（如 `BV1BJ411W7pX?p=3`）。不含 `list=`，无法触发单集下载，yt-dlp 会尝试下载整个系列。

**修复方案**：

```bash
if [[ "$URL" == *"list="* ]] || [[ "$URL" == *"?p="* ]] || [[ "$URL" == *"&p="* ]]; then
    NO_PLAYLIST_OPT="--no-playlist"
```

---

## 整体可行性评估

| 层面 | 结论 |
|------|------|
| 视频/音频下载核心 | ✅ 完全兼容，格式串直接可用 |
| 认证机制 | ⚠️ cookie 需始终开启（而非按需重试） |
| 字幕路径 | ❌ 需新增 Bilibili 专属字幕处理（`ai-zh` + SRT 转换） |
| 元数据 | ⚠️ `language` 字段需特殊处理 |
| 多P检测 | ⚠️ `--no-playlist` 条件需扩展 |
| **整体可行性** | ✅ **可行**，核心下载通道无障碍，4 个缺口均有明确修复方案 |

---

## 修复优先级建议

1. **缺口 4**（多P URL）：一行改动，影响面广，建议最先修
2. **缺口 3**（language 默认值）：一行改动，防止 ASR 语言错误
3. **缺口 1**（Bot 检测重试）：影响认证流程稳定性
4. **缺口 2**（字幕系统）：工作量最大，但 ASR fallback 可先托底
