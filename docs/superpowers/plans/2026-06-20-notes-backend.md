# 笔记后端 实施计划

**目标：** 将笔记从浏览器 localStorage 迁移到后端，存储为 `work/<taskId>/notes.json`，支持增删改查。

**架构：** `core/paths.js` 新增 notes 路径；Koa HTTP server 新增 4 条路由（GET/POST/PATCH/DELETE）；前端 `api.ts` + `use-tasks.ts` 新增 notes 方法和 hooks；`notes-panel.tsx` 替换 localStorage 为 react-query。

**技术栈：** Node.js fs/promises, Koa, React Query, TypeScript

---

### Task 1: 扩展 core/paths.js — 新增 notes 路径

**文件：**
- 修改: `core/paths.js`

- [ ] **Step 1: 在 getTaskDirs 返回值中添加 notes 字段**

找到 `getTaskDirs` 函数的 return 语句，添加 `notes` 字段：

```js
function getTaskDirs(rootDir, taskId) {
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('getTaskDirs requires a non-empty taskId string');
  }
  const workRoot = getWorkRoot(rootDir);
  const base = path.join(workRoot, taskId);
  return {
    base,
    media:      path.join(base, 'media'),
    transcript: path.join(base, 'transcript'),
    writing:    path.join(base, 'writing'),
    notes:      path.join(base, 'notes.json'),
  };
}
```

- [ ] **Step 2: 验证**

```bash
node -e "
const { getTaskDirs } = require('./core/paths');
const d = getTaskDirs('/tmp/test', 'abc123');
console.log(d.notes);
"
```

预期输出：`/tmp/test/work/abc123/notes.json`

- [ ] **Step 3: 提交**

```bash
git add core/paths.js
git commit -m "feat(core): add notes.json path to getTaskDirs"
```

---

### Task 2: 后端 — 4 条笔记 API 路由

**文件：**
- 修改: `services/http-server/index.js`

在文件顶部已有 `const { getTaskDirs } = require('../../core/paths');`，无需额外 import。需要 `require('node:fs/promises')` 和 `require('node:crypto')`——检查文件顶部是否已引入，若无则添加。

- [ ] **Step 1: 在文件顶部添加缺失的 require**

在 `services/http-server/index.js` 顶部（现有 require 区域）检查并按需添加：

```js
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
```

- [ ] **Step 2: 添加 notes 辅助函数（在路由注册前）**

在 `module.exports` 或路由注册函数体内、第一条路由之前，添加：

```js
// ── Notes helpers ────────────────────────────────────────────────────────────
async function readNotes(notesPath) {
  try {
    const raw = await fs.readFile(notesPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeNotes(notesPath, notes) {
  const tmp = notesPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(notes, null, 2), 'utf8');
  await fs.rename(tmp, notesPath);
}
```

- [ ] **Step 3: 添加 GET /tasks/:taskId/notes 路由**

在 `router.get('/tasks/:taskId/subtitles', ...)` 之后添加：

```js
router.get('/tasks/:taskId/notes', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    const metaId = task?.meta?.id ?? taskId;
    const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
    const notes = await readNotes(notesPath);
    ctx.body = notes;
  } catch (err) {
    if (/task not found/.test(err.message || '')) { ctx.status = 404; }
    else { ctx.status = 500; }
    ctx.body = { error: err.message || 'failed to get notes' };
  }
});
```

- [ ] **Step 4: 添加 POST /tasks/:taskId/notes 路由**

```js
router.post('/tasks/:taskId/notes', async (ctx) => {
  const { taskId } = ctx.params;
  const { anchor = '', mediaTimestamp, body } = ctx.request.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    ctx.status = 400;
    ctx.body = { error: 'body is required' };
    return;
  }
  try {
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    const metaId = task?.meta?.id ?? taskId;
    const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
    const notes = await readNotes(notesPath);
    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      anchor: anchor || '',
      ...(mediaTimestamp != null ? { mediaTimestamp: Number(mediaTimestamp) } : {}),
      body: body.trim(),
      createdAt: now,
      updatedAt: now,
    };
    notes.unshift(note);
    await writeNotes(notesPath, notes);
    ctx.status = 201;
    ctx.body = note;
  } catch (err) {
    if (/task not found/.test(err.message || '')) { ctx.status = 404; }
    else { ctx.status = 500; }
    ctx.body = { error: err.message || 'failed to create note' };
  }
});
```

- [ ] **Step 5: 添加 PATCH /tasks/:taskId/notes/:noteId 路由**

```js
router.patch('/tasks/:taskId/notes/:noteId', async (ctx) => {
  const { taskId, noteId } = ctx.params;
  const { body } = ctx.request.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    ctx.status = 400;
    ctx.body = { error: 'body is required' };
    return;
  }
  try {
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    const metaId = task?.meta?.id ?? taskId;
    const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
    const notes = await readNotes(notesPath);
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
    notes[idx] = { ...notes[idx], body: body.trim(), updatedAt: Date.now() };
    await writeNotes(notesPath, notes);
    ctx.body = notes[idx];
  } catch (err) {
    if (/task not found/.test(err.message || '')) { ctx.status = 404; }
    else { ctx.status = 500; }
    ctx.body = { error: err.message || 'failed to update note' };
  }
});
```

