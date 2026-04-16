# Agent Service ID & Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 HTTP agent service 与 Electron/CLI 在任务 ID 计算和任务状态存储上彻底统一，使同一 URL 在所有入口下共用同一条任务记录，并让任务状态可靠持久化到 SQLite 而不是仅存在于内存。

**Architecture:** 抽取一份统一的 ID 计算工具供 `core/orchestrator`、Electron orchestrator 以及脚本层使用；将当前 `core/orchestrator` 的内存任务/步骤状态改为通过现有的 SQLite `tasks/steps/downloads` 表读写，并在启动时从 DB 恢复已有任务，从而让 HTTP service 与 Electron 共享同一套状态源。

**Tech Stack:** Node.js、SQLite（现有 `work/database.sqlite`）、Electron `DatabaseManager` 封装、Bash 脚本（现有）、Koa HTTP server。

---

### Task 1: 统一 ID 计算策略（对齐 Electron 实现）

**Files:**
- Read: `electron/src/orchestrator.js`
- Read: `scripts/fetch_info.sh`
- Modify: `core/orchestrator/index.js`
- (可选) Create: `core/id.js`（统一 ID 工具）

**Step 1: 明确当前各处 ID 计算方式**

- 在 `electron/src/orchestrator.js` 中确认 `generateId(url)` 的实现（已知是 `sha1(url + '\n').substring(0, 12)`）。  
- 在 `scripts/fetch_info.sh` / 其他脚本中查看 ID 的生成与使用方式（是否依赖相同规则或只作为参数传入）。  
- 在 `core/orchestrator/index.js` 中确认当前实现（现为 `sha1(url).slice(0, 12)`）。

**Step 2: 抽取统一 ID 工具**

- 在 `core/` 下新建 `core/id.js`（或类似命名），导出：

```js
const crypto = require('crypto');

function generateId(url) {
  return crypto.createHash('sha1').update(url + '\n').digest('hex').slice(0, 12);
}

module.exports = { generateId };
```

**Step 3: 修改 core/orchestrator 使用统一 ID**

- 在 `core/orchestrator/index.js` 中：
  - 删除/替换本地的 `computeId` 实现；
  - 引入 `const { generateId } = require('../id');`；
  - 将所有 `computeId(url)` 调用改为 `generateId(url)`。

**Step 4: 手动验证 ID 一致性**

- 在 Node REPL 中分别调用：

```bash
node -e "const { generateId } = require('./core/id'); console.log(generateId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));"
node -e "const Orchestrator=require('./electron/src/orchestrator'); const o=new Orchestrator(process.cwd()); console.log(o.generateId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));"
```

- 确认两者输出的 ID 完全一致。

**Step 5: 提交**

```bash
git status
git add core/id.js core/orchestrator/index.js
git commit -m "feat(agent): unify task id generation with electron orchestrator"
```

---

### Task 2: 为 core/orchestrator 引入 SQLite DB 封装（复用 Electron 数据库）

**Files:**
- Read: `electron/src/db.js`
- Read: `scripts/db.sh`（了解表结构）
- Create: `core/orchestrator/db.js`
- Modify: `core/orchestrator/index.js`

**Step 1: 理解现有 DB 结构与 API**

- 阅读 `electron/src/db.js`，记录：
  - `DatabaseManager` 如何连接 `work/database.sqlite`；
  - 公开方法（如 `createTask(id, url)`, `updateTask`, `getTask`, `updateStep`, `updateTranscripts` 等）的语义；  
  - `tasks/steps/downloads` 表的字段（可以从 SQL 初始化语句中获取）。

**Step 2: 在 core 中创建轻量 DB 封装**

- 新建 `core/orchestrator/db.js`，导出一个最小 API，例如：

```js
const path = require('path');
const DatabaseManager = require('../../electron/src/db'); // 直接复用

function createDb(rootDir) {
  const dbPath = path.join(rootDir, 'work', 'database.sqlite');
  return new DatabaseManager(dbPath);
}

module.exports = { createDb };
```

**Step 3: 在 core/orchestrator 中注入 DB**

- 在 `core/orchestrator/index.js` 顶部引入 `createDb`，并在模块级或 `createTask` 初次调用时初始化：

```js
let db = null;
function ensureDb(rootDir) {
  if (!db) {
    db = createDb(rootDir);
  }
  return db;
}
```

**Step 4: 提交**

```bash
git status
git add core/orchestrator/db.js core/orchestrator/index.js electron/src/db.js
git commit -m "feat(agent): wire core orchestrator to shared sqlite db"
```

---

### Task 3: 将 createTask 逻辑持久化到 SQLite

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: 在 createTask 中写入 DB**

- 在 `createTask(params)` 内，在构建好 `id` 和 `meta` 后：
  - 调用 `const db = ensureDb(rootDir);`；  
  - 先尝试从 DB 读取已有任务（`db.getTask(id)`），如果存在且 `force=0`：
    - 从 DB 填充 meta（包括 title/duration/focus/output_lang 等），并返回一个“复用”任务对象（不创建新记录）；  
  - 若不存在或 `force=1`：
    - 调用 `db.createTask(id, url)`；  
    - 调用 `db.updateTask(id, { url, title: '', focus, output_lang })` 初始化任务记录；
    - 初始化 `steps` 表：对 `STEPS` 中的每个 step 调用 `db.updateStep(id, stepName, 'pending')`（或使用已有工具方法）。

**Step 2: 保持 index.jsonl 行为**

