## 背景与目标

Video-Learner 当前有两套入口：
- CLI 模式：`scripts/run.sh "<URL>"` 串行调度整条流水线，状态由 `work/index.jsonl` + 文件存在性推断。
- Electron GUI 模式：`electron/src/orchestrator.js` 将流水线拆成多步，通过 SQLite `work/database.sqlite` 管理任务/步骤状态，并通过 WebSocket 推送给前端。

现在希望在 **保留 Electron 桌面客户端能力** 的前提下，让整个流水线对上层 agent 编排系统（如 OpenClaw）暴露为一个「可调用工具」，支持：
- **任务级调用**：给定 `url` + `focus` + `mode` 等参数，一次性完成下载/转录/文章/总结，返回结构化结果。
- **步骤级调用**：针对已有任务，按需执行或重试某个 step（如只跑 transcript + summary，或只重试 video 下载）。

本设计文档描述在 `feat/agent-service` 分支上引入「本地 HTTP 服务 + 共用 orchestrator 内核」的方案一，作为长期主方案。

---

## 总体架构

### 模块划分

- `core/orchestrator`（新建 Node 模块）
  - 负责：
    - 创建任务、初始化 steps/下载记录；
    - 调用 `scripts/*.sh` 具体执行各 step；
    - 读写 `work/database.sqlite` / `work/index.jsonl` / `work/<id>/...`；
    - 维护逻辑上的 meta（与 `PROJECT_KNOWLEDGE.md` / `CLAUDE.md` 中定义一致）；
    - 发出结构化事件流（`taskCreated/Updated`、`stepStarted/Finished`、`log` 等）。
- `services/http-server`（新建进程或模块）
  - 使用 Koa/Fastify/Express 任一框架实现；
  - 引入 `core/orchestrator`，对外提供 HTTP/JSON API：
    - 任务级：创建任务、查询任务状态、获取结果；
    - 步骤级：执行/重试指定 step，查询 step 状态；
  - 可选：内部再启动一个 WebSocket，将 orchestrator 事件转成 WS 消息，供 GUI/agent 订阅。
- Electron 主进程适配层（重构现有 `electron/src/orchestrator.js`）
  - 过渡阶段：
    - 可以直接复用 `core/orchestrator`，维持原有 IPC + WebSocket 行为；
    - 或改为通过 HTTP 调用 `services/http-server`，把自己也降级为「客户端」。
  - 中长期目标：
    - Electron renderer 直接通过 HTTP/WS 调用 agent service；
    - 主进程仅负责窗口与安全桥接，不再持有业务 orchestrator。

### 外部调用方

- **OpenClaw / 其他 agent 系统**：
  - 通过本地 HTTP 调用 `services/http-server`；
  - 使用任务级 API 或步骤级 API 完成具体编排。
- **Electron renderer**：
  - 短期：继续通过 preload.js + WebSocket 与主进程交互；
  - 中长期：直接与 HTTP/WS 服务通信，进一步解耦主进程与业务逻辑。

---

## 对外 HTTP API 设计（初版）

### 资源：Task（任务级）

1. 创建任务

`POST /api/tasks`

请求体：
```json
{
  "url": "https://www.youtube.com/...",
  "focus": "技术细节, 架构分析",
  "mode": "both",
  "force": 0,
  "output_lang": "zh-CN"
}
```

响应（201）：
```json
{
  "task_id": "uuid-or-internal-id",
  "status": "pending",
  "meta": {
    "url": "...",
    "id": "...",
    "title": "...",
    "duration": "...",
    "output_lang": "zh-CN",
    "download_status": "pending",
    "transcript_done": false,
    "article_done": false,
    "summary_done": false,
    "focus": "技术细节, 架构分析"
  }
}
```

说明：
- `mode` 语义对齐 CLI：`both|video|audio|transcript`；
- `force=0/1` 影响是否复用已有输出，与 `run.sh` 行为保持一致。

2. 查询任务状态

`GET /api/tasks/:taskId`

响应（200）：
```json
{
  "task_id": "...",
  "status": "pending|running|completed|failed",
  "meta": { /* 同上，来自 DB + 文件存在性推断 */ },
  "steps": [
    {
      "name": "fetch",
      "status": "pending|running|completed|failed",
      "attempts": 1,
      "error": null
    },
    {
      "name": "video",
      "status": "failed",
      "attempts": 2,
      "error": "yt-dlp ...",
      "download_status": "failed"
    }
  ]
}
```

