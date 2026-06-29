# Video-Learner

音视频处理流水线 - YouTube / 本地文件 → 转录、总结，一站式完成。

## 功能特性

- **本地文件导入**: 直接传入本地音频（mp3/m4a/wav/aac/flac 等）或视频（mp4/mkv/mov 等），跳过下载步骤直接转录
- **视频下载**: 自动下载最高 1080p 视频和音频（YouTube / Bilibili）
- **双语字幕**: 自动获取中英双语字幕，优先使用原创字幕
- **繁体兜底**: 仅当英文与简体中文都未成功下载到任何字幕（original 或 auto）时，才会尝试繁体字幕（`zh-TW`/`zh-Hant`；original 优先，其次 auto）
- **智能转录**: 转换为带时间戳的逐字稿，自动去重
- **文章整理**: 将转录整理为结构化文章
- **重点总结**: 根据你关注的重点生成精准摘要
- **桌面客户端**: 提供 Electron GUI，支持视频播放和字幕同步
- **Web 客户端**: 浏览器界面（`vdl web`），关闭页面后端自动停（详见 [docs/how-to/run-web.md](docs/how-to/run-web.md)）

## 快速开始

### 正式安装（推荐）

安装完成后**可删除仓库**，`vdl` 独立运行：

```bash
bash scripts/install.sh                # 安装系统依赖（yt-dlp / ffmpeg / jq）
npm install                            # 安装 Node 依赖
npm pack && npm install -g ./video-learner-*.tgz && rm video-learner-*.tgz
```

首次运行任意 `vdl` 命令时，向导自动创建 **`~/.config/vdl/settings.conf`** 并询问数据目录（默认 `~/vdl-work`）。

### 开发安装

在仓库内直接运行，改代码立即生效，无需重新安装：

```bash
bash scripts/install.sh && npm install
node cli/index.js <URL>                # 直接调用 CLI 入口
npm link                               # 或：注册 symlink 以使用 vdl 命令（仅开发期间）
```

### 启动方式

```bash
vdl <YouTube URL>          # CLI：处理 YouTube/Bilibili 视频
vdl ./recording.mp3        # CLI：处理本地音频（需 ./ 或 / 开头）
vdl ./video.mp4            # CLI：处理本地视频
vdl web                    # Web 端：起后端 + 开浏览器（关浏览器自动停后端）
bash start-electron.sh     # Electron 桌面客户端
```

### 配置

至少配置 **`WRITING_ENGINE_DEFAULT`**（`opencode` / `claude`）、**`OUTPUT_LANG`**；若 YouTube 出现人机验证，再配置 **`YT_DLP_COOKIES_BROWSER`** 或 **`YT_DLP_COOKIES_FILE`**。手动跑 Agent Service 时可设置环境变量 **`PORT`**、**`AGENT_EVENTS_TOKEN`**、**`OPENCODE_HOST`** / **`OPENCODE_PORT`** 等。

**完整清单与步骤**见 **[部署指南：docs/how-to/deploy.md](docs/how-to/deploy.md)**。

### Agent Service（HTTP 编排）

一键 shell 入口 `scripts/run.sh` **已废弃**（执行将报错并提示替代方式）。请使用本地 HTTP 服务创建任务：

```bash
# 启动 Agent Service（默认端口见终端输出，可用 PORT= 覆盖）
npm run agent:serve
```

在另一终端使用 `POST /api/tasks` 创建任务（`url`、`focus`、`mode`、`force` 等），或配合外部 agent 调用。`mode` 可选值：`media`（默认，下载视频，视频失败自动兜底音频）/ `audio`（仅音频）/ `transcript`（仅转录，不下载媒体）/ `full`（视频 + 音频均下载）。字段完整约定见 [docs/reference/api.md](docs/reference/api.md)。

**单步执行与重置**：`POST /api/tasks/:taskId/steps/:stepName/run` 支持 body 字段 **`reset_scope`**：`off`（默认，仅执行该步）| `step`（先重置该步再执行）| `downstream`（按 DAG 重置锚点及下游后再触发整条 `runTask` 调度）。语义与状态码见 [docs/reference/api.md](docs/reference/api.md)。

编排层 **`runTask`** 使用 B 层 DAG + 主链/次优先串行调度（见 [docs/reference/architecture.md](docs/reference/architecture.md)），与「视频失败不挡字幕链」等产品约束一致。

端到端校验（与上述编排一致、较慢）：

```bash
npm run test:agent:e2e
# 或: bash scripts/test_full_e2e.sh
```

### GUI 使用

```bash
# 启动桌面客户端
bash start-electron.sh
```

### Web 端使用

```bash
# 起后端 + 在默认浏览器打开 web 端
vdl web                  # 默认
vdl web --no-browser     # 只起后端，不开浏览器
vdl web --port 3001      # 端口覆盖
```

