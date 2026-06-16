import { useEffect, useRef, useState } from 'react';

export interface TocItem { id: string; text: string; level: 2 | 3; }

export function extractToc(markdown: string): TocItem[] {
  const lines = markdown.split('\n');
  const items: TocItem[] = [];
  for (const line of lines) {
    const m2 = line.match(/^##\s+(.+)$/);
    const m3 = line.match(/^###\s+(.+)$/);
    const text = (m2 ?? m3)?.[1]?.trim();
    if (!text) continue;
    const id = text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '');
    items.push({ id, text, level: m2 ? 2 : 3 });
  }
  return items;
}

export function Toc({ items, containerSelector = 'article.prose-cn' }: { items: TocItem[]; containerSelector?: string }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const obs = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const root = document.querySelector(containerSelector);
    if (!root) return;
    const headings = Array.from(root.querySelectorAll('h2, h3'));
    headings.forEach((h, i) => {
      if (items[i] && !h.id) h.id = items[i].id;
    });
    obs.current = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '0px 0px -70% 0px' });
    headings.forEach((h) => obs.current?.observe(h));
    return () => obs.current?.disconnect();
  }, [items, containerSelector]);

  return (
    <aside className="w-44 px-6 py-14 flex-shrink-0">
      <nav className="sticky top-14">
        {items.map((it) => (
          <a key={it.id} href={`#${it.id}`}
             className="block py-1 text-[12.5px] transition-colors"
             style={{
               color: active === it.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
               fontWeight: active === it.id ? 500 : 400,
               paddingLeft: it.level === 3 ? 12 : 0
             }}>
            {it.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}
