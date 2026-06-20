# Article Anchor Notes 实施计划

**目标：** 支持用户在文章中划选文字后创建绑定笔记，笔记卡片在 notes-col 中与锚点文字 Y 位置对齐

**架构：** 选区气泡（reader.tsx） → pendingAnchor 状态（tasks.$id.tsx 协调） → NotesPanel 绝对定位卡片 + 推挤算法（anchor-layout.ts 纯函数）

**技术栈：** React, TypeScript, ResizeObserver, TreeWalker, useLayoutEffect

---

### Task 1: 推挤算法纯函数

**文件：**
- 创建: `web/src/lib/anchor-layout.ts`
- 测试: `web/src/lib/anchor-layout.test.ts`（Vitest）

- [ ] **Step 1: 编写失败测试**

```typescript
// web/src/lib/anchor-layout.test.ts
import { describe, it, expect } from 'vitest';
import { computePositions } from './anchor-layout';

describe('computePositions', () => {
  it('returns anchorY unchanged when no collision', () => {
    const notes = [
      { id: 'a', anchorY: 0,   height: 60 },
      { id: 'b', anchorY: 200, height: 60 },
    ];
    const result = computePositions(notes, 8);
    expect(result[0].top).toBe(0);
    expect(result[1].top).toBe(200);
  });

  it('pushes second card down on collision', () => {
    const notes = [
      { id: 'a', anchorY: 100, height: 80 },
      { id: 'b', anchorY: 140, height: 80 },  // overlaps
    ];
    const result = computePositions(notes, 8);
    expect(result[0].top).toBe(100);
    expect(result[1].top).toBe(188);  // 100 + 80 + 8
  });

  it('chains: three cards cascade', () => {
    const notes = [
      { id: 'a', anchorY: 0,  height: 60 },
      { id: 'b', anchorY: 10, height: 60 },
      { id: 'c', anchorY: 20, height: 60 },
    ];
    const result = computePositions(notes, 8);
    expect(result[0].top).toBe(0);
    expect(result[1].top).toBe(68);   // 0 + 60 + 8
    expect(result[2].top).toBe(136);  // 68 + 60 + 8
  });

  it('returns empty array for empty input', () => {
    expect(computePositions([], 8)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/lib/anchor-layout.test.ts
```

预期: FAIL（文件不存在）

- [ ] **Step 3: 实现算法**

```typescript
// web/src/lib/anchor-layout.ts
export interface NoteLayout {
  id: string;
  anchorY: number;
  height: number;
}

export interface NotePosition {
  id: string;
  top: number;
}

export function computePositions(notes: NoteLayout[], gap: number): NotePosition[] {
  const sorted = [...notes].sort((a, b) => a.anchorY - b.anchorY);
  let cursor = 0;
  return sorted.map((note) => {
    const top = Math.max(note.anchorY, cursor);
    cursor = top + note.height + gap;
    return { id: note.id, top };
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/lib/anchor-layout.test.ts
```

预期: PASS (4 tests)

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/anchor-layout.ts web/src/lib/anchor-layout.test.ts
git commit -m "feat(notes): add anchor push-down layout algorithm"
```

---

### Task 2: CSS — notes-col 去掉独立滚动

**文件：**
- 修改: `web/src/styles/globals.css`

notes-col 当前有 `overflow-y: auto`（第 133 行），必须去掉，让它与 article-col 共享外层滚动容器（`flex-1 overflow-y-auto` div，位于 `tasks.$id.tsx` 第 141 行）。

- [ ] **Step 1: 修改 CSS**

在 `web/src/styles/globals.css` 中，将 `.notes-col` 块从：

```css
.notes-col {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-subtle);
  padding: 16px 16px 16px 20px;
  overflow-y: auto;
}
```

改为：

```css
.notes-col {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-subtle);
  padding: 0;
  position: relative;
}
```

padding 移入 NotesPanel 内部控制（Task 4 处理）。

- [ ] **Step 2: 构建并目测检查**

```bash
cd web && npm run build
```

启动 dev server 确认现有 notes-col 显示正常（无内容溢出，无滚动条消失）。

- [ ] **Step 3: 提交**

```bash
git add web/src/styles/globals.css
git commit -m "feat(notes): remove independent scroll from notes-col for shared container"
```

---

### Task 3: Reader — 选区监听 + 气泡

**文件：**
- 修改: `web/src/components/reader.tsx`

为 `Reader` 添加 `onAnchorSelect` 回调 prop，内部监听 `mouseup`，检测选区并通知父组件。气泡在 Reader 内部渲染（`position: fixed`）。

- [ ] **Step 1: 修改 reader.tsx**

```typescript
// web/src/components/reader.tsx
import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MermaidChart } from './mermaid-chart';

