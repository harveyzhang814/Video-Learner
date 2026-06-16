import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';

export function Player({ taskId, kind }: { taskId: string; kind: 'video' | 'audio' }) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const playing = usePlayerStore((s) => s.playing);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const duration = usePlayerStore((s) => s.duration);

  // External time changes (e.g. subtitle click) → seek
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.abs(el.currentTime - currentTime) > 0.5) {
      el.currentTime = currentTime;
    }
  }, [currentTime]);

  const src = `/api/tasks/${taskId}/media?token=${encodeURIComponent(api.token())}`;

  const MediaTag = kind === 'video' ? 'video' : 'audio';

  return (
    <div className="relative bg-black flex-shrink-0"
         style={{ aspectRatio: kind === 'video' ? '16/9' : 'auto', height: kind === 'audio' ? 120 : undefined }}>
      <MediaTag
        ref={ref as React.RefObject<HTMLVideoElement & HTMLAudioElement>}
        src={src}
        className="w-full h-full object-contain"
        onLoadedMetadata={(e) => setDuration((e.currentTarget as HTMLMediaElement).duration)}
        onTimeUpdate={(e) => setCurrentTime((e.currentTarget as HTMLMediaElement).currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        controls={kind === 'audio'}
      />
      {kind === 'video' && (
        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/70 to-transparent">
          <div className="flex items-center gap-3 text-white text-xs">
            <button className="text-base"
                    onClick={() => { const el = ref.current; if (!el) return; playing ? el.pause() : el.play(); }}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="mono text-white/70">
              {formatDuration(currentTime)} / {formatDuration(duration || 0)}
            </span>
            <div className="flex-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full"
                   style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%',
                            background: 'var(--accent-9)' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
