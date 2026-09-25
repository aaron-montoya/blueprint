import { NodeResizer, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useDiagram } from '../store/diagramStore';
import type { NoteNode as NoteNodeType } from '../store/types';

function NoteNodeView({ id, data, selected }: NodeProps<NoteNodeType>) {
  const setNoteText = useDiagram((s) => s.setNoteText);
  const checkpoint = useDiagram((s) => s.checkpoint);
  const [editing, setEditing] = useState(data.text === '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  return (
    <div className={`note${selected ? ' selected' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={40} onResizeStart={() => checkpoint()} />
      {editing ? (
        <textarea
          ref={ref}
          className="note-text nodrag nowheel"
          value={data.text}
          placeholder="Note…"
          onChange={(e) => setNoteText(id, e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <div className="note-text" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          {data.text || <span className="placeholder">Double-click to write a note</span>}
        </div>
      )}
    </div>
  );
}

export const NoteNode = memo(NoteNodeView);
