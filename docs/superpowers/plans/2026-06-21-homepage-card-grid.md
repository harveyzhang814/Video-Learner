# 首页卡片 Grid + 搜索 实施计划

**目标：** 将首页任务列表替换为 3 列卡片 Grid，并在 Header 内嵌实时搜索框

**架构：** 新建 `TaskCard` 组件承载卡片 UI；`_index.tsx` 新增 `searchQuery` state 做客户端过滤，移除 `FilterBar`；搜索框替换现有 ⌘K 按钮，支持 `Escape` 清空。

**技术栈：** React, TypeScript, Tailwind CSS, Zustand（现有 useUiStore），React Router

---

### Task 1: 新建 TaskCard 组件

**文件：**
- 创建: `web/src/components/task-card.tsx`

- [ ] **Step 1: 创建 TaskCard 组件**

```tsx
import { Link } from 'react-router';
import type { Task } from '@/lib/api';
import { formatDuration, formatRelativeTime } from '@/lib/time';

function formatResolution(width?: number, height?: number): string | null {
  if (!height) return null;
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720)  return '720p';
  if (height >= 480)  return '480p';
  return `${width}×${height}`;
}

export function TaskCard({ task }: { task: Task }) {
  const isFailed   = task.status === 'failed';
  const duration   = task.duration_seconds ? formatDuration(task.duration_seconds) : null;
  const resolution = formatResolution(task.width, task.height);
  const meta = [task.mode, resolution, duration].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/tasks/${task.id}`}
      className="block rounded-xl border p-4 transition-colors"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
    >
      {/* Title */}
      <h2
        className="chinese text-[15px] font-medium mb-2 line-clamp-2"
        style={{ color: isFailed ? 'var(--text-secondary)' : 'var(--text-primary)' }}
      >
        {task.title || task.url}
      </h2>

      {/* URL */}
      <p className="text-xs mb-3 truncate" style={{ color: 'var(--text-tertiary)' }}>
        {task.url}
      </p>

      {/* Meta row */}
      {isFailed ? (
        <div className="text-xs truncate" style={{ color: 'var(--status-err)' }}>
          {task.error_message || '处理失败'}
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs"
             style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          <span>{meta}</span>
          <span>{formatRelativeTime(task.updated_at)}</span>
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 2: TypeScript 检查**

```bash
cd web && npx tsc --noEmit
```

预期：无报错

- [ ] **Step 3: 提交**

```bash
git add web/src/components/task-card.tsx
git commit -m "feat(home): add TaskCard component"
```

---

### Task 2: 改写 _index.tsx — Grid + 搜索

**文件：**
- 修改: `web/src/routes/_index.tsx`

- [ ] **Step 1: 重写 _index.tsx**

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from '@/components/task-card';

export default function Home() {
  const { data: tasks = [], isLoading } = useTasks();
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = tasks.filter((t) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (t.title ?? '').toLowerCase().includes(q)
        || t.url.toLowerCase().includes(q);
  });

  // ⌘K focuses search; Escape clears
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="max-w-6xl mx-auto px-8 pt-16 pb-24">
      {/* Header */}
      <header className="flex items-center justify-between mb-10">
        <h1 className="text-lg font-semibold tracking-tight">Video Learner</h1>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
             style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); inputRef.current?.blur(); } }}
            placeholder="搜索…"
            className="text-sm bg-transparent outline-none w-40"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0"
               style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)',
                        color: 'var(--text-tertiary)' }}>
            ⌘K
          </kbd>
        </div>
      </header>

      {/* Content */}
      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>
      ) : tasks.length === 0 ? (
        <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
          暂无任务<br />
          新建任务：终端输入 <code style={{ color: 'var(--accent-11)', fontFamily: 'var(--font-mono)' }}>vdl &lt;URL&gt;</code>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
          无匹配结果
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-2">
          {filtered.map((t) => <TaskCard key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 检查**

```bash
cd web && npx tsc --noEmit
```

预期：无报错

- [ ] **Step 3: 提交**

```bash
git add web/src/routes/_index.tsx
git commit -m "feat(home): card grid + inline search, remove FilterBar"
```

---

## 自检

- [x] 规格覆盖：3 列 Grid ✓、搜索框 ✓、Escape 清空 ✓、Failed 红色错误 ✓、空状态 ✓
- [x] 无 TBD / TODO
- [x] `Task` 类型字段（title, url, mode, width, height, duration_seconds, updated_at, error_message）与 `web/src/lib/api.ts` 中定义一致
- [x] `formatDuration` / `formatRelativeTime` 沿用现有 `@/lib/time` 导出
