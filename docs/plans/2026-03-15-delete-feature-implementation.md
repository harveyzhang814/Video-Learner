# 主界面删除功能完善 - 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现三种删除方式（hard/state/soft），后端提供 DELETE API，前端确认弹窗支持半透明蒙版并在弹窗内切换删除方式，默认硬删除。

**Architecture:** 在 db 层增加 deleted_at 与 deleteTask/softDeleteTask；orchestrator 增加 deleteTask(taskId, { rootDir, mode })；HTTP 增加 DELETE /api/tasks/:taskId?mode=；前端增加确认弹窗 HTML、ServiceClient.deleteTask、删除后刷新与选中下一项。

**Tech Stack:** Node (better-sqlite3, fs), Koa, Vanilla JS (Electron renderer), 现有 modal 样式。

---

### Task 1: DB 层 - 增加 deleted_at 列与删除方法

**Files:**
- Modify: `core/orchestrator/db.js`

**Step 1: 在 initTables 中为 tasks 表增加 deleted_at 列（迁移）**

在 `initTables` 内、在现有 `transcripts` 迁移 try/catch 之后，增加：

```js
// Migration: add deleted_at for soft delete
try {
  const cols = db.prepare('PRAGMA table_info(tasks)').all();
  if (!cols.some((c) => c.name === 'deleted_at')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN deleted_at TEXT`);
  }
} catch (_) {
  // ignore
}
```

**Step 2: 修改 listTasks - 只返回未删除**

将 `listTasks` 内 SQL 的 `FROM tasks` 改为带条件：

```js
FROM tasks
WHERE deleted_at IS NULL
ORDER BY datetime(created_at) DESC, datetime(ts) DESC
LIMIT ?
```

**Step 3: 修改 getTask - 软删除任务返回 null**

将 `getTask(id)` 内查询改为：

```js
const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id);
```

**Step 4: 新增 deleteTask(id)**

在 `getTask` 之后、`updateTask` 之前增加：

```js
deleteTask(id) {
  db.prepare('DELETE FROM steps WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
},

softDeleteTask(id) {
  return db.prepare('UPDATE tasks SET deleted_at = datetime(\'now\') WHERE id = ?').run(id);
},
```

**Step 5: Commit**

```bash
git add core/orchestrator/db.js
git commit -m "feat(db): add deleted_at, deleteTask, softDeleteTask; list/get exclude soft-deleted"
```

---

### Task 2: Orchestrator - 实现 deleteTask(taskId, options)

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: 实现 deleteTask 函数**

在 `skipStep` 之后、`_dropTaskFromMemory` 之前添加：

```js
const VALID_DELETE_MODES = ['hard', 'state', 'soft'];

function deleteTask(taskId, options = {}) {
  const { rootDir, mode = 'hard' } = options;
  if (!VALID_DELETE_MODES.includes(mode)) {
    throw new Error(`invalid delete mode: ${mode}`);
  }
  const workDir = getWorkDir(rootDir, taskId);
  const db = rootDir ? ensureDb(rootDir) : null;

  if (mode === 'soft') {
    if (!db) throw new Error('rootDir required for delete');
    const row = db.getTask(taskId);
    if (!row) throw new Error(`task not found: ${taskId}`);
    db.softDeleteTask(taskId);
    tasks.delete(taskId);
    return;
  }

  // hard / state: need DB delete
  if (!db) throw new Error('rootDir required for delete');
  const row = db.getTask(taskId);
  if (!row) throw new Error(`task not found: ${taskId}`);
  db.deleteTask(taskId);
  tasks.delete(taskId);

  if (mode === 'hard' && fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true });
  }
}
```

注意：`db.getTask` 当前已过滤 `deleted_at IS NULL`，软删除任务 getTask 返回 null，因此 soft 分支里应用 `db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)` 或单独写一个不过滤 deleted_at 的 getTaskRaw（若存在）。为最小改动，可在 soft 分支中先查存在性：用 `db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)`，若存在再 softDeleteTask；否则 getTask 已对未删除的返回行，软删除后 getTask 会返回 null，所以「检查任务存在」在 soft 时可用 `db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)` 不依赖 deleted_at。采用：soft 分支里用 `db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)` 判断存在，存在则 `db.softDeleteTask(taskId)` 并 `tasks.delete(taskId)`。

修正上面 deleteTask 中 soft 分支为：

```js
if (mode === 'soft') {
  if (!db) throw new Error('rootDir required for delete');
  const row = db.getTask(taskId);
  if (!row) throw new Error(`task not found: ${taskId}`);
  db.softDeleteTask(taskId);
  tasks.delete(taskId);
  return;
}
```

（soft 分支用 `db.getTask(taskId)` 检查存在且未删除，与 hard/state 一致。）

**Step 2: 导出 deleteTask**

在 `module.exports` 中增加 `deleteTask`。

**Step 3: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): add deleteTask with mode hard/state/soft"
```

---

### Task 3: HTTP 服务 - 增加 DELETE /api/tasks/:taskId