interface ReaderProps {
  content: string;
  onAnchorSelect?: (anchor: string) => void;
}

const components: Components = {
  code({ className, children, ...props }) {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    if (lang === 'mermaid') {
      return <MermaidChart code={String(children).trim()} />;
    }
    return <code className={className} {...props}>{children}</code>;
  },
};

export function Reader({ content, onAnchorSelect }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  const articleRef = useRef<HTMLElement>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number; anchor: string } | null>(null);

  const handleMouseUp = useCallback(() => {
    if (!onAnchorSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (!text) return;
    // Check selection is inside article
    const range = sel.getRangeAt(0);
    if (!articleRef.current?.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    setBubble({ x: rect.right, y: rect.top, anchor: text.slice(0, 80) });
  }, [onAnchorSelect]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (bubble && !(e.target as Element).closest('.anchor-bubble')) {
        setBubble(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setBubble(null); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [bubble]);

  const handleBubbleClick = () => {
    if (!bubble) return;
    onAnchorSelect?.(bubble.anchor);
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  };

  return (
    <>
      <article ref={articleRef} className="prose-cn" onMouseUp={handleMouseUp}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
          {md}
        </ReactMarkdown>
      </article>

      {bubble && (
        <button
          className="anchor-bubble"
          onClick={handleBubbleClick}
          style={{
            position: 'fixed',
            left: bubble.x + 6,
            top: bubble.y - 4,
            zIndex: 50,
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'var(--accent-9)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          }}
        >
          📝 记笔记
        </button>
      )}
    </>
  );
}
```

- [ ] **Step 2: 目测测试气泡**

启动 dev server，打开一个有文章内容的任务，划选文字，确认气泡出现在选区右上角，点击后气泡消失。

- [ ] **Step 3: 提交**

```bash
git add web/src/components/reader.tsx
git commit -m "feat(notes): add selection bubble to Reader for anchor capture"
```

---

### Task 4: tasks.$id.tsx — 协调 pendingAnchor + articleRef

**文件：**
- 修改: `web/src/routes/tasks.$id.tsx`

添加 `pendingAnchor` 状态和 `articleRef`，将两者传给 NotesPanel，将 `onAnchorSelect` 传给 Reader。

- [ ] **Step 1: 修改 tasks.$id.tsx**

在 `tasks.$id.tsx` 中：

1. 添加 import：`import { useRef, useState } from 'react'` （已有 useRef、useState，无需重复）
2. 添加状态（第 28 行后）：
```typescript
const [pendingAnchor, setPendingAnchor] = useState<string>('');
const articleRef = useRef<HTMLDivElement>(null);
```

3. 两处 `<Reader content={content} />` 替换为：
```tsx
<Reader
  content={content}
  onAnchorSelect={(anchor) => {
    setPendingAnchor(anchor);
    // NotesPanel input focus is triggered via prop change
  }}
/>
```

4. `notes-col` 内的 `<NotesPanel>` 替换为：
```tsx
<NotesPanel
  taskId={id}
  hasMedia={!!mediaKind}
  pendingAnchor={pendingAnchor}
  onAnchorConsumed={() => setPendingAnchor('')}
  articleRef={articleRef}
/>
```

5. `.article-col` div 添加 `ref={articleRef}`：
```tsx
<div className="article-col" ref={articleRef}>
```

- [ ] **Step 2: 提交**

```bash
git add web/src/routes/tasks.$id.tsx
git commit -m "feat(notes): wire pendingAnchor and articleRef through task route"
```

---

### Task 5: NotesPanel 重构 — 绝对定位 + 推挤

**文件：**
- 修改: `web/src/components/notes-panel.tsx`

这是最核心的改动。接收 `pendingAnchor`、`onAnchorConsumed`、`articleRef` 三个新 prop。

- [ ] **Step 1: 完整重写 NotesPanel**

```typescript
// web/src/components/notes-panel.tsx
import { useState, useRef, useEffect, useLayoutEffect, useCallback, RefObject } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { useNotes, useAddNote, useUpdateNote, useDeleteNote } from '@/hooks/use-tasks';
import { computePositions } from '@/lib/anchor-layout';
import type { Note } from '@/lib/api';

interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
  pendingAnchor?: string;
  onAnchorConsumed?: () => void;
  articleRef?: RefObject<HTMLDivElement>;
}

// Resolve anchor text to Y offset relative to articleEl's top (scroll-adjusted)
function resolveAnchorY(anchor: string, articleEl: HTMLElement): number | null {
  const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.includes(anchor)) {
      let el: HTMLElement | null = node.parentElement;
      while (el && !['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE'].includes(el.tagName)) {
        el = el.parentElement;
      }
      if (!el) return null;
      const elRect = el.getBoundingClientRect();
      const artRect = articleEl.getBoundingClientRect();
      return elRect.top - artRect.top + articleEl.scrollTop;
    }
  }
  return null;
}

function NoteItem({
  note,
  onUpdate,
  onDelete,
  onHeightChange,
}: {
  note: Note;
  onUpdate: (body: string) => void;
  onDelete: () => void;
  onHeightChange: (id: string, h: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!liRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      onHeightChange(note.id, entry.contentRect.height);
    });
    ro.observe(liRef.current);
    return () => ro.disconnect();
  }, [note.id, onHeightChange]);

  const save = () => {
    if (draft.trim() && draft.trim() !== note.body) onUpdate(draft.trim());
    setEditing(false);
  };
  const cancel = () => { setDraft(note.body); setEditing(false); };

  return (
    <li
      ref={liRef}
      className="px-4 py-3 group"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
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
          <button onClick={() => setEditing(true)} className="text-xs cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>编辑</button>
          <button onClick={onDelete} className="text-xs cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>删除</button>
        </div>
      )}
    </li>
  );
}

