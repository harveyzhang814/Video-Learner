import { create } from 'zustand';

export interface Subtitle { start: number; text?: string; }
export interface Segment { start: number; end?: number; text: string; }
export interface Track { lang: string; label?: string; segments: Segment[]; }

export function parseVtt(vtt: string): Segment[] {
  const segments: Segment[] = [];
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const timeRe = /(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find((l) => timeRe.test(l));
    if (!timeLine) continue;
    const m = timeLine.match(timeRe);
    if (!m) continue;
    const start = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000;
    const end   = parseInt(m[5]) * 3600 + parseInt(m[6]) * 60 + parseInt(m[7]) + parseInt(m[8]) / 1000;
    const text = lines.filter((l) => !timeRe.test(l) && !/^\d+$/.test(l.trim()) && l.trim() !== 'WEBVTT').join(' ').trim();
    if (text) segments.push({ start, end, text });
  }
  return segments;
}

export function normLang(lang: string) {
  if (lang === 'zh' || lang === 'zh-CN') return 'zh-CN';
  return lang;
}

export function langLabel(lang: string) {
  if (lang === 'zh-CN') return '中文';
  if (lang === 'en') return 'EN';
  return lang;
}

interface PlayerState {
  currentTime: number;
  duration: number;
  playing: boolean;
  subtitles: Subtitle[];
  activeIndex: number;
  immersive: boolean;
  tracks: Track[];
  activeLang: string;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setPlaying: (p: boolean) => void;
  setSubtitles: (s: Subtitle[]) => void;
  setImmersive: (b: boolean) => void;
  setTracks: (tracks: Track[]) => void;
  setActiveLang: (lang: string) => void;
  reset: () => void;
}

function deriveActive(subs: Subtitle[], t: number): number {
  if (!subs.length) return -1;
  let idx = 0;
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].start <= t) idx = i; else break;
  }
  return idx;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTime: 0,
  duration: 0,
  playing: false,
  subtitles: [],
  activeIndex: -1,
  immersive: false,
  tracks: [],
  activeLang: '',
  setCurrentTime: (t) => set({ currentTime: t, activeIndex: deriveActive(get().subtitles, t) }),
  setDuration: (d) => set({ duration: d }),
  setPlaying: (p) => set({ playing: p }),
  setSubtitles: (s) => set({ subtitles: s, activeIndex: deriveActive(s, get().currentTime) }),
  setImmersive: (b) => set({ immersive: b }),
  setTracks: (tracks) => {
    // prefer zh-CN if available, else first track
    const lang = tracks.find((t) => t.lang === 'zh-CN')?.lang ?? tracks[0]?.lang ?? '';
    const active = tracks.find((t) => t.lang === lang) ?? tracks[0];
    set({ tracks, activeLang: lang, subtitles: active?.segments ?? [], activeIndex: -1 });
  },
  setActiveLang: (lang) => {
    const { tracks, currentTime } = get();
    const track = tracks.find((t) => t.lang === lang);
    if (!track) return;
    set({ activeLang: lang, subtitles: track.segments, activeIndex: deriveActive(track.segments, currentTime) });
  },
  reset: () => set({ currentTime: 0, duration: 0, playing: false, subtitles: [], activeIndex: -1, immersive: false, tracks: [], activeLang: '' }),
}));
