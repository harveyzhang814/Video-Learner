# CLI `vdl` 设计文档

## 概述

新增 `vdl` 全局命令行工具，作为 GUI（Electron）和 HTTP API 之外的第三条执行路径。CLI 复用已有 HTTP Service（`services/http-server`）和 `core/orchestrator`，自身只负责终端交互与进度展示。

## 背景

当前两条执行路径：

- **GUI**：`bash start-electron.sh`，桌面交互
- **HTTP API**：`npm run agent:serve` + curl/脚本调用

CLI 补足命令行用户的使用场景：一条命令启动、等待、看结果，无需手动管理 HTTP 服务进程。

旧 `scripts/run.sh` 已废弃（仅打印错误并退出），新 CLI 完全重写，基于 HTTP API，与旧实现无关。

## 架构设计

```
vdl (bin/vdl)
  └─ cli/index.js               ← 入口，参数分发
       ├─ cli/commands/run.js    ← vdl <url> [options]
       ├─ cli/commands/status.js ← vdl status <task_id>
       ├─ cli/commands/result.js ← vdl result <task_id>
       ├─ cli/commands/rerun.js  ← vdl rerun <task_id> <step>
       ├─ cli/commands/list.js   ← vdl list
       └─ cli/lib/
            ├─ server.js         ← HTTP 服务生命周期管理 + token 读写
            ├─ client.js         ← HTTP API 封装（Node.js 内置 http 模块）
            └─ format.js         ← 终端输出格式化、步骤名映射、TTY 检测
```

`package.json` 增加：

```json
"bin": { "vdl": "cli/index.js" }
```

本地开发注册：`npm link`（`__dirname` 通过 symlink 仍解析到项目根，路径正确）

不新增 npm 依赖，参数解析手写，HTTP 调用用 Node.js 内置 `http` 模块。

## 子命令

| 命令 | 说明 |
|------|------|
| `vdl <url> [options]` | 主命令：交互询问 focus（若未传）→ 创建任务 → 实时进度 → 打印结果路径 |
| `vdl status <task_id>` | 查看任务状态与各步骤状态列表 |
| `vdl result <task_id> [--type summary\|article]` | 打印 summary 或 article 内容到 stdout；调用 `GET /api/tasks/:id/result/content?type=<type>` |
| `vdl rerun <task_id> <step> [--reset downstream\|step\|off]` | 重跑指定步骤，默认 `--reset downstream`；`downstream` 返回 202 后自动切换轮询模式等待完成 |
| `vdl list` | 列出最近任务，直读 `work/database.sqlite`（不需服务），路径：`path.resolve(__dirname, '../work/database.sqlite')` |

### 主命令选项

```
vdl <url>
  --focus  <text>     关注点（未传时在启动前交互询问）
  --mode   <mode>     transcript | media | audio | full（默认 media）
  --lang   <lang>     zh-CN | en（默认 zh-CN）
  --force             强制重跑已完成步骤
  --json              以 JSON 格式输出最终结果（供脚本化）
```

## 服务生命周期与 Token 管理

Bearer token 是 HTTP server 鉴权的核心。CLI 通过 token 文件（`/tmp/vl-agent-token`）与可能已在运行的服务共享 token。

```
vdl 启动
  └─ GET http://127.0.0.1:3000/healthz
       ├─ 200 → 读 /tmp/vl-agent-token 获取 token
       │         token 文件不存在则报错 exit 1（服务在跑但 token 未知，属异常）
       │         CLI 退出时不关闭服务（不是自己启动的）
       └─ 失败 → 自己生成 token（crypto.randomBytes(24).toString('hex')）
                  → 后台启动 node services/http-server/index.js
                    注入环境变量 AGENT_EVENTS_TOKEN=<token>
                  → 每 500ms 轮询 healthz，最多等 5s
                  → 超时则打印错误并 exit 1
                  → 记录子进程 pid，标记"我启动的"
                  → 注册 process.on('exit') / SIGINT / SIGTERM
                  → CLI 退出时 kill 子进程 + 删除 /tmp/vl-agent-token
```

**HTTP server 侧改动**：启动时（`require.main === module`）把 token 写入 `/tmp/vl-agent-token`，进程退出时删除该文件。Electron 启动的 HTTP server 同样受益（Electron + CLI 并发时共享同一服务实例）。

**关键约束**：仅关闭 CLI 自己启动的服务。若服务由 Electron 或用户手动启动，CLI 只读 token 文件，退出时不干预服务生命周期。

## 进度展示（主命令与 `vdl rerun --reset downstream`）

轮询 `GET /api/tasks/:id`，间隔 2 秒，检测步骤状态变化。

### 步骤名映射（`format.js`）

| DAG 步骤名 | 显示名 |
|-----------|--------|
| `fetch` | `fetch_info` |
| `subs` | `download_subs` |
| `vtt2md` | `convert_vtt_md` |
| `article` | `generate_article` |
| `summary` | `generate_summary` |
| `video` | `download_video` |
| `audio` | `download_audio` |
| `asr` | `asr_transcribe` |
| `md2vtt` | `convert_md_vtt` |