- [ ] **Step 6: 添加 DELETE /tasks/:taskId/notes/:noteId 路由**

```js
router.delete('/tasks/:taskId/notes/:noteId', async (ctx) => {
  const { taskId, noteId } = ctx.params;
  try {
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    const metaId = task?.meta?.id ?? taskId;
    const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
    const notes = await readNotes(notesPath);
    const filtered = notes.filter((n) => n.id !== noteId);
    if (filtered.length === notes.length) {
      ctx.status = 404; ctx.body = { error: 'note not found' }; return;
    }
    await writeNotes(notesPath, filtered);
    ctx.status = 204;
  } catch (err) {
    if (/task not found/.test(err.message || '')) { ctx.status = 404; }
    else { ctx.status = 500; }
    ctx.body = { error: err.message || 'failed to delete note' };
  }
});
```

- [ ] **Step 7: 手动验证 API（需要后端已运行）**

```bash
TOKEN=$(curl -s http://127.0.0.1:3000/ | grep -o 'content="[a-f0-9]*"' | tail -1 | cut -d'"' -f2)
TASK=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/tasks | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d)[0].id)")

# GET (空)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/tasks/$TASK/notes

# POST
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"测试笔记","mediaTimestamp":42}' \
  http://127.0.0.1:3000/api/tasks/$TASK/notes

# GET (应有1条)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/tasks/$TASK/notes
```

预期：POST 返回 `{"id":"...","body":"测试笔记","mediaTimestamp":42,...}`，GET 返回含该条的数组。

- [ ] **Step 8: 提交**

```bash
git add services/http-server/index.js
git commit -m "feat(http): add notes CRUD endpoints (GET/POST/PATCH/DELETE)"
```

---

### Task 3: 前端 api.ts — 新增 notes 方法

**文件：**
- 修改: `web/src/lib/api.ts`

- [ ] **Step 1: 在 api.ts 顶部添加 Note 类型**

在现有 `export interface MediaInfo` 之前添加：

