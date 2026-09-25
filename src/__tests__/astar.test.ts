import type { XY } from '../model/format';
import { astarCoords, Occupancy } from '../geometry/astar';
import { pathFromCoords, simplify, type Anchor, type Rect } from '../geometry/routing';
import { computeWireGeometry } from '../geometry/wireGeometry';
import { BUILTIN_PARTS } from '../library/builtin';
import type { DiagramNode, WireEdge } from '../store/types';

const hitsRect = (path: XY[], r: Rect) =>
  path.some((a, i) => {
    if (i === 0) return false;
    const b = path[i - 1];
    return (
      Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width &&
      Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height
    );
  });

describe('A* auto-router', () => {
  const S: Anchor = { x: 100, y: 200, side: 'right' };
  const T: Anchor = { x: 500, y: 200, side: 'left' };

  it('goes straight when nothing is in the way', () => {
    const c = astarCoords(S, T, [], new Occupancy())!;
    expect(simplify(pathFromCoords(S, T, c, true))).toEqual([{ x: 100, y: 200 }, { x: 500, y: 200 }]);
  });

  it('routes around a part in the way, never through it', () => {
    const block: Rect = { x: 250, y: 120, width: 100, height: 160 };
    const c = astarCoords(S, T, [block], new Occupancy())!;
    const path = simplify(pathFromCoords(S, T, c, true));
    expect(hitsRect(path, block)).toBe(false);
    expect(path[0]).toEqual({ x: 100, y: 200 });
    expect(path[path.length - 1]).toEqual({ x: 500, y: 200 });
  });

  it('keeps a second parallel wire off the first one', () => {
    const occ = new Occupancy();
    const a1: Anchor = { x: 100, y: 100, side: 'right' };
    const b1: Anchor = { x: 400, y: 300, side: 'left' };
    const p1 = simplify(pathFromCoords(a1, b1, astarCoords(a1, b1, [], occ)!, true));
    occ.add(p1);
    const a2: Anchor = { x: 100, y: 120, side: 'right' };
    const b2: Anchor = { x: 400, y: 320, side: 'left' };
    const p2 = simplify(pathFromCoords(a2, b2, astarCoords(a2, b2, [], occ)!, true));
    const vertical = (p: XY[]) => p.filter((q, i) => i > 0 && q.x === p[i - 1].x).map((q) => q.x);
    expect(vertical(p1).some((x) => vertical(p2).includes(x))).toBe(false);
  });

  it('routes a busy board quickly', () => {
    const esp = BUILTIN_PARTS.find((p) => p.id === 'esp32-devkit-v1-30')!;
    const xlr = BUILTIN_PARTS.find((p) => p.name === 'XLR Jack')!;
    const nodes: DiagramNode[] = [
      { id: 'esp', type: 'part', position: { x: 400, y: 100 }, data: { def: esp, label: esp.name, rotation: 0, flip: false } },
    ];
    const edges: WireEdge[] = [];
    const right = esp.pins.filter((p) => p.side === 'right' && p.type !== 'gnd' && p.type !== 'power');
    const left = esp.pins.filter((p) => p.side === 'left' && p.type !== 'gnd' && p.type !== 'power');
    [...right, ...left].forEach((pin, i) => {
      const onRight = pin.side === 'right';
      const id = `x${i}`;
      nodes.push({
        id,
        type: 'part',
        position: { x: onRight ? 800 + (i % 3) * 180 : -300 - (i % 3) * 180, y: 20 + Math.floor(i / 3) * 130 },
        data: { def: xlr, label: id, rotation: 0, flip: false },
      });
      edges.push({ id: `w${i}`, type: 'wire', source: 'esp', sourceHandle: pin.id, target: id, targetHandle: '1', data: { color: 'red', route: 'orthogonal' } });
    });
    computeWireGeometry(nodes, edges); // warm up the JIT
    const t0 = performance.now();
    const moved = nodes.map((n) => (n.id === 'esp' ? { ...n, position: { x: 410, y: 110 } } : n));
    const geo = computeWireGeometry(moved, edges);
    const ms = performance.now() - t0;
    expect(geo.size).toBe(edges.length);
    // Budget for one drag frame on a slow work PC is generous here; typical is a few ms.
    expect(ms).toBeLessThan(400);
    console.log(`${edges.length} wires routed in ${ms.toFixed(1)} ms`);
  });
});
