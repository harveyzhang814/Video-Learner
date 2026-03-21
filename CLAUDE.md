# YouTube Pipeline - Claude Code 执行标准

## 重要提醒
- **每次开发功能前，必须检查当前所在分支**
- 开发只能在 `feature/*` 或 `hotfix/*` 分支上进行
- **禁止在 `master` 和 `staging` 分支上直接开发**
- **合并到 `staging` / `master` 时禁止使用 fast-forward**：必须使用 `git merge --no-ff`（规范见 `docs/GIT_FLOW.md`）

## 概述
本仓库实现 YouTube URL → 下载/转录/总结 的自动化流水线。

## 固定输出结构
```
work/
├── index.jsonl                    # 每次运行追加一条记录
└── <id>/
    ├── media/                     # 媒体文件
    │   ├── video.mp4             # 视频文件（若下载成功）
    │   ├── audio.m4a              # 音频文件
    │   └── video_download.log    # 下载日志
    ├── transcript/               # 转录与字幕
    │   ├── subs/                 # 字幕文件 (vtt)
    │   ├── original.md           # 逐字稿，带 [mm:ss] 时间戳（已去重）
    │   └── meta.json             # 元数据
    └── writing/                  # 生成内容
        ├── article.md             # 整理后的结构化文章
        ├── summary.md             # 总结 (TL;DR + Outline + Key Points + Action Items + Terms)
        └── summary_prompt.txt    # Claude 总结提示词
```

## 关键约束

### 1. 视频下载独立
- 视频下载成功/失败**不影响** transcript 获取和总结
- 即使 video 下载失败，也必须完成 original.md + summary.md

### 2. 视频下载重试策略
- 第一次失败 → 立刻重试一次（清理半成品）
- 第二次仍失败 → 放弃，记录 `download_status=failed` + `download_error` 到 meta.json

### 3. 视频下载质量策略
- 默认目标：最高 1080p（不追求 4K）
- 优先合并格式（progressive）
- 无法合并 → 下载 DASH 分离流 + ffmpeg 合并

### 4. 去重与复用
- ID = sha1(url) 前 12 位
- 若 `meta.json` 存在且 `transcript_done=true`，跳过 transcript/summary（FORCE=1 除外）
- 若 `video.mp4` 存在且完整，跳过视频下载
- 任何情况都更新/追加 `work/index.jsonl`

### 5. 用户意图 (FOCUS)
- 每次处理视频时，需要询问用户想了解视频的哪些方面
- 如果用户已提供 FOCUS，则使用它来生成总结
- FOCUS 示例：技术细节、主要论点、行动项、关键术语、架构分析等

## meta.json 字段
```json
{
  "url": "...",
  "id": "...",
  "ts": "...",
  "title": "...",
  "duration": "...",
  "lang": "...",
  "output_lang": "zh-CN|en",
  "download_status": "pending|success|failed|skipped_existing",
  "download_attempts": 0,
  "download_error": "...",
  "transcript_source": "youtube_transcript|subtitle|existing|asr_missing|none",
  "transcript_done": true|false,
  "article_done": true|false,
  "article_prompt_path": "...",
  "summary_done": true|false,
  "focus": "...",
  "focus_needed": true|false,
  "claude_summary_pending": true|false,
  "tool_versions": { "yt_dlp": "...", "ffmpeg": "...", "jq": "..." }
}
```

## 执行命令

**`scripts/run.sh` 已废弃**（薄壳：仅打印说明并非零退出）。正式执行仅通过 **GUI（Electron）** 或 **Agent Service（HTTP → `core/orchestrator`）**。

### GUI
```bash
bash start-electron.sh
```
在界面中创建任务并填写 URL、`focus`、`mode`、是否强制重跑等。

### Agent Service（HTTP）
```bash
npm run agent:serve
```
使用 `POST /api/tasks` 创建任务（body 含 `url`、`focus`、`mode`、`force`、`output_lang` 等），轮询 `GET /api/tasks/:id` 或订阅 `GET /api/events`。约定见 `docs/PROJECT_KNOWLEDGE.md`（Agent HTTP Service）。

### 字段备忘（与旧 CLI 对应）
- `output_lang`: 输出语言，默认 `zh-CN`（简体中文），可由 `settings.conf` 等扩展
- `mode`: `both` | `video` | `audio` | `transcript`
- `force`: 是否强制重跑
- `focus`: 用户想了解的重点（如「技术细节」「主要论点」「行动项」）

## Claude 总结生成流程

当 `claude_summary_pending=true` 或 `focus_needed=true` 时：

1. **如果 focus_needed=true**：
   - 读取 original.md
   - 询问用户想了解视频的哪些方面
   - 用户提供 FOCUS 后，更新 meta.json: `jq --arg focus "用户回答" '.focus = $focus' meta.json`
   - 继续生成总结

2. **如果 claude_summary_pending=true**：
   - 读取 original.md 和 summary_prompt.txt
   - 根据 FOCUS 生成 summary.md
   - 更新 meta.json: `jq '.claude_summary_pending = false' meta.json`

## Summary 模板 (Claude 生成)
```markdown
# Summary

## TL;DR
[一句话总结]

## Outline
1. [主要章节/要点，按时间顺序]

## Key Points
- [关键要点1] [时间戳]
- [关键要点2] [时间戳]
- [...]

## Action Items
- [行动项1]
- [行动项2]

## Terms/Entities
- [术语1]: [定义]
- [术语2]: [定义]
```

## 复用命令（最短）
```
请处理这个 YouTube: <URL>
```
在助手侧通过 **GUI** 或 **HTTP 创建任务** 完成处理；勿再使用 `scripts/run.sh`。

## 多引擎写作

- **全局默认引擎（配置文件）**
  - 复制 `scripts/settings.example.conf` 为 `scripts/settings.conf`，可选设置：
    ```bash
    WRITING_ENGINE_DEFAULT=opencode   # 或 claude；不设或非法时回退为 opencode
    ```
  - `scripts/llm_engine.sh` 会读取该默认值，影响 `generate_article.sh` / `generate_summary.sh`（及编排层触发的各 Step）的写作引擎。
- **单次覆盖（环境变量）**
  - 启动 Agent Service 或 Electron **之前**在环境中设置 `WRITING_ENGINE=claude|opencode`，子进程中的 `llm_engine.sh` 会继承该覆盖。
- **当前引擎实现**
  - `claude`：使用 Claude Code CLI。
  - `opencode`：使用 OpenCode CLI `opencode run -m minimax-cn-coding-plan/MiniMax-M2.5 --format json`（PTY），从 NDJSON 事件流抽取文本。

## 测试验证
- 首次运行：下载视频+字幕，生成 original.md
- 如果没有 FOCUS：提示用户输入重点
- 提供 FOCUS 后：Claude 生成 summary.md
- 第二次运行：全部跳过
