import { computeHops } from '../geometry/hops';
import { optimizeWires } from '../geometry/optimize';
import { computeWireGeometry } from '../geometry/wireGeometry';
import { BUILTIN_PARTS } from '../library/builtin';
import type { Rotation } from '../model/format';
import type { DiagramNode, WireEdge } from '../store/types';

const def = (name: string) => BUILTIN_PARTS.find((p) => p.name === name)!;

/** An ESP32 driving four RC522 readers through JST "bus" connectors. */
export function rfidScene() {
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
  }, 20_000);

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

describe('Optimize wires: fans', () => {
  /** A reader's SPI pins down into a JST below it, as drawn by hand. */
  function fan() {
    const rc = def('RFID RC522');
    const jst = def('JST 6-pin');
    const nodes: DiagramNode[] = [
      { id: 'rc', type: 'part', position: { x: 110, y: 40 }, data: { def: rc, label: 'rc', rotation: 0, flip: false } },
      { id: 'jst', type: 'part', position: { x: 100, y: 360 }, data: { def: jst, label: 'jst', rotation: 90, flip: false } },
    ];
    const edges: WireEdge[] = [
      ['SCK', '6'],
      ['MOSI', '5'],
      ['MISO', '4'],
      ['RST', '3'],
    ].map(([a, b], i) => ({
      id: `w${i}`,
      type: 'wire',
      source: 'rc',
      sourceHandle: a,
      target: 'jst',
      targetHandle: b,
      data: { color: 'red', route: 'orthogonal' },
    }));
    return { nodes, edges };
  }

  it('nests the wires instead of crossing them', () => {
    const { nodes, edges } = fan();
    const r = optimizeWires(nodes, edges);
    console.log('fan', r.before, '→', r.after);
    expect(r.after.crossings).toBe(0);
    expect(r.after.overlap).toBe(0);
  });
});

describe('Optimize wires: a row of readers, each fanning into its own JST', () => {
  function readers(fans: number[]) {
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
    part('esp', 'ESP32 DevKit V1', -400, 0);
    for (let k = 0; k < 4; k++) {
      part(`rc${k}`, 'RFID RC522', 120 + k * 240, 108);
      part(`j${k}`, 'JST 6-pin', 80 + k * 240, 516, 90);
      wire('esp', ['D21', 'D22', 'D27', 'D32'][k], `rc${k}`, 'SDA/SS');
    }
    for (const k of fans)
      for (const [a, b] of [['SCK', '6'], ['MOSI', '5'], ['MISO', '4'], ['RST', '3'], ['GND', '2'], ['3.3V', '1']])
        wire(`rc${k}`, a, `j${k}`, b);
    return { nodes, edges };
  }

  it('makes every fan equally tidy (only the crossing its pin order forces)', () => {
    const { nodes, edges } = readers([0, 3]);
    const r = optimizeWires(nodes, edges);
    const after = edges.map((e) => (r.points.has(e.id) ? { ...e, data: { ...e.data!, points: r.points.get(e.id) } } : e));
    const geo = computeWireGeometry(nodes, after);
    for (const k of [0, 3]) {
      const fan = after.filter((e) => e.source === `rc${k}`).map((e) => geo.get(e.id)!.points);
      // GND is above RST on the reader but lands right of it on the JST: one crossing.
      expect(computeHops(fan).reduce((n, h) => n + h.length, 0)).toBe(1);
    }
  }, 20_000);
});
