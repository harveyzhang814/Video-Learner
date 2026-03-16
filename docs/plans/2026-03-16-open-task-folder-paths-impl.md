# Open Task Folder Paths Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a shared path service and HTTP API so the Electron "Open" button opens the correct `work/<id>/` task directory using a unified core/paths module.

**Architecture:** Introduce a small `core/paths` module to compute task directories, expose them via a dedicated `GET /api/tasks/:taskId/paths` endpoint in the agent HTTP server, and wire Electron main + preload + renderer so the UI calls an IPC handler that uses this API (or core module) and `shell.openPath` to open the folder.

**Tech Stack:** Node.js (core + Koa HTTP server), Electron (main/preload/renderer), existing test runner (npm test / Jest or equivalent), SQLite (already wired, used only for task existence checks).

---

### Task 1: Create `core/paths` module for work & task directories

**Files:**
- Create: `core/paths.js`
- (Optional, if tests exist for core): `tests/core/paths.test.js` or `core/__tests__/paths.test.js`（根据实际测试结构调整）

**Step 1: Write failing tests for `core/paths`**

In the chosen test file (e.g. `core/__tests__/paths.test.js`), add tests that specify:

```js
// Pseudo-test structure – adapt to actual test framework (Jest/Mocha/etc.)
describe('core/paths', () => {
  it('uses default work root when WORK_ROOT is not set', () => {
    // clear WORK_ROOT from env
    // import getWorkRoot
    // expect(getWorkRoot()).toBe(path.join(projectRoot, 'work'));
  });

  it('uses WORK_ROOT env var when provided', () => {
    // set process.env.WORK_ROOT = '/tmp/custom-work'
    // expect(getWorkRoot()).toBe('/tmp/custom-work');
  });

  it('computes task directories from taskId', () => {
    // const dirs = getTaskDirs('abcd1234ef56');
    // expect(dirs.base).toBe(path.join(getWorkRoot(), 'abcd1234ef56'));
    // expect(dirs.media).toBe(path.join(dirs.base, 'media'));
    // expect(dirs.transcript).toBe(path.join(dirs.base, 'transcript'));
    // expect(dirs.writing).toBe(path.join(dirs.base, 'writing'));
  });
});
```

Make sure these tests **import** `getWorkRoot` / `getTaskDirs` from `core/paths`.

**Step 2: Run tests to verify they fail**

Run the project’s test command, for example:

```bash
npm test
# 或使用实际的测试命令，例如：
# npx jest core/__tests__/paths.test.js
```

确认与 `core/paths` 相关的测试失败，原因是模块或导出函数不存在。

**Step 3: Implement `core/paths.js`**

Create `core/paths.js` with minimal implementation to satisfy the tests:

```js
const path = require('path');

function getWorkRoot() {
  const fromEnv = process.env.WORK_ROOT;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv);
  }
  // 默认：仓库根目录下的 work/。
  // 如果有现成的 projectRoot 计算逻辑，可复用；否则用 process.cwd() 约定从仓库根运行。
  return path.join(process.cwd(), 'work');
}

function getTaskDirs(taskId) {
  const base = path.join(getWorkRoot(), taskId);
  return {
    base,
    media: path.join(base, 'media'),
    transcript: path.join(base, 'transcript'),
    writing: path.join(base, 'writing'),
  };
}

module.exports = {
  getWorkRoot,
  getTaskDirs,
};
```

**Step 4: Run tests to verify they pass**

再次运行测试命令：

```bash
npm test
# 或对应的单测命令
```

确认与 `core/paths` 相关的测试全部通过，且未破坏现有测试。

**Step 5: Commit**

```bash
git add core/paths.js
# 以及新增/修改的测试文件
git add core/__tests__/paths.test.js  # 按实际路径调整
git commit -m "feat(core): add paths module for work and task directories"
```

---

### Task 2: Add `GET /api/tasks/:taskId/paths` to agent HTTP service

**Files:**
- Modify: `services/http-server/index.js`（或当前注册路由的入口）
- Modify or Create: `services/http-server/routes/tasks.js`（如果已有任务路由）  
  或新建 `services/http-server/routes/paths.js`（如果希望单独文件）
- (Optional tests) Create/modify HTTP tests under `tests/services/http-server/` or similar

**Step 1: Locate current HTTP server and task routes**

阅读：

- `services/http-server/index.js`（或等价入口）
- 现有任务相关路由文件，例如 `services/http-server/routes/tasks.js`

确认：

- 如何挂载路由（Koa Router / 自定义 router）；
- 现有 `/api/tasks/:taskId`、`/api/tasks/:taskId/media` 等路由的风格与错误处理方式。

**Step 2: Write failing HTTP tests for `/api/tasks/:taskId/paths`**

在 HTTP 测试文件中新增用例（示意）：

