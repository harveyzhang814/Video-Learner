import { useParams, Link } from 'react-router';
import { useState, useMemo } from 'react';
import { useTask, useContent } from '@/hooks/use-tasks';
import { Reader } from '@/components/reader';
import { Toc, extractToc } from '@/components/toc';
import { SubtitleList } from '@/components/subtitle-list';

export default function TaskDetail() {
  const { id = '' } = useParams();
  const { data: task, isLoading } = useTask(id);
  const [tab, setTab] = useState<'summary' | 'article'>('summary');
  const { data: content = '' } = useContent(id, tab);
  const toc = useMemo(() => extractToc(content), [content]);

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>;
  if (!task) return <div className="p-8 text-sm" style={{ color: 'var(--status-err)' }}>未找到任务</div>;

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 flex items-center justify-between px-5 border-b"
              style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</Link>
          <h1 className="chinese text-sm font-medium truncate">{task.title || task.url}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <span>沉浸 <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>F</kbd></span>
          <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>⌘K</kbd>
          <button>⋯</button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <section className="w-[42%] flex flex-col border-r" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="aspect-video bg-black flex items-center justify-center text-white/30 text-xs">
            player placeholder
          </div>
          <SubtitleList taskId={id} />
        </section>

        <section className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-12 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex">
              {(['summary', 'article'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                        className="py-2.5 mr-6 text-sm border-b-2 transition-colors cursor-pointer"
                        style={{
                          borderColor: tab === t ? 'var(--accent-9)' : 'transparent',
                          color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                          fontWeight: tab === t ? 500 : 400
                        }}>
                  {t === 'summary' ? '总结' : '文章'}
                </button>
              ))}
            </div>
            <button className="text-xs py-3" style={{ color: 'var(--text-tertiary)' }}>复制</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="flex max-w-5xl mx-auto">
              <div className="flex-1 px-12 py-14">
                <Reader content={content} />
              </div>
              <Toc items={toc} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