- 保留 `appendIndex` 调用，以便 CLI/历史流程仍然能通过 `work/index.jsonl` 追踪；  
- 确认生成的 `id` 与脚本/GUI 一致（利用 Task 1 的工具）。

**Step 3: 提交**

```bash
git status
git add core/orchestrator/index.js
git commit -m "feat(agent): persist http-created tasks into sqlite tasks/steps"
```

---

### Task 4: 将 steps 状态读写迁移到 SQLite（内存 Map 仅作 cache）

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: 在 runStep 前从 DB 取最新 step 状态**

- 在 `runStep(taskId, stepName, options)` 开头：
  - 通过 `ensureDb(rootDir)` 获取 DB；  
  - （如果 `db` 中有获取 steps 列表的 API，则使用；否则在 `db.js` 里补充简单查询方法）；  
  - 用 DB 中的状态初始化/更新 `task.steps[stepName]`。

**Step 2: 在 runStep 内更新 DB 的 steps 表**

- 在 step 置为 `running` 时：

```js
db.updateStep(id, stepName, 'running');
```

- 在 step 成功时：

```js
db.updateStep(id, stepName, 'completed');
```

- 在 step 失败时：

```js
db.updateStep(id, stepName, 'failed', stepState.error || 'Step failed');
```

**Step 3: 同步任务级元信息到 DB**

- 在 `updateTaskMetaFromFilesystem(task)` 中或在 `runTask` 完成后：
  - 将 `download_status/transcript_done/article_done/summary_done` 同步回 `tasks` 表（`db.updateTask(id, {...})`）。  
  - 这样 Electron 读取 DB 时能看到 HTTP 流水线更新后的字段。

**Step 4: 调整 getTask/getTaskSteps 读取来源**

- `getTask(taskId)`：
  - 尝试从 DB 读任务（作为权威源），再合并内存中的状态；  
  - 保证 `meta` 字段与 DB 中一致。  
- `getTaskSteps(taskId)`：
  - 首选从 DB 中读取（如果 API 支持），否则将内存 `task.steps` 与 DB 同步后返回。

**Step 5: 提交**

```bash
git status
git add core/orchestrator/index.js core/orchestrator/db.js electron/src/db.js
git commit -m "feat(agent): sync step and meta state with sqlite"
```

---

### Task 5: 启动时从 SQLite 恢复任务（避免重启丢失）

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: 为任务提供“按 ID 打开”的入口**

- 新增一个函数 `async function loadTaskFromDb(taskId, rootDir)`：
  - 从 DB 读取任务及 steps；
  - 构造与 `createTask` 时相同结构的内存 `task` 对象；
  - 放入 `tasks` Map 中。

**Step 2: 在 getTask / getTaskSteps / runTask 中容忍“仅 DB 有记录”的情况**

- 当 `tasks.get(taskId)` 返回空时：
  - 尝试调用 `loadTaskFromDb(taskId, rootDir)`；  
  - 成功后继续原有逻辑；若 DB 中也没有记录，再抛出 `task not found`。

**Step 3: 提交**

```bash
git status
git add core/orchestrator/index.js core/orchestrator/db.js
git commit -m "feat(agent): allow restoring tasks from sqlite on demand"
```

---

### Task 6: 端到端验证（HTTP + Electron 共享任务）

**Files:**
- (暂不修改代码) 使用现有测试与 Electron GUI 做人工验证

**Step 1: 通过 HTTP 创建任务**

- 在 worktree 根目录启动 agent service 或直接用 `test:agent`：

```bash
npm run agent:serve &
curl -s -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","focus":"persistence test","mode":"transcript","force":1,"output_lang":"zh-CN"}'
```

**Step 2: 启动 Electron GUI 查看任务列表**

```bash
bash start-electron.sh
```

- 在 GUI 中确认：
  - 对应 URL 的任务是否出现在列表中（依赖 GUI 用 DB 读取 tasks）；  
  - 状态字段（download/transcript/article/summary）是否与 HTTP 任务一致。

**Step 3: 再次通过 HTTP 操作 steps 并刷新 GUI**

- 用 `/api/tasks/:id/steps` / `/run` 重跑部分步骤；  
- 在 GUI 中刷新任务详情，观察 steps/状态是否更新。

**Step 4: 提交验证结果（可更新设计文档/PROJECT_KNOWLEDGE）**

```bash
git status
git add docs/plans/2026-03-10-agent-service-design.md docs/PROJECT_KNOWLEDGE.md
git commit -m "docs(agent): document id and sqlite persistence behavior"
```

---

### Task 7: 更新 agent 实现计划与待办项（可选收尾）

**Files:**
- Modify: `docs/plans/2026-03-10-agent-service-implementation.md`
- Modify: `docs/plans/2026-03-10-agent-service-design.md`

**Step 1: 在实现计划中勾掉“ID 统一 & 持久化”待办**

- 在 `2026-03-10-agent-service-implementation.md` 中追加简短小节，说明：  
  - ID 统一已完成；  
  - HTTP 任务已持久化到 SQLite 并可在 Electron 中复用。

**Step 2: 在设计文档中补充最终状态说明**

- 在 `2026-03-10-agent-service-design.md` 加一小节“ID & Persistence”：  
  - 描述所有入口的 ID 计算约定；  
  - 描述 HTTP service 与 Electron/CLI 如何共享 SQLite 状态。

**Step 3: 提交**

```bash
git status
git add docs/plans/2026-03-10-agent-service-implementation.md docs/plans/2026-03-10-agent-service-design.md
git commit -m "docs(agent): align plans with id and sqlite persistence changes"
```

