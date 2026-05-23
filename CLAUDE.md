# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# YouTube Pipeline - Claude Code 执行标准

## 重要提醒
- **每次开发功能前，必须检查当前所在分支**
- 开发只能在 `feature/*` 或 `hotfix/*` 分支上进行
- **禁止在 `master` 和 `staging` 分支上直接开发**
- **合并到 `staging` / `master` 时禁止使用 fast-forward**：必须使用 `git merge --no-ff`（规范见 `docs/explanation/git-workflow.md`）

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

**`scripts/run.sh` 已废弃**（薄壳：仅打印说明并非零退出）。正式执行通过三种方式：**CLI (`vdl`)**、**GUI（Electron）** 或 **Agent Service（HTTP API）**，均共享同一个 `core/orchestrator` 和 SQLite 状态。

### CLI (`vdl`)

详见 `docs/reference/cli.md`。CLI 会自动启动或连接本地 HTTP 服务（端口 3000），Token 存于 `/tmp/vl-agent-token`。

### GUI（Electron）
```bash
bash start-electron.sh
```
在界面中创建任务并填写 URL、`focus`、`mode`、是否强制重跑等。

### Agent Service（HTTP API）
```bash
npm run agent:serve
```
HTTP 服务启动后，使用以下端点操作（Bearer token 认证）：

```bash
# 创建任务
POST /api/tasks  { url, focus, mode, force, output_lang }

# 查询任务状态
GET /api/tasks/:taskId

# 获取输出内容（Markdown）
GET /api/tasks/:taskId/result/content?type=article|summary

# 重跑某步骤（支持 reset_scope）
POST /api/tasks/:taskId/steps/:stepName/run  { reset_scope: "off"|"step"|"downstream" }

# SSE 实时事件流（query param 传 token）
GET /api/events?token=<token>
```

完整约定见 `docs/reference/api.md`。

### 字段备忘
- `output_lang`: 输出语言，默认 `zh-CN`（简体中文）
- `mode`: `media`（默认）| `audio` | `transcript` | `full`（`both`/`video` 为旧别名，等同于 `media`）
- `force`: 是否强制重跑
- `focus`: 用户想了解的重点（如「技术细节」「主要论点」「行动项」）
- `reset_scope`: `off`（只重置当前步骤）| `step`（重置后运行）| `downstream`（级联重置并重跑整条流水线）

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

## 最短调用方式

**CLI（推荐）：**
```bash
vdl <URL>
```

**自然语言触发（Claude Code 内）：**
```
请处理这个 YouTube: <URL>
```
在助手侧通过 **CLI (`vdl`)** 或 **HTTP 创建任务** 完成处理；勿再使用 `scripts/run.sh`。

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
  - `opencode`：使用 OpenCode CLI，模型为 `minimax-cn-coding-plan/MiniMax-M2.7`，通过 HTTP 调用。

## 开发命令

### 安装依赖
```bash
npm run install-deps      # 安装系统依赖（yt-dlp, ffmpeg, jq）
npm install               # 安装 Node 依赖
cd electron && npm install  # 安装 Electron 依赖
```

### 运行测试
```bash
# 核心（Orchestrator + HTTP + SQLite）
npm run test:agent:core

# DAG 调度 + reset_scope 语义
npm run test:orchestrator:unit

# 全量 HTTP 集成（含 reset_scope × 各步骤）
npm run test:reset-scope

# 取消/恢复任务生命周期
npm run test:abort
npm run test:resume

# SSE 事件流
npm run test:sse

# CLI 完整测试套件（8 个测试文件）
npm run test:cli

# Electron 主进程 + preload + 客户端状态
npm run test:gui

# 单个测试文件（无框架，直接 node 运行）
node tests/orchestrator-schedule.test.js
node tests/agent-http.test.js
```

### 测试验证
- 首次运行：下载视频+字幕，生成 original.md
- 如果没有 FOCUS：提示用户输入重点
- 提供 FOCUS 后：Claude 生成 summary.md
- 第二次运行：全部跳过

## Dev Harness（开发调试工具）

`harness/` 目录下存放**仅供开发调试使用**的启动脚本，与 `scripts/`（生产脚本）完全分离。

### 启动命令

```bash
# 仅启动后端（Agent HTTP Service + monitor + debug-env）
bash harness/start-dev.sh

# 启动后端 + Electron GUI
bash harness/start-dev.sh --electron
```

Ctrl-C 退出时，所有子进程（后端、monitor、debug-env、Electron）同步关闭。

### 脚本说明

