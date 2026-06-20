import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initialized = false;
let idCounter = 0;

function initMermaid() {
  if (initialized) return;
  initialized = true;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? 'dark' : 'neutral',
    fontFamily: 'inherit',
  });
}

export function MermaidChart({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    initMermaid();
    setError(null);
    mermaid
      .render(id.current, code)
      .then(({ svg }) => {
        if (containerRef.current) containerRef.current.innerHTML = svg;
      })
      .catch((err) => {
        setError(String(err?.message ?? err));
      });
  }, [code]);

  if (error) {
    return (
      <pre style={{ color: 'var(--status-err)', fontSize: 12, whiteSpace: 'pre-wrap', margin: '12px 0' }}>
        {error}
      </pre>
    );
  }

  return <div ref={containerRef} style={{ margin: '20px 0', textAlign: 'center' }} />;
}
