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

export function TaskRow({ task }: { task: Task }) {
  const isRunning = task.status === 'running';
  const isFailed  = task.status === 'failed';
  const duration  = task.duration_seconds ? formatDuration(task.duration_seconds) : '';
  const resolution = formatResolution(task.width, task.height);
  const meta = [
    task.mode,
    resolution,
    duration,
    isRunning && task.current_step && task.progress != null ? `${task.current_step} ${task.progress}%` : null,
    task.focus
  ].filter(Boolean).join(' · ');

  return (
    <li className="task-row py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      <Link to={`/tasks/${task.id}`} className="block">
        <div className="flex items-baseline gap-3 mb-1.5">
          <h2 className="chinese text-[15.5px] font-medium flex-1 truncate"
              style={{ color: isFailed ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
            {task.title || task.url}
          </h2>
          <span className="text-xs mono flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
            {formatRelativeTime(task.updated_at)}
          </span>
        </div>
        {isFailed ? (
          <div className="text-xs mono truncate" style={{ color: 'var(--status-err)' }}>
            失败 · {task.error_message || 'unknown error'}
          </div>
        ) : (
          <div className="text-xs mono truncate mb-2" style={{ color: 'var(--text-tertiary)' }}>
            {meta}
          </div>
        )}
        {isRunning && task.progress != null && (
          <div data-testid="progress" className="max-w-md h-0.5 rounded-full overflow-hidden"
               style={{ background: 'var(--border-subtle)' }}>
            <span className="block h-full pulse" style={{ width: `${task.progress}%`, background: 'var(--accent-9)' }} />
          </div>
        )}
      </Link>
      <style>{`
        .task-row { transition: background 160ms ease-out; }
        .task-row:hover { background: var(--bg-surface); }
        .mono { font-family: var(--font-mono); }
        .pulse { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
      `}</style>
    </li>
  );
}
