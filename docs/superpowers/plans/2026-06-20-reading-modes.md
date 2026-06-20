# 任务详情页多阅读模式 实施计划

**目标：** 在任务详情页实现 5 种可切换阅读模式（A/B/C/E/F），根据媒体类型自动推荐默认模式，切换不中断播放。

**架构：** 外层 `div[data-mode]` 属性 + `globals.css` 中的 CSS 选择器控制各面板显隐和尺寸；`<Player>` 始终 mount，CSS 决定其位置；Zustand `ui-store` 持有 `layoutMode`；`NotesPanel` 用 localStorage 实现轻量持久化。

**技术栈：** React 19, Zustand, Tailwind CSS v4, CSS 自定义属性

---

### Task 1: 扩展 ui-store — 添加 layoutMode

**文件：**
- 修改: `web/src/stores/ui-store.ts`

- [ ] **Step 1: 添加 LayoutMode 类型和状态**

在 `ui-store.ts` 现有 `Theme`、`StatusFilter` 类型之后添加：

```ts
export type LayoutMode = 'A' | 'B' | 'C' | 'E' | 'F';
```

在 `UiState` interface 中添加：
```ts
layoutMode: LayoutMode;
setLayoutMode: (m: LayoutMode) => void;
```

在 `create` 初始值中添加：
```ts
layoutMode: 'A',
setLayoutMode: (layoutMode) => set({ layoutMode }),
```

- [ ] **Step 2: 确认类型正确**

```bash
cd web && npx tsc --noEmit 2>&1 | grep ui-store
```

预期：无输出（无错误）

- [ ] **Step 3: 提交**

```bash
git add web/src/stores/ui-store.ts
git commit -m "feat(web): add layoutMode to ui-store"
```

---

### Task 2: 添加 5 种模式的 CSS 布局规则

**文件：**
- 修改: `web/src/styles/globals.css`

- [ ] **Step 1: 在 globals.css 末尾追加布局 CSS**

