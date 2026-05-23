# `vdl` CLI 参考

`vdl` 是 Video-Learner 的命令行工具，复用 HTTP Service 和 `core/orchestrator`，提供终端下的任务创建、进度跟踪与结果查看能力。使用方法见 [how-to/cli.md](../how-to/cli.md)。

---

## 安装

```bash
npm link      # 全局注册（开发环境）
npm unlink vdl  # 取消注册
```

`npm link` 通过 symlink 安装，`__dirname` 仍解析到项目根目录，数据库和服务路径均正确定位。

---

## 子命令

### `vdl <url> [options]` — 主命令

处理一个 YouTube 视频：询问 focus → 创建任务 → 实时进度 → 打印结果路径。

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--focus <text>` | 交互询问 | 关注点，未传时在启动前交互输入 |
| `--mode <mode>` | `media` | `transcript` \| `media` \| `audio` \| `full` |
| `--lang <lang>` | `zh-CN` | 输出语言，`zh-CN` \| `en` |
| `--force` | false | 强制重跑已完成步骤 |
| `--json` | false | 以 JSON 格式输出最终结果（供脚本化） |

### `vdl status <task_id>`

打印任务当前状态及所有步骤的状态列表。

### `vdl result <task_id> [options]`

将指定内容输出到 stdout（供重定向或管道）。

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--type <type>` | `summary` | `summary` \| `article` |

内部调用 `GET /api/tasks/:id/result/content?type=<type>`。

### `vdl rerun <task_id> <step> [options]`

重跑指定步骤。

| 选项 | 默认值 | 对应 `reset_scope` | 说明 |
|------|--------|-------------------|------|
| `--reset downstream` | ✓ | `downstream` | 级联重置锚点及下游步骤，返回 202 后自动切换轮询等待 |
| `--reset step` | | `step` | 仅重置并重跑该步骤 |
| `--reset off` | | `off` | 直接跑，不重置 |

### `vdl list`

列出最近任务。直接读取 `work/database.sqlite`，无需 HTTP 服务在运行。

---

### `vdl gui`

在后台启动 Electron GUI，CLI 本身立刻返回提示符。

```bash
vdl gui
# GUI launched.
# $  ← 立刻拿回 shell
```

等同于 `bash start-electron.sh`，但无需记住脚本路径。GUI 启动后会自动连接（或启动）后端，与 CLI 共享同一个 port 3000 实例。

---

## 服务生命周期与 Token

### 单例后端

CLI、Electron GUI、`npm run agent:serve` 三种启动方式**共用同一个后端实例**，固定监听 `127.0.0.1:3000`。

### 启动逻辑（`core/agent-connect`）

```
任意客户端（CLI / Electron）启动
  └─ GET http://127.0.0.1:3000/healthz
       ├─ 200 → 后端已在运行
       │         读取 /tmp/vl-agent-token，注册心跳
       │
       └─ 失败 → 以 AUTO_SHUTDOWN=1 启动后端进程
                  轮询 healthz，最多等 8s
                  超时且仍无响应 → 打印错误，exit 1
                  ── EADDRINUSE 竞态 ──
                  两个进程同时启动时，输掉端口的一方
                  再次检查 healthz；若已有赢家则直接连接
```

**发现文件**（后端成功绑定端口后写入，退出时删除）：

| 文件 | 内容 |
|------|------|
| `/tmp/vl-agent-token` | Bearer token（HTTP 请求鉴权用） |
| `/tmp/vl-agent.pid` | 后端进程 PID |

### 心跳与自动关闭

后端以 `AUTO_SHUTDOWN=1` 启动时（由 CLI 或 Electron 拉起），启用引用计数自动关闭机制：

- 每个客户端每 10 秒向 `POST /api/heartbeat` 发送一次心跳
- 超过 20 秒未收到心跳的客户端被驱逐
- 无活跃客户端且无运行中任务时，30 秒宽限期后后端自动退出
- **`npm run agent:serve` 不设 `AUTO_SHUTDOWN=1`**，服务会一直运行直到手动停止

### 重启后的状态恢复

后端重启时自动执行：
- 将所有遗留的 `running` 步骤重置为 `failed`（可重跑）
- 删除 `task_id` 不合法的孤儿 step 行

---

## 进度输出格式

进度显示方式由 `process.stdout.isTTY` 决定。

### TTY 模式（终端直接运行）

原地刷新多行进度块（ANSI escape codes）：

```
Processing: How to build a RAG system (12m30s)
──────────────────────────────────────────────
✓ fetch_info          2s
✓ download_subs       8s
⠸ convert_vtt_md      running...
  generate_article    pending
  generate_summary    pending
```

完成后：

```
Done in 47s

  transcript  work/a1b2c3/transcript/original.md
  article     work/a1b2c3/writing/article.md
  summary     work/a1b2c3/writing/summary.md
```

### 非 TTY 模式（管道/重定向）

每次步骤状态变化追加一行，不使用 ANSI codes：

```
[fetch_info] done (2s)
[download_subs] done (8s)
[convert_vtt_md] running
[convert_vtt_md] done (12s)
Done: work/a1b2c3/writing/summary.md
```

### 步骤名映射

| DAG 内部名 | CLI 显示名 |
|-----------|-----------|
| `fetch` | `fetch_info` |
| `subs` | `download_subs` |
| `vtt2md` | `convert_vtt_md` |
| `article` | `generate_article` |
| `summary` | `generate_summary` |
| `video` | `download_video` |
| `audio` | `download_audio` |
| `asr` | `asr_transcribe` |
| `md2vtt` | `convert_md_vtt` |

---

## 退出码

| 码 | 原因 |
|----|------|
| 0 | 成功完成 |
| 1 | 服务启动超时、token 不可知、任务创建失败、pipeline 以 `failed` 状态结束、task_id 不存在 |

### Ctrl-C 行为

```
^C  Interrupted. Task a1b2c3 may have a step stuck in 'running'.
    To resume: vdl rerun a1b2c3 <step> --reset step
```

若 HTTP 服务由 CLI 自己启动，Ctrl-C 时会 kill 服务进程并删除 token 文件。若服务由 Electron 或用户手动启动，CLI 不干预。

---

## 文件结构

```
cli/
  index.js              ← 入口与子命令分发
  commands/
    run.js              ← 主命令（focus 询问 → 创建任务 → 轮询进度）
    status.js
    result.js
    rerun.js            ← reset_scope 映射 + 202 后切轮询
    list.js             ← 直读 SQLite
  lib/
    server.js           ← healthz 检查、服务启动/关闭、token 文件读写
    client.js           ← HTTP 封装（createTask, getTask, runStep, getResult）
    format.js           ← 步骤名映射、TTY 检测、进度渲染
```

---

## 测试

```bash
npm run test:cli
# node tests/cli-run.test.js && node tests/cli-subcommands.test.js
```

覆盖：token 文件读写、服务自启动/复用、主命令 happy path、focus 交互（stdin mock）、TTY/非 TTY 输出格式、各子命令、`rerun --reset downstream` 后切轮询、Ctrl-C 关闭自启动服务。
