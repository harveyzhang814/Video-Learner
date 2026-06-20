import { useParams, Link } from 'react-router';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useTask, useContent, useReveal, useMediaInfo } from '@/hooks/use-tasks';
import { Reader } from '@/components/reader';
import { Toc, extractToc } from '@/components/toc';
import { SubtitleList } from '@/components/subtitle-list';
import { Player } from '@/components/player';
import { NotesPanel } from '@/components/notes-panel';
import { ModeSwitcher } from '@/components/mode-switcher';
import { useUiStore } from '@/stores/ui-store';
import type { LayoutMode } from '@/stores/ui-store';

export default function TaskDetail() {
  const { id = '' } = useParams();
  const { data: task, isLoading } = useTask(id);
  const { data: mediaInfo } = useMediaInfo(id);
  const mediaKind: 'video' | 'audio' | null =
    mediaInfo?.video?.exists ? 'video' :
    mediaInfo?.audio?.exists ? 'audio' : null;
  const [tab, setTab] = useState<'summary' | 'article'>('summary');
  const { data: content = '' } = useContent(id, tab);
  const toc = useMemo(() => extractToc(content), [content]);
  const reveal = useReveal();

  const layoutMode = useUiStore((s) => s.layoutMode);
  const setLayoutMode = useUiStore((s) => s.setLayoutMode);
  const [ccEnabled, setCcEnabled] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string>('');
  const articleRef = useRef<HTMLDivElement>(null);

  // Auto-set default mode based on mediaKind (once per task load)
  useEffect(() => {
    if (!mediaInfo) return;
    const defaultMode: LayoutMode =
      mediaKind === 'video' ? 'A' :
      mediaKind === 'audio' ? 'C' : 'E';
    setLayoutMode(defaultMode);
  }, [mediaInfo, mediaKind, setLayoutMode]);

  // Sync data-mode attribute on shell element
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    shell.setAttribute('data-mode', layoutMode);
  }, [layoutMode]);

  const onCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
  };

  const onReveal = () => reveal.mutate(id);

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>;
  if (!task) return <div className="p-8 text-sm" style={{ color: 'var(--status-err)' }}>未找到任务</div>;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-12 flex items-center justify-between px-5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</Link>
          <h1 className="chinese text-sm font-medium truncate">{task.title || task.url}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ModeSwitcher />
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>⌘K</kbd>
            <button>⋯</button>
          </div>
        </div>
      </header>

      {/* Layout shell — data-mode drives all CSS */}
      <div
        ref={shellRef}
        data-mode={layoutMode}
        className="layout-shell flex-1 flex flex-col min-h-0"
      >
        {/* MODE C: top audio bar — works for both audio and video tasks */}
        <div className="audio-bar" style={{ display: layoutMode === 'C' ? undefined : 'none' }}>
          {mediaKind && (
            <Player taskId={id} kind={mediaKind} audioOnly={true} />
          )}
        </div>

        {/* Main content area */}
        <div className="mode-content">

          {/* MODE C body wrapper (subtitle col + article) */}
          <div className="mode-content-body">

            {/* LEFT PANEL — Mode A: video + notes below */}
            <section className="panel-left">
              {mediaKind && (
                <Player
                  taskId={id}
                  kind={mediaKind}
                  showCc={true}
                  ccEnabled={ccEnabled}
                  onToggleCc={() => setCcEnabled((v) => !v)}
                />
              )}
              <div className="left-notes flex-1 overflow-y-auto">
                <NotesPanel taskId={id} hasMedia={!!mediaKind} />
              </div>
            </section>

            {/* MODE C: subtitle column */}
            <aside className="subtitle-col">
              <SubtitleList taskId={id} />
            </aside>

            {/* RIGHT PANEL — article + tab bar */}
            <section className="panel-right">
              {/* Tab bar */}
              <div className="px-12 border-b flex items-center justify-between flex-shrink-0"
                   style={{ borderColor: 'var(--border-subtle)' }}>
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
                <div className="flex items-center gap-3 py-3 text-xs">
                  <button onClick={onCopy} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">复制</button>
                  <button onClick={onReveal} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">显示文件</button>
                </div>
              </div>

              {/* Article + Notes row (B/C/E/F modes) */}
              <div className="flex-1 overflow-y-auto">
                <div className="article-notes-row">
                  <div className="article-col" ref={articleRef}>
                    <Reader
                      content={content}
                      onAnchorSelect={(anchor) => setPendingAnchor(anchor)}
                    />
                    <Toc items={toc} />
                  </div>
                  <aside className="notes-col">
                    <NotesPanel
                      taskId={id}
                      hasMedia={!!mediaKind}
                      pendingAnchor={pendingAnchor}
                      onAnchorConsumed={() => setPendingAnchor('')}
                      articleRef={articleRef}
                    />
                  </aside>
                </div>
              </div>
            </section>

            {/* MODE B: right sidebar (video + subtitles) */}
            <aside className="panel-sidebar">
              {mediaKind && (
                <Player taskId={id} kind={mediaKind} />
              )}
              <div className="flex-1 overflow-hidden">
                <SubtitleList taskId={id} />
              </div>
            </aside>

          </div>{/* end mode-content-body */}

          {/* MODE F: theater — full-width video above */}
          <div className="theater-section">
            {mediaKind === 'video' && (
              <div className="relative bg-black w-full" style={{ maxHeight: '58vh', aspectRatio: '16/9' }}>
                <Player
                  taskId={id}
                  kind="video"
                  showCc={true}
                  ccEnabled={ccEnabled}
                  onToggleCc={() => setCcEnabled((v) => !v)}
                  className="w-full h-full"
                />
              </div>
            )}
          </div>

        </div>{/* end mode-content */}
      </div>
    </div>
  );
}
