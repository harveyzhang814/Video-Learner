import { useUiStore, type StatusFilter } from '@/stores/ui-store';
import type { Task } from '@/lib/api';

const OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',     label: '全部' },
  { value: 'running', label: '进行中' },
  { value: 'done',    label: '已完成' },
  { value: 'failed',  label: '失败' }
];

export function FilterBar({ tasks }: { tasks: Task[] }) {
  const filter = useUiStore((s) => s.statusFilter);
  const setFilter = useUiStore((s) => s.setStatusFilter);

  const counts: Record<StatusFilter, number> = {
    all: tasks.length,
    running: tasks.filter((t) => t.status === 'running' || t.status === 'pending').length,
    done: tasks.filter((t) => t.status === 'done').length,
    failed: tasks.filter((t) => t.status === 'failed').length
  };

  return (
    <nav className="flex items-center gap-6 mb-6 text-sm">
      {OPTIONS.map((o) => {
        const active = filter === o.value;
        return (
          <button key={o.value}
                  onClick={() => setFilter(o.value)}
                  className="cursor-pointer transition-colors"
                  style={{
                    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: active ? 500 : 400
                  }}>
            {o.label} <span className="text-xs ml-0.5" style={{ fontFamily: 'var(--font-mono)' }}>
              {counts[o.value]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
