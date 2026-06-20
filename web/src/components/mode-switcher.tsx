import { useUiStore, type LayoutMode } from '@/stores/ui-store';

const MODES: { id: LayoutMode; icon: string; label: string }[] = [
  { id: 'A', icon: '▶', label: '视频' },
  { id: 'B', icon: '≡', label: '阅读' },
  { id: 'C', icon: '◉', label: '音频' },
  { id: 'E', icon: '○', label: '纯读' },
  { id: 'F', icon: '▬', label: '剧场' },
];

export function ModeSwitcher() {
  const layoutMode = useUiStore((s) => s.layoutMode);
  const setLayoutMode = useUiStore((s) => s.setLayoutMode);

  return (
    <div className="flex items-center gap-0.5">
      {MODES.map((m) => {
        const active = layoutMode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => setLayoutMode(m.id)}
            className="flex items-center gap-1 px-2 h-7 rounded cursor-pointer transition-colors"
            style={{
              background: active ? 'var(--accent-3)' : 'transparent',
              color: active ? 'var(--accent-9)' : 'var(--text-tertiary)',
            }}>
            <span style={{ fontSize: 10 }}>{m.icon}</span>
            <span style={{ fontSize: 12 }}>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