**Files:**
- Modify: `services/http-server/index.js`

**Step 1: 添加 DELETE 路由**

在 `router.get('/tasks/:taskId', ...)` 之后添加：

```js
router.delete('/tasks/:taskId', async (ctx) => {
  const { taskId } = ctx.params;
  const mode = (ctx.query.mode || ctx.request.body?.mode || 'hard').toLowerCase();
  if (!['hard', 'state', 'soft'].includes(mode)) {
    ctx.status = 400;
    ctx.body = { error: 'invalid mode' };
    return;
  }
  try {
    await orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode });
    ctx.status = 204;
    ctx.body = null;
  } catch (err) {
    if (/task not found/.test(err.message)) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.body = { error: err.message || 'delete failed' };
  }
});
```

**Step 2: Commit**

```bash
git add services/http-server/index.js
git commit -m "feat(api): add DELETE /api/tasks/:taskId?mode=hard|state|soft"
```

---

### Task 4: Agent HTTP 测试 - 增加 DELETE 用例

**Files:**
- Modify: `tests/agent-http.test.js`

**Step 1: 在现有流程末尾增加 DELETE 测试**

在文件末尾、`run()` 调用之前或 `run()` 内最后一个断言之后，增加（使用已创建的 taskId）：

```js
// 5) Delete task (state mode: only DB, keep files)
const deleteRes = await fetch(base + `/api/tasks/${taskId}?mode=state`, { method: 'DELETE' });
if (deleteRes.status !== 204 && deleteRes.status !== 200) {
  const t = await deleteRes.text();
  throw new Error('delete task failed: ' + t);
}
console.log('[test] task deleted (state)');

// 6) GET after delete -> 404
const afterGet = await jsonRequest(`/api/tasks/${taskId}`);
if (afterGet.status !== 404) {
  throw new Error('expected 404 after delete, got ' + afterGet.status);
}
console.log('[test] get after delete returns 404');
```

**Step 2: 运行测试**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner && node tests/agent-http.test.js
```

预期：创建、轮询、steps、runStep 等原有逻辑仍通过，且 DELETE 返回 204/200，随后 GET 返回 404。

**Step 3: Commit**

```bash
git add tests/agent-http.test.js
git commit -m "test(agent-http): add DELETE and 404-after-delete check"
```

---

### Task 5: ServiceClient - 增加 deleteTask 方法

**Files:**
- Modify: `electron/src/renderer/service-client.js`

**Step 1: 添加 deleteTask**

在 `runStep` 方法之后、`subscribeEvents` 之前添加：

```js
deleteTask(taskId, { mode = 'hard' } = {}) {
  const q = new URLSearchParams({ mode }).toString();
  return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}?${q}`, { method: 'DELETE' });
}
```

说明：_fetchJson 对 204 可能无 body，需兼容。若 _fetchJson 在 res.ok 且 text 为空时返回 null，则无需改；若 204 导致抛错，可对 204 做特殊处理不解析 body。当前实现 `const text = await res.text();` 后 `data = text ? JSON.parse(text) : null`，204 时 text 为空则 data 为 null，res.ok 为 true 不抛，可行。

**Step 2: Commit**

```bash
git add electron/src/renderer/service-client.js
git commit -m "feat(renderer): ServiceClient.deleteTask(taskId, { mode })"
```

---

### Task 6: 前端 - 确认删除弹窗 HTML 与样式

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 在 newTaskModal 之后添加确认删除弹窗**

在 `</div>\n  </div>`（newTaskModal 的 modal 与 modal-overlay 的闭合标签）之后、`<script type="module">` 之前，插入：

```html
  <!-- Confirm Delete Modal: 半透明蒙版 + 弹窗 -->
  <div class="modal-overlay hidden" id="confirmDeleteModal">
    <div class="modal" style="width: 420px;">
      <div class="modal-content">
        <div class="modal-title">确认删除</div>
        <p style="color: var(--text-muted); margin: 0 0 12px 0;">选择删除方式后点击删除。硬删除将同时删除任务文件，且不可恢复。</p>
        <div class="delete-mode-options" style="margin-bottom: 16px;">
          <label class="radio-label" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <input type="radio" name="deleteMode" value="hard" checked />
            <span>硬删除：删除记录并删除该任务下所有文件（不可恢复）</span>
          </label>
          <label class="radio-label" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <input type="radio" name="deleteMode" value="state" />
            <span>仅删记录：只删除任务与步骤记录，保留文件</span>
          </label>
          <label class="radio-label" style="display: flex; align-items: center; gap: 8px;">
            <input type="radio" name="deleteMode" value="soft" />
            <span>标记删除：仅在列表中隐藏，不删记录与文件</span>
          </label>
        </div>
        <div class="modal-actions" style="justify-content: flex-end; margin-top: 16px;">
          <button class="btn" id="confirmDeleteCancel">取消</button>
          <button class="btn danger" id="confirmDeleteOk">删除</button>
        </div>
      </div>
    </div>
  </div>

```