```css
/* ==============================
   Reading Modes — layout shell
   data-mode on outer wrapper div
   ============================== */

/* --- Transition --- */
.layout-shell[data-switching="1"] { opacity: 0.6; transition: opacity 80ms ease; }
.layout-shell { transition: opacity 80ms ease; }

/* --- Shared: article + notes row --- */
.article-notes-row {
  display: flex;
  max-width: 1040px;
  margin: 0 auto;
  width: 100%;
}
.article-col { flex: 1; min-width: 0; padding: 56px 48px; }
.notes-col {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-subtle);
  padding: 16px 16px 16px 20px;
  overflow-y: auto;
}

/* ===== MODE A — 视频优先 (55% / 45%) ===== */
[data-mode="A"] .mode-content { display: flex; flex: 1; min-height: 0; }
[data-mode="A"] .panel-left {
  width: 55%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
}
[data-mode="A"] .panel-right { flex: 1; display: flex; flex-direction: column; min-width: 0; }
[data-mode="A"] .panel-sidebar { display: none; }
[data-mode="A"] .audio-bar { display: none; }
[data-mode="A"] .subtitle-col { display: none; }
[data-mode="A"] .theater-section { display: none; }
/* Mode A: notes in left column, no right-side notes */
[data-mode="A"] .notes-col { display: none; }
[data-mode="A"] .left-notes { display: flex; flex-direction: column; }

/* ===== MODE B — 阅读优先 ===== */
[data-mode="B"] .mode-content { display: flex; flex: 1; min-height: 0; }
[data-mode="B"] .panel-left { display: none; }
[data-mode="B"] .panel-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }
[data-mode="B"] .panel-sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-subtle);
}
[data-mode="B"] .audio-bar { display: none; }
[data-mode="B"] .subtitle-col { display: none; }
[data-mode="B"] .theater-section { display: none; }
[data-mode="B"] .left-notes { display: none; }
[data-mode="B"] .notes-col { display: flex; flex-direction: column; }
/* Mode B: article-notes-row max-width 1040 */
[data-mode="B"] .article-col { max-width: 720px; }

/* ===== MODE C — 音频+文章 ===== */
[data-mode="C"] .mode-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
[data-mode="C"] .audio-bar {
  height: 72px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 20px;
}
[data-mode="C"] .mode-content-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
[data-mode="C"] .panel-left { display: none; }
[data-mode="C"] .panel-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }
[data-mode="C"] .subtitle-col {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
}
[data-mode="C"] .panel-sidebar { display: none; }
[data-mode="C"] .theater-section { display: none; }
[data-mode="C"] .left-notes { display: none; }
[data-mode="C"] .notes-col { display: flex; flex-direction: column; }
[data-mode="C"] .article-col { max-width: 720px; }

/* ===== MODE E — 沉浸阅读 ===== */
[data-mode="E"] .mode-content { display: flex; flex: 1; min-height: 0; }
[data-mode="E"] .panel-left { display: none; }
[data-mode="E"] .panel-right { flex: 1; display: flex; flex-direction: column; min-width: 0; }
[data-mode="E"] .panel-sidebar { display: none; }
[data-mode="E"] .audio-bar { display: none; }
[data-mode="E"] .subtitle-col { display: none; }
[data-mode="E"] .theater-section { display: none; }
[data-mode="E"] .left-notes { display: none; }
[data-mode="E"] .notes-col { display: flex; flex-direction: column; }
/* Mode E: narrower article + notes = 1000px */
[data-mode="E"] .article-notes-row { max-width: 1000px; }
[data-mode="E"] .article-col { max-width: 680px; }

/* ===== MODE F — 剧场模式 ===== */
[data-mode="F"] .mode-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
[data-mode="F"] .theater-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #000;
}
[data-mode="F"] .theater-video {
  width: 100%;
  max-height: 58vh;
  aspect-ratio: 16/9;
  object-fit: contain;
}
[data-mode="F"] .panel-left { display: none; }
[data-mode="F"] .panel-right { flex-shrink: 0; display: flex; flex-direction: column; }
[data-mode="F"] .panel-sidebar { display: none; }
[data-mode="F"] .audio-bar { display: none; }
[data-mode="F"] .subtitle-col { display: none; }
[data-mode="F"] .left-notes { display: none; }
[data-mode="F"] .notes-col { display: flex; flex-direction: column; }
[data-mode="F"] .article-col { max-width: 720px; }

/* CC overlay */
.cc-overlay-text {
  position: absolute;
  bottom: 52px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  text-align: center;
  color: #fff;
  font-size: 15px;
  line-height: 1.5;
  text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  pointer-events: none;
  padding: 3px 10px;
  background: rgba(0,0,0,0.45);
  border-radius: 3px;
}

/* CC button */
.cc-btn {
  border: 1px solid rgba(255,255,255,0.35);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background 120ms;
}
.cc-btn:hover { background: rgba(255,255,255,0.12); }
.cc-btn.on { background: rgba(255,255,255,0.18); color: #fff; }
.cc-btn.on::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-9);
  display: inline-block;
}
```

- [ ] **Step 2: 确认 CSS 解析正常（无语法错误）**

```bash
cd web && npm run build 2>&1 | grep -i "error\|warn" | head -20
```

预期：无 CSS 错误

- [ ] **Step 3: 提交**

```bash
git add web/src/styles/globals.css
git commit -m "feat(web): add reading-modes CSS layout rules"
```

---

### Task 3: 创建 CcOverlay 组件并更新 Player

**文件：**
- 创建: `web/src/components/cc-overlay.tsx`
- 修改: `web/src/components/player.tsx`

- [ ] **Step 1: 创建 cc-overlay.tsx**

```tsx
import { usePlayerStore } from '@/stores/player-store';

interface CcOverlayProps {
  enabled: boolean;
}

export function CcOverlay({ enabled }: CcOverlayProps) {
  const subtitles = usePlayerStore((s) => s.subtitles);
  const activeIndex = usePlayerStore((s) => s.activeIndex);

  if (!enabled || activeIndex < 0) return null;
  const text = subtitles[activeIndex]?.text;
  if (!text) return null;

  return <div className="cc-overlay-text">{text}</div>;
}
```

- [ ] **Step 2: 修改 player.tsx — 添加 showCc prop 和 CC 按钮**

