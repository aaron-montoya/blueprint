import { useEffect, useRef } from 'react';
import { WIRE_COLOR_NAMES, WIRE_COLORS, wireColorName, type WireColor } from '../model/format';
import { useDiagram } from '../store/diagramStore';
import type { DiagramNode } from '../store/types';
import { isPartNode } from '../store/types';

export interface PopoverTarget {
  wireId: string;
  /** Position within the canvas wrapper, px. */
  x: number;
  y: number;
  /** Size of the canvas wrapper, to keep the popover on screen. */
  bounds: { width: number; height: number };
}

export function pinName(nodes: DiagramNode[], partId: string, pinId: string | null | undefined) {
  const n = nodes.find((x) => x.id === partId);
  if (!n || !isPartNode(n)) return '?';
  const pin = n.data.def.pins.find((p) => p.id === pinId);
  return `${n.data.label} · ${pin?.label ?? pinId}`;
}

export function Swatches({ value, onPick, allowNone }: { value?: WireColor; onPick: (c?: WireColor) => void; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none${!value ? ' active' : ''}`} onClick={() => onPick(undefined)} title="No stripe">
          ∅
        </button>
      )}
      {WIRE_COLOR_NAMES.map((c) => (
        <button
          key={c}
          className={`swatch${c === value ? ' active' : ''}${c === 'white' ? ' white' : ''}`}
          style={{ background: WIRE_COLORS[c].hex }}
          onClick={() => onPick(c)}
          title={WIRE_COLORS[c].label}
          aria-label={WIRE_COLORS[c].label}
        />
      ))}
    </div>
  );
}

export function WirePopover({ target, onClose }: { target: PopoverTarget; onClose: () => void }) {
  const wire = useDiagram((s) => s.edges.find((e) => e.id === target.wireId));
  const nodes = useDiagram((s) => s.nodes);
  const updateWire = useDiagram((s) => s.updateWire);
  const deleteWire = useDiagram((s) => s.deleteWire);
  const setWireColor = useDiagram((s) => s.setWireColor);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wire) onClose();
  }, [wire, onClose]);
  if (!wire?.data) return null;
  const d = wire.data;

  // Keep the popover inside the canvas.
  const w = 300;
  const left = Math.max(8, Math.min(target.x + 12, target.bounds.width - w - 8));
  const top = Math.max(8, Math.min(target.y + 12, target.bounds.height - 340));

  return (
    <div
      ref={ref}
      className="popover wire-popover"
      style={{ left, top, width: w }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="popover-head">
        <strong>Wire · {wireColorName(d)}</strong>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>
      <div className="wire-ends">
        {pinName(nodes, wire.source, wire.sourceHandle)} → {pinName(nodes, wire.target, wire.targetHandle)}
      </div>

      <label className="field-label">Color</label>
      <Swatches
        value={d.color}
        onPick={(c) => {
          if (!c) return;
          updateWire(wire.id, { color: c });
          setWireColor(c);
        }}
      />
      <label className="field-label">Stripe (two-color cable)</label>
      <Swatches value={d.stripe} allowNone onPick={(c) => updateWire(wire.id, { stripe: c })} />

      <label className="field-label" htmlFor="wire-label">
        Label
      </label>
      <input
        id="wire-label"
        className="text-input"
        placeholder="e.g. D23 → Top XLR 1"
        value={d.label ?? ''}
        onChange={(e) => updateWire(wire.id, { label: e.target.value || undefined }, `wirelabel:${wire.id}`)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') onClose();
        }}
      />

      <label className="field-label">Routing</label>
      <div className="row">
        <div className="segmented">
          <button
            className={d.route === 'orthogonal' ? 'active' : ''}
            onClick={() => d.route !== 'orthogonal' && updateWire(wire.id, { route: 'orthogonal', points: undefined })}
          >
            Right-angle
          </button>
          <button
            className={d.route === 'straight' ? 'active' : ''}
            onClick={() => d.route !== 'straight' && updateWire(wire.id, { route: 'straight', points: undefined })}
          >
            Straight
          </button>
        </div>
        <button
          className="btn small"
          disabled={!d.points?.length}
          onClick={() => updateWire(wire.id, { points: undefined })}
          title="Throw away manual bends and auto-route this wire"
        >
          Reset route
        </button>
      </div>

      <div className="popover-foot">
        <button
          className="btn danger"
          onClick={() => {
            deleteWire(wire.id);
            onClose();
          }}
        >
          Delete wire
        </button>
      </div>
    </div>
  );
}
