export interface NoteLayout {
  id: string;
  anchorY: number;
  height: number;
}

export interface NotePosition {
  id: string;
  top: number;
}

export function computePositions(notes: NoteLayout[], gap: number): NotePosition[] {
  const sorted = [...notes].sort((a, b) => a.anchorY - b.anchorY);
  let cursor = 0;
  return sorted.map((note) => {
    const top = Math.max(note.anchorY, cursor);
    cursor = top + note.height + gap;
    return { id: note.id, top };
  });
}
