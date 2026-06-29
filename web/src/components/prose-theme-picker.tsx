import { useState, useEffect, useRef } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { THEMES } from '@/lib/themes';

export function ProseThemePicker() {
  const proseTheme = useUiStore((s) => s.proseTheme);
  const setProseTheme = useUiStore((s) => s.setProseTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="文章主题"
        className="text-sm px-2 py-1 rounded hover:opacity-70 transition-opacity"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ✦
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            boxShadow: '0 2px 8px var(--border-strong)',
            minWidth: 96,
            zIndex: 50,
          }}
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => { setProseTheme(t.id); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                textAlign: 'left',
                fontSize: 13,
                color: proseTheme === t.id ? 'var(--accent-9)' : 'var(--text-primary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