```js
describe('GET /api/tasks/:taskId/paths', () => {
  it('returns 404 when task does not exist', async () => {
    const res = await request(app.callback())
      .get('/api/tasks/non-existing-task-id/paths')
      .expect(404);

    expect(res.body).toHaveProperty('error');
  });

  it('returns base/media/transcript/writing paths for existing task', async () => {
    // 1. 准备一个存在的 taskId（可以通过直接插入 SQLite、或复用已有 helper 创建任务）
    const taskId = await createTestTaskAndReturnId();

    const res = await request(app.callback())
      .get(`/api/tasks/${taskId}/paths`)
      .expect(200);

    expect(res.body.id).toBe(taskId);
    expect(typeof res.body.base).toBe('string');
    expect(res.body.base).toContain(taskId);
    expect(res.body.media).toContain(`${taskId}/media`);
    expect(res.body.transcript).toContain(`${taskId}/transcript`);
    expect(res.body.writing).toContain(`${taskId}/writing`);
  });
});
```

确保测试期望与现有错误 JSON 风格保持一致（例如 `error` 字段名）。

**Step 3: Run tests to verify they fail**

```bash
npm test
# 或针对 HTTP 层的定向测试命令
```

确认新加的 `/api/tasks/:taskId/paths` 测试失败（路由未实现）。

**Step 4: Implement `/api/tasks/:taskId/paths` route using `core/paths`**

在 HTTP server 路由中实现逻辑：

- 从 `ctx.params.taskId` 取 `taskId`；
- 调用已有的 DB 层（例如 `db.getTaskById(taskId)`）检查任务是否存在；
- 不存在 → 设置 404 和错误 JSON；
- 存在 → 调用 `const { getTaskDirs } = require('../../core/paths');`；
  - `const dirs = getTaskDirs(taskId);`
  - 返回形如：

```js
ctx.body = {
  id: taskId,
  base: dirs.base,
  media: dirs.media,
  transcript: dirs.transcript,
  writing: dirs.writing,
};
```

确保路由前缀为 `/api/tasks/:taskId/paths`，与文档一致。

**Step 5: Run tests to verify they pass**

再次运行：

```bash
npm test
```

确认新加的 HTTP 测试通过，并且未破坏现有接口测试。

**Step 6: Commit**

```bash
git add services/http-server/index.js \
        services/http-server/routes/*.js \
        tests/**/paths*.test.js  # 按实际路径调整
git commit -m "feat(api): add GET /api/tasks/:taskId/paths endpoint"
```

---

### Task 3: Wire Electron main process IPC to open task folder

**Files:**
- Modify: `electron/src/main.js`
- Modify: `electron/src/preload.js`
- (Optional tests) Electron main/preload tests if they exist

**Step 1: Inspect current Electron IPC & shell usage**

阅读：

- `electron/src/main.js`：找到已有 `ipcMain.handle` / `ipcMain.on` 注册位置；
- `electron/src/preload.js`：查看 `contextBridge.exposeInMainWorld` 中已暴露的 API 格式；
- 确认是否已经在别处使用 `shell.openPath` 或类似 API。

**Step 2: Define IPC contract for `open-task-folder`**

决定 IPC 调用约定：

- channel：`open-task-folder`
- 请求参数：`taskId: string`
- 返回值：`{ ok: true }` 或 `{ ok: false, error: string }`

在 `preload.js` 中先写伪实现（或注释）声明接口（编译尚未通过也可以先写注释），例如：

```js
contextBridge.exposeInMainWorld('electron', {
  // ...
  openTaskFolder(taskId) {
    return ipcRenderer.invoke('open-task-folder', taskId);
  },
});
```

**Step 3: Implement `ipcMain.handle('open-task-folder', ...)` in main process**

在 `electron/src/main.js` 中：

- 引入 `ipcMain`、`shell`（如果尚未引入）；
- 实现 handler（伪代码示意）：

```js
const { ipcMain, shell } = require('electron');
const axios = require('axios'); // 或使用已有 HTTP 客户端
// 或者：const { getTaskDirs } = require('../../core/paths');

ipcMain.handle('open-task-folder', async (_event, taskId) => {
  try {
    // 方式 A：通过 HTTP API 获取路径
    const res = await axios.get(`http://localhost:3000/api/tasks/${taskId}/paths`);
    const base = res.data.base;

    const result = await shell.openPath(base);
    if (result) {
      // result 为错误字符串
      return { ok: false, error: result };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to open folder' };
  }
});
```

后续可以根据项目现有 HTTP client 封装/端口配置进行细化。

**Step 4: Ensure preload exposes `openTaskFolder` to renderer**

在 `electron/src/preload.js` 中实现实际函数（不再只是注释）：

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // ...已有方法
  openTaskFolder(taskId) {
    return ipcRenderer.invoke('open-task-folder', taskId);
  },
});
```

**Step 5: (Optional) Manual smoke test for IPC**

运行 Electron 应用：

```bash
bash start-electron.sh
# 或
cd electron && npm start
```

在 DevTools Console 中手动执行：

```js
window.electron.openTaskFolder('some-task-id').then(console.log);
```

观察是否能正常打开对应任务目录（需要有实际存在的 `taskId`）。

**Step 6: Commit**

```bash
git add electron/src/main.js electron/src/preload.js
git commit -m "feat(electron): add IPC to open task folder via agent paths API"
```

