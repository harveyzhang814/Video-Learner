import type { JSX } from 'react';

export interface GanttStep {
  name: string;
  cat: 'fetch' | 'download' | 'convert' | 'ai';
  startMs: number;
  endMs: number;
}

interface GanttChartProps {
  totalMs: number;
  serialMs: number;
  steps: GanttStep[];
}

const CAT_COLOR: Record<GanttStep['cat'], string> = {
  fetch:    '#60a5fa',
  download: '#f87171',
  convert:  '#4ade80',
  ai:       '#c084fc',
};

const CAT_LABEL: Record<GanttStep['cat'], string> = {
  fetch:    '元数据',
  download: '下载',
  convert:  '转换',
  ai:       'AI 生成',
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function tickInterval(totalMs: number): number {
  const targets = [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000];
  const target = totalMs / 6;
  return targets.find(t => t >= target) ?? targets[targets.length - 1];
}

export function GanttChart({ totalMs, serialMs, steps }: GanttChartProps): JSX.Element {
  const speedup = serialMs > 0 ? (serialMs / totalMs).toFixed(1) : '—';
  const saved = serialMs - totalMs;
  const interval = tickInterval(totalMs);
  const ticks = Array.from(
    { length: Math.floor(totalMs / interval) + 1 },
    (_, i) => i * interval
  );

  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '24px 0' }}>
      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 1,
        marginBottom: 24,
        background: 'var(--border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {[
          { label: '加速比', value: `${speedup}×`, accent: true },
          { label: '实际耗时', value: fmtMs(totalMs) },
          { label: '串行估计', value: fmtMs(serialMs) },
          { label: '节省时间', value: fmtMs(Math.max(0, saved)), accent: saved > 0 },
          { label: '步骤数', value: String(steps.length) },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{
            background: 'var(--bg-surface)',
            padding: '12px 16px',
          }}>
            <div style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</div>
            <div style={{
              fontSize: 20,
              fontWeight: 600,
              color: accent ? '#4ade80' : 'var(--text-primary)',
            }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Chart area */}
      <div style={{ position: 'relative' }}>
        {/* Ruler */}
        <div style={{
          display: 'flex',
          marginLeft: 120,
          marginBottom: 4,
          position: 'relative',
          height: 16,
        }}>
          {ticks.map(t => (
            <div key={t} style={{
              position: 'absolute',
              left: `${(t / totalMs) * 100}%`,
              color: 'var(--text-tertiary)',
              fontSize: 10,
              transform: 'translateX(-50%)',
            }}>
              {fmtMs(t)}
            </div>
          ))}
        </div>

        {/* Grid lines */}
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, left: 120, pointerEvents: 'none' }}>
            {ticks.map(t => (
              <div key={t} style={{
                position: 'absolute',
                left: `${(t / totalMs) * 100}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--border-subtle)',
              }} />
            ))}
          </div>

          {/* Step rows */}
          {steps.map(s => {
            const left = (s.startMs / totalMs) * 100;
            const width = ((s.endMs - s.startMs) / totalMs) * 100;
            const color = CAT_COLOR[s.cat];
            return (
              <div key={s.name} style={{
                display: 'flex',
                alignItems: 'center',
                height: 32,
                marginBottom: 2,
              }}>
                {/* Label */}
                <div style={{
                  width: 120,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  paddingRight: 8,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: color, flexShrink: 0,
                  }} />
                  <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </span>
                </div>
                {/* Bar area */}
                <div style={{ flex: 1, position: 'relative', height: 20 }}>
                  <div style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${Math.max(width, 0.5)}%`,
                    height: '100%',
                    background: color,
                    opacity: 0.85,
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 6,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                  }}>
                    <span style={{ color: '#000', fontSize: 10, opacity: 0.75 }}>
                      {fmtMs(s.endMs - s.startMs)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginTop: 20,
        paddingTop: 16,
        borderTop: '1px solid var(--border-subtle)',
      }}>
        {(Object.keys(CAT_COLOR) as GanttStep['cat'][]).map(cat => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 2,
              background: CAT_COLOR[cat], flexShrink: 0,
            }} />
            <span style={{ color: 'var(--text-tertiary)' }}>{CAT_LABEL[cat]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
