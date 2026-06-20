import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';

export function Player({ taskId, kind }: { taskId: string; kind: 'video' | 'audio' }) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
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

  const seekTo = useCallback((clientX: number) => {
    const bar = seekBarRef.current;
    const el = ref.current;
    if (!bar || !el || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = ratio * duration;
    el.currentTime = t;
    setCurrentTime(t);
  }, [duration, setCurrentTime]);

  const onSeekMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    seekTo(e.clientX);

    const onMove = (ev: MouseEvent) => { if (isDragging.current) seekTo(ev.clientX); };
    const onUp = (ev: MouseEvent) => {
      if (isDragging.current) { seekTo(ev.clientX); isDragging.current = false; }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [seekTo]);

  const token = api.token();
  const src = `/api/tasks/${taskId}/media/${kind}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  const MediaTag = kind === 'video' ? 'video' : 'audio';

  return (
    <div className="relative bg-black flex-shrink-0"
         style={{ aspectRatio: kind === 'video' ? '16/9' : 'auto', height: kind === 'audio' ? 120 : undefined }}>
      <MediaTag
        ref={ref as React.RefObject<HTMLVideoElement & HTMLAudioElement>}
        src={src}
        className="w-full h-full object-contain"
        onLoadedMetadata={(e) => setDuration((e.currentTarget as HTMLMediaElement).duration)}
        onTimeUpdate={(e) => { if (!isDragging.current) setCurrentTime((e.currentTarget as HTMLMediaElement).currentTime); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        controls={kind === 'audio'}
      />
      {kind === 'video' && (
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 pt-8 bg-gradient-to-t from-black/80 to-transparent">
          {/* 进度条 — 宽点击区 */}
          <div
            ref={seekBarRef}
            className="w-full cursor-pointer select-none flex items-center mb-2"
            style={{ height: 16 }}
            onMouseDown={onSeekMouseDown}
          >
            <div className="relative w-full h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }}>
              <div className="h-full rounded-full relative" style={{
                width: duration ? `${(currentTime / duration) * 100}%` : '0%',
                background: 'var(--accent-9)',
              }}>
                <div className="absolute right-0 top-1/2 w-3 h-3 rounded-full bg-white shadow"
                     style={{ transform: 'translate(50%, -50%)' }} />
              </div>
            </div>
          </div>
          {/* 单行控制栏 */}
          <div className="flex items-center gap-3 text-white">
            <button
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/15 transition-colors text-sm"
              onClick={() => { const el = ref.current; if (!el) return; playing ? el.pause() : el.play(); }}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="text-xs flex-shrink-0" style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)' }}>
              {formatDuration(currentTime)}
              <span style={{ color: 'rgba(255,255,255,0.35)' }}> / {formatDuration(duration || 0)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
