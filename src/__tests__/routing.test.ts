import type { XY } from '../model/format';
import {
  autoCoords,
  coordsFromPoints,
  dragOrthoSegment,
  interior,
  normalizeCoords,
  pathFromCoords,
  routeWire,
  simplify,
  type Anchor,
} from '../geometry/routing';
import { computeHops, pathWithHops } from '../geometry/hops';

const isOrthogonal = (path: XY[]) =>
  path.every((p, i) => i === 0 || p.x === path[i - 1].x || p.y === path[i - 1].y);

const leavesOutward = (path: XY[], a: Anchor) => {
  const p = simplify(path);
  const n = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[a.side];
  return (p[1].x - p[0].x) * n[0] + (p[1].y - p[0].y) * n[1] > 0;
};
const entersFromOutside = (path: XY[], a: Anchor) => leavesOutward([...path].reverse(), a);

describe('orthogonal routing', () => {
  const S: Anchor = { x: 100, y: 100, side: 'right' };
  const T: Anchor = { x: 300, y: 200, side: 'left' };

  it('round-trips coords through stored bend points', () => {
    for (const firstH of [true, false])
      for (const coords of [[], [150], [150, 180], [150, 180, 250, 90]]) {
        const path = pathFromCoords(S, T, coords, firstH);
        expect(isOrthogonal(path)).toBe(true);
        expect(coordsFromPoints(interior(path), firstH)).toEqual(coords);
      }
  });

  const cases: [Anchor, Anchor][] = [
    [S, T],
    [S, { x: 40, y: 260, side: 'left' }],
    [S, { x: 40, y: 260, side: 'right' }],
    [S, { x: 300, y: 300, side: 'top' }],
    [S, { x: 300, y: 20, side: 'bottom' }],
    [{ x: 100, y: 100, side: 'bottom' }, { x: 400, y: 120, side: 'left' }],
    [{ x: 100, y: 100, side: 'top' }, { x: 400, y: 300, side: 'top' }],
    [{ x: 100, y: 100, side: 'left' }, { x: 400, y: 100, side: 'right' }],
  ];
  it.each(cases)('auto-routes %o → %o orthogonally, out of and into the pins', (a, b) => {
    const path = routeWire({ source: a, target: b, route: 'orthogonal' });
    expect(isOrthogonal(path)).toBe(true);
    expect(path[0]).toEqual({ x: a.x, y: a.y });
    expect(path[path.length - 1]).toEqual({ x: b.x, y: b.y });
    expect(leavesOutward(path, a)).toBe(true);
    expect(entersFromOutside(path, b)).toBe(true);
  });

  it('keeps wires attached and orthogonal, and bends in place, when parts move', () => {
    const coords = autoCoords(S, T);
    const points = interior(pathFromCoords(S, T, coords, true));
    const dragged = dragOrthoSegment(S, T, coordsFromPoints(points, true), 1, 222);
    const stored = interior(pathFromCoords(S, T, dragged, true));
    // Move both parts somewhere else entirely.
    const S2: Anchor = { x: 40, y: 400, side: 'right' };
    const T2: Anchor = { x: 520, y: 30, side: 'left' };
    const path = routeWire({ source: S2, target: T2, route: 'orthogonal', points: stored });
    expect(path[0]).toEqual({ x: 40, y: 400 });
    expect(path[path.length - 1]).toEqual({ x: 520, y: 30 });
    expect(isOrthogonal(path)).toBe(true);
    // The manually placed vertical run is still at x = 220 (snapped).
    expect(path.some((p, i) => i > 0 && p.x === 220 && path[i - 1].x === 220)).toBe(true);
  });

  it('dragging a pin-bound segment inserts a jog instead of detaching', () => {
    const coords = [200];
    const first = dragOrthoSegment(S, T, coords, 0, 60);
    const p1 = pathFromCoords(S, T, first, true);
    expect(isOrthogonal(p1)).toBe(true);
    expect(p1[0]).toEqual({ x: 100, y: 100 });
    expect(p1.some((p) => p.y === 60)).toBe(true);
    const last = dragOrthoSegment(S, T, coords, coords.length + 1, 260);
    const p2 = pathFromCoords(S, T, last, true);
    expect(isOrthogonal(p2)).toBe(true);
    expect(p2[p2.length - 1]).toEqual({ x: 300, y: 200 });
    expect(p2.some((p) => p.y === 260)).toBe(true);
    // Final approach still comes into the left pin from the left.
    expect(entersFromOutside(p2, T)).toBe(true);
  });

  it('drops redundant coordinate pairs', () => {
    expect(normalizeCoords([100, 50, 100, 80])).toEqual([100, 80]);
    expect(normalizeCoords([100, 50, 120])).toEqual([100, 50, 120]);
  });

  it('straight wires go through their bend points', () => {
    const path = routeWire({ source: S, target: T, route: 'straight', points: [{ x: 150, y: 50 }] });
    expect(path).toEqual([{ x: 100, y: 100 }, { x: 150, y: 50 }, { x: 300, y: 200 }]);
  });
});

describe('crossing hops', () => {
  it('hops the later wire over an earlier one', () => {
    const h = computeHops([
      [{ x: 0, y: 50 }, { x: 100, y: 50 }],
      [{ x: 50, y: 0 }, { x: 50, y: 100 }],
    ]);
    expect(h[0]).toEqual([]);
    expect(h[1]).toEqual([{ segment: 0, at: 50 }]);
    expect(pathWithHops([{ x: 50, y: 0 }, { x: 50, y: 100 }], h[1])).toContain(' A ');
  });

  it('does not hop where wires share a pin or a corner', () => {
    const h = computeHops([
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 100 }],
      [{ x: 100, y: 0 }, { x: 100, y: 100 }],
    ]);
    expect(h.flat()).toEqual([]);
  });

  it('bulges horizontal hops upward whichever way the wire runs', () => {
    const right = pathWithHops([{ x: 0, y: 50 }, { x: 100, y: 50 }], [{ segment: 0, at: 50 }]);
    const left = pathWithHops([{ x: 100, y: 50 }, { x: 0, y: 50 }], [{ segment: 0, at: 50 }]);
    expect(right).toContain('A 5 5 0 0 1 55 50');
    expect(left).toContain('A 5 5 0 0 0 45 50');
  });
});