const ESTIMATED_HEIGHT = 72;
const GAP = 8;

export function NotesPanel({ taskId, hasMedia, pendingAnchor, onAnchorConsumed, articleRef }: NotesPanelProps) {
  const [draft, setDraft] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: notes = [], isLoading } = useNotes(taskId);
  const addNote = useAddNote(taskId);
  const updateNote = useUpdateNote(taskId);
  const deleteNote = useDeleteNote(taskId);

  // Heights map: noteId → measured px
  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeightChange = useCallback((id: string, h: number) => {
    setHeights((prev) => prev[id] === h ? prev : { ...prev, [id]: h });
  }, []);

  // Resolved positions: noteId → top px (computed by layout effect)
  const [positions, setPositions] = useState<Record<string, number>>({});
  // Article height for the anchored zone container
  const [articleHeight, setArticleHeight] = useState(0);

  // Focus input when pendingAnchor arrives
  useEffect(() => {
    if (pendingAnchor) inputRef.current?.focus();
  }, [pendingAnchor]);

  // Sync article height via ResizeObserver
  useEffect(() => {
    const el = articleRef?.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArticleHeight(el.scrollHeight));
    ro.observe(el);
    setArticleHeight(el.scrollHeight);
    return () => ro.disconnect();
  }, [articleRef]);

  // Recompute positions synchronously before paint
  useLayoutEffect(() => {
    const el = articleRef?.current;
    if (!el) return;
    const anchored = notes.filter((n) => n.anchor);
    const layouts = anchored.map((n) => {
      const anchorY = resolveAnchorY(n.anchor, el) ?? 0;
      const height = heights[n.id] ?? ESTIMATED_HEIGHT;
      return { id: n.id, anchorY, height };
    });
    const computed = computePositions(layouts, GAP);
    const next: Record<string, number> = {};
    computed.forEach((p) => { next[p.id] = p.top; });
    setPositions(next);
  }, [notes, heights, articleRef, articleHeight]);

  const submit = () => {
    if (!draft.trim()) return;
    addNote.mutate({
      body: draft.trim(),
      anchor: pendingAnchor ?? '',
      ...(hasMedia && currentTime > 0 ? { mediaTimestamp: Math.floor(currentTime) } : {}),
    });
    setDraft('');
    onAnchorConsumed?.();
  };

  const unanchored = notes.filter((n) => !n.anchor);
  const anchored = notes.filter((n) => !!n.anchor);

  return (
    <div className="flex flex-col text-sm" style={{ minHeight: '100%' }}>
      {/* Header */}
      <div
        className="px-4 py-2.5 text-xs font-medium"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--bg-surface)',
        }}
      >
        笔记 {notes.length > 0 && <span style={{ color: 'var(--text-tertiary)' }}>· {notes.length}</span>}
      </div>

      {/* Sticky input */}
      <div
        className="px-3 py-3"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 36,
          zIndex: 10,
          background: 'var(--bg-surface)',
        }}
      >
        {pendingAnchor && (
          <div className="mb-2 text-xs px-2 py-1 rounded" style={{ background: 'var(--accent-3)', color: 'var(--accent-11)' }}>
            锚点：{pendingAnchor.slice(0, 40)}{pendingAnchor.length > 40 ? '…' : ''}
          </div>
        )}
        <textarea
          ref={inputRef}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            if (e.key === 'Escape' && pendingAnchor) onAnchorConsumed?.();
          }}
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

      {/* Unanchored notes (flow layout) */}
      {unanchored.length > 0 && (
        <ul className="py-2">
          {isLoading && (
            <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>加载中…</li>
          )}
          {unanchored.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              onHeightChange={onHeightChange}
              onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
              onDelete={() => deleteNote.mutate(note.id)}
            />
          ))}
        </ul>
      )}

      {/* Anchored notes (absolute layout zone) */}
      {anchored.length > 0 && (
        <div style={{ position: 'relative', height: articleHeight, flexShrink: 0 }}>
          {anchored.map((note) => (
            <ul
              key={note.id}
              style={{
                position: 'absolute',
                top: positions[note.id] ?? 0,
                width: '100%',
                margin: 0,
                padding: 0,
              }}
            >
              <NoteItem
                note={note}
                onHeightChange={onHeightChange}
                onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
                onDelete={() => deleteNote.mutate(note.id)}
              />
            </ul>
          ))}
        </div>
      )}

      {!isLoading && notes.length === 0 && (
        <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>暂无笔记</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 构建确认无 TypeScript 错误**

```bash
cd web && npx tsc --noEmit
```

预期: 0 errors

- [ ] **Step 3: 目测端到端流程**

1. 打开一个有文章内容的任务（Mode E 或 Mode B）
2. 划选一段文字 → 气泡出现
3. 点击气泡 → 锚点预览显示在输入框上方，输入框获焦
4. 输入笔记内容 → ⌘↵ 提交
5. 笔记卡片出现在 notes-col 中，Y 位置与文章中对应段落对齐
6. 添加第二条绑定笔记，确认碰撞时向下推移

- [ ] **Step 4: 提交**

```bash
git add web/src/components/notes-panel.tsx
git commit -m "feat(notes): refactor NotesPanel for absolute-positioned anchor binding"
```

---

### Task 6: 重新构建 web + 更新 E2E 测试

**文件：**
- 修改: `tests/e2e-notes.test.js`

NotesPanel 结构变化（有无锚点两个区域），E2E 测试中的笔记选择器需要验证仍然有效。

- [ ] **Step 1: 重新构建 web**

```bash
cd web && npm run build
```

- [ ] **Step 2: 运行现有 E2E 测试**

```bash
node tests/e2e-notes.test.js
```

如果无锚点笔记的 `<li>` 选择器仍然有效（结构未变），测试应全部通过。如有失败，根据错误调整选择器。

- [ ] **Step 3: 运行 HTTP 单元测试确认后端无影响**

```bash
node tests/http-notes.test.js
```

预期: PASS (20 tests)

- [ ] **Step 4: 最终提交**

```bash
git add web/dist  # 如 dist 在版本控制中
git commit -m "feat(notes): article anchor binding complete — build + tests green"
```

---

## 验收标准

1. 在文章中划选文字 → 气泡出现，点击 → 输入框聚焦且显示锚点预览
2. 提交后，笔记卡片出现在 notes-col 中对应 Y 位置（±20px 允许误差）
3. 多张锚点笔记不重叠（推挤生效）
4. 无锚点笔记（纯自由输入、媒体时间戳）仍在顶部流式列表
5. `npx vitest run src/lib/anchor-layout.test.ts` PASS
6. `node tests/http-notes.test.js` PASS
7. `node tests/e2e-notes.test.js` PASS
