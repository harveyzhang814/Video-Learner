import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore, parseVtt, normLang, langLabel } from '@/stores/player-store';
import type { Track } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';
import { CcOverlay } from './cc-overlay';

export function Player({
  taskId,
  kind,
  showCc = false,
  onToggleCc,
  ccEnabled = false,
  className,
  audioOnly = false,
}: {
  taskId: string;
  kind: 'video' | 'audio';
  showCc?: boolean;
  onToggleCc?: () => void;
  ccEnabled?: boolean;
  className?: string;
  audioOnly?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const playing = usePlayerStore((s) => s.playing);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const tracks = usePlayerStore((s) => s.tracks);
  const activeLang = usePlayerStore((s) => s.activeLang);
  const setTracks = usePlayerStore((s) => s.setTracks);
  const setActiveLang = usePlayerStore((s) => s.setActiveLang);

  // On mount: restore position + resume if was playing before a mode switch
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { currentTime: t, playing: wasPlaying } = usePlayerStore.getState();
    if (t > 0.5) el.currentTime = t;
    if (wasPlaying) el.play().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // External time changes (e.g. subtitle click) → seek
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.abs(el.currentTime - currentTime) > 0.5) {
      el.currentTime = currentTime;
    }
  }, [currentTime]);

  // Fetch subtitle tracks if not already loaded (covers modes without SubtitleList panel)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (usePlayerStore.getState().tracks.length > 0) return;
      try {
        const r = await fetch(`/api/tasks/${taskId}/subtitles`, {
          headers: { Authorization: `Bearer ${api.token()}` },
        });
        if (!r.ok || cancelled) return;
        const data = await r.json() as { tracks: { lang: string; label?: string; vtt?: string; segments?: { start: number; end?: number; text: string }[] }[] };
        if (cancelled) return;
        const normalized: Track[] = (data.tracks ?? []).map((t) => ({
          lang: normLang(t.lang),
          label: t.label,
          segments: t.segments ?? (t.vtt ? parseVtt(t.vtt) : []),
        }));
        setTracks(normalized);
      } catch { /* network error — tracks stay empty */ }
    };
    load();
    return () => { cancelled = true; };
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cycleTrack = useCallback(() => {
    if (tracks.length < 2) return;
    const idx = tracks.findIndex((t) => t.lang === activeLang);
    const next = tracks[(idx + 1) % tracks.length];
    setActiveLang(next.lang);
  }, [tracks, activeLang, setActiveLang]);

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
  const showCustomControls = kind === 'video' || audioOnly;
  const hasMultipleTracks = tracks.length > 1;

  return (
    <div className={`relative bg-black flex-shrink-0${audioOnly ? ' w-full' : ''}${className ? ` ${className}` : ''}`}
         style={{
           aspectRatio: (!audioOnly && kind === 'video') ? '16/9' : 'auto',
           height: (audioOnly || kind === 'audio') ? 72 : undefined,
         }}>
      <MediaTag
        ref={ref as React.RefObject<HTMLVideoElement & HTMLAudioElement>}
        src={src}
        className={audioOnly ? 'absolute w-0 h-0 opacity-0' : 'w-full h-full object-contain'}
        onLoadedMetadata={(e) => setDuration((e.currentTarget as HTMLMediaElement).duration)}
        onTimeUpdate={(e) => { if (!isDragging.current) setCurrentTime((e.currentTarget as HTMLMediaElement).currentTime); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        controls={kind === 'audio' && !audioOnly}
      />
      {kind === 'video' && ccEnabled && !audioOnly && (
        <CcOverlay enabled={ccEnabled} />
      )}
      {showCustomControls && (
        <div className={audioOnly
          ? "absolute inset-0 flex flex-col justify-center px-4 bg-black/80"
          : "absolute bottom-0 left-0 right-0 px-3 pb-3 pt-8 bg-gradient-to-t from-black/80 to-transparent"
        }>
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
            {/* 字幕轨道切换 — 仅当存在多轨道时显示 */}
            {hasMultipleTracks && (
              <button
                className="ml-auto flex-shrink-0 h-7 px-2 rounded hover:bg-white/15 transition-colors text-xs font-medium"
                style={{ color: 'rgba(255,255,255,0.85)' }}
                title="切换字幕语言"
                onClick={cycleTrack}
              >
                {langLabel(activeLang)}
              </button>
            )}
            {showCc && (
              <button
                className={`cc-btn${!hasMultipleTracks ? ' ml-auto' : ''}${ccEnabled ? ' on' : ''}`}
                onClick={onToggleCc}
              >
                CC
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