行为：CLI 起后端后**立即退出**，终端回到 prompt；你在浏览器里操作，关闭浏览器 tab 后约 30 秒后端自动停。无需 Ctrl+C 终端。

> **Web 端是给人用的图形界面**，agent 不要自己访问它。Agent 唯一合法触发 `vdl web` 的场景是"替用户打开 UI"。Agent 自己跑任务请用 `vdl <URL>` / `vdl <file>` / `vdl list / status / result` 或 `core/agent-connect.connect()`。详见 [docs/how-to/run-web.md](docs/how-to/run-web.md) 的「Agent 用法」。

## 参数说明

创建任务时（GUI 表单或 `POST /api/tasks`）常用字段如下：

| 字段 / 概念 | 说明 | 典型默认 |
|-------------|------|----------|
| `url` | YouTube/Bilibili 链接，或本地文件导入时的虚拟 URL `local://<absPath>` | 必填 |
| `mode` | `media`（默认）/ `audio` / `transcript` / `full` | `media` |
| `force` | 是否强制重跑对应步骤 | `false` |
| `focus` | 总结侧重点 | 可选 |
| `output_lang` | 输出语言（如 `zh-CN`） | `zh-CN` |

单步 HTTP 可选字段 **`reset_scope`**（`off` \| `step` \| `downstream`）见上文链接；GUI 后续可接同一接口。

## 输出结构

（与 [docs/reference/architecture.md](docs/reference/architecture.md) 一致；`id` 为 `sha1(url)` 前 12 位。）

```
work/
├── index.jsonl                    # 运行追溯（可选）
├── database.sqlite                # 任务与步骤状态（GUI / Agent 共用）
└── <id>/
    ├── media/
    │   ├── video.mp4
    │   └── audio.m4a
    ├── transcript/
    │   ├── subs/                  # 原始 .vtt
    │   ├── original_en.md / original_zh.md   # 逐字稿（带时间戳）
    │   └── meta.json
    └── writing/
        ├── article.md
        └── summary.md
```

## 开发与测试（节选）

| 命令 | 作用 |
|------|------|
| `npm run test:orchestrator:unit` | 编排层单元测（含 `schedule`、`reset_scope` 相关） |
| `npm run test:reset-scope` | 仅 `applyResetScope` + HTTP `reset_scope` |
| `npm run test:agent` | Agent HTTP 集成测 |
| `npm run test:agent:core` | orchestrator 单元 + runStep A 层 + agent-http + sqlite 持久化 |

完整列表见根目录 **`package.json`** 的 `scripts`。

## Dev Harness（开发调试）

`harness/` 目录提供带实时错误监测的开发启动脚本，与生产脚本（`scripts/`、`start-electron.sh`）完全分离。

```
harness/
├── start-dev.sh           # 统一开发入口（后端 + monitor + debug-env，可选 Electron）
├── monitor.sh             # 后台 watcher，随应用启动/关闭
├── check-errors.sh        # 一键错误摘要
└── debug/                 # 日志聚合工具（setup/read/stop/discover）
```

**使用方式**：

```bash
# 仅启动后端（Agent HTTP Service + monitor + debug-env）
bash harness/start-dev.sh

# 启动后端 + Electron GUI
bash harness/start-dev.sh --electron
```

启动后 monitor 在后台持续监测日志，将错误摘要写入 `/tmp/vl-error-summary.txt`。Ctrl-C 退出时，所有子进程同步关闭。

**检查错误**（另开一个终端或由 Agent 调用）：

```bash
bash harness/check-errors.sh
```

> **生产部署**：继续使用 `npm run agent:serve` / `bash start-electron.sh`，`harness/` 目录不参与生产。  
> **详细设计**：见 [harness/README.md](harness/README.md)。

## 总结模板

生成的 summary.md 包含：

- **TL;DR**: 一句话总结
- **Outline**: 主要章节
- **Key Points**: 关键要点（含时间戳）
- **Action Items**: 行动项
- **Terms/Entities**: 关键术语

## 示例

- 启动 **GUI**，在界面中粘贴 URL，填写「关注重点」，选择是否下载视频/音频后创建任务。
- 或使用 **Agent Service**：`npm run agent:serve` 后按 [docs/reference/api.md](docs/reference/api.md) 中的 HTTP 示例创建任务并轮询状态。

## 注意事项

- 视频下载失败不会阻断转录和总结流程（B 层 DAG 上 `video` 非字幕链前驱）
- 相同 URL 第二次运行会跳过已完成步骤（除非 `force` / 使用 `reset_scope` 等重置语义）
- 提供 FOCUS 可以获得更精准的总结
- 流水线默认 **单队列串行** 执行步骤；主链（fetch→subs→vtt2md→article→summary）优先于媒体与 md2vtt（详见编排设计文档）

## License

MIT