3. 获取任务结果

`GET /api/tasks/:taskId/result`

响应（200）：
```json
{
  "task_id": "...",
  "status": "completed|failed|partial",
  "meta": { /* 与 PROJECT_KNOWLEDGE 中逻辑 meta 对齐 */ },
  "outputs": {
    "article_path": "work/<id>/writing/article.md",
    "summary_path": "work/<id>/writing/summary.md",
    "original_en_md": "work/<id>/transcript/original_en.md",
    "original_zh_md": "work/<id>/transcript/original_zh.md",
    "video_path": "work/<id>/media/video.mp4",
    "audio_path": "work/<id>/media/audio.m4a"
  }
}
```

说明：
- `status=partial` 表示例如视频下载失败但转录/总结成功的情况；
- 路径为本机绝对/相对路径，上层 agent 可选择读取文件内容或仅记录路径。

### 资源：Step（步骤级）

4. 执行/重试某 Step

`POST /api/tasks/:taskId/steps/:stepName/run`

请求体：
```json
{
  "force": false,
  "options": {}
}
```

响应（202）：
```json
{
  "task_id": "...",
  "step": "video",
  "status": "queued|running",
  "previous_status": "failed|completed|pending"
}
```

语义：
- `force=false` 且 step 已 `completed` → 不重复执行，直接返回当前状态；
- `force=true` → 无视当前 state，递增 attempts，并重新执行该 step。

5. 查询所有 Step 状态

`GET /api/tasks/:taskId/steps`

响应（200）：
```json
[
  { "name": "fetch", "status": "completed", "attempts": 1, "error": null },
  { "name": "video", "status": "failed", "attempts": 2, "error": "..." },
  { "name": "subs", "status": "completed", "attempts": 1, "error": null }
]
```

---

## 核心数据流（MVP）

### 任务生命周期

1. 创建任务
- HTTP `POST /api/tasks` → `core/orchestrator.createTask(params)`：
  - 从 `url` 计算 `id = sha1(url)`；
  - 在 SQLite 的 `tasks` / `steps` / `downloads` 表初始化记录；
  - 视情况更新 `work/index.jsonl`（与现有 CLI 一致）；
  - 决定根据 `mode` 启用哪些 step；
  - 返回 `task_id` + 初始 meta。

2. 执行任务
- `core/orchestrator.runTask(taskId)`：
  - 按顺序调用：
    - `fetch` → `video`（可后台）→ `audio` → `subs` → `vtt2md` → `article` → `summary`；
  - 每一步：
    - 调用对应 `scripts/*.sh`；
    - 记录 start/finish 时间、`status`/`attempts`/`error`；
    - 发出事件（供 WebSocket/日志使用）。

3. 任务完成与结果查询
- 所有启用 step 完成后，更新 `tasks.status=completed`（即便某些非核心 step 失败但不阻塞整体，比如视频下载失败的情况可以视为 partial success）；
- `GET /api/tasks/:taskId` 和 `/result` 从 DB + 文件系统汇总状态，按约定组装 meta 和 outputs。

### 下载独立性与复用

- 下载独立性保持不变：
  - `video` 失败 → 记录 `download_status=failed` + `download_error`；
  - 仍继续执行 `subs/vtt2md/article/summary`；
  - `status` 可为 `completed` + meta 中标记下载失败。
- 复用策略：
  - 若已有同 `id` 且 `force=0`：
    - 可直接返回已有 `task_id` 和当前 meta，而不重新执行；
    - 或根据策略判断仅补跑部分未完成的 step。

---

## 错误处理与重试语义

### HTTP 层

- 4xx：参数非法（缺少 url、不支持的 mode、非法 force 值等）；
- 404：不存在的 `taskId` 或 `stepName`；
- 409：当前状态下不允许的操作（例如任务整体处于 running 状态时再次调用 runTask，MVP 可直接返回 409）。

### 业务层重试

- 任务级：
  - `POST /api/tasks` + `force=0`：优先复用已有任务或已有成功 step；
  - `force=1`：即使有现有结果也从头跑（或从逻辑上视为新任务）。
- 步骤级：
  - 根据 `force` 参数控制是否无视既有成功状态；
  - `attempts` 字段持续累积，便于后续分析稳定性问题。

---

## 与 Electron 的集成策略

### 阶段 1：仅新增 HTTP 服务，不扰动现有 GUI