**Step 2: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(renderer): add confirm delete modal HTML with mode options"
```

---

### Task 7: 前端 - 确认弹窗显示/关闭与删除逻辑

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 获取确认弹窗 DOM 引用**

在现有 `const deleteBtn = ...` 附近增加：

```js
const confirmDeleteModal = document.getElementById('confirmDeleteModal');
const confirmDeleteCancel = document.getElementById('confirmDeleteCancel');
const confirmDeleteOk = document.getElementById('confirmDeleteOk');
```

**Step 2: 暴露 showDeleteConfirm 并实现关闭逻辑**

在 script 中、可被 window 调用的位置添加（使用现有变量名 `currentTaskId`）：

```js
function showConfirmDelete() {
  if (!currentTaskId) return;
  confirmDeleteModal.classList.remove('hidden');
}
function hideConfirmDelete() {
  confirmDeleteModal.classList.add('hidden');
}
window.showDeleteConfirm = showConfirmDelete;
```

为确认弹窗绑定：取消按钮点击、点击蒙版关闭：

```js
confirmDeleteCancel.addEventListener('click', hideConfirmDelete);
confirmDeleteModal.addEventListener('click', (e) => {
  if (e.target === confirmDeleteModal) hideConfirmDelete();
});
```

**Step 3: 确认「删除」按钮：读 mode、调 API、刷新、选中下一项**

在 `confirmDeleteCancel` 的 addEventListener 之后添加。删除成功后清空当前任务状态、刷新列表，若有剩余任务则选中最后一项（`selectTask`），否则显示空状态并重置 info 区为 '-'：

```js
confirmDeleteOk.addEventListener('click', async () => {
  const modeEl = document.querySelector('input[name="deleteMode"]:checked');
  const mode = (modeEl && modeEl.value) || 'hard';
  const idToDelete = currentTaskId;
  hideConfirmDelete();
  if (!idToDelete) return;
  try {
    await client.deleteTask(idToDelete, { mode });
  } catch (e) {
    console.error('delete failed', e);
    alert(e.message || '删除失败');
    return;
  }
  currentTaskId = null;
  toolbar.classList.add('hidden');
  articleOutput.innerHTML = '';
  summaryOutput.innerHTML = '';
  emptyState.classList.remove('hidden');
  videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.classList.add('hidden');
  if (videoEmpty) videoEmpty.classList.remove('hidden');
  infoTitle.textContent = '-';
  infoUrl.textContent = '-';
  infoLang.textContent = '-';
  infoDuration.textContent = '-';
  infoFocus.textContent = '-';
  ['fetch','video','audio','subs','vtt2md','md2vtt','article','summary'].forEach(s => setPillState('#infoStatus', s, {}));
  await refreshHistory();
  const works = await client.listTasks({ limit: 200 });
  if (works && works.length > 0) {
    const last = works[works.length - 1];
    await selectTask(last.id);
  }
});
```

（与现有 index.html 命名一致。清空 status pills 可遍历 `['fetch','video','audio','subs','vtt2md','md2vtt','article','summary']` 对每步调用 `setPillState('#infoStatus', step, {})`，或若有 `resetInfoStatusPills` 则调用之。）

**Step 4: 启用 Delete 按钮**

删除或注释掉禁用 Delete 按钮的两行：

```js
// deleteBtn.disabled = true;
// deleteBtn.title = '暂不可用：需后续通过 HTTP API 暴露「删除任务」';
```

改为不设置 disabled；可选设置 `deleteBtn.title = '删除当前任务'`。

**Step 5: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(renderer): wire confirm delete modal, deleteTask API, and post-delete refresh"
```

---

### Task 8: 手动验证与文档更新

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md`（可选）

**Step 1: 启动 Electron 做手动验证**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner && bash start-electron.sh
```

验证：选中一项 → 点 Delete → 弹窗为半透明蒙版+弹窗、默认硬删除、可切换三种方式 → 取消关闭 → 再点删除选「仅删记录」执行 → 列表刷新、选中下一项或空状态；再选一项做「标记删除」→ 该任务从列表消失。

**Step 2: 在 PROJECT_KNOWLEDGE 的 Agent HTTP Service 路由表中增加 DELETE 行**

在「主要路由」表格中增加一行：

| DELETE | `/api/tasks/:taskId` | 删除任务（query: mode=hard\|state\|soft，默认 hard）；成功 204。 |

**Step 3: Commit**

```bash
git add docs/PROJECT_KNOWLEDGE.md
git commit -m "docs: add DELETE /api/tasks/:taskId to agent service routes"
```

---

## 执行选项

计划已保存到 `docs/plans/2026-03-15-delete-feature-implementation.md`。可选执行方式：

1. **Subagent-Driven（本会话）**：按任务分派子 agent，每步完成后你做 review，再进入下一步。
2. **独立会话**：在新会话中打开该计划，使用 executing-plans 按任务执行并在检查点做验证。

若选 1，请使用 subagent-driven-development；若选 2，在新会话中粘贴本计划并说明使用 executing-plans。
