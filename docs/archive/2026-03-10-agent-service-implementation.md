# Agent Service (HTTP Orchestrator) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `feat/agent-service` 分支上实现一个基于现有流水线的本地 HTTP 服务，提供任务级 API（创建任务、查询任务状态、获取结果），为后续步骤级 API 和 Electron 适配打基础。

**Architecture:** 抽取现有 Electron orchestrator 的核心调度逻辑到可复用的 `core/orchestrator` 模块，再新增 `services/http-server` 使用该模块对外暴露 HTTP/JSON API，重用当前的 `scripts/*.sh`、`work/` 目录结构和 SQLite 数据库，不改变原有 CLI/Electron 行为。

**Tech Stack:** Node.js、Electron、SQLite、Bash 脚本（现有）、Express/Koa/Fastify（任选一种 HTTP 框架）、supertest（HTTP 层测试，可选）。

---

### Task 1: 建立基础目录与依赖

**Files:**
- Create: `core/orchestrator/index.js`（占位）
- Create: `services/http-server/index.js`（占位）
- Modify: `package.json` / `electron/package.json`（视情况添加依赖，如 express/koa/fastify）
- Test: 暂不新增测试文件，只跑现有测试/脚本确认无破坏

**Step 1: 创建基础目录与占位文件**

- 在仓库根目录下新建 `core/` 和 `services/` 目录；
- 创建空的 `core/orchestrator/index.js`（仅导出一个占位函数）；
- 创建空的 `services/http-server/index.js`（仅打印一行日志，比如 "HTTP server placeholder"）。

**Step 2: 选择并安装 HTTP 框架**

- 在根级 `package.json` 或单独 `services` 范围内添加依赖（例如选择 Koa）：

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
npm install koa koa-router --save
```

（如倾向 Express/Fastify，可替换为对应依赖。）

**Step 3: 确认现有项目脚本仍可运行**

- 运行基础命令，确保新增依赖未破坏现有流程：

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
bash scripts/run.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" MODE=transcript FOCUS="smoke test" || echo "run.sh smoke failed (acceptable for now, just record)"
```

- 手动检查命令是否至少能进入脚本执行阶段（如有已知外部依赖缺失，可先记录，不必在本任务内解决）。

**Step 4: 初次提交**

```bash
git status
git add core/orchestrator/index.js services/http-server/index.js package.json package-lock.json
git commit -m "chore: scaffold core and http-service directories"
```

---

### Task 2: 抽取 Electron Orchestrator 的核心逻辑（只读分析 + 设计）

**Files:**
- Read/Analyze: `electron/src/orchestrator.js`
- Read/Analyze: `electron/src/db.js`
- Read/Analyze: 关键 `scripts/*.sh` 调用（例如 `scripts/fetch_info.sh`, `scripts/download_video.sh` 等）
- Modify: 暂不修改任何实现文件，仅在本 task 完成后更新设计文档（如需要）

**Step 1: 阅读 Electron orchestrator 与 DB 封装**

- 打开并通读：
  - `electron/src/orchestrator.js`
  - `electron/src/db.js`
- 重点记录：
  - 任务结构（task 对应的字段、表结构）；
  - step 的枚举列表、执行顺序、状态机（pending/running/completed/failed）；
  - 与 `scripts/*.sh` 的参数约定。

**Step 2: 对照 PROJECT_KNOWLEDGE.md 与 CLAUDE.md**

- 再次确认 `PROJECT_KNOWLEDGE.md` / `CLAUDE.md` 中对 meta 结构、步骤复用、下载独立性的约定；
- 对比实际 orchestrator 实现是否有差异（如有偏差，先记录在设计文档或 TODO 中，不在本 task 修改）。

**Step 3: 在设计文档中（可选）补充“核心 orchestrator 职责”小节**

- 如有必要，在 `docs/plans/2026-03-10-agent-service-design.md` 中补充简短说明：
  - `core/orchestrator` 需要提供的最小接口（如 `createTask`, `runTask`, `getTask`, `getTaskResult`）；
  - 与 SQLite/table schema 的关系。

**Step 4: 提交（若有文档更新）**

```bash
git status
git add docs/plans/2026-03-10-agent-service-design.md
git commit -m "docs: clarify core orchestrator responsibilities"
```

（如无修改则可跳过 commit。）

---

### Task 3: 定义 core/orchestrator 的最小接口（MVP）

**Files:**
- Modify: `core/orchestrator/index.js`
- Modify: （如需要）`electron/src/orchestrator.js`（仅导出类型/常量，不改行为）
- Test: 新建或预留：`tests/core/orchestrator.mjs` 或类似路径（可延后实现）

**Step 1: 在 core 中定义接口骨架**

