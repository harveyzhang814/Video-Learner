import { create } from 'zustand';
import { ThemeId } from '@/lib/themes';

export type Theme = 'system' | 'light' | 'dark';
export type StatusFilter = 'all' | 'running' | 'done' | 'failed';
export type LayoutMode = 'A' | 'B' | 'C' | 'E' | 'F';

interface UiState {
  theme: Theme;
  paletteOpen: boolean;
  statusFilter: StatusFilter;
  setTheme: (t: Theme) => void;
  setPaletteOpen: (open: boolean) => void;
  setStatusFilter: (f: StatusFilter) => void;
  layoutMode: LayoutMode;
  setLayoutMode: (m: LayoutMode) => void;
  proseTheme: ThemeId;
  setProseTheme: (theme: ThemeId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  paletteOpen: false,
  statusFilter: 'all',
  setTheme: (theme) => set({ theme }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  layoutMode: 'A',
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  proseTheme: (localStorage.getItem('prose-theme') ?? 'default') as ThemeId,
  setProseTheme: (proseTheme) => {
    localStorage.setItem('prose-theme', proseTheme);
    set({ proseTheme });
  },
}));
