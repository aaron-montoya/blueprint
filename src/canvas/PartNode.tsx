import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { PIN_TYPE_INFO, type PartDefinition, type PinSide } from '../model/format';
import { layoutPart, PIN_SIZE, type LaidOutPin, type PartLayout } from '../geometry/partLayout';
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
    <PartBody
      layout={layout}
      def={data.def}
      selected={selected}
      header={
        editing ? (
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
        ) : undefined
      }
      onHeaderDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(data.label);
        setEditing(true);
      }}
      renderPin={(pin, style) => (
        <Handle
          key={pin.def.id}
          id={pin.def.id}
          type="source"
          position={POSITION[pin.side]}
          className={`pin pin-${pin.def.type}`}
          style={style}
          title={`${pin.def.label} — ${PIN_TYPE_INFO[pin.def.type].label}`}
        />
      )}
    />
  );
}

/**
 * The drawn part: body, header, note, pin labels and pins. Shared by the
 * canvas node (pins are React Flow handles) and the Part Maker preview.
 */
export function PartBody({
  layout,
  def,
  selected,
  header,
  onHeaderDoubleClick,
  renderPin,
}: {
  layout: PartLayout;
  def: PartDefinition;
  selected?: boolean;
  /** Replaces the title line (e.g. with a rename input). */
  header?: React.ReactNode;
  onHeaderDoubleClick?: (e: React.MouseEvent) => void;
  renderPin: (pin: LaidOutPin, style: React.CSSProperties) => React.ReactNode;
}) {
  return (
    <div
      className={`part${selected ? ' selected' : ''}`}
      style={{ width: layout.width, height: layout.height }}
      data-category={def.category}
    >
      <div
        className="part-header"
        style={{ top: layout.headerTop, height: layout.headerHeight }}
        onDoubleClick={onHeaderDoubleClick}
        title={onHeaderDoubleClick ? 'Double-click to rename this part' : undefined}
      >
        {header ?? <div className="part-title">{layout.titleLine}</div>}
        {layout.subtitleLine && <div className="part-subtitle">{layout.subtitleLine}</div>}
      </div>

      {layout.note && (
        <div className="part-note" style={{ top: layout.note.top, height: layout.note.height }}>
          {def.note}
        </div>
      )}

      {layout.pins.map((pin) => (
        <PinLabel key={`l-${pin.def.id}`} pin={pin} />
      ))}
      {layout.pins.map((pin) =>
        renderPin(pin, {
          left: pin.x,
          top: pin.y,
          width: PIN_SIZE,
          height: PIN_SIZE,
          background: PIN_TYPE_INFO[pin.def.type].color,
        }),
      )}
    </div>
  );
}

export const PartNode = memo(PartNodeView);
