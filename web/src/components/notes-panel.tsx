import { useState, useRef, useEffect, useLayoutEffect, useCallback, RefObject } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { useNotes, useAddNote, useUpdateNote, useDeleteNote } from '@/hooks/use-tasks';
import { computePositions } from '@/lib/anchor-layout';
import type { Note } from '@/lib/api';

interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
  pendingAnchor?: string;
  onAnchorConsumed?: () => void;
  articleRef?: RefObject<HTMLDivElement | null>;
}

function resolveAnchorY(anchor: string, articleEl: HTMLElement): number | null {
  const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.includes(anchor)) {
      let el: HTMLElement | null = node.parentElement;
      while (el && !['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE'].includes(el.tagName)) {
        el = el.parentElement;
      }
      if (!el) return null;
      const elRect = el.getBoundingClientRect();
      const artRect = articleEl.getBoundingClientRect();
      return elRect.top - artRect.top + articleEl.scrollTop;
    }
  }
  return null;
}

function NoteItem({
  note,
  onUpdate,
  onDelete,
  onHeightChange,
}: {
  note: Note;
  onUpdate: (body: string) => void;
  onDelete: () => void;
  onHeightChange: (id: string, h: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!liRef.current) return;
    const li = liRef.current;
    const ro = new ResizeObserver(() => {
      onHeightChange(note.id, li.offsetHeight);
    });
    ro.observe(li);
    return () => ro.disconnect();
  }, [note.id, onHeightChange]);

  const save = () => {
    if (draft.trim() && draft.trim() !== note.body) onUpdate(draft.trim());
    setEditing(false);
  };
  const cancel = () => { setDraft(note.body); setEditing(false); };

  return (
    <li
      ref={liRef}
      className="px-4 py-3 group"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      {note.mediaTimestamp !== undefined && (
        <div className="text-xs mb-1" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
          @ {formatDuration(note.mediaTimestamp)}
        </div>
      )}

      {editing ? (
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={save}
          className="w-full text-xs resize-none rounded p-2 outline-none"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--accent-9)',
            lineHeight: 1.6,
          }}
        />
      ) : (
        <p
          className="text-xs leading-relaxed cursor-text"
          style={{ color: 'var(--text-primary)' }}
          onClick={() => setEditing(true)}
        >
          {note.body}
        </p>
      )}

      {!editing && (
        <div className="mt-1 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="text-xs cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className="text-xs cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            删除
          </button>
        </div>
      )}
    </li>
  );
}

const ESTIMATED_HEIGHT = 72;
const GAP = 8;

export function NotesPanel({ taskId, hasMedia, pendingAnchor, onAnchorConsumed, articleRef }: NotesPanelProps) {
  const [draft, setDraft] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: notes = [], isLoading } = useNotes(taskId);
  const addNote = useAddNote(taskId);
  const updateNote = useUpdateNote(taskId);
  const deleteNote = useDeleteNote(taskId);

  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeightChange = useCallback((id: string, h: number) => {
    setHeights((prev) => prev[id] === h ? prev : { ...prev, [id]: h });
  }, []);

  const [positions, setPositions] = useState<Record<string, number>>({});
  const [articleHeight, setArticleHeight] = useState(0);

  useEffect(() => {
    if (pendingAnchor) inputRef.current?.focus();
  }, [pendingAnchor]);

  useEffect(() => {
    const el = articleRef?.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArticleHeight(el.scrollHeight));
    ro.observe(el);
    setArticleHeight(el.scrollHeight);
    return () => ro.disconnect();
  }, [articleRef]);

  useLayoutEffect(() => {
    const el = articleRef?.current;
    if (!el) return;
    const anchored = notes.filter((n) => n.anchor);
    const layouts = anchored.map((n) => {
      const anchorY = resolveAnchorY(n.anchor, el) ?? 0;
      const height = heights[n.id] ?? ESTIMATED_HEIGHT;
      return { id: n.id, anchorY, height };
    });
    const computed = computePositions(layouts, GAP);
    const next: Record<string, number> = {};
    computed.forEach((p) => { next[p.id] = p.top; });
    // Only update state if positions actually changed to avoid infinite re-render loop
    setPositions((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const k of nextKeys) {
        if (prev[k] !== next[k]) return next;
      }
      return prev;
    });
  }, [notes, heights, articleRef, articleHeight]);

  const submit = () => {
    if (!draft.trim()) return;
    addNote.mutate({
      body: draft.trim(),
      anchor: pendingAnchor ?? '',
      ...(hasMedia && currentTime > 0 ? { mediaTimestamp: Math.floor(currentTime) } : {}),
    });
    setDraft('');
    onAnchorConsumed?.();
  };

  const unanchored = notes.filter((n) => !n.anchor);
  const anchored = notes.filter((n) => !!n.anchor);

  return (
    <div className="flex flex-col text-sm" style={{ minHeight: '100%' }}>
      {/* Header */}
      <div
        className="px-4 py-2.5 text-xs font-medium"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--bg-surface)',
        }}
      >
        笔记{notes.length > 0 && <span style={{ color: 'var(--text-tertiary)' }}> · {notes.length}</span>}
      </div>

      {/* Sticky input */}
      <div
        className="px-3 py-3"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 36,
          zIndex: 10,
          background: 'var(--bg-surface)',
        }}
      >
        {pendingAnchor && (
          <div
            className="mb-2 text-xs px-2 py-1 rounded"
            style={{ background: 'var(--accent-3)', color: 'var(--accent-11)' }}
          >
            锚点：{pendingAnchor.slice(0, 40)}{pendingAnchor.length > 40 ? '…' : ''}
          </div>
        )}
        <textarea
          ref={inputRef}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            if (e.key === 'Escape' && pendingAnchor) onAnchorConsumed?.();
          }}
          placeholder="⌘↵ 保存笔记…"
          className="w-full text-xs resize-none rounded p-2 outline-none"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            lineHeight: 1.6,
          }}
        />
        {hasMedia && currentTime > 0 && (
          <div className="mt-1 text-xs" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
            @ {formatDuration(currentTime)}
          </div>
        )}
      </div>

      {/* Unanchored notes (normal flow) */}
      {(isLoading || unanchored.length > 0) && (
        <ul className="py-2">
          {isLoading && (
            <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
              加载中…
            </li>
          )}
          {unanchored.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              onHeightChange={onHeightChange}
              onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
              onDelete={() => deleteNote.mutate(note.id)}
            />
          ))}
        </ul>
      )}

      {/* Anchored notes (absolute layout zone) */}
      {anchored.length > 0 && (
        <div style={{ position: 'relative', height: articleHeight, flexShrink: 0 }}>
          {anchored.map((note) => (
            <ul
              key={note.id}
              style={{
                position: 'absolute',
                top: positions[note.id] ?? 0,
                width: '100%',
                margin: 0,
                padding: 0,
                listStyle: 'none',
              }}
            >
              <NoteItem
                note={note}
                onHeightChange={onHeightChange}
                onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
                onDelete={() => deleteNote.mutate(note.id)}
              />
            </ul>
          ))}
        </div>
      )}

      {!isLoading && notes.length === 0 && (
        <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          暂无笔记
        </div>
      )}
    </div>
  );
}