- 在 `core/orchestrator/index.js` 中定义并导出以下占位函数（暂不实现内部逻辑）：
  - `createTask(params)`
  - `runTask(taskId)`
  - `getTask(taskId)`
  - `getTaskResult(taskId)`

**Step 2: 保持与 Electron orchestrator 的 step 命名/顺序一致**

- 定义一个共享的 step 枚举/常量：

```js
const STEPS = ["fetch", "video", "audio", "subs", "vtt2md", "article", "summary"];
module.exports = { createTask, runTask, getTask, getTaskResult, STEPS };
```

**Step 3: 暂时不改 Electron，确保兼容性**

- 检查 `electron/src/orchestrator.js` 是否有导出类似 step 列表；
- 暂时不改其实现，只在后续 Task 中切换为依赖 `core/orchestrator`。

**Step 4: 提交**

```bash
git status
git add core/orchestrator/index.js
git commit -m "feat(agent): define core orchestrator MVP interface"
```

---

### Task 4: 实现 createTask 与 getTask（只读 DB + 初始化逻辑）

**Files:**
- Modify: `core/orchestrator/index.js`
- Read: `electron/src/db.js`（复用 SQL/连接逻辑）
- Possibly Create: `core/orchestrator/db.js`（抽出 DB 操作封装）
- Test: 预留 `tests/core/orchestrator-createTask.test.js`

**Step 1: 抽出 SQLite 操作封装**

- 在 `core/orchestrator` 内创建一个简单 DB 封装模块（如 `db.js`）：
  - 负责建立到 `work/database.sqlite` 的连接；
  - 提供最小操作：插入 tasks、初始化 steps、查询 task/steps 状态。
- 可参考 `electron/src/db.js` 的实现，尽量避免复制大段代码（考虑复用或抽公共模块）。

**Step 2: 实现 createTask(params)**

- 实现逻辑：
  - 从 `params.url` 计算 `id = sha1(url)`；
  - 检查 DB 中是否已有同一 `id` 且 `force=0`：
    - 如有，返回已有任务（后续可以扩展为复用逻辑）；
  - 否则：
    - 在 `tasks` 表中插入一条新记录（status=pending，写入 focus/output_lang/mode 等字段）；
    - 在 `steps` 表中为每个 step 插入 status=pending 的记录；
    - 写入/更新 `work/index.jsonl` 中对应行（可复用现有 CLI 逻辑）。

**Step 3: 实现 getTask(taskId)**

- 从 DB 读取：
  - `tasks` 表中的任务基本信息；
  - `steps` 表中的所有 step 状态；
  - 按 `PROJECT_KNOWLEDGE.md`/`CLAUDE.md` 中的 meta 约定组装一个 meta 对象。

**Step 4: 手工测试 createTask/getTask**

```bash
node -e "const o=require('./core/orchestrator'); o.createTask({url:'https://www.youtube.com/watch?v=...', focus:'test', mode:'transcript', force:0, output_lang:'zh-CN'}).then(t=>console.log(t)).catch(console.error)"
```

```bash
node -e "const o=require('./core/orchestrator'); o.getTask('<TASK_ID>').then(console.log).catch(console.error)"
```

**Step 5: 提交**

```bash
git status
git add core/orchestrator
git commit -m "feat(agent): implement createTask and getTask using sqlite state"
```

---

### Task 5: 实现 runTask（顺序执行各 step，复用 scripts/*.sh）

**Files:**
- Modify: `core/orchestrator/index.js`
- Read: 各 `scripts/*.sh`（确认参数和退出码语义）
- Test: 预留集成测试脚本（如 `scripts/test_agent_service_run_task.sh`）

**Step 1: 设计 runTask 流程**

- 在 `core/orchestrator` 内部，设计一个简单的 step 执行器：
  - 按 `STEPS` 顺序遍历；
  - 对于每个 step：
    - 检查当前 step status：
      - `completed` 且 `force=false` → 跳过；
      - 其他 → 执行；
    - 更新 DB（status=running，attempts+1）；
    - 通过 Node `child_process.spawn`/`execFile` 调用对应脚本；
    - 根据退出码更新 status=completed/failed，并记录 error/log 抽象。

**Step 2: 映射 stepName → scripts**

- 定义一个映射表：

```js
const STEP_SCRIPTS = {
  fetch: "scripts/fetch_info.sh",
  video: "scripts/download_video.sh",
  audio: "scripts/download_audio.sh",
  subs: "scripts/download_subs.sh",
  vtt2md: "scripts/convert_vtt_md.sh",
  article: "scripts/generate_article.sh",
  summary: "scripts/generate_summary.sh"
};
```

- 根据现有 Electron orchestrator 中的调用参数复用 URL/id 等上下文。

**Step 3: 实现 runTask(taskId)**

- 伪代码：