将 `Player` 的 props 类型更改为：
```tsx
export function Player({
  taskId,
  kind,
  showCc = false,
  onToggleCc,
  ccEnabled = false,
}: {
  taskId: string;
  kind: 'video' | 'audio';
  showCc?: boolean;
  onToggleCc?: () => void;
  ccEnabled?: boolean;
}) {
```

在 video 控制栏 `<div className="flex items-center gap-3 text-white">` 内，播放按钮后、时间戳后添加：

```tsx
{showCc && (
  <button
    className={`cc-btn ml-auto${ccEnabled ? ' on' : ''}`}
    onClick={onToggleCc}
  >
    CC
  </button>
)}
```

在播放器外层 `div` 的视频 `<MediaTag>` 后面、controls overlay 之前添加 CC overlay（仅 video 模式）：

```tsx
{kind === 'video' && ccEnabled && (
  <CcOverlay enabled={ccEnabled} />
)}
```

在文件顶部导入：
```tsx
import { CcOverlay } from './cc-overlay';
```

- [ ] **Step 3: TypeScript 检查**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -E "player|cc-overlay"
```

预期：无输出

- [ ] **Step 4: 提交**

```bash
git add web/src/components/cc-overlay.tsx web/src/components/player.tsx
git commit -m "feat(web): add CC overlay to video player"
```

---

### Task 4: 创建 NotesPanel 组件

**文件：**
- 创建: `web/src/components/notes-panel.tsx`

- [ ] **Step 1: 创建 notes-panel.tsx**

```tsx
import { useState, useEffect } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';

interface Note {
  id: string;
  taskId: string;
  anchor: string;
  mediaTimestamp?: number;
  body: string;
  createdAt: number;
}

function loadNotes(taskId: string): Note[] {
  try {
    return JSON.parse(localStorage.getItem(`notes:${taskId}`) ?? '[]');
  } catch {
    return [];
  }
}

function saveNotes(taskId: string, notes: Note[]) {
  localStorage.setItem(`notes:${taskId}`, JSON.stringify(notes));
}

interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
}