### TTY 检测

- **`process.stdout.isTTY === true`**：使用 ANSI escape codes 原地刷新多行进度块
- **非 TTY（管道/重定向）**：每次步骤状态变化追加一行，不使用 ANSI codes

### TTY 模式示例

```
Processing: How to build a RAG system (12m30s)
──────────────────────────────────────────────
✓ fetch_info          2s
✓ download_subs       8s
⠸ convert_vtt_md      running...
  generate_article    pending
  generate_summary    pending
```

完成后输出：

```
Done in 47s

  transcript  work/a1b2c3/transcript/original.md
  article     work/a1b2c3/writing/article.md
  summary     work/a1b2c3/writing/summary.md
```

### 非 TTY 模式示例

```
[fetch_info] done (2s)
[download_subs] done (8s)
[convert_vtt_md] running
[convert_vtt_md] done (12s)
...
Done: work/a1b2c3/writing/summary.md
```

### focus 交互流程

若未传 `--focus`，在创建任务**之前**交互询问：

```
? 你想了解这个视频的哪些方面？ > _
```

用户输入后带 focus 创建任务，无需中途暂停轮询，无需依赖任何 `focus_needed` 字段。

## `vdl rerun` 语义

| `--reset` 值 | 对应 `reset_scope` | 行为 |
|---|---|---|
| `downstream`（默认） | `downstream` | 级联重置锚点及下游步骤，server 返回 202，CLI 自动切换轮询模式等待完成 |
| `step` | `step` | 重置并重跑单步，等待完成 |
| `off` | `off` | 直接跑（不重置），等待完成 |

`vdl rerun <id> <step>` 不带 `--reset` 默认等同于 `--reset downstream`。

## 错误处理

| 情况 | 行为 |
|------|------|
| HTTP 服务启动超时（>5s） | 打印错误，exit 1 |
| 服务在跑但 token 文件不存在 | 打印"服务运行中但 token 不可知，请重启服务"，exit 1 |
| 任务创建失败 | 打印 API 错误信息，exit 1 |
| 流水线状态变为 `failed` | 打印失败步骤名与错误信息，exit 1；轮询以 `task.status === 'failed'` 为退出条件 |
| 用户 Ctrl-C | 打印提示后退出；若为自启动服务则 kill 服务进程 + 删除 token 文件 |
| `vdl status/result` 传入不存在的 task_id | 打印"task not found"，exit 1 |

### Ctrl-C 提示（当前阶段）

```
^C  Interrupted. Task a1b2c3 may have a step stuck in 'running'.
    To resume: vdl rerun a1b2c3 <step> --reset step
```

**TODO**：任务取消功能（`POST /api/tasks/:id/stop`）作为独立功能实现后，Ctrl-C 改为先调 stop 接口再退出。该功能需改动 orchestrator（存储子进程引用、`cancelTask` 函数）、HTTP server（新增 stop 路由）、GUI（取消按钮），见待立规格 `2026-05-18-task-cancel-design.md`。

**TODO**：评估是否改用 SSE（`GET /api/events`）替代轮询以获得实时步骤推送，权衡实现复杂度（需手写 chunked HTTP 流解析，约 30 行）与延迟收益（当前 2s 轮询对分钟级任务无感知）。

## 文件结构

```
cli/
  index.js              ← #!/usr/bin/env node，入口与子命令分发
  commands/
    run.js              ← 主命令逻辑（focus 询问 → 创建任务 → 轮询进度）
    status.js
    result.js           ← 调用 GET /api/tasks/:id/result/content?type=
    rerun.js            ← reset_scope 映射 + 202 后切轮询
    list.js             ← 直读 SQLite，path.resolve(__dirname, '../work/database.sqlite')
  lib/
    server.js           ← healthz 检查、服务启动/关闭、token 文件读写
    client.js           ← HTTP 封装（createTask, getTask, runStep, getResult, getSteps）
    format.js           ← 步骤名映射表、TTY 检测、进度渲染、颜色
```

## 测试策略

- `tests/cli-*.test.js`（延续项目风格，无框架，`node tests/cli-*.test.js`）
- 通过 `createApp()` 启动测试用 HTTP server，注入 mock orchestrator
- 覆盖：token 文件读写、服务自启动/复用、主命令 happy path、focus 交互（stdin mock）、TTY/非 TTY 输出格式、`status`/`result`/`rerun` 子命令、`rerun --reset downstream` 后切轮询、Ctrl-C 关闭自启动服务

新增 `package.json` 脚本：

```json
"test:cli": "node tests/cli-run.test.js && node tests/cli-subcommands.test.js"
```

## 注册方式

```bash
npm link          # 开发时全局注册 vdl
npm unlink vdl    # 取消注册
```

`npm link` 通过 symlink 安装，`__dirname` 仍解析到项目根目录，`work/database.sqlite` 和 `services/http-server/index.js` 路径均可正确定位。生产分发：项目作为私有工具，`npm link` 足够。
