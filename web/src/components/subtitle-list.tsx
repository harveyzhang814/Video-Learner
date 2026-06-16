import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';

interface Segment { start: number; end?: number; text: string; }

interface SubtitlesPayload {
  tracks: { lang: string; segments: Segment[] }[];
}

export function SubtitleList({ taskId }: { taskId: string }) {
  const [tracks, setTracks] = useState<SubtitlesPayload['tracks']>([]);
  const [lang, setLang] = useState<string>('zh-CN');
  const setSubtitles = usePlayerStore((s) => s.setSubtitles);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const activeIndex = usePlayerStore((s) => s.activeIndex);
  const containerRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/subtitles`, {
      headers: { Authorization: `Bearer ${api.token()}` }
    })
      .then((r) => r.ok ? r.json() : { tracks: [] })
      .then((data: SubtitlesPayload) => {
        if (cancelled) return;
        setTracks(data.tracks ?? []);
        const first = data.tracks?.[0];
        if (first) {
          setLang(first.lang);
          setSubtitles(first.segments);
        }
      });
    return () => { cancelled = true; };
  }, [taskId, setSubtitles]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = containerRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const current = tracks.find((t) => t.lang === lang) ?? tracks[0];
  const segments = current?.segments ?? [];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="px-4 py-2.5 flex items-center gap-4 text-xs border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {tracks.map((t) => (
          <button key={t.lang} onClick={() => { setLang(t.lang); setSubtitles(t.segments); }}
                  className="cursor-pointer"
                  style={{
                    color: lang === t.lang ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: lang === t.lang ? 500 : 400
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
