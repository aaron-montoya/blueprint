import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { PIN_TYPE_INFO, type PinSide } from '../model/format';
import { layoutPart, PIN_SIZE, type LaidOutPin } from '../geometry/partLayout';
import { useDiagram } from '../store/diagramStore';
import type { PartNode as PartNodeType } from '../store/types';

const POSITION: Record<PinSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

function PinLabel({ pin }: { pin: LaidOutPin }) {
  const gap = PIN_SIZE / 2 + 3;
  const style: React.CSSProperties = {};
  let cls = `pin-label pin-label-${pin.side}`;
  switch (pin.side) {
    case 'left':
      style.left = pin.x + gap;
      style.top = pin.y;
      break;
    case 'right':
      style.right = `calc(100% - ${pin.x - gap}px)`;
      style.top = pin.y;
      break;
    case 'top':
      style.left = pin.x;
      style.top = pin.y + gap;
      break;
    case 'bottom':
      style.left = pin.x;
      style.bottom = `calc(100% - ${pin.y - gap}px)`;
      break;
  }
  if (pin.verticalLabel) cls += ' vertical';
  return (
    <span className={cls} style={style}>
      {pin.def.label}
    </span>
  );
}

function PartNodeView({ id, data, selected }: NodeProps<PartNodeType>) {
  const layout = layoutPart(data.def, data.rotation, data.flip, data.label);
  const setPartLabel = useDiagram((s) => s.setPartLabel);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // F2 (or the toolbar) asks a selected part to start renaming.
  useEffect(() => {
    const onRename = (e: Event) => {
      if ((e as CustomEvent).detail === id) {
        setDraft(data.label);
        setEditing(true);
      }
    };
    window.addEventListener('blueprint:rename', onRename);
    return () => window.removeEventListener('blueprint:rename', onRename);
  }, [id, data.label]);

  const finish = (save: boolean) => {
    setEditing(false);
    const v = draft.trim() || data.def.name;
    if (save && v !== data.label) setPartLabel(id, v);
  };

  return (
    <div
      className={`part${selected ? ' selected' : ''}`}
      style={{ width: layout.width, height: layout.height }}
      data-category={data.def.category}
    >
      <div
        className="part-header"
        style={{ top: layout.headerTop, height: layout.headerHeight }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(data.label);
          setEditing(true);
        }}
        title="Double-click to rename this part"
      >
        {editing ? (
          <input
            ref={inputRef}
            className="part-title-input nodrag"
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
          <div className="part-title">{layout.titleLine}</div>
        )}
        {layout.subtitleLine && <div className="part-subtitle">{layout.subtitleLine}</div>}
      </div>

      {layout.note && (
        <div className="part-note" style={{ top: layout.note.top, height: layout.note.height }}>
          {data.def.note}
        </div>
      )}

      {layout.pins.map((pin) => (
        <PinLabel key={`l-${pin.def.id}`} pin={pin} />
      ))}
      {layout.pins.map((pin) => (
        <Handle
          key={pin.def.id}
          id={pin.def.id}
          type="source"
          position={POSITION[pin.side]}
          className={`pin pin-${pin.def.type}`}
          style={{
            left: pin.x,
            top: pin.y,
            width: PIN_SIZE,
            height: PIN_SIZE,
            background: PIN_TYPE_INFO[pin.def.type].color,
          }}
          title={`${pin.def.label} — ${PIN_TYPE_INFO[pin.def.type].label}`}
        />
      ))}
    </div>
  );
}

export const PartNode = memo(PartNodeView);
