import { WIRE_COLORS, WIRE_COLOR_NAMES, wireColorName, type WireColor } from '../model/format';
import { useDiagram } from '../store/diagramStore';
import type { DiagramNode } from '../store/types';
import { isPartNode } from '../store/types';

/** "Part label · pin label" for one end of a wire. */
export function pinName(nodes: DiagramNode[], partId: string, pinId: string | null | undefined) {
  const n = nodes.find((x) => x.id === partId);
  if (!n || !isPartNode(n)) return '?';
  const pin = n.data.def.pins.find((p) => p.id === pinId);
  return `${n.data.label} · ${pin?.label ?? pinId}`;
}

function Swatches({
  value,
  onPick,
  allowNone,
  className,
}: {
  value?: WireColor;
  onPick: (c?: WireColor) => void;
  allowNone?: boolean;
  className: string;
}) {
  return (
    <div className={`swatches ${className}`}>
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
          title={WIRE_COLORS[c].label}
          aria-label={WIRE_COLORS[c].label}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

/**
 * The wire editor, docked at the top of the canvas while exactly one wire is
 * selected (click a wire, pick one in the Connections list, or draw a new
 * one): color, stripe, label, routing and delete — without covering the
 * parts you're working on.
 */
export function WireBar() {
  const wire = useDiagram((s) => {
    const sel = s.edges.filter((e) => e.selected);
    return sel.length === 1 && !s.nodes.some((n) => n.selected) ? sel[0] : null;
  });
  const nodes = useDiagram((s) => s.nodes);
  const updateWire = useDiagram((s) => s.updateWire);
  const deleteWire = useDiagram((s) => s.deleteWire);
  const setWireColor = useDiagram((s) => s.setWireColor);
  const clearSelection = useDiagram((s) => s.clearSelection);
  if (!wire?.data) return null;
  const d = wire.data;

  return (
    <div
      className="wire-bar"
      role="region"
      aria-label="Wire"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="wire-bar-head">
        <strong>Wire · {wireColorName(d)}</strong>
        <span className="wire-bar-ends">
          {pinName(nodes, wire.source, wire.sourceHandle)} → {pinName(nodes, wire.target, wire.targetHandle)}
        </span>
        <button className="btn small danger" onClick={() => deleteWire(wire.id)} title="Delete this wire (Del)">
          Delete wire
        </button>
        <button className="icon-btn" onClick={clearSelection} title="Close (Esc)" aria-label="Close">
          ×
        </button>
      </div>

      <div className="wire-bar-grid">
        <span className="field-label">Color</span>
        <Swatches
          className="wire-bar-colors"
          value={d.color}
          onPick={(c) => {
            if (!c) return;
            updateWire(wire.id, { color: c });
            setWireColor(c);
          }}
        />
        <span className="field-label">Stripe</span>
        <Swatches className="wire-bar-stripes" value={d.stripe} allowNone onPick={(c) => updateWire(wire.id, { stripe: c })} />
        <label className="field-label" htmlFor="wire-label">
          Label
        </label>
        <div className="wire-bar-row">
          <input
            id="wire-label"
            className="text-input"
            placeholder="e.g. D23 → Top XLR 1"
            value={d.label ?? ''}
            onChange={(e) => updateWire(wire.id, { label: e.target.value || undefined }, `wirelabel:${wire.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
          <div className="segmented" title="How this wire is drawn">
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
      </div>
    </div>
  );
}
