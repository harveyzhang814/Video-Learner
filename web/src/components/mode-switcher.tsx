import { useUiStore, type LayoutMode } from '@/stores/ui-store';

const MODES: { id: LayoutMode; label: string; title: string }[] = [
  { id: 'A', label: '▣', title: '视频优先' },
  { id: 'B', label: '▤', title: '阅读优先' },
  { id: 'C', label: '▥', title: '音频+文章' },
  { id: 'E', label: '▦', title: '沉浸阅读' },
  { id: 'F', label: '▧', title: '剧场模式' },
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
            title={m.title}
            onClick={() => setLayoutMode(m.id)}
            className="w-7 h-7 flex items-center justify-center rounded text-base cursor-pointer transition-colors"
            style={{
              background: active ? 'var(--accent-3)' : 'transparent',
              color: active ? 'var(--accent-9)' : 'var(--text-tertiary)',
            }}>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
