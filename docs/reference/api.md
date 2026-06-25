# Agent HTTP Service API 参考

项目包含面向 agent 编排层的本地 HTTP 服务，与 **Electron GUI** 共用同一套 **`core/orchestrator`** 流水线逻辑与 SQLite 状态。

## 入口与目录

- **启动**：`npm run agent:serve`（根目录），默认监听 `http://localhost:3000`，可通过环境变量 `PORT` 修改。
- **相关目录**：
  - `core/id.js`：统一任务 ID 计算（`sha1(url + '\n').slice(0,12)`），与 Electron 一致。
  - `core/orchestrator/`：共用编排内核，创建任务、执行步骤、读写 `work/database.sqlite` 与 `work/<id>/`。
  - `services/http-server/`：Koa 实现的 HTTP API，调用 `core/orchestrator` 并对外暴露 JSON 接口。

## 主要路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tasks` | 创建任务（body: url, focus, mode, force, output_lang），返回 task_id；后台自动跑整条流水线。 |
| GET | `/api/tasks/:taskId` | 查询任务状态与 meta、steps。 |
| DELETE | `/api/tasks/:taskId` | 删除任务（query: mode=hard\|state\|soft，默认 hard）；成功 204。 |
| GET | `/api/tasks/:taskId/result` | 获取任务结果与输出路径（article_path、summary_path 等）。 |
| GET | `/api/tasks/:taskId/result/content?type=article\|summary` | 返回对应 Markdown 文件正文（Content-Type: text/markdown），供 GUI 渲染；仅允许 `work/<id>/writing/` 下 article.md / summary.md。 |
| GET | `/api/tasks/:taskId/media` | 返回 `{ video: { path, exists } }`，path 为 `work/<id>/media/video.mp4` 的绝对路径，供 GUI 拼 `file://` 播放。 |
| GET | `/api/tasks/:taskId/subtitles` | 一次性返回 `{ tracks: [{ id, lang, label, vtt }] }`（md2vtt 产出的 VTT 全文），供 GUI 解析并展示多轨字幕。 |
| GET | `/api/tasks/:taskId/steps` | 获取该任务所有步骤的状态列表。 |
| POST | `/api/tasks/:taskId/steps/:stepName/run` | 执行指定步骤。body 可选：`focus`、`force`；**`reset_scope`**（已实现）：`off`（默认）\| `step` \| `downstream`。 |
| POST | `/api/tasks/:taskId/cancel` | 中止运行中的任务（同步等待进程退出）。任务进入 `aborted` 状态。任务非运行中 **409**（`code: NOT_RUNNING`）。 |
| POST | `/api/tasks/:taskId/resume` | 继续已中止（`aborted`）的任务，从中断处继续执行，已完成步骤不重跑。任务非 `aborted` **409**（`code: NOT_ABORTED`）。 |
| POST | `/api/tasks/:taskId/steps/:stepName/cancel` | 中止运行中的指定步骤（同步等待进程退出）。步骤重置为 `pending`，任务继续调度后续步骤。步骤非运行中 **409**（`code: STEP_NOT_RUNNING`）。 |
| GET | `/api/events` | SSE 流（query: token），推送任务/步骤/日志事件，供 GUI 实时刷新。 |
| GET | `/api/tasks/:taskId/paths` | 返回该任务的路径信息（base/media/transcript/writing），供 Electron 等客户端打开本地输出目录。 |
| GET | `/api/tasks/:taskId/paths` | 返回该任务的路径信息（base/media/transcript/writing），供 Electron 等客户端打开本地输出目录。 |
| GET | `/api/config` | 返回当前 work 根目录配置（`workRoot`、`workDir`、`settingsPath`）。 |
| POST | `/api/config` | 持久化写入 `WORK_ROOT` 到 `~/.config/vdl/settings.conf`，返回 `{ ok, restart_required: true }`。 |
| GET | `/healthz` | 健康检查，返回 200 OK。 |

## `GET /api/config` 与 `POST /api/config`

查看和修改 work 根目录。修改仅写入配置文件，**重启后端**后才对已建立的 DB 连接生效。

