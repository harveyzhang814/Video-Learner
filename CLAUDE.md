# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# YouTube Pipeline - Claude Code 执行标准

## 重要提醒
- **每次开发功能前，必须检查当前所在分支**
- 开发只能在 `feature/*` 或 `hotfix/*` 分支上进行
- **禁止在 `master` 和 `staging` 分支上直接开发**
- **合并到 `staging` / `master` 时禁止使用 fast-forward**：必须使用 `git merge --no-ff`（规范见 `docs/explanation/git-workflow.md`）

## 概述
本仓库实现 YouTube URL → 下载/转录/总结 的自动化流水线。CLI、GUI（Electron）、Web（浏览器）、HTTP API 四种方式共用同一个 `core/orchestrator` 和 SQLite 状态（`work/database.sqlite`）。

## 最短调用方式

```bash
vdl <URL>                # CLI（agent 跑任务首选）
vdl web                  # Web 端：起后端 + 开浏览器（给人用，agent 别自己用）
bash start-electron.sh   # Electron GUI
npm run agent:serve      # HTTP API 长驻服务
```

完整 CLI 参考见 `docs/reference/cli.md`，HTTP API 见 `docs/reference/api.md`，Web 端使用见 `docs/how-to/run-web.md`。

## Agent 与 Web 端的关系
- Web 端是**给人用的图形界面**，agent **不会自己访问** web 端
- Agent 唯一合法触发 `vdl web` 的场景：用户让 agent "帮我打开网页"——agent 替用户启动 UI，然后退出
- Agent 自己跑任务：用 `vdl <URL>` / `vdl list / status / result`
- Agent 直接调 HTTP API：用 `core/agent-connect.connect({ clientId })`，自动持心跳
- 详细机制见 `docs/explanation/singleton-backend.md` 的"Web 浏览器：SSE 连接作为被动心跳"小节

## 字段备忘
- `mode`: `media`（默认）| `audio` | `transcript` | `full`
- `output_lang`: `zh-CN`（默认）| `en`
- `focus`: 用户关注点（如「技术架构」「主要论点」）
- `reset_scope`: `off` | `step` | `downstream`
- `timeout_scale`: `1`（默认）| `3`（长视频）| `6`（超长视频）

## 超长视频模式
用户描述含以下信号时，**必须**加上 `timeout_scale`，否则 ASR / LLM 步骤会在完成前超时：

| 用户信号 | timeout_scale | CLI 等效 |
|---------|--------------|---------|
| 视频约 1–3 小时 / "讲座" / "会议" / "播客" / "long" | `3` | `--long` |
| 视频 3 小时以上 / "超长" / "全天" / "ultra-long" | `6` | `--ultra-long` |
| 用户明确要求"长模式"/"long mode" | `3`（至少） | `--long` |

```bash
# CLI
vdl --long <URL>
vdl --ultra-long <URL>

# HTTP API
POST /api/tasks  { "url": "...", "timeout_scale": 3 }
```

## 多引擎写作

写作引擎通过 `scripts/llm_engine.sh` 路由：
- **默认**：`scripts/settings.conf` 中设置 `WRITING_ENGINE_DEFAULT=opencode|claude`
- **单次覆盖**：启动前设置环境变量 `WRITING_ENGINE=claude|opencode`
- `opencode`：MiniMax-M2.7（HTTP）；`claude`：Claude Code CLI

## 开发命令

```bash
# 安装
npm install && cd electron && npm install

# 测试（按范围）
npm run test:agent:core       # Orchestrator + HTTP + SQLite
npm run test:orchestrator:unit # DAG 调度 + reset_scope
npm run test:reset-scope      # 全量 HTTP 集成
npm run test:abort            # 取消/恢复生命周期
npm run test:sse              # SSE 事件流
npm run test:cli              # CLI 完整套件
npm run test:gui              # Electron 主进程 + preload

# 单个文件（无框架）
node tests/<file>.test.js
```

## Dev Harness（开发调试）

```bash
bash harness/start-dev.sh            # 启动后端 + monitor
bash harness/start-dev.sh --electron # + Electron GUI

bash harness/check-errors.sh         # 查看错误摘要
curl -s http://127.0.0.1:3000/healthz  # 健康检查
bash harness/debug/read-logs.sh --errors --last 30  # 近期错误日志
```

详细设计见 `harness/README.md`，日志过滤见 `docs/how-to/debug-env.md`。

## 架构概览

```
CLI (vdl) ─────┐
Electron GUI ──┤
Web Browser ───┼──► core/orchestrator ──► scripts/*.sh ──► yt-dlp/ffmpeg/llm
HTTP Service ──┘        │
                        └──► work/database.sqlite（状态权威）
```

| 目录 | 职责 |
|------|------|
| `core/orchestrator/` | 任务状态机 + DAG 调度（`schedule.js`）+ SQLite（`db.js`） |
| `core/agent-connect.js` | 统一 check-or-start：CLI/Electron/Web 共用，固定端口 3000；`vdl web` 走 `noHeartbeat: true` 路径 |
| `core/heartbeat-client.js` | 心跳发送（CLI/Electron）；浏览器走 SSE 被动心跳，不走此路径 |
| `services/http-server/` | Koa HTTP API + SSE；`index.js` 含全部路由 + `sseRegistry` |
| `scripts/` | 每步骤一个 shell 脚本（fetch/download/convert/generate） |
| `electron/src/` | 主进程（`main.js`）+ preload IPC + 渲染器 |
| `web/` | React/TS SPA，给人用的浏览器界面；agent 不访问 |
| `cli/commands/web.js` | `vdl web` 子命令：起后端 + 开浏览器 + 立即 exit |
| `tests/` | 无框架，直接 `node tests/*.test.js` |
| `harness/` | 仅开发用，不在生产代码中引用 |

### 核心设计要点

- **SQLite 是状态权威**：tasks/steps 表优先于 meta.json；index.jsonl 仅作审计追踪
- **DAG 调度**：main chain（transcript 流水线）优先；视频下载失败不阻塞后续步骤
- **单例后端**：固定端口 3000；CLI/API 主动心跳 + 浏览器 SSE 被动心跳共同决定 auto-shutdown（`heartbeatRegistry.size > 0 || sseRegistry.size > 0`，见 `docs/explanation/singleton-backend.md`）
- **步骤超时**：各步骤有独立超时上限，超时后 SIGTERM kill，步骤标记 failed（可重跑）
- **任务 ID**：`sha1(url + '\n').slice(0, 12)`，见 `core/id.js`
- **Electron IPC**：renderer 只调用 preload 暴露的安全 API
- **文档**：Diátaxis 方法论（`docs/reference/`、`docs/how-to/`、`docs/explanation/`、`docs/adr/`）
