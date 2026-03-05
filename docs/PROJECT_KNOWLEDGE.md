# Video-Learner 项目知识文档

## 项目概述

Video-Learner 是一个 YouTube 视频处理流水线工具，实现了从 YouTube URL 到下载、转录、总结的完整自动化流程。核心功能包括：

1. **视频下载** - 下载最高 1080p 的视频和音频
2. **字幕获取** - 自动下载中英双语字幕
3. **转录生成** - 将字幕转换为带时间戳的逐字稿（original.md）
4. **文章整理** - 将转录整理为结构化文章（article.md）
5. **智能总结** - 根据用户关注的重点生成摘要（summary.md）
6. **桌面客户端** - 提供 Electron GUI 界面

---

## 目录结构

```
Video-Learner/
├── CLAUDE.md                 # 项目执行标准文档
├── scripts/                  # 核心脚本
│   ├── run.sh               # 主入口脚本（流水线调度）
│   ├── download_video.sh    # 视频下载脚本
│   ├── vtt_converter.py     # VTT 转 Markdown 工具
│   ├── md2subtitle.py       # Markdown 转字幕工具
│   ├── meta_utils.py        # 元数据管理工具
│   ├── article_prompt.txt   # 文章生成提示词
│   └── summary_prompt.txt   # 总结生成提示词
├── electron/                 # Electron 桌面客户端
│   ├── package.json
│   ├── src/
│   │   ├── main.js          # 主进程
│   │   ├── preload.js       # 预加载脚本
│   │   └── renderer/
│   │       └── index.html   # 前端界面
│   └── README.md
├── start-electron.sh         # 启动 Electron 的脚本
└── work/                    # 输出目录
    └── <id>/
        ├── media/           # 媒体文件
        │   ├── video.mp4    # 视频文件
        │   ├── audio.m4a    # 音频文件
        │   └── video_download.log
        ├── transcript/      # 转录与字幕
        │   ├── subs/        # 字幕文件 (vtt)
        │   ├── original.md  # 逐字稿（带时间戳）
        │   ├── original.vtt
        │   └── meta.json   # 元数据
        └── writing/         # 生成内容
            ├── article.md    # 结构化文章
            └── summary.md   # 总结
```

---

## 核心组件详解

### 1. run.sh - 主入口脚本

这是整个流水线的核心入口，负责协调各个步骤的执行：

**主要功能：**
- 解析命令行参数（URL、LANG、MODE、FORCE、FOCUS）
- 生成视频 ID（URL 的 SHA1 前 12 位）
- 初始化或加载 meta.json
- 调度视频下载、转录、文章生成、总结生成

**参数说明：**
```bash
bash scripts/run.sh "<URL>" [LANG=auto] [MODE=both|video|audio|transcript] [FORCE=0|1] [FOCUS="..."]
```

- `LANG`: 语言代码，默认 auto
- `MODE`: `both` (下载+转录) | `video` (仅视频) | `audio` (仅音频) | `transcript` (仅转录+总结)
- `FORCE`: `0` (跳过已完成的) | `1` (强制重新执行)
- `FOCUS`: 用户想了解的重点（如 "技术细节"、"主要论点"、"行动项"）

**执行流程：**
1. Step 0: 获取视频信息（标题、时长、语言）
2. Step 1: 视频下载（后台独立进程）
3. Step 2: 音频提取
4. Step 3: 获取双语字幕并转写为 original.md
5. Step 3.5: 生成结构化 article.md
6. Step 4: 生成 summary.md

### 2. download_video.sh - 视频下载脚本

独立的后台下载脚本，支持两种下载策略：

**策略 1: 合并格式（优先）**
- 尝试下载合并的 MP4 格式（bestvideo+bestaudio）
- 目标分辨率：最高 1080p

**策略 2: DASH 分离流（后备）**
- 分别下载视频流和音频流
- 使用 ffmpeg 合并为完整视频

**重试逻辑：**
- 第一次失败 → 立刻重试一次（清理半成品）
- 第二次仍失败 → 放弃，记录 `download_status=failed`

### 3. Python 工具脚本

#### vtt_converter.py
- **功能**: 将 VTT 字幕转换为 Markdown 格式
- **输入**: VTT 字幕文件
- **输出**: 带时间戳的 Markdown 文件（[mm:ss] 格式）
- **特性**: 自动去重（时间差<0.5s 或文本包含时合并）

#### md2subtitle.py
- **功能**: 将 Markdown 转换回字幕格式
- **输入**: original.md 文件
- **输出**: VTT 或 SRT 格式字幕
- **用途**: 前端显示字幕

#### meta_utils.py
- **功能**: 管理 meta.json 的工具函数
- **提供**: 创建、加载、保存 meta 的 Python API

### 4. Electron 桌面客户端

基于 Electron 的 GUI 应用，提供可视化的视频处理界面：

**主要功能：**
- 输入 YouTube URL 和 FOCUS
- 实时显示处理进度
- 查看生成的 Article 和 Summary
- 播放下载的视频
- 中英双语字幕切换
- 历史记录管理

**界面布局：**
- 左侧: 历史记录列表
- 中间: 输入区 + 输出区（Log/Article/Summary 标签页）
- 右侧: 视频播放器 + 字幕模块