```ts
export interface Note {
  id: string;
  anchor: string;
  mediaTimestamp?: number;
  body: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: 在 api 对象中添加 4 个 notes 方法**

在 `reveal: ...` 之后添加：

```ts
  listNotes: (taskId: string) =>
    request<Note[]>(`/api/tasks/${taskId}/notes`),

  addNote: (taskId: string, data: { anchor?: string; mediaTimestamp?: number; body: string }) =>
    request<Note>(`/api/tasks/${taskId}/notes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateNote: (taskId: string, noteId: string, data: { body: string }) =>
    request<Note>(`/api/tasks/${taskId}/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteNote: (taskId: string, noteId: string) =>
    request<void>(`/api/tasks/${taskId}/notes/${noteId}`, { method: 'DELETE' }),
```

- [ ] **Step 3: TypeScript 检查**

```bash
cd web && npx tsc --noEmit 2>&1 | grep api.ts
```

预期：无输出

- [ ] **Step 4: 提交**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): add notes API methods to api.ts"
```

---

### Task 4: 前端 use-tasks.ts — 新增 notes hooks

**文件：**
- 修改: `web/src/hooks/use-tasks.ts`

- [ ] **Step 1: 添加 Note 类型 import**

在现有 import 行添加 `Note`：

```ts
import { api, type Task, type Note } from '@/lib/api';
```

- [ ] **Step 2: 在文件末尾追加 3 个 hooks**

```ts
export function useNotes(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task', taskId, 'notes'],
    queryFn: () => api.listNotes(taskId!),
    enabled: Boolean(taskId),
    staleTime: 0,
  });
}

export function useAddNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { anchor?: string; mediaTimestamp?: number; body: string }) =>
      api.addNote(taskId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId, 'notes'] }),
  });
}

export function useUpdateNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      api.updateNote(taskId, noteId, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId, 'notes'] }),
  });
}

export function useDeleteNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.deleteNote(taskId, noteId),
    onMutate: async (noteId) => {
      await qc.cancelQueries({ queryKey: ['task', taskId, 'notes'] });
      const prev = qc.getQueryData<Note[]>(['task', taskId, 'notes']);
      qc.setQueryData<Note[]>(
        ['task', taskId, 'notes'],
        (old) => (old ?? []).filter((n) => n.id !== noteId)
      );
      return { prev };
    },
    onError: (_err, _noteId, ctx) => {
      if (ctx?.prev) qc.setQueryData(['task', taskId, 'notes'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['task', taskId, 'notes'] }),
  });
}
```

- [ ] **Step 3: TypeScript 检查**

```bash
cd web && npx tsc --noEmit 2>&1 | grep use-tasks
```

预期：无输出

- [ ] **Step 4: 提交**

```bash
git add web/src/hooks/use-tasks.ts
git commit -m "feat(web): add useNotes/useAddNote/useUpdateNote/useDeleteNote hooks"
```

---

### Task 5: 前端 notes-panel.tsx — 替换 localStorage，支持编辑

**文件：**
- 修改: `web/src/components/notes-panel.tsx`

完整替换文件内容：

- [ ] **Step 1: 重写 notes-panel.tsx**

```tsx
import { useState } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { useNotes, useAddNote, useUpdateNote, useDeleteNote } from '@/hooks/use-tasks';
import type { Note } from '@/lib/api';

interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
}

function NoteItem({
  note,
  onUpdate,
  onDelete,
}: {
  note: Note;
  onUpdate: (body: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);

  const save = () => {
    if (draft.trim() && draft.trim() !== note.body) onUpdate(draft.trim());
    setEditing(false);
  };

  const cancel = () => {
    setDraft(note.body);
    setEditing(false);
  };

  return (
    <li className="px-4 py-3 group" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {note.mediaTimestamp !== undefined && (
        <div className="text-xs mb-1" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
          @ {formatDuration(note.mediaTimestamp)}
        </div>
      )}

      {editing ? (
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={save}
          className="w-full text-xs resize-none rounded p-2 outline-none"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--accent-9)',
            lineHeight: 1.6,
          }}
        />
      ) : (
        <p
          className="text-xs leading-relaxed cursor-text"
          style={{ color: 'var(--text-primary)' }}
          onClick={() => setEditing(true)}
        >
          {note.body}
        </p>
      )}

      {!editing && (
        <div className="mt-1 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="text-xs cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className="text-xs cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            删除
          </button>
        </div>
      )}
    </li>
  );
}

export function NotesPanel({ taskId, hasMedia }: NotesPanelProps) {
  const [draft, setDraft] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);

  const { data: notes = [], isLoading } = useNotes(taskId);
  const addNote = useAddNote(taskId);
  const updateNote = useUpdateNote(taskId);
  const deleteNote = useDeleteNote(taskId);

  const submit = () => {
    if (!draft.trim()) return;
    addNote.mutate({
      body: draft.trim(),
      ...(hasMedia && currentTime > 0 ? { mediaTimestamp: Math.floor(currentTime) } : {}),
    });
    setDraft('');
  };

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="px-4 py-2.5 border-b text-xs font-medium"
           style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
        笔记 {notes.length > 0 && (
          <span style={{ color: 'var(--text-tertiary)' }}>· {notes.length}</span>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder="⌘↵ 保存笔记…"
          className="w-full text-xs resize-none rounded p-2 outline-none"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            lineHeight: 1.6,
          }}
        />
        {hasMedia && currentTime > 0 && (
          <div className="mt-1 text-xs" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
            @ {formatDuration(currentTime)}
          </div>
        )}
      </div>

      {/* Note list */}
      <ul className="flex-1 overflow-y-auto py-2">
        {isLoading && (
          <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            加载中…
          </li>
        )}
        {!isLoading && notes.length === 0 && (
          <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            暂无笔记
          </li>
        )}
        {notes.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
            onDelete={() => deleteNote.mutate(note.id)}
          />
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 检查**

```bash
cd web && npx tsc --noEmit 2>&1
```

预期：0 错误

- [ ] **Step 3: 提交**

```bash
git add web/src/components/notes-panel.tsx
git commit -m "feat(web): migrate NotesPanel from localStorage to backend API"
```

---

## 自检清单

### 1. 规格覆盖

| 需求 | 任务 |
|------|------|
| `notes.json` 路径 | Task 1 |
| GET 列出笔记 | Task 2 Step 3 |
| POST 创建笔记（含时间戳）| Task 2 Step 4 |
| PATCH 修改笔记 | Task 2 Step 5 |
| DELETE 删除笔记 | Task 2 Step 6 |
| 前端 Note 类型 | Task 3 Step 1 |
| api.ts 4 个方法 | Task 3 Step 2 |
| react-query hooks | Task 4 Step 2 |
| 乐观删除 | Task 4 Step 2 (useDeleteNote onMutate) |
| 点击编辑 inline | Task 5 Step 1 (NoteItem) |
| ⌘↵ 保存 / Esc 取消 | Task 5 Step 1 |

### 2. 占位符扫描

无 TBD / TODO。

### 3. 类型一致性

- `Note` 在 `api.ts` 定义，`use-tasks.ts` 和 `notes-panel.tsx` 均从 `@/lib/api` import
- `useAddNote` / `useUpdateNote` / `useDeleteNote` 的 mutationFn 签名与 `api.ts` 方法一致
- `onMutate` 的乐观更新类型标注为 `Note[]`，与 `useNotes` 返回类型一致
