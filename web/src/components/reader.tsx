import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MermaidChart } from './mermaid-chart';

interface ReaderProps {
  content: string;
  onAnchorSelect?: (anchor: string) => void;
}

const components: Components = {
  code({ className, children, ...props }) {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    if (lang === 'mermaid') {
      return <MermaidChart code={String(children).trim()} />;
    }
    return <code className={className} {...props}>{children}</code>;
  },
};

export function Reader({ content, onAnchorSelect }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  const articleRef = useRef<HTMLElement>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number; anchor: string } | null>(null);

  const handleMouseUp = useCallback(() => {
    if (!onAnchorSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    if (!articleRef.current?.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    setBubble({ x: rect.right, y: rect.top, anchor: text.slice(0, 80) });
  }, [onAnchorSelect]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (bubble && !(e.target as Element).closest('.anchor-bubble')) {
        setBubble(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBubble(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [bubble]);

  const handleBubbleClick = () => {
    if (!bubble) return;
    onAnchorSelect?.(bubble.anchor);
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  };

  return (
    <>
      <article ref={articleRef} className="prose-cn" onMouseUp={handleMouseUp}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={components}
        >
          {md}
        </ReactMarkdown>
      </article>

      {bubble && (
        <button
          className="anchor-bubble"
          onClick={handleBubbleClick}
          style={{
            position: 'fixed',
            left: bubble.x + 6,
            top: bubble.y - 4,
            zIndex: 50,
            fontSize: 13,
            lineHeight: 1,
            padding: '3px 6px',
            borderRadius: 4,
            background: 'var(--accent-9)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11.5 1.5a1.5 1.5 0 0 1 2.121 2.121l-8.5 8.5L2 13l.879-3.121 8.621-8.379z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
    </>
  );
}
