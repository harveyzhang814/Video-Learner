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

### `vdl gui`

在后台启动 Electron GUI 窗口，CLI 立刻返回（不阻塞终端）。若 HTTP 服务尚未运行，Electron 会自动启动并注册心跳；CLI 本身不再管理服务生命周期。

---

## 服务生命周期与 Token

所有启动方式（CLI、Electron GUI、`npm run agent:serve`）共用 **固定端口 3000** 上的同一后端实例。底层逻辑由 `core/agent-connect.js` 统一处理。

### 启动逻辑

```
vdl 启动
  └─ GET http://127.0.0.1:3000/healthz
       ├─ 200 → 服务已在运行
       │         读取 /tmp/vl-agent-token（最多重试 3 次 × 100ms）
       │         token 文件不存在 → 打印错误，exit 1
       │         注册心跳（POST /api/heartbeat）
       └─ 失败 → 以 AUTO_SHUTDOWN=1 后台启动 node services/http-server/index.js
                  每 300ms 轮询 healthz，最多等 8s
                  若 EADDRINUSE（并发竞争）→ 重试 healthz，复用赢家服务
                  超时 → 打印错误，exit 1
                  注册心跳
```

### 心跳与自动关闭

CLI 运行期间每 10 秒向 `POST /api/heartbeat` 发送一次心跳（clientId 唯一）。CLI 退出时发送 `DELETE /api/heartbeat/:clientId` 注销。

服务在 `AUTO_SHUTDOWN=1` 模式下（CLI/Electron 启动时自动设置）监测心跳注册表：

- 超过 20s 未收到心跳的客户端自动驱逐
- 注册表清空且无运行中任务 → 等待 30s 宽限期 → `process.exit(0)`
- `npm run agent:serve` 不设置 `AUTO_SHUTDOWN=1`，服务永久运行

### Token 文件

| 文件 | 内容 | 生命周期 |
|------|------|---------|
| `/tmp/vl-agent-token` | Bearer token（hex） | 服务 `listen()` 成功后写入，进程退出时删除 |
| `/tmp/vl-agent.pid` | 服务进程 PID | 同上 |

两个文件均在 `listen()` 回调内写入（bind 成功后），防止 EADDRINUSE 竞争时被覆盖。

### 服务重启行为

服务启动时自动将数据库中所有 `running` 状态的步骤重置为 `failed`（防止崩溃后步骤永久卡死）。

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
    gui.js              ← 后台启动 Electron（detached + unref）
  lib/
    server.js           ← 委托 core/agent-connect；心跳注册/注销；shutdown 信号处理
    client.js           ← HTTP 封装（createTask, getTask, runStep, getResult）
    format.js           ← 步骤名映射、TTY 检测、进度渲染
core/
  agent-connect.js      ← 统一 check-or-start 逻辑（CLI 和 Electron 共用）
  heartbeat-client.js   ← 心跳发送（start/stop，unref 防阻塞进程退出）
```

---

## 测试

```bash
npm run test:cli
# node tests/cli-run.test.js && node tests/cli-subcommands.test.js
```

覆盖：token 文件读写、服务自启动/复用、主命令 happy path、focus 交互（stdin mock）、TTY/非 TTY 输出格式、各子命令、`rerun --reset downstream` 后切轮询、Ctrl-C 心跳注销、心跳注册/驱逐/自动关闭、EADDRINUSE 并发竞争、单例后端集成（8 场景）。