export function NotesPanel({ taskId, hasMedia }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes(taskId));
  const [draft, setDraft] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);

  useEffect(() => {
    setNotes(loadNotes(taskId));
  }, [taskId]);

  const addNote = () => {
    if (!draft.trim()) return;
    const note: Note = {
      id: crypto.randomUUID(),
      taskId,
      anchor: '',
      mediaTimestamp: hasMedia ? Math.floor(currentTime) : undefined,
      body: draft.trim(),
      createdAt: Date.now(),
    };
    const next = [note, ...notes];
    setNotes(next);
    saveNotes(taskId, next);
    setDraft('');
  };

  const deleteNote = (id: string) => {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    saveNotes(taskId, next);
  };

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="px-4 py-2.5 border-b text-xs font-medium"
           style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
        笔记 {notes.length > 0 && <span style={{ color: 'var(--text-tertiary)' }}>· {notes.length}</span>}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); }}
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
        {notes.length === 0 && (
          <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            暂无笔记
          </li>
        )}
        {notes.map((note) => (
          <li key={note.id} className="px-4 py-3 group"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {note.mediaTimestamp !== undefined && (
              <div className="text-xs mb-1" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
                @ {formatDuration(note.mediaTimestamp)}
              </div>
            )}
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {note.body}
            </p>
            <button
              onClick={() => deleteNote(note.id)}
              className="mt-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              style={{ color: 'var(--text-tertiary)' }}>
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: 确认编译**

```bash
cd web && npx tsc --noEmit 2>&1 | grep notes-panel
```

预期：无输出

- [ ] **Step 3: 提交**

```bash
git add web/src/components/notes-panel.tsx
git commit -m "feat(web): add NotesPanel component with localStorage persistence"
```

---

### Task 5: 创建 ModeSwitcher 组件

**文件：**
- 创建: `web/src/components/mode-switcher.tsx`

- [ ] **Step 1: 创建 mode-switcher.tsx**

```tsx
import { useUiStore, type LayoutMode } from '@/stores/ui-store';

const MODES: { id: LayoutMode; label: string; title: string }[] = [
  { id: 'A', label: '▣', title: '视频优先' },
  { id: 'B', label: '▤', title: '阅读优先' },
  { id: 'C', label: '▥', title: '音频+文章' },
  { id: 'E', label: '▦', title: '沉浸阅读' },
  { id: 'F', label: '▧', title: '剧场模式' },
];

export function ModeSwitcher() {
  const layoutMode = useUiStore((s) => s.layoutMode);
  const setLayoutMode = useUiStore((s) => s.setLayoutMode);

  return (
    <div className="flex items-center gap-0.5">
      {MODES.map((m) => {
        const active = layoutMode === m.id;
        return (
          <button
            key={m.id}
            title={m.title}
            onClick={() => setLayoutMode(m.id)}
            className="w-7 h-7 flex items-center justify-center rounded text-base cursor-pointer transition-colors"
            style={{
              background: active ? 'var(--accent-3)' : 'transparent',
              color: active ? 'var(--accent-9)' : 'var(--text-tertiary)',
            }}>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 确认编译**

```bash
cd web && npx tsc --noEmit 2>&1 | grep mode-switcher
```

预期：无输出

- [ ] **Step 3: 提交**

```bash
git add web/src/components/mode-switcher.tsx
git commit -m "feat(web): add ModeSwitcher header component"
```

---

### Task 6: 重构 tasks.$id.tsx — 接入所有模式

**文件：**
- 修改: `web/src/routes/tasks.$id.tsx`

这是核心任务，将现有固定布局替换为多模式布局架构。

- [ ] **Step 1: 添加 import 和 store 绑定**

顶部 import 替换为：

```tsx
import { useParams, Link } from 'react-router';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTask, useContent, useReveal, useMediaInfo } from '@/hooks/use-tasks';
import { Reader } from '@/components/reader';
import { Toc, extractToc } from '@/components/toc';
import { SubtitleList } from '@/components/subtitle-list';
import { Player } from '@/components/player';
import { NotesPanel } from '@/components/notes-panel';
import { ModeSwitcher } from '@/components/mode-switcher';
import { useUiStore } from '@/stores/ui-store';
import type { LayoutMode } from '@/stores/ui-store';
```

- [ ] **Step 2: 添加组件内 state 和自动模式推断**

在 `TaskDetail` 函数体中，现有 `const [tab, ...]` 之后添加：

```tsx
const layoutMode = useUiStore((s) => s.layoutMode);
const setLayoutMode = useUiStore((s) => s.setLayoutMode);
const [ccEnabled, setCcEnabled] = useState(false);
const shellRef = useRef<HTMLDivElement>(null);

// Auto-set default mode based on mediaKind (once per task)
useEffect(() => {
  if (!mediaInfo) return;
  const defaultMode: LayoutMode =
    mediaKind === 'video' ? 'A' :
    mediaKind === 'audio' ? 'C' : 'E';
  setLayoutMode(defaultMode);
}, [mediaInfo, mediaKind, setLayoutMode]);

const switchMode = useCallback((mode: LayoutMode) => {
  const shell = shellRef.current;
  if (shell) shell.setAttribute('data-switching', '1');
  setTimeout(() => {
    setLayoutMode(mode);
    if (shell) shell.removeAttribute('data-switching');
  }, 80);
}, [setLayoutMode]);
```

- [ ] **Step 3: 将 ModeSwitcher 加入 header**

在 header 右侧区域（目前含"沉浸"和 ⌘K 的 div）之前，插入：

```tsx
<ModeSwitcher />
```

完整 header 区域变为：

```tsx
<header className="h-12 flex items-center justify-between px-5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-subtle)' }}>
  <div className="flex items-center gap-4 min-w-0">
    <Link to="/" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</Link>
    <h1 className="chinese text-sm font-medium truncate">{task.title || task.url}</h1>
  </div>
  <div className="flex items-center gap-3">
    <ModeSwitcher />
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
      <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>⌘K</kbd>
      <button>⋯</button>
    </div>
  </div>
</header>
```

- [ ] **Step 4: 替换 body 布局 — 多模式架构**

将现有 `<div className="flex-1 flex min-h-0">` 及其内容全部替换为以下结构：

```tsx
<div
  ref={shellRef}
  data-mode={layoutMode}
  className="layout-shell flex-1 flex flex-col min-h-0"
>
  {/* === MODE C: 顶部音频条 === */}
  <div className="audio-bar" style={{ display: 'none' }}>
    {mediaKind === 'audio' && (
      <Player taskId={id} kind="audio" />
    )}
  </div>

  {/* === 主内容区（各模式布局通过 CSS 控制）=== */}
  <div className="mode-content flex-1 min-h-0">

    {/* MODE C 内容列（audio bar 下方的三列）*/}
    <div className="mode-content-body flex flex-1 min-h-0" style={{ display: 'contents' }}>

      {/* === 左列（Mode A: 视频+笔记）=== */}
      <section className="panel-left" style={{ display: 'none' }}>
        {mediaKind && layoutMode === 'A' && (
          <Player
            taskId={id}
            kind={mediaKind}
            showCc={layoutMode === 'A'}
            ccEnabled={ccEnabled}
            onToggleCc={() => setCcEnabled((v) => !v)}
          />
        )}
        {/* Mode A: notes below video */}
        <div className="left-notes flex-1 overflow-y-auto" style={{ display: 'none' }}>
          <NotesPanel taskId={id} hasMedia={!!mediaKind} />
        </div>
      </section>

      {/* === Mode C: 字幕列 === */}
      <aside className="subtitle-col" style={{ display: 'none' }}>
        <SubtitleList taskId={id} />
      </aside>

      {/* === 主阅读区（右列）=== */}
      <section className="panel-right flex flex-col" style={{ display: 'none' }}>
        {/* Tab bar */}
        <div className="px-12 border-b flex items-center justify-between flex-shrink-0"
             style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex">
            {(['summary', 'article'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                      className="py-2.5 mr-6 text-sm border-b-2 transition-colors cursor-pointer"
                      style={{
                        borderColor: tab === t ? 'var(--accent-9)' : 'transparent',
                        color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        fontWeight: tab === t ? 500 : 400
                      }}>
                {t === 'summary' ? '总结' : '文章'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 py-3 text-xs">
            <button onClick={onCopy} style={{ color: 'var(--text-tertiary)' }}
                    className="hover:text-[var(--text-secondary)] cursor-pointer">复制</button>
            <button onClick={onReveal} style={{ color: 'var(--text-tertiary)' }}
                    className="hover:text-[var(--text-secondary)] cursor-pointer">显示文件</button>
          </div>
        </div>

        {/* Article + Notes row */}
        <div className="flex-1 overflow-y-auto">
          <div className="article-notes-row">
            <div className="article-col">
              <Reader content={content} />
            </div>
            {/* Mode B/C/E/F: right-side notes col */}
            <aside className="notes-col" style={{ display: 'none' }}>
              <NotesPanel taskId={id} hasMedia={!!mediaKind} />
            </aside>
          </div>
        </div>
      </section>

      {/* === Mode B: 右侧边栏（视频+字幕）=== */}
      <aside className="panel-sidebar" style={{ display: 'none' }}>
        {mediaKind && (
          <Player
            taskId={id}
            kind={mediaKind}
            showCc={false}
          />
        )}
        <SubtitleList taskId={id} />
      </aside>

    </div>{/* end mode-content-body */}

    {/* === Mode F: 剧场模式（全宽视频 + 下方文章）=== */}
    {layoutMode === 'F' && (
      <div className="theater-section flex flex-col" style={{ display: 'none' }}>
        {mediaKind === 'video' && (
          <div className="relative bg-black theater-video">
            <Player
              taskId={id}
              kind="video"
              showCc
              ccEnabled={ccEnabled}
              onToggleCc={() => setCcEnabled((v) => !v)}
            />
          </div>
        )}
      </div>
    )}

  </div>{/* end mode-content */}
</div>
```

> **注意：** CSS `display: 'none'` 内联 style 是初始占位（防止 SSR 闪烁）；最终由 `[data-mode]` CSS 规则覆盖。每个面板区域的 `style={{ display: 'none' }}` 会被对应模式的 CSS 选择器覆盖为正确值。

- [ ] **Step 5: TypeScript 检查**

```bash
cd web && npx tsc --noEmit 2>&1
```

预期：0 错误

- [ ] **Step 6: 手动视觉验证**

启动 dev server：
```bash
cd web && npm run dev
```

打开 `http://localhost:5173`，进入一个有视频的任务，逐一验证：
- 默认模式 A：左 55% 视频，右 45% 文章，CC 按钮在播放控制栏
- 切换 B：全宽文章+笔记，右侧 320px 视频+字幕侧边栏
- 切换 C（仅音频任务）：顶部 72px 音频条，左侧字幕列，中间文章，右侧笔记
- 切换 E：无媒体，全宽文章+笔记
- 切换 F：全宽视频（max 58vh），下方展开文章+笔记
- 切换模式时视频不停止播放

- [ ] **Step 7: 提交**

```bash
git add web/src/routes/tasks.$id.tsx
git commit -m "feat(web): refactor task detail page with 5-mode layout system"
```

---

### Task 7: 修复 Player 在剧场模式的尺寸约束

剧场模式（F）中 `<Player>` 的外层 `div` 默认 `aspect-ratio: 16/9`，宽度 100% 时高度可能超出 `58vh`。需要让 Player 在此场景自适应约束。

**文件：**
- 修改: `web/src/components/player.tsx`

- [ ] **Step 1: 给 Player 添加 `className` prop**

将 props 类型中添加 `className?: string`，并将外层 `div` 的 `className` 改为：

```tsx
<div
  className={`relative bg-black flex-shrink-0${className ? ` ${className}` : ''}`}
  style={{ aspectRatio: kind === 'video' ? '16/9' : 'auto', height: kind === 'audio' ? 120 : undefined }}
>
```

- [ ] **Step 2: 在 tasks.$id.tsx 的 theater 区域给 Player 传 className**

找到剧场模式的 `<Player>` 调用，改为：

```tsx
<Player
  taskId={id}
  kind="video"
  showCc
  ccEnabled={ccEnabled}
  onToggleCc={() => setCcEnabled((v) => !v)}
  className="theater-video"
/>
```

并将外层的 `<div className="relative bg-black theater-video">` 简化为：

```tsx
<div className="relative bg-black w-full" style={{ maxHeight: '58vh' }}>
```

- [ ] **Step 3: TypeScript 检查**

```bash
cd web && npx tsc --noEmit 2>&1
```

预期：0 错误

- [ ] **Step 4: 提交**

```bash
git add web/src/components/player.tsx web/src/routes/tasks.$id.tsx
git commit -m "fix(web): constrain theater-mode video to max 58vh"
```

---

## 自检清单

### 1. 规格覆盖

| 设计规格项 | 覆盖任务 |
|-----------|---------|
| 5 种模式 CSS 布局 | Task 2 |
| layoutMode store | Task 1 |
| CC 字幕叠层（A、F 模式） | Task 3 |
| 笔记面板（A/B/C/E/F） | Task 4 |
| 模式切换图标 | Task 5 |
| 媒体类型 → 默认模式自动推断 | Task 6 Step 2 |
| 切换 80ms 动画不中断播放 | Task 6 Step 2 (`switchMode`) |
| 剧场模式视频 max-height 58vh | Task 7 |
| Mode B 字幕列表在侧边栏 | Task 6 Step 4 (`panel-sidebar`) |
| Mode C 顶部音频条 72px | Task 2 + Task 6 Step 4 |
| Mode E 无媒体，全宽阅读 | Task 2 + Task 6 Step 4 |
| 文章行宽约束 720px/680px | Task 2 (`.article-col` max-width) |
| 笔记栏 260px | Task 2 (`.notes-col` width) |

### 2. 占位符扫描

无 TBD / TODO / 未定义引用。`switchMode` 在 Task 6 中定义，在同一函数内使用。

### 3. 类型一致性

- `LayoutMode = 'A' | 'B' | 'C' | 'E' | 'F'` — 在 Task 1 定义，Task 5/6 使用
- `Player` props 新增 `showCc`, `onToggleCc`, `ccEnabled`, `className` — Task 3 定义，Task 6/7 使用
- `NotesPanel` props `taskId: string, hasMedia: boolean` — Task 4 定义，Task 6 使用
- `Note` interface 仅在 `notes-panel.tsx` 内部使用，不跨文件