```js
async function runTask(taskId, options={}) {
  // 标记 task.running
  for (const step of STEPS) {
    // 根据 mode/filter 决定是否执行该 step
    // 更新 steps.status=running, attempts++
    // spawn 对应脚本，等待结束
    // 更新 steps.status=completed/failed, error
    // 处理下载失败但继续后续步骤的策略
  }
  // 最终更新 tasks.status=completed/failed/partial
}
```

**Step 4: 手工跑一个完整任务**

```bash
node -e "const o=require('./core/orchestrator'); (async () => { const t = await o.createTask({url:'https://www.youtube.com/watch?v=...', focus:'agent test', mode:'transcript', force:1, output_lang:'zh-CN'}); await o.runTask(t.task_id); console.log(await o.getTask(t.task_id)); })().catch(console.error)"
```

**Step 5: 提交**

```bash
git status
git add core/orchestrator
git commit -m "feat(agent): implement runTask using existing scripts"
```

---

### Task 6: 在 services/http-server 中实现任务级 API

**Files:**
- Modify: `services/http-server/index.js`
- Possibly Modify: 根级 `package.json`（添加启动脚本，如 `"agent:serve": "node services/http-server/index.js"`）
- Test: 新建 `tests/services/http-server-tasks.test.js`（可使用 supertest）

**Step 1: 实现基础 HTTP server**

- 在 `services/http-server/index.js` 中：
  - 引入 Koa/Express；
  - 实现基础路由：
    - `POST /api/tasks` → 调用 `core/orchestrator.createTask` + 异步触发 `runTask`；
    - `GET /api/tasks/:taskId` → 调用 `getTask`；
    - `GET /api/tasks/:taskId/result` → 调用 `getTaskResult`。

**Step 2: 添加启动脚本**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
npm set-script agent:serve "node services/http-server/index.js"
```

**Step 3: 手工验证 HTTP 行为**

```bash
npm run agent:serve &
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=...","focus":"test","mode":"transcript","force":0,"output_lang":"zh-CN"}'

curl http://localhost:3000/api/tasks/<TASK_ID>
curl http://localhost:3000/api/tasks/<TASK_ID>/result
```

**Step 4: 提交**

```bash
git status
git add services/http-server package.json
git commit -m "feat(agent): add http server with task-level API"
```

---

### Task 7: 为 HTTP API 添加基础测试（可选但推荐）

**Files:**
- Create: `tests/services/http-server-tasks.test.js`
- Modify: `package.json`（添加测试脚本，如 `"test:agent": "node ./node_modules/.bin/mocha tests/services/http-server-*.test.js"` 或使用 jest）

**Step 1: 编写简单的集成测试**

- 使用 supertest（或原生 fetch + child_process 启动 server）：
  - 测试 `POST /api/tasks` 返回 201；  
  - 测试 `GET /api/tasks/:taskId` 在短时间内返回有效结构；
  - 如环境允许，等待一段时间查看 `status` 是否变为 `completed` 或 `failed`。

**Step 2: 运行测试**

```bash
npm run test:agent
```

**Step 3: 提交**

```bash
git status
git add tests/services/http-server-tasks.test.js package.json
git commit -m "test(agent): add basic http task API tests"
```

---

### Task 8: 最小集成验证与文档更新

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md`（追加“Agent Service / HTTP API”简短小节）
- Modify: 如有需要更新：`docs/plans/2026-03-10-agent-service-design.md`

**Step 1: 手动端到端验证**

- 启动 HTTP 服务；
- 用一个真实的 YouTube URL 走完整流程（MODE=transcript 或 both）；
- 检查：
  - `work/<id>/` 下是否产生正确的 transcript/writing 文件；
  - SQLite 中任务/步骤状态是否符合预期；
  - HTTP API 返回的 meta 与实际文件状态一致。

**Step 2: 更新项目知识文档**

- 在 `docs/PROJECT_KNOWLEDGE.md` 适当位置新增一小节：
  - 简要说明新引入的 HTTP agent service；
  - 列出主要路由和典型调用方式；
  - 标明当前仅支持任务级 API，步骤级和 Electron 适配将在后续迭代。

**Step 3: 最终提交**

```bash
git status
git add docs/PROJECT_KNOWLEDGE.md docs/plans/2026-03-10-agent-service-design.md
git commit -m "docs(agent): document http agent service mvp"
```

---

### 后续工作（非本次 MVP 范围，但可在后续 plan 中展开）

- 为 HTTP 服务补充步骤级 API（Task 4/5 的能力向外暴露）；
- 将 Electron 主进程改为复用 `core/orchestrator` 或直接通过 HTTP 调用 agent service；
- 若需要，将 agent service 打包为单独可执行（例如 CLI v2：`node cli-agent.js` 仅调用 HTTP API）。 

