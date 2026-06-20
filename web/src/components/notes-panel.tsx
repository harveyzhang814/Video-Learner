import { useState } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { useNotes, useAddNote, useUpdateNote, useDeleteNote } from '@/hooks/use-tasks';
import type { Note } from '@/lib/api';

interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
}

function NoteItem({
  note,
  onUpdate,
  onDelete,
}: {
  note: Note;
  onUpdate: (body: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);

  const save = () => {
    if (draft.trim() && draft.trim() !== note.body) onUpdate(draft.trim());
    setEditing(false);
  };

  const cancel = () => {
    setDraft(note.body);
    setEditing(false);
  };

  return (
    <li className="px-4 py-3 group" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
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

export function NotesPanel({ taskId, hasMedia }: NotesPanelProps) {
  const [draft, setDraft] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);

  const { data: notes = [], isLoading } = useNotes(taskId);
  const addNote = useAddNote(taskId);
  const updateNote = useUpdateNote(taskId);
  const deleteNote = useDeleteNote(taskId);

  const submit = () => {
    if (!draft.trim()) return;
    addNote.mutate({
      body: draft.trim(),
      ...(hasMedia && currentTime > 0 ? { mediaTimestamp: Math.floor(currentTime) } : {}),
    });
    setDraft('');
  };

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="px-4 py-2.5 border-b text-xs font-medium"
           style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
        笔记 {notes.length > 0 && (
          <span style={{ color: 'var(--text-tertiary)' }}>· {notes.length}</span>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
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

      {/* Note list */}
      <ul className="flex-1 overflow-y-auto py-2">
        {isLoading && (
          <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            加载中…
          </li>
        )}
        {!isLoading && notes.length === 0 && (
          <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            暂无笔记
          </li>
        )}
        {notes.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
            onDelete={() => deleteNote.mutate(note.id)}
          />
        ))}
      </ul>
    </div>
  );
}