| 脚本 | 用途 |
|------|------|
| `harness/start-dev.sh` | **统一开发启动入口**（后端 + monitor + debug-env，可选 Electron） |
| `harness/monitor.sh` | 后台 watcher，实时检测日志错误，写入 `/tmp/vl-error-summary.txt` |
| `harness/check-errors.sh` | 读取错误摘要，供 Agent 按需调用 |
| `harness/debug/setup.sh` | 日志聚合守护进程（由 start-dev.sh 自动启动） |
| `harness/debug/discover.sh` | 扫描所有日志来源，输出 JSON manifest |
| `harness/debug/read-logs.sh` | 过滤读取聚合日志 |
| `harness/debug/stop.sh` | 停止日志聚合守护进程 |

### Agent 操作规范

**检查当前错误状态**：
```bash
bash harness/check-errors.sh
```
读取 `/tmp/vl-error-summary.txt`，字段 `status=ok|error|exited`。

**后端健康检查**：
```bash
curl -s http://127.0.0.1:3000/healthz
```

**后端重启**（不重启整个 harness 时）：
```bash
kill $(cat /tmp/vl-backend.pid 2>/dev/null) 2>/dev/null
node services/http-server/index.js >> /tmp/vl-backend.log 2>&1 &
echo $! > /tmp/vl-backend.pid
```

详细设计见 `harness/README.md`。

### 调试日志环境（Debug Log Env）

`harness/debug/` 提供统一日志聚合方案，把所有日志来源合并到一个文件，支持按来源/错误级别过滤。

**快速启动**（应用已在运行时）：
```bash
bash harness/debug/setup.sh &          # 启动聚合守护进程（后台）
bash harness/debug/read-logs.sh --errors --last 30   # 查看近期错误
bash harness/debug/stop.sh             # 停止
```

**常用过滤命令**：
```bash
# 只看后端日志
bash harness/debug/read-logs.sh --source backend --last 50

# 只看 Electron 主进程
bash harness/debug/read-logs.sh --source electron-main --last 30

# 只看渲染器（前端 console）
bash harness/debug/read-logs.sh --source electron-renderer --last 30

# 只看某个任务的日志
bash harness/debug/read-logs.sh --task <taskId前缀> --last 50

# 读全部（一次性分析）
bash harness/debug/read-logs.sh --all
```

**聚合日志路径**：`/tmp/video-learner-debug.log`

**日志来源标签**：`[backend]`、`[electron-main]`、`[electron-renderer]`、`[monitor]`、`[<taskId>/<step>.raw]`、`[<taskId>/task.log.jsonl]`

**发现日志来源**：
```bash
bash harness/debug/discover.sh   # 输出 JSON，显示所有日志来源和 exists 状态
```

## 架构概览

### 组件层次

```
Electron GUI ──┐
               ├──► core/orchestrator  ──► scripts/*.sh  ──► yt-dlp/ffmpeg/llm
HTTP Service ──┘        │
                        └──► work/database.sqlite  (状态权威)
```

两条执行路径（GUI 和 HTTP Service）都通过同一个 `core/orchestrator` 运行，互相等价。

### 关键目录

| 目录 | 职责 |
|------|------|
| `core/orchestrator/` | 任务创建/状态机/DAG 调度；`schedule.js` 定义步骤依赖图，`db.js` 管理 SQLite |
| `services/http-server/` | Koa HTTP API + SSE 事件流；`index.js` 含全部路由 |
| `scripts/` | 每个步骤对应一个 shell 脚本（fetch_info、download_video、download_subs、convert_vtt_md、generate_article、generate_summary 等） |
| `electron/src/` | 主进程（`main.js`）+ preload IPC + 单页渲染器（`renderer/index.html`） |
| `harness/` | 仅开发用；绝不在生产代码中引用 |
| `tests/` | 无框架，直接 `node tests/*.test.js` 运行 |

### 核心设计要点

- **SQLite 是状态权威**：`work/database.sqlite`（tasks/steps 表）优先于 `meta.json`；index.jsonl 仅作审计追踪。
- **DAG 调度**：步骤依赖在 `core/orchestrator/schedule.js` 中声明；main chain（transcript 流水线）优先于媒体下载，视频下载失败不阻塞后续步骤。
- **任务 ID**：`sha1(url + '\n').slice(0, 12)`，见 `core/id.js`。
- **LLM 引擎路由**：`scripts/llm_engine.sh` 读取 `WRITING_ENGINE` 环境变量或 `settings.conf` 中的 `WRITING_ENGINE_DEFAULT`，分发到 `claude`（Claude Code CLI）或 `opencode`（PTY，NDJSON 流）。
- **Reset scope**：`off`（单步重置）、`step`（重置后运行）、`downstream`（级联重置全流水线），在 HTTP `POST /api/tasks/:id/steps/:step/run` 中通过 `reset_scope` 字段控制。
- **Electron IPC**：renderer 只能调用 preload 暴露的安全 API，不直接访问 Node.js；HTTP Bearer token 由主进程生成并注入 renderer。
- **文档组织**：遵循 Diátaxis 方法论（`docs/reference/`、`docs/how-to/`、`docs/explanation/`、`docs/adr/`）；ADR 一旦写入不可修改。
