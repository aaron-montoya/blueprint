import { useReactFlow } from '@xyflow/react';
import { Fragment, useMemo, useState } from 'react';
import { computeWireGeometry, labelAnchor } from '../geometry/wireGeometry';
import { connectionRows, wireHex, type ConnectionRow } from '../model/connections';
import { WIRE_COLOR_NAMES, WIRE_COLORS, type WireColor } from '../model/format';
import { useDiagram } from '../store/diagramStore';

function chipBackground(r: Pick<ConnectionRow, 'color' | 'stripe'>) {
  return r.stripe
    ? `repeating-linear-gradient(90deg, ${wireHex(r.color)} 0 5px, ${wireHex(r.stripe)} 5px 10px)`
    : wireHex(r.color);
}

function Palette({ value, onPick, none }: { value?: WireColor; onPick: (c?: WireColor) => void; none?: boolean }) {
  return (
    <div className="swatches">
      {none && (
        <button className={`swatch none${!value ? ' active' : ''}`} onClick={() => onPick(undefined)} title="No stripe">
          ∅
        </button>
      )}
      {WIRE_COLOR_NAMES.map((c) => (
        <button
          key={c}
          className={`swatch small-md${c === value ? ' active' : ''}${c === 'white' ? ' white' : ''}`}
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
 * Every wire as a table row. Click a row to find the wire on the canvas,
 * click its color to recolor/relabel it, × to delete it.
 */
export function ConnectionsPanel() {
  const nodes = useDiagram((s) => s.nodes);
  const edges = useDiagram((s) => s.edges);
  const selectWire = useDiagram((s) => s.selectWire);
  const updateWire = useDiagram((s) => s.updateWire);
  const deleteWire = useDiagram((s) => s.deleteWire);
  const { setCenter, getZoom } = useReactFlow();
  const rows = useMemo(() => connectionRows({ nodes, edges }), [nodes, edges]);
  const selected = new Set(edges.filter((e) => e.selected).map((e) => e.id));
  const [editing, setEditing] = useState<string | null>(null);

  const show = (id: string) => {
    selectWire(id);
    const g = computeWireGeometry(useDiagram.getState().nodes, useDiagram.getState().edges).get(id);
    const at = g && labelAnchor(g.points);
    if (at) setCenter(at.x, at.y, { zoom: Math.max(getZoom(), 1), duration: 250 });
  };

  if (!rows.length) return <p className="empty">No wires yet. Drag from one pin to another to add one.</p>;
  return (
    <table className="connections">
      <thead>
        <tr>
          <th>From</th>
          <th>Wire</th>
          <th>To</th>
          <th aria-label="Delete" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.wireId}>
            <tr
              className={`${selected.has(r.wireId) ? 'selected' : ''}${editing === r.wireId ? ' editing' : ''}`}
              onClick={() => show(r.wireId)}
              title={r.label ? `Label: ${r.label}` : 'Click to find this wire'}
            >
              <td>
                <span className="conn-part">{r.from.part}</span>
                <span className="conn-pin">{r.from.pin}</span>
              </td>
              <td className="conn-wire">
                <button
                  className="conn-color-btn"
                  title="Change color or label"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(editing === r.wireId ? null : r.wireId);
                  }}
                >
                  <span className={`wire-chip${r.color === 'white' ? ' white' : ''}`} style={{ background: chipBackground(r) }} />
                  <span className="conn-color">{r.colorName}</span>
                  <span className="caret">▾</span>
                </button>
                {r.label && <span className="conn-label">{r.label}</span>}
              </td>
              <td>
                <span className="conn-part">{r.to.part}</span>
                <span className="conn-pin">{r.to.pin}</span>
              </td>
              <td className="conn-actions">
                <button
                  className="icon-btn tiny"
                  title="Delete this wire (Ctrl+Z to undo)"
                  aria-label="Delete wire"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editing === r.wireId) setEditing(null);
                    deleteWire(r.wireId);
                  }}
                >
                  ×
                </button>
              </td>
            </tr>
            {editing === r.wireId && (
              <tr className="conn-editor">
                <td colSpan={4}>
                  <div className="conn-editor-row">
                    <span className="field-label">Color</span>
                    <Palette value={r.color} onPick={(c) => c && updateWire(r.wireId, { color: c })} />
                  </div>
                  <div className="conn-editor-row">
                    <span className="field-label">Stripe</span>
                    <Palette value={r.stripe} none onPick={(c) => updateWire(r.wireId, { stripe: c })} />
                  </div>
                  <div className="conn-editor-row">
                    <span className="field-label">Label</span>
                    <input
                      className="text-input"
                      placeholder="e.g. D23 → Top XLR 1"
                      value={r.label}
                      onChange={(e) => updateWire(r.wireId, { label: e.target.value || undefined }, `wirelabel:${r.wireId}`)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter' || e.key === 'Escape') setEditing(null);
                      }}
                    />
                  </div>
                  <div className="conn-editor-done">
                    <button className="btn small" onClick={() => setEditing(null)}>
                      Done
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
