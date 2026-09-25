import { WIRE_COLORS, WIRE_COLOR_NAMES } from '../model/format';
import { useDiagram } from '../store/diagramStore';
import { pinName } from './WirePopover';

/**
 * Docked at the top of the canvas while exactly one wire is selected (every
 * new wire starts selected): pick its real color in one click without a
 * popover covering the parts you're about to wire next.
 */
export function WireBar({ onMore }: { onMore: (wireId: string) => void }) {
  const wire = useDiagram((s) => {
    const sel = s.edges.filter((e) => e.selected);
    return sel.length === 1 && !s.nodes.some((n) => n.selected) ? sel[0] : null;
  });
  const nodes = useDiagram((s) => s.nodes);
  const updateWire = useDiagram((s) => s.updateWire);
  const setWireColor = useDiagram((s) => s.setWireColor);
  if (!wire?.data) return null;
  const d = wire.data;
  return (
    <div className="wire-bar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="wire-bar-ends" title="This wire">
        {pinName(nodes, wire.source, wire.sourceHandle)} → {pinName(nodes, wire.target, wire.targetHandle)}
      </span>
      <div className="swatches">
        {WIRE_COLOR_NAMES.map((c) => (
          <button
            key={c}
            className={`swatch${c === d.color ? ' active' : ''}${c === 'white' ? ' white' : ''}`}
            style={{ background: WIRE_COLORS[c].hex }}
            title={WIRE_COLORS[c].label}
            aria-label={`Wire color ${WIRE_COLORS[c].label}`}
            onClick={() => {
              updateWire(wire.id, { color: c });
              setWireColor(c);
            }}
          />
        ))}
      </div>
      <input
        className="text-input"
        placeholder="Label"
        value={d.label ?? ''}
        onChange={(e) => updateWire(wire.id, { label: e.target.value || undefined }, `wirelabel:${wire.id}`)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      <button className="btn small" onClick={() => onMore(wire.id)} title="Stripe, routing, delete…">
        More…
      </button>
    </div>
  );
}
