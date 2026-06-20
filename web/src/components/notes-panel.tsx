import { useState, useEffect } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';

interface Note {
  id: string;
  taskId: string;
  anchor: string;
  mediaTimestamp?: number;
  body: string;
  createdAt: number;
}

function loadNotes(taskId: string): Note[] {
  try {
    return JSON.parse(localStorage.getItem(`notes:${taskId}`) ?? '[]');
  } catch {
    return [];
  }
}

function saveNotes(taskId: string, notes: Note[]) {
  localStorage.setItem(`notes:${taskId}`, JSON.stringify(notes));
}

interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
}

export function NotesPanel({ taskId, hasMedia }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes(taskId));
  const [draft, setDraft] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);

  useEffect(() => {
    setNotes(loadNotes(taskId));
  }, [taskId]);

  const addNote = () => {
    if (!draft.trim()) return;
    const note: Note = {
      id: crypto.randomUUID(),
      taskId,
      anchor: '',
      mediaTimestamp: hasMedia ? Math.floor(currentTime) : undefined,
      body: draft.trim(),
      createdAt: Date.now(),
    };
    const next = [note, ...notes];
    setNotes(next);
    saveNotes(taskId, next);
    setDraft('');
  };

  const deleteNote = (id: string) => {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    saveNotes(taskId, next);
  };

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="px-4 py-2.5 border-b text-xs font-medium"
           style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
        笔记 {notes.length > 0 && <span style={{ color: 'var(--text-tertiary)' }}>· {notes.length}</span>}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); }}
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
        {notes.length === 0 && (
          <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            暂无笔记
          </li>
        )}
        {notes.map((note) => (
          <li key={note.id} className="px-4 py-3 group"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {note.mediaTimestamp !== undefined && (
              <div className="text-xs mb-1" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
                @ {formatDuration(note.mediaTimestamp)}
              </div>
            )}
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {note.body}
            </p>
            <button
              onClick={() => deleteNote(note.id)}
              className="mt-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              style={{ color: 'var(--text-tertiary)' }}>
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
