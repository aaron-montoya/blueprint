import { NodeResizer, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { SECTION_COLORS } from '../model/format';
import { useDiagram } from '../store/diagramStore';
import type { SectionNode as SectionNodeType } from '../store/types';

/**
 * A labeled region drawn behind parts. Only its tab and border catch the
 * mouse, so box-selecting inside a section still works; drag the tab to move
 * the section and everything inside it.
 */
function SectionNodeView({ id, data, selected }: NodeProps<SectionNodeType>) {
  const setSection = useDiagram((s) => s.setSection);
  const checkpoint = useDiagram((s) => s.checkpoint);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const finish = (save: boolean) => {
    setEditing(false);
    if (save && draft !== data.label) setSection(id, { label: draft });
  };

  return (
    <div className={`section${selected ? ' selected' : ''}`} style={{ background: data.color }}>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={60} onResizeStart={() => checkpoint()} />
      <div
        className="section-tab"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(data.label);
          setEditing(true);
        }}
        title="Drag to move the section and everything in it · double-click to rename"
      >
        {editing ? (
          <input
            ref={ref}
            className="nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') finish(true);
              if (e.key === 'Escape') finish(false);
            }}
          />
        ) : (
          <span>{data.label || 'Section'}</span>
        )}
        {selected && !editing && (
          <span className="section-colors nodrag">
            {SECTION_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch small${c === data.color ? ' active' : ''}`}
                style={{ background: c }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSection(id, { color: c });
                }}
                title="Section color"
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

export const SectionNode = memo(SectionNodeView);