### `GET /api/config`

```json
{
  "workRoot": "~/Syncthing/video-learner",
  "workDir":  "/Users/alice/Syncthing/video-learner/work",
  "settingsPath": "/Users/alice/.config/vdl/settings.conf"
}
```

`workRoot` 为 `null` 表示当前使用默认值（`~/vdl-work`）。

### `POST /api/config`

请求体：

```json
{ "workRoot": "~/Syncthing/video-learner" }
```

`workRoot` 必须是绝对路径或以 `~` 开头。成功响应：

```json
{ "ok": true, "workRoot": "~/Syncthing/video-learner", "restart_required": true }
```

等效 CLI：`vdl config set work-root <path>`。

## `POST .../steps/:stepName/run` 与 `reset_scope`

与「只执行一步、不改其它步状态」及「重置后再跑」共用同一路径，由 body 字段 **`reset_scope`** 区分：

| `reset_scope` | 行为概要 |
|---------------|----------|
| `off` 或省略 | 仅 `runStep(taskId, stepName)`；**不**批量改其它步骤。响应与改动前一致（成功多为 **202** + `runStep` 结果）。 |
| `step` | 先将 **`stepName` 本步** 置 `pending`（清 error、attempts），再执行该步；响应 body 在结果对象上附带 **`reset_steps`**（通常仅含该步）。 |
| `downstream` | 将 **锚点步及 DAG 下游闭包**（`core/orchestrator/schedule.js` 中 `STEP_EDGES` 正向可达）内非 `skipped` 步置 `pending` 后，**fire-and-forget** `runTask`；HTTP **202**，body 含 **`accepted`、`from_step`、`reset_steps`**。任务或任一步 **`running`** 时 **409**；锚点对当前 `mode` 非法、或锚点为 **`skipped`** 时 **400**。 |

**鉴权**：本阶段路由层不额外要求 token（与历史行为一致）。

**`force`（body 可选）**：仅通过 `runStep` 作用于 `video` / `audio` 脚本；与其它 Step 无关；与 `reset_scope`、`task.params.force`、`downstream` 下是否透传的关系见 architecture.md §force参数。

## 任务创建参数

`POST /api/tasks` body：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | 是 | YouTube URL |
| `focus` | string | 否 | 用户关注点（影响 summary 内容） |
| `mode` | string | 否 | `media`（默认）\| `audio` \| `transcript` \| `full` |
| `force` | boolean | 否 | 是否强制重跑（影响 video/audio 步骤） |
| `output_lang` | string | 否 | 输出语言，默认 `zh-CN` |
| `timeout_scale` | number | 否 | 超时倍率，默认 `1`；`3` = `--long`，`6` = `--ultra-long`。非正数值自动归一化为 `1`，per-task 生效，不影响并发的其他任务。 |

旧 mode 名称（`both`、`video`）会被静默规范化为 `media`，见 [adr/2026-04-13-mode-redesign.md](../adr/2026-04-13-mode-redesign.md)。

## 与 CLI / Electron 的关系

- **任务 ID**：三者统一使用 `core/id.js` 的 `generateId(url)`，同一 URL 在任意入口下得到相同 `id`，对应同一套 `work/<id>/` 与 SQLite 记录。
- **状态存储**：HTTP 与 Electron 共用 `work/database.sqlite`（tasks / steps 表）；进程重启后可通过 GET 或 runStep 按 taskId 从 DB 恢复任务到内存再继续操作。
- **Electron**：`electron/src/orchestrator.js` 已改为「适配器」，内部委托 `core/orchestrator` 与 `core/id`，GUI 与 HTTP 使用同一套编排与状态。

## `reset_scope` 自动化测试

- **命令**：`npm run test:reset-scope`（已并入 `npm run test:orchestrator:unit` / `npm run test:agent:core`）。
- **覆盖**：
  - `tests/reset-scope-all-steps-http.test.js`：对 `ALL_STEPS` × `mode` ∈ {`transcript`,`media`,`audio`,`full`} 分别请求 `reset_scope: downstream` 与 `reset_scope: step`。
  - `tests/service-client-reset-scope-all-steps.test.js`：同一矩阵通过 `electron/src/renderer/service-client.js` 调用。
