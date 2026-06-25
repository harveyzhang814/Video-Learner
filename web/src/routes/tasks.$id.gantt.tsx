import { useParams, Link } from 'react-router';
import { useTask, useSteps } from '@/hooks/use-tasks';
import { GanttChart, type GanttStep } from '@/components/gantt-chart';
import type { Step } from '@/lib/api';

const STEP_CAT: Record<string, GanttStep['cat']> = {
  fetch:     'fetch',
  video:     'download',
  audio:     'download',
  subs:      'download',
  asr:       'convert',
  vtt2md:    'convert',
  md2vtt:    'convert',
  translate: 'ai',
  article:   'ai',
  summary:   'ai',
};

function parseIso(s: string | null): number | null {
  if (!s) return null;
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

function computeGanttData(steps: Step[], taskCreatedAt: number): {
  ganttSteps: GanttStep[];
  totalMs: number;
  serialMs: number;
} {
  const valid = steps
    .map(s => ({
      name: s.name,
      cat: (STEP_CAT[s.name] ?? 'convert') as GanttStep['cat'],
      startMs: parseIso(s.started_at),
      endMs: parseIso(s.completed_at),
    }))
    .filter((s): s is { name: string; cat: GanttStep['cat']; startMs: number; endMs: number } =>
      s.startMs !== null && s.endMs !== null && s.endMs > s.startMs
    );

  if (valid.length === 0) {
    return { ganttSteps: [], totalMs: 0, serialMs: 0 };
  }

  const t0 = Math.min(...valid.map(s => s.startMs), taskCreatedAt);
  const ganttSteps: GanttStep[] = valid
    .map(s => ({
      name: s.name,
      cat: s.cat,
      startMs: s.startMs - t0,
      endMs: s.endMs - t0,
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const totalMs = Math.max(...ganttSteps.map(s => s.endMs));
  const serialMs = ganttSteps.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  return { ganttSteps, totalMs, serialMs };
}

export default function GanttPage() {
  const { id = '' } = useParams();
  const { data: task, isLoading: taskLoading } = useTask(id);
  const { data: steps, isLoading: stepsLoading } = useSteps(id);

  const isLoading = taskLoading || stepsLoading;

  const { ganttSteps, totalMs, serialMs } = task && steps
    ? computeGanttData(steps, task.created_at)
    : { ganttSteps: [], totalMs: 0, serialMs: 0 };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header
        className="h-12 flex items-center justify-between px-5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <Link
            to={`/tasks/${id}`}
            className="text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ←
          </Link>
          <h1
            className="chinese text-sm font-medium truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {task?.title || task?.url || id}
          </h1>
        </div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {id} · mode={task?.mode ?? '…'}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</p>
        )}

        {!isLoading && ganttSteps.length === 0 && (
          <div
            className="flex flex-col items-center justify-center h-64 gap-3"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span style={{ fontSize: 32 }}>📊</span>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              此任务暂无执行时间数据
            </p>
            <p className="text-xs text-center" style={{ maxWidth: 320 }}>
              步骤时间戳仅在 2026-06-23 之后执行的任务中记录。
              重新触发任务执行后，甘特图将自动可用。
            </p>
          </div>
        )}

        {!isLoading && ganttSteps.length > 0 && (
          <GanttChart
            totalMs={totalMs}
            serialMs={serialMs}
            steps={ganttSteps}
          />
        )}
      </div>
    </div>
  );
}