- 在 `feat/agent-service` 分支上：
  - 从现有 `electron/src/orchestrator.js` 中抽取通用逻辑到 `core/orchestrator`；
  - 新增 `services/http-server.js`：
    - 引入 `core/orchestrator`；
    - 实现上述 Task/Step API；
    - 初期可以不暴露 WebSocket，只做 HTTP 轮询。
- Electron 侧保持现状：
  - 继续使用原 orchestrator + WebSocket，为 GUI 提供进度和日志；
  - 此时 orchestrator 有一份重复逻辑，但先保证行为等价、回归通过。

### 阶段 2：Electron 主进程复用 core/orchestrator

- 将 `electron/src/orchestrator.js` 改造为：
  - 直接调用 `core/orchestrator`（与 HTTP 服务同源）；
  - 或者完全去掉内部 orchestrator，通过 HTTP 调 `services/http-server`；
- WebSocket server 可以：
  - 监听 `core/orchestrator` 事件流；
  - 或从 HTTP 服务中转事件给前端。

### 阶段 3：GUI 直接对接 HTTP/WS

- Renderer 通过 HTTP/WS 直接访问 agent service：
  - 创建/查询任务、查看 steps 状态、展示 article/summary；
  - 主进程主要负责安全沙箱与文件系统权限代理。

---

## 与 OpenClaw 的对接示例（概念层）

- 定义 tool：`process_youtube_video`
  - 输入：
    - `url: string`
    - `focus?: string`
    - `mode?: "both" | "transcript"`
    - `force?: boolean`
  - 输出：
    - `task_id: string`
    - `status: "completed" | "failed" | "partial"`
    - `summary_path: string`
    - `meta: { download_status, transcript_done, article_done, summary_done, ... }`
- 编排逻辑：
  - 第一次调用：`POST /api/tasks` 创建任务；
  - 轮询 `GET /api/tasks/:taskId` 直到进入终态；
  - 再调 `GET /api/tasks/:taskId/result` 获取最终输出路径，按需读取 `summary.md` 内容用于后续推理。

---

## 测试与验证策略

- 单元/集成测试：
  - 核心：`core/orchestrator` 的任务/步骤状态机、meta 生成逻辑；
  - HTTP：各路由的参数校验、状态码语义、错误路径；
  - 回归：保证对 `work/` 目录和 SQLite 的读写行为与现有 Electron 流程兼容。
- 端到端测试：
  - 场景 1：正常视频，`mode=both`，视频/字幕齐全；
  - 场景 2：视频下载失败但字幕存在，验证 `partial` 语义；
  - 场景 3：仅 transcript 流程（`mode=transcript`），不强制下载完整视频；
  - 场景 4：重复 URL + `force=0/1` 的复用与重新执行行为。

---

## 实现状态（feat/agent-service）

以下已在当前分支落地：

- **ID 统一**：所有入口使用 `core/id.js` 的 `generateId(url) = sha1(url + '\n').slice(0,12)`，与 Electron 及脚本侧约定一致，同一 URL 在 CLI / HTTP / Electron 下对应同一 `id` 与同一条 SQLite 任务记录。
- **任务与步骤持久化到 SQLite**：`core/orchestrator` 在创建任务时写入 `tasks` 与 `steps` 表，在执行/重试步骤时更新 `steps` 状态；与 Electron 共用 `work/database.sqlite`。
- **启动时从 SQLite 恢复任务**：当内存中无某 `taskId` 时，`getTask` / `getTaskResult` / `getTaskSteps` / `runStep` / `runTask` 在收到 `options.rootDir` 的前提下会调用 `loadTaskFromDb(taskId, rootDir)` 从 DB 加载任务与步骤到内存，再继续逻辑；HTTP 层在所有请求中传入 `rootDir`，故进程重启后仍可通过同一 taskId 查询或继续执行步骤。
- **Electron 复用 core**：`electron/src/orchestrator.js` 已改为适配器，`run` / `runStep` / `retryStep` / `skipStep` / `getStatus` 委托给 `core/orchestrator`，`generateId` 使用 `core/id`；GUI 与 HTTP 共用同一套编排与状态源。

---

## 总结

通过引入 `core/orchestrator` + `services/http-server`，Video-Learner 可以在：
- 保持现有 Electron GUI 和 CLI 行为不变的前提下，
- 向上层 agent 编排系统以 HTTP/JSON 的形式暴露任务级和步骤级 API，
- 复用原有 SQLite / work 目录结构规范与失败策略，
从而成为一个既适合人类交互、又适合 agent 编排的通用视频学习流水线服务。