- **`downstream`** 在测试中不跑真实整条线：`createApp({ runTaskForDownstream: async () => {} })` 注入空实现。

## 任务与步骤取消

### `POST /api/tasks/:taskId/cancel`

同步中止运行中任务。等待进程退出后响应。

| 状态码 | 含义 |
|--------|------|
| 200 | 中止成功，body: `{ task_id, status: "aborted" }` |
| 404 | 任务不存在 |
| 409 | 任务未在运行，body: `{ error, code: "NOT_RUNNING" }` |

中止完成后：当前运行步骤重置为 `pending`，任务状态变为 `aborted`（持久化到 DB，重启后恢复）；`article.md` / `summary.md` 等不完整产物会被删除（视频/音频部分文件保留，支持续传）。

### `POST /api/tasks/:taskId/steps/:stepName/cancel`

同步中止运行中的指定步骤。等待进程退出后响应。步骤重置为 `pending`，任务 DAG 继续调度（可立即重跑该步或后续步骤）。

| 状态码 | 含义 |
|--------|------|
| 200 | 中止成功，body: `{ task_id, step, status: "pending" }` |
| 404 | 任务或步骤不存在 |
| 409 | 步骤未在运行，body: `{ error, code: "STEP_NOT_RUNNING" \| "STEP_ABORT_IN_PROGRESS" }` |

### SSE 事件（取消场景）

取消不产生新事件类型，复用现有类型：

| 场景 | 事件类型 | 关键字段 |
|------|----------|---------|
| 任务取消完成 | `task.updated` | `{ status: "aborted" }` |
| 步骤取消完成 | `step.finished` | `{ stepName, status: "pending", aborted: true }` |
| 任务 resume 触发 | `task.updated` | `{ status: "running" }` |

### 取消测试

`npm run test:abort`（`tests/task-abort.test.js`），覆盖：任务级中止、步骤级中止、非运行中 409、不存在 404、`article.md` 文件清理。

### `POST /api/tasks/:taskId/resume`

继续已中止的任务，从中断处继续执行。已完成步骤（`completed`/`skipped`）不重跑，DAG 从所有前驱完成的 `pending` 步骤重新调度。响应为 `202 Accepted`（fire-and-forget，任务进入 running 但流水线尚未完成）。

| 状态码 | 含义 |
|--------|------|
| 202 | resume 已触发，body: `{ task_id, status: "running" }` |
| 404 | 任务不存在 |
| 409 | 任务非 `aborted` 状态，body: `{ error, code: "NOT_ABORTED" }` |

注意：`failed` 任务不支持 resume，需通过 `reset_scope` 手动重置步骤。

### Resume 测试

`npm run test:resume`（`tests/task-resume.test.js`），覆盖：
- T1–T3：abort → resume 主流程（已完成步骤保持、DAG 跳过、最终完成）
- T4–T7：非 `aborted` 状态调用 resume → 409 NOT_ABORTED（running / pending / completed / failed）
- T8：进程重启后 `aborted` 状态持久化（`_dropTaskFromMemory` + `getTask` 验证）
- T9：对 `aborted` 任务再次调用 abortTask → NOT_RUNNING
- T10–T12：HTTP 层验证（202 成功、409 NOT_ABORTED、404 不存在）

## 端到端测试（HTTP 慢路径）

- **命令**：`npm run test:agent:e2e`（见 `tests/agent-service-e2e.test.js` 文件头注释）。
- **依赖**：可访问 YouTube、`yt-dlp`/`ffmpeg`、写作引擎。
- **行为**：经 HTTP 创建任务并等待整条流水线完成，校验 GET task 的 `meta`（`transcript_done` / `article_done` / `summary_done`）、逐字稿与 Markdown 文件。
- 默认**不**删除 `work/<id>/`；若需清理可设 `E2E_CLEANUP=1`。
- CI：耗时与外部环境依赖大，默认不必纳入必跑流水线。
