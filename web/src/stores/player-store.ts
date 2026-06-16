import { create } from 'zustand';

export interface Subtitle { start: number; text?: string; }

interface PlayerState {
  currentTime: number;
  duration: number;
  playing: boolean;
  subtitles: Subtitle[];
  activeIndex: number;
  immersive: boolean;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setPlaying: (p: boolean) => void;
  setSubtitles: (s: Subtitle[]) => void;
  setImmersive: (b: boolean) => void;
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
  setCurrentTime: (t) => set({ currentTime: t, activeIndex: deriveActive(get().subtitles, t) }),
  setDuration: (d) => set({ duration: d }),
  setPlaying: (p) => set({ playing: p }),
  setSubtitles: (s) => set({ subtitles: s, activeIndex: deriveActive(s, get().currentTime) }),
  setImmersive: (b) => set({ immersive: b }),
  reset: () => set({ currentTime: 0, duration: 0, playing: false, subtitles: [], activeIndex: -1, immersive: false })
}));
