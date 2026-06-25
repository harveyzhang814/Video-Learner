import { useEffect } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';

export function useGlobalHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUiStore.getState().setPaletteOpen(!useUiStore.getState().paletteOpen);
      } else if (e.key === 'Escape') {
        if (useUiStore.getState().paletteOpen) useUiStore.getState().setPaletteOpen(false);
        if (usePlayerStore.getState().immersive) usePlayerStore.getState().setImmersive(false);
      } else if (e.key.toLowerCase() === 'f' && !meta && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        usePlayerStore.getState().setImmersive(!usePlayerStore.getState().immersive);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
