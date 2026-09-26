import { optimizeWires } from '../geometry/optimize';
import { computeWireGeometry } from '../geometry/wireGeometry';
import { BUILTIN_PARTS } from '../library/builtin';
import type { Rotation } from '../model/format';
import type { DiagramNode, WireEdge } from '../store/types';

const def = (name: string) => BUILTIN_PARTS.find((p) => p.name === name)!;

/** An ESP32 driving four RC522 readers through JST "bus" connectors. */
function rfidScene() {
  const nodes: DiagramNode[] = [];
  const edges: WireEdge[] = [];
  const part = (id: string, name: string, x: number, y: number, rotation: Rotation = 0) =>
    nodes.push({ id, type: 'part', position: { x, y }, data: { def: def(name), label: id, rotation, flip: false } });
  const wire = (s: string, sp: string, t: string, tp: string) =>
    edges.push({
      id: `w${edges.length}`,
      type: 'wire',
      source: s,
      sourceHandle: sp,
      target: t,
      targetHandle: tp,
      data: { color: 'red', route: 'orthogonal' },
    });

  part('esp', 'ESP32 DevKit V1', 0, 400);
  for (let k = 0; k < 4; k++) part(`rc${k}`, 'RFID RC522', 400 + k * 260, 450);
  const buses: [string, string, string][] = [
    ['sck', 'D18', 'SCK'],
    ['mosi', 'D23', 'MOSI'],
    ['miso', 'D19', 'MISO'],
    ['rst', 'D33', 'RST'],
  ];
  buses.forEach(([id], k) => part(id, 'JST 5-pin', 400 + k * 260, 850, 90));
  part('gnd', 'JST 6-pin', 500, 200, 90);
  part('v33', 'JST 5-pin', 800, 200, 90);
  for (const [id, espPin, rcPin] of buses) {
    wire('esp', espPin, id, '1');
    for (let k = 0; k < 4; k++) wire(id, String(k + 2), `rc${k}`, rcPin);
  }
  ['D21', 'D22', 'D27', 'D32'].forEach((p, k) => wire('esp', p, `rc${k}`, 'SDA/SS'));
  wire('esp', 'GND.right', 'gnd', '1');
  wire('esp', '3V3', 'v33', '1');
  for (let k = 0; k < 4; k++) {
    wire('gnd', `${k + 2}.right`, `rc${k}`, 'GND');
    wire('v33', `${k + 2}.right`, `rc${k}`, '3.3V');
  }
  return { nodes, edges };
}

describe('Optimize wires', () => {
  it('never makes the layout worse, and untangles a busy diagram', () => {
    const { nodes, edges } = rfidScene();
    const t0 = performance.now();
    const r = optimizeWires(nodes, edges);
    const ms = performance.now() - t0;
    console.log(`optimized ${edges.length} wires in ${ms.toFixed(0)} ms`, r.before, '→', r.after);
    expect(r.after.crossings + r.after.overlap).toBeLessThan(r.before.crossings + r.before.overlap);
    expect(ms).toBeLessThan(10_000);

    // Stored as bends, the new routes reproduce exactly.
    const optimized = edges.map((e) => (r.points.has(e.id) ? { ...e, data: { ...e.data!, points: r.points.get(e.id) } } : e));
    const again = optimizeWires(nodes, optimized);
    expect(again.before).toEqual(r.after);
    expect(computeWireGeometry(nodes, optimized).size).toBe(edges.length);
  });

  it('only touches the wires asked for', () => {
    const { nodes, edges } = rfidScene();
    const only = new Set(['w0', 'w1', 'w2']);
    const r = optimizeWires(nodes, edges, only);
    for (const id of r.points.keys()) expect(only.has(id)).toBe(true);
  });

  it('leaves straight wires alone', () => {
    const { nodes, edges } = rfidScene();
    const straight = edges.map((e) => ({ ...e, data: { ...e.data!, route: 'straight' as const } }));
    expect(optimizeWires(nodes, straight).points.size).toBe(0);
  });
});
