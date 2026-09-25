import { useReactFlow } from '@xyflow/react';
import { useMemo } from 'react';
import { computeWireGeometry, labelAnchor } from '../geometry/wireGeometry';
import { connectionRows, wireHex } from '../model/connections';
import { useDiagram } from '../store/diagramStore';

/** Every wire as a table row. Click a row to select the wire and pan to it. */
export function ConnectionsPanel() {
  const nodes = useDiagram((s) => s.nodes);
  const edges = useDiagram((s) => s.edges);
  const selectWire = useDiagram((s) => s.selectWire);
  const { setCenter, getZoom } = useReactFlow();
  const rows = useMemo(() => connectionRows({ nodes, edges }), [nodes, edges]);
  const selected = new Set(edges.filter((e) => e.selected).map((e) => e.id));

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
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.wireId}
            className={selected.has(r.wireId) ? 'selected' : ''}
            onClick={() => show(r.wireId)}
            title={r.label ? `Label: ${r.label}` : 'Click to find this wire'}
          >
            <td>
              <span className="conn-part">{r.from.part}</span>
              <span className="conn-pin">{r.from.pin}</span>
            </td>
            <td className="conn-wire">
              <span
                className={`wire-chip${r.color === 'white' ? ' white' : ''}`}
                style={{
                  background: r.stripe
                    ? `repeating-linear-gradient(90deg, ${wireHex(r.color)} 0 5px, ${wireHex(r.stripe)} 5px 10px)`
                    : wireHex(r.color),
                }}
              />
              <span className="conn-color">{r.colorName}</span>
              {r.label && <span className="conn-label">{r.label}</span>}
            </td>
            <td>
              <span className="conn-part">{r.to.part}</span>
              <span className="conn-pin">{r.to.pin}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
