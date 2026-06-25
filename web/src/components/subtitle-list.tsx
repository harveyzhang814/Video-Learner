import { useEffect, useRef } from 'react';
import { usePlayerStore, parseVtt, normLang } from '@/stores/player-store';
import type { Track } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';

export function SubtitleList({ taskId }: { taskId: string }) {
  const tracks = usePlayerStore((s) => s.tracks);
  const activeLang = usePlayerStore((s) => s.activeLang);
  const setTracks = usePlayerStore((s) => s.setTracks);
  const setActiveLang = usePlayerStore((s) => s.setActiveLang);
  const activeIndex = usePlayerStore((s) => s.activeIndex);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const containerRef = useRef<HTMLUListElement>(null);

  // Fetch tracks if not already loaded by Player
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
      } catch { /* network error */ }
    };
    load();
    return () => { cancelled = true; };
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = containerRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const current = tracks.find((t) => t.lang === activeLang) ?? tracks[0];
  const segments = current?.segments ?? [];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="px-4 py-2.5 flex items-center gap-4 text-xs border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {tracks.map((t) => (
          <button key={t.lang} onClick={() => setActiveLang(t.lang)}
                  className="cursor-pointer"
                  style={{
                    color: activeLang === t.lang ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: activeLang === t.lang ? 500 : 400
                  }}>
            {t.lang === 'zh-CN' ? '中文' : t.lang === 'en' ? 'EN' : t.lang}
          </button>
        ))}
        <span className="ml-auto" style={{ color: 'var(--text-tertiary)' }}>{segments.length} 段</span>
      </div>
      <ul ref={containerRef} className="py-2 flex-1 overflow-y-auto">
        {segments.map((seg, idx) => (
          <li key={idx} data-idx={idx}
              onClick={() => setCurrentTime(seg.start)}
              className="px-4 py-2.5 cursor-pointer subtitle-row"
              style={{
                background: idx === activeIndex ? 'var(--accent-3)' : 'transparent'
              }}>
            <div className="mono text-xs mb-1"
                 style={{ color: idx === activeIndex ? 'var(--accent-11)' : 'var(--text-tertiary)' }}>
              {formatDuration(seg.start)}
            </div>
            <p className="chinese text-[13.5px]"
               style={{ color: idx === activeIndex ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {seg.text}
            </p>
          </li>
        ))}
      </ul>
      <style>{`
        .subtitle-row { transition: background 120ms ease-out; }
        .subtitle-row:hover { background: var(--bg-canvas); }
        .mono { font-family: var(--font-mono); font-size: 12.5px; }
        .chinese { line-height: 1.75; }
      `}</style>
    </div>
  );
}
