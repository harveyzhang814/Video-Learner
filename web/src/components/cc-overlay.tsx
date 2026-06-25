import { usePlayerStore } from '@/stores/player-store';

interface CcOverlayProps {
  enabled: boolean;
}

export function CcOverlay({ enabled }: CcOverlayProps) {
  const subtitles = usePlayerStore((s) => s.subtitles);
  const activeIndex = usePlayerStore((s) => s.activeIndex);

  if (!enabled || activeIndex < 0) return null;
  const text = subtitles[activeIndex]?.text;
  if (!text) return null;

  return <div className="cc-overlay-text">{text}</div>;
}
