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
    <div className="px-8 pt-16 pb-24">
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
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {filtered.map((t) => <TaskCard key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}
