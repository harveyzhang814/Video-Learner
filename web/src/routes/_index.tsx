import { useTasks } from '@/hooks/use-tasks';
import { useUiStore } from '@/stores/ui-store';
import { TaskRow } from '@/components/task-row';
import { FilterBar } from '@/components/filter-bar';

export default function Home() {
  const { data: tasks = [], isLoading } = useTasks();
  const filter = useUiStore((s) => s.statusFilter);

  const filtered = tasks.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'running') return t.status === 'running' || t.status === 'pending';
    return t.status === filter;
  });

  return (
    <div className="max-w-3xl mx-auto px-8 pt-16 pb-24">
      <header className="flex items-baseline justify-between mb-10">
        <h1 className="text-lg font-semibold tracking-tight">Video Learner</h1>
        <button className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          搜索 <kbd className="ml-1.5 px-1.5 py-0.5 rounded border text-[11px]"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>⌘K</kbd>
        </button>
      </header>

      <FilterBar tasks={tasks} />

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
          暂无任务<br/>
          新建任务：终端输入 <code className="mono" style={{ color: 'var(--accent-11)' }}>vdl &lt;URL&gt;</code>
        </div>
      ) : (
        <ul>
          {filtered.map((t) => <TaskRow key={t.id} task={t} />)}
        </ul>
      )}

      <div className="mt-16 text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
        新建任务：在终端输入 <code className="mono" style={{ color: 'var(--accent-11)' }}>vdl &lt;URL&gt;</code>
      </div>
    </div>
  );
}
