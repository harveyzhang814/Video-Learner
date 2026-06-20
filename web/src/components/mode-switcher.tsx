import React from 'react';
import { useUiStore, type LayoutMode } from '@/stores/ui-store';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const MODES: { id: LayoutMode; label: string; icon: React.ReactNode }[] = [
  {
    id: 'A', label: '视频',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...S}>
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
        <polygon points="10,8 10,14 16,11" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'B', label: '阅读',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...S}>
        <rect x="3" y="3" width="7" height="18" rx="1"/>
        <rect x="14" y="3" width="7" height="18" rx="1"/>
      </svg>
    ),
  },
  {
    id: 'C', label: '音频',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...S}>
        <path d="M3 14C3 9.03 7.03 5 12 5s9 4.03 9 9"/>
        <rect x="2" y="14" width="4" height="6" rx="1"/>
        <rect x="18" y="14" width="4" height="6" rx="1"/>
      </svg>
    ),
  },
  {
    id: 'E', label: '纯读',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...S}>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    ),
  },
  {
    id: 'F', label: '剧场',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...S}>
        <rect x="2" y="6" width="20" height="14" rx="2"/>
        <path d="M2 6l4-4h12l4 4"/>
        <line x1="8" y1="2" x2="6" y2="6"/>
        <line x1="14" y1="2" x2="12" y2="6"/>
      </svg>
    ),
  },
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
            {m.icon}
            <span style={{ fontSize: 12 }}>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
