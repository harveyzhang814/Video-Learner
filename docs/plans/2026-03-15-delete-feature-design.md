# 主界面删除功能完善设计（前端 + Agent Service）

> 方案：GUI 默认硬删除，确认弹窗内可切换删除方式；API 与后端支持三种 mode（hard / state / soft）。

---

## 1. 删除语义（A/B/C 通过参数）

| mode   | 说明 |
|--------|------|
| **hard**  | 删除 DB 记录（tasks + steps）+ 物理删除 `work/<id>/` 目录，不可恢复。 |
| **state** | 仅删除 DB 记录，保留 `work/<id>/` 目录下所有文件。 |
| **soft**  | 仅标记删除（DB 设 `deleted_at`），不删目录、不删行；列表与单任务查询均不可见（统一按「已删除」处理）。 |

---

## 2. API 与后端

### 2.1 HTTP 接口

- **方法/路径**：`DELETE /api/tasks/:taskId`
- **参数**：`mode` 通过 **query** 传递，取值 `hard` \| `state` \| `soft`，缺省为 `hard`。
- **成功**：`204 No Content` 或 `200 { ok: true }`。
- **失败**：任务不存在 → `404`；`mode` 非法 → `400`；其它 → `500`，body `{ error: "..." }`。

### 2.2 core/orchestrator

- 新增并导出 **deleteTask(taskId, options)**，`options = { rootDir, mode: 'hard'|'state'|'soft' }`。
  - **hard**：内存移除 → 删 DB（先 steps 后 tasks）→ `fs.rmSync(workDir, { recursive: true })`。
  - **state**：内存移除 → 删 DB，不删目录。
  - **soft**：内存移除 → 仅调用 `db.softDeleteTask(id)`，不删目录、不删 steps 行。
- 任务不存在（DB 无记录）时抛错，由 HTTP 层返回 404。

### 2.3 core/orchestrator/db.js

- 新增 **deleteTask(id)**：`DELETE FROM steps WHERE task_id=?`，再 `DELETE FROM tasks WHERE id=?`（供 hard/state）。
- 新增 **softDeleteTask(id)**：`UPDATE tasks SET deleted_at = datetime('now') WHERE id = ?`。
- **表结构**：在 `tasks` 表增加 `deleted_at TEXT`（可为 NULL）。在 `initTables` 或现有迁移逻辑中做 `ALTER TABLE` 兼容；无该列时视为未删除。
- **listTasks**：只返回 `WHERE deleted_at IS NULL`（或等效）。
- **getTask(id)**：若该任务 `deleted_at IS NOT NULL`，返回 null（由上层转 404）。**统一规则**：软删除后列表不展示，GET 单任务也返回 404。

### 2.4 index.jsonl

- **hard**：删除目录后不修改 `work/index.jsonl`（保留审计）。
- **state / soft**：不删目录，不改动 index.jsonl。

---

## 3. 前端（确认弹窗 + 调用 + 删除后行为）

### 3.1 确认弹窗 UI

- **结构**：半透明覆盖蒙版 + 弹窗，与现有 `newTaskModal` 一致。使用 `.modal-overlay` 全屏半透明蒙版（如 `rgba(0,0,0,0.4)`），点击蒙版关闭；中间 `.modal` 弹窗。
- **标题**：确认删除。
- **说明**：一句短说明，例如「选择删除方式后点击删除。硬删除将同时删除任务文件，且不可恢复。」
- **删除方式**（三选一，默认「硬删除」）：
  - **硬删除**：删除任务记录并删除该任务下所有文件（不可恢复）。
  - **仅删记录**：只删除任务与步骤记录，保留文件。
  - **标记删除**：仅在列表中隐藏，不删记录与文件。
- **控件**：单选用 `<input type="radio" name="deleteMode">` 或 `<select>`，默认选中 `hard`。
- **按钮**：取消（左）、删除（右，`.btn.danger`）。

### 3.2 前端逻辑

- Delete 按钮**启用**，点击调用 `window.showDeleteConfirm()`，打开确认弹窗。打开前若 `currentId` 为空则直接 return，不打开弹窗。
- 取消 / 点击蒙版 / Esc：关闭弹窗，不请求 API。
- 点击「删除」：读取当前选中的 `mode` → `client.deleteTask(currentId, { mode })` → 关闭弹窗；失败则提示错误，不刷新列表；成功则执行删除后行为。

### 3.3 ServiceClient

- **deleteTask(taskId, { mode = 'hard' } = {})**：请求 `DELETE /api/tasks/${taskId}?mode=${mode}`，成功按 204/200 处理，失败与现有 `_fetchJson` 一致抛错。

### 3.4 删除成功后的行为

- 清空当前选中、清空 URL/Focus/Article/Summary/视频等展示。
- 调用现有 `refreshHistory()` 重拉列表。
- 若列表仍有任务，选中并加载最后一个；若为空，显示空状态。

---

## 4. 错误处理与边界

- **API**：任务不存在 → 404；`mode` 非法 → 400；运行中任务允许删除（不阻止）。
- **前端**：请求失败时提示错误，不刷新、不切换选中；无 `currentId` 时不打开弹窗。
- **软删除**：`listTasks` 与 `GET /api/tasks/:taskId` 对已软删除任务统一不可见（GET 返回 404）。

---

## 5. 实现注意点（供实现计划使用）

- 修改范围：`core/orchestrator/index.js`、`core/orchestrator/db.js`、`services/http-server/index.js`、`electron/src/renderer/service-client.js`、`electron/src/renderer/index.html`。
- DB 迁移：新增 `deleted_at` 列时兼容已有库，`listTasks` / `getTask` 需过滤或返回 null。
- 确认弹窗 HTML 放在 `newTaskModal` 之后，复用现有 modal 样式与 `.hidden` 控制显隐。
