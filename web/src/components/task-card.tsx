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
      className="flex flex-col rounded-xl border p-4 transition-colors"
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

      {/* Meta row — pinned to bottom */}
      {isFailed ? (
        <div className="mt-auto text-xs truncate" style={{ color: 'var(--status-err)' }}>
          {task.error_message || '处理失败'}
        </div>
      ) : (
        <div className="mt-auto flex items-center justify-between text-xs"
             style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          <span>{meta}</span>
          <span>{task.upload_date ?? formatRelativeTime(task.updated_at)}</span>
        </div>
      )}
    </Link>
  );
}