---

### Task 4: Connect renderer Open button to IPC

**Files:**
- Modify: `electron/src/renderer/index.html`（及其配套 JS）
- (Optional) Renderer JS file if split out (e.g. `electron/src/renderer/main.js`)

**Step 1: Locate the current “Open” button in renderer**

阅读 `electron/src/renderer/index.html`：

- 找到当前任务详情区域；
- 确认是否已有「Open」按钮，或需要新增一个按钮（例如在标题/URL 区附近）。

**Step 2: Add or refine the Open button markup**

在合适位置添加/调整按钮（示例）：

```html
<button id="open-task-folder-btn" disabled>Open Folder</button>
```

默认 `disabled`，仅在有选中任务时启用。

**Step 3: Wire selection state to button enabled/disabled**

在 renderer JS 逻辑中（例如内联 `<script>` 或单独 JS 文件）：

- 维护当前选中任务的 `taskId`（大概率已有）；
- 当任务选中变化时：
  - 更新内部状态；
  - 如果有选中任务 → `open-task-folder-btn.disabled = false`；
  - 否则 → `disabled = true`。

**Step 4: Hook click handler to call `window.electron.openTaskFolder`**

在同一 JS 里添加：

```js
const openBtn = document.getElementById('open-task-folder-btn');

openBtn.addEventListener('click', async () => {
  if (!currentTaskId) return;
  openBtn.disabled = true;
  try {
    const res = await window.electron.openTaskFolder(currentTaskId);
    if (!res || res.ok !== true) {
      // TODO: 用已有的 toast / 提示机制
      alert(res && res.error ? res.error : 'Failed to open task folder');
    }
  } catch (err) {
    alert(err.message || 'Failed to open task folder');
  } finally {
    openBtn.disabled = false;
  }
});
```

保证在无选中任务时不会发送 IPC 调用。

**Step 5: Manual end-to-end test in GUI**

1. 启动 agent HTTP 服务：

   ```bash
   npm run agent:serve
   ```

2. 启动 Electron：

   ```bash
   bash start-electron.sh
   ```

3. 在 GUI 中：

   - 创建一个新任务（输入 URL / FOCUS 等），等待任务至少完成到 `work/<id>/` 目录已存在；
   - 在左侧列表选中该任务；
   - 点击「Open Folder」按钮；
   - 确认系统文件管理器打开了带有 `media/`、`transcript/`、`writing/` 等子目录的 `work/<id>/`。

4. 在任务被删除或不存在的场景，验证按钮点击后能够看到合理的错误提示。

**Step 6: Commit**

```bash
git add electron/src/renderer/index.html
# 如果有独立 renderer JS 文件也一并加入
git add electron/src/renderer/*.js
git commit -m "feat(ui): wire Open button to open task folder via IPC"
```

---

### Task 5: Update docs & light regression checks

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md`
- (Optional) Modify: `docs/plans/2026-03-16-open-folder-paths-design.md`（若有需要微调）
- No code changes beyond docs

**Step 1: Update `docs/PROJECT_KNOWLEDGE.md` Agent HTTP Service section**

在「十二、Agent HTTP Service」中，路由表附近增加一行：

```markdown
| GET | `/api/tasks/:taskId/paths` | 返回该任务的路径信息（base/media/transcript/writing），供 Electron 或其它客户端打开本地目录使用。 |
```

同时在文字说明中简要说明该接口用途和与 `core/paths` 的关系（1–2 句即可）。

**Step 2: (Optional) Link from GUI layout/design doc**

在 `docs/plans/2026-03-12-gui-main-layout-polish-design.md` 中，如果有涉及主界面信息区的描述，可以在「InfoCard」或相关小节中加一句说明：

- 「Open 按钮通过 agent HTTP 的 `/api/tasks/:taskId/paths` + Electron IPC 打开 `work/<id>/` 目录。」

这一步是锦上添花，可选。

**Step 3: Run a quick regression check**

- 启动 agent HTTP 服务和 Electron，验证：
  - 原有任务创建/重试/删除流程仍可用；
  - Article / Summary / Media / Subtitles 相关功能正常；
  - 新增的 Open 按钮工作正常，不影响其它 UI。

**Step 4: Commit docs**

```bash
git add docs/PROJECT_KNOWLEDGE.md docs/plans/2026-03-16-open-folder-paths-design.md
git commit -m "docs: document task paths API and Open button behavior"
```

---

## Execution Handoff

Plan complete and ready to be saved as `docs/plans/2026-03-16-open-task-folder-paths-impl.md`.

Two execution options:

1. **Subagent-Driven (this session)**  
   我在当前会话里用「subagent-driven-development」按 Task 1 → Task 5 逐步实现，每个 Task 之间做一次小 review。

2. **Parallel Session (separate)**  
   你在新会话里启动 `superpowers:executing-plans`，把本计划当作输入，在独立 worktree 里批量执行。

你更倾向哪种方式？如果希望我现在就开始实现，也可以直接说「按这个计划开始实施」。  

