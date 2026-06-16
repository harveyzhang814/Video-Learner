import { create } from 'zustand';

export type Theme = 'system' | 'light' | 'dark';
export type StatusFilter = 'all' | 'running' | 'done' | 'failed';

interface UiState {
  theme: Theme;
  paletteOpen: boolean;
  statusFilter: StatusFilter;
  setTheme: (t: Theme) => void;
  setPaletteOpen: (open: boolean) => void;
  setStatusFilter: (f: StatusFilter) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  paletteOpen: false,
  statusFilter: 'all',
  setTheme: (theme) => set({ theme }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setStatusFilter: (statusFilter) => set({ statusFilter })
}));