**IPC 通信：**
- `run-pipeline`: 启动流水线
- `read-file`: 读取生成的文件
- `list-works`: 列出历史记录
- `delete-work`: 删除记录
- `get-video-path`: 获取视频路径
- `read-subtitle`: 读取字幕

---

## meta.json 字段说明

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "id": "a1274118464c",
  "ts": "2026-03-04T19:33:57Z",
  "title": "视频标题",
  "duration": "332",
  "lang": "en-US",
  "download_status": "pending|success|failed|skipped_existing",
  "download_attempts": 0,
  "download_error": "",
  "transcript_source": "youtube_transcript|subtitle|existing|asr_missing|none",
  "transcript_done": true|false,
  "article_done": true|false,
  "summary_done": true|false,
  "download_video": true|false,
  "focus": "用户关注的重点",
  "tool_versions": {
    "yt_dlp": "2026.03.03",
    "ffmpeg": "8.0",
    "jq": "jq-1.7.1-apple"
  },
  "transcripts": {
    "en": { "type": "original|auto", "done": true|false },
    "zh": { "type": "original|auto", "done": true|false }
  },
  "article_source_lang": "en|zh",
  "article_prompt_path": "..."
}
```

---

## 关键设计决策

### 1. 视频下载独立性
- 视频下载成功/失败**不影响** transcript 获取和总结
- 即使 video 下载失败，也必须完成 original.md + summary.md

### 2. 双语字幕处理
- 自动检测可用的字幕语言（en-orig/en/zh-Hans/zh-Hant）
- 优先使用 original 字幕，其次是 auto 字幕
- 选择优先级: original > auto，同类型时 English > Chinese

### 3. 去重与复用
- ID = sha1(url) 前 12 位
- 若 `meta.json` 存在且 `transcript_done=true`，跳过 transcript/summary（FORCE=1 除外）
- 若 `video.mp4` 存在且完整，跳过视频下载
- 每次运行都更新/追加 `work/index.jsonl`

### 4. 用户意图 (FOCUS)
- 处理视频时询问用户想了解哪些方面
- FOCUS 示例：技术细节、主要论点、行动项、关键术语、架构分析等
- FOCUS 会影响 summary.md 的生成重点

---

## 依赖工具

- **yt-dlp**: YouTube 视频下载工具
- **ffmpeg**: 音视频处理和合并
- **jq**: JSON 命令行处理
- **Python 3**: 脚本运行环境
- **Node.js**: Electron 运行需要
- **Claude CLI**: 生成文章和总结

---

## 使用示例

### 命令行使用
```bash
# 基本使用
bash scripts/run.sh "https://www.youtube.com/watch?v=..."

# 指定重点
bash scripts/run.sh "https://youtube.com/..." FOCUS="技术细节,架构分析"

# 仅转录+总结（不下载视频）
bash scripts/run.sh "https://youtube.com/..." MODE=transcript

# 强制重新生成
bash scripts/run.sh "https://youtube.com/..." FORCE=1
```

### GUI 使用
```bash
# 启动 Electron 客户端
bash start-electron.sh
# 或
cd electron && npm install && npm start
```

---

## 流水线执行流程图

```
URL 输入
    │
    ▼
┌─────────────────┐
│ Step 0: 获取信息  │ ──▶ meta.json (title, duration)
└────────┬────────┘
         │
    ┌────▼────┐
    │ Step 1  │ ──▶ 后台进程下载视频
    │ 视频下载 │     (video.mp4 / failed)
    └────┬────┘
         │
    ┌────▼────┐
    │ Step 2  │ ──▶ audio.m4a
    │ 音频提取 │
    └────┬────┘
         │
    ┌────▼────┐
    │ Step 3  │ ──▶ 双语字幕检测
    │ 获取转录 │     original.md (去重后)
    └────┬────┘
         │
    ┌────▼────┐
    │ Step 3.5│ ──▶ article.md
    │ 生成文章 │     (结构化 + 时间戳)
    └────┬────┘
         │
    ┌────▼────┐
    │ Step 4  │ ──▶ summary.md
    │ 生成总结 │     (TL;DR + Outline + Key Points + Action Items + Terms)
    └────┬────┘
         │
         ▼
    流水线完成
```

---

## 总结模板结构

Claude 生成的 summary.md 包含以下部分：

```markdown
# Summary

## TL;DR
[一句话总结]

## Outline
1. [主要章节/要点，按时间顺序]

## Key Points
- [关键要点1] [时间戳]
- [关键要点2] [时间戳]

## Action Items
- [行动项1]
- [行动项2]

## Terms/Entities
- [术语1]: [定义]
- [术语2]: [定义]
```

---

## 注意事项

1. **独立性**: 视频下载失败不会阻断转录和总结流程
2. **复用机制**: 相同 URL 第二次运行会跳过已完成步骤
3. **FOCUS 重要性**: 提供 FOCUS 可以获得更精准的总结
4. **双语支持**: 自动处理中英双语字幕，优先使用原创字幕
5. **后台下载**: 视频下载在后台独立运行，不阻塞主流程
