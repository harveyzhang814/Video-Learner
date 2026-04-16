# Video-Learner

YouTube 视频处理流水线 - 下载、转录、总结，一站式完成。

## 功能特性

- **视频下载**: 自动下载最高 1080p 视频和音频
- **双语字幕**: 自动获取中英双语字幕，优先使用原创字幕
- **繁体兜底**: 仅当英文与简体中文都未成功下载到任何字幕（original 或 auto）时，才会尝试繁体字幕（`zh-TW`/`zh-Hant`；original 优先，其次 auto）
- **智能转录**: 转换为带时间戳的逐字稿，自动去重
- **文章整理**: 将转录整理为结构化文章
- **重点总结**: 根据你关注的重点生成精准摘要
- **桌面客户端**: 提供 Electron GUI，支持视频播放和字幕同步

## 快速开始

### 首次安装

```bash
# 自动安装所有依赖（推荐）
bash scripts/install.sh

# 或者直接启动（会自动检查并安装依赖）
bash start-electron.sh
```

### 部署到新机器

`scripts/settings.conf` **不会随仓库提交**（见 `.gitignore`），克隆后请复制并编辑：

```bash
cp scripts/settings.example.conf scripts/settings.conf
```

至少配置 **`WRITING_ENGINE_DEFAULT`**（`opencode` / `claude`）、**`OUTPUT_LANG`**；若 YouTube 出现人机验证，再配置 **`YT_DLP_COOKIES_BROWSER`** 或 **`YT_DLP_COOKIES_FILE`**。手动跑 Agent Service 时可设置环境变量 **`PORT`**、**`AGENT_EVENTS_TOKEN`**、**`OPENCODE_HOST`** / **`OPENCODE_PORT`** 等。

根目录 **`npm install`** 为跑 Agent Service / 测试所必需；仅 GUI 时仍需 **`cd electron && npm install`**。

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

## 参数说明

创建任务时（GUI 表单或 `POST /api/tasks`）常用字段如下：

| 字段 / 概念 | 说明 | 典型默认 |
|-------------|------|----------|
| `url` | YouTube 视频链接 | 必填 |
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
