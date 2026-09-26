/**
 * Obstacle-aware orthogonal auto-routing: A* over grid lines.
 *
 * Every part body is an obstacle (so an auto-routed wire can never pass over
 * someone else's pin and look connected to it). Bends cost extra, running on
 * top of an earlier wire costs a lot, and crossing one costs a little. The
 * result is converted into the same alternating-coordinate form that manual
 * edits use, so freezing an auto-route (by dragging it) is lossless.
 */
import type { XY } from '../model/format';
import { GRID, isHorizontalSide, sideNormal } from './partLayout';
import { coordsFromPoints, type Anchor, type Rect } from './routing';

const MARGIN = 80; // search area around the two pins
const WIDE_MARGIN = 400; // retry area if the first search finds nothing
export const CLEARANCE = 8; // obstacles are inflated by this much (pins stick out 5)
/** In front of a pin: this far out along its normal, this far to either side. */
export const PIN_KEEP_OUT = GRID + 2;
export const PIN_KEEP_SIDE = 6;
const MAX_STATES = 400_000;

/** Search costs, in grid steps. */
export interface RouteCosts {
  bend: number;
  /** Per grid step run on top of another wire. */
  overlap: number;
  cross: number;
  /** Per grid step through the space right in front of a pin the wire isn't connected to. */
  pin: number;
  /** Per grid step squeezed through a one-line gap between two parts. */
  squeeze: number;
  /** Search area around the two pins. */
  margin: number;
  /** >1 trades optimality for speed. */
  heuristicWeight: number;
  /**
   * Tie-breaker for where bends go, per grid step: > 0 prefers bending early
   * (near the source), < 0 late (near the target). The optimizer tries both,
   * so wires fanning out of a row of pins can nest instead of crossing.
   */
  turnBias?: number;
}
/** Live routing (runs on every drag frame): fast. */
export const LIVE_COSTS: RouteCosts = { bend: 3, overlap: 12, cross: 1, pin: 10, squeeze: 6, margin: MARGIN, heuristicWeight: 1.3 };

// Search buffers are reused between searches (routing runs on every drag
// frame). `stamp[s] === gen` marks entries written by the current search.
let cap = 0;
let gBuf = new Float64Array(0);
let parentBuf = new Int32Array(0);
let stampBuf = new Uint32Array(0);
let closedBuf = new Uint32Array(0);
let gen = 0;
function buffers(n: number) {
  if (n > cap) {
    cap = Math.max(n, cap * 2);
    gBuf = new Float64Array(cap);
    parentBuf = new Int32Array(cap);
    stampBuf = new Uint32Array(cap);
    closedBuf = new Uint32Array(cap);
    gen = 0;
  }
  gen++;
  if (gen === 0xffffffff) {
    stampBuf.fill(0);
    closedBuf.fill(0);
    gen = 1;
  }
}

/** Segments already on the canvas, indexed by the line they run along. */
export class Occupancy {
  readonly h = new Map<number, [number, number][]>();
  readonly v = new Map<number, [number, number][]>();

  add(points: XY[]) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a.y === b.y && a.x !== b.x) push(this.h, a.y, a.x, b.x);
      else if (a.x === b.x && a.y !== b.y) push(this.v, a.x, a.y, b.y);
    }
  }
}

function push(m: Map<number, [number, number][]>, key: number, a: number, b: number) {
  const list = m.get(key) ?? [];
  list.push([Math.min(a, b), Math.max(a, b)]);
  m.set(key, list);
}
/** Index range [first, last] of sorted `vals` inside (lo, hi) or [lo, hi]. */
function range(vals: number[], lo: number, hi: number, strict: boolean): [number, number] {
  let a = lowerBound(vals, lo);
  if (strict) while (a < vals.length && vals[a] <= lo + 0.5) a++;
  let b = lowerBound(vals, hi + 1e-9) - 1;
  if (strict) while (b >= 0 && vals[b] >= hi - 0.5) b--;
  return [a, b];
}
function lowerBound(vals: number[], v: number) {
  let lo = 0;
  let hi = vals.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (vals[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Sorted grid lines covering [lo, hi], plus the exact extra values. */
function lines(lo: number, hi: number, extra: number[]): number[] {
  const set = new Set<number>(extra);
  for (let v = Math.ceil(lo / GRID) * GRID; v <= hi; v += GRID) set.add(v);
  return [...set].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
}

// Directions: 0 +x, 1 -x, 2 +y, 3 -y.
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];
const dirOf = (n: XY) => (n.x > 0 ? 0 : n.x < 0 ? 1 : n.y > 0 ? 2 : 3);
const opposite = (d: number) => d ^ 1;

class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    const it = this.items;
    const ks = this.keys;
    let i = it.length;
    it.push(item);
    ks.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= key) break;
      it[i] = it[p];
      ks[i] = ks[p];
      i = p;
    }
    it[i] = item;
    ks[i] = key;
  }
  pop(): number {
    const it = this.items;
    const ks = this.keys;
    const top = it[0];
    const lastI = it.pop()!;
    const lastK = ks.pop()!;
    if (it.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= it.length) break;
        const r = l + 1;
        const c = r < it.length && ks[r] < ks[l] ? r : l;
        if (ks[c] >= lastK) break;
        it[i] = it[c];
        ks[i] = ks[c];
        i = c;
      }
      it[i] = lastI;
      ks[i] = lastK;
    }
    return top;
  }
}

function search(
  S: Anchor,
  T: Anchor,
  obstacles: Rect[],
  occ: Occupancy,
  pins: Anchor[],
  margin: number,
  costs: RouteCosts,
): XY[] | null {
  const xs = lines(Math.min(S.x, T.x) - margin, Math.max(S.x, T.x) + margin, [S.x, T.x]);
  const ys = lines(Math.min(S.y, T.y) - margin, Math.max(S.y, T.y) + margin, [S.y, T.y]);
  const nx = xs.length;
  const ny = ys.length;
  if (nx * ny * 4 > MAX_STATES) return null;

  const blocked = new Uint8Array(nx * ny);
  for (const r of obstacles) {
    const [i0, i1] = range(xs, r.x - CLEARANCE, r.x + r.width + CLEARANCE, true);
    const [j0, j1] = range(ys, r.y - CLEARANCE, r.y + r.height + CLEARANCE, true);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
  }
  // Earlier wires: stepH[c] = the step from cell c to c+1 (along x) lies on
  // a wire; stepV likewise along y; cross* = a wire passes through cell c
  // across the direction of travel.
  const stepH = new Uint8Array(nx * ny);
  const stepV = new Uint8Array(nx * ny);
  const crossForH = new Uint8Array(nx * ny);
  const crossForV = new Uint8Array(nx * ny);
  const yIndex = new Map(ys.map((y, j) => [y, j]));
  const xIndex = new Map(xs.map((x, i) => [x, i]));
  for (const [y, list] of occ.h) {
    const j = yIndex.get(y);
    if (j === undefined) continue;
    for (const [a, b] of list) {
      const [i0, i1] = range(xs, a, b, false);
      for (let i = i0; i < i1; i++) stepH[j * nx + i] = 1;
      const [k0, k1] = range(xs, a, b, true);
      for (let i = k0; i <= k1; i++) crossForV[j * nx + i] = 1;
    }
  }
  for (const [x, list] of occ.v) {
    const i = xIndex.get(x);
    if (i === undefined) continue;
    for (const [a, b] of list) {
      const [j0, j1] = range(ys, a, b, false);
      for (let j = j0; j < j1; j++) stepV[j * nx + i] = 1;
      const [k0, k1] = range(ys, a, b, true);
      for (let j = k0; j <= k1; j++) crossForH[j * nx + i] = 1;
    }
  }
  const si = xs.indexOf(S.x);
  const sj = ys.indexOf(S.y);
  const ti = xs.indexOf(T.x);
  const tj = ys.indexOf(T.y);
  const startDir = dirOf(sideNormal(S.side));
  const endDir = opposite(dirOf(sideNormal(T.side))); // direction of travel into T
  // A one-line gap between two parts: blocked on both sides across the
  // direction of travel. Wires can squeeze through, but it looks cramped.
  const isBlocked = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && blocked[j * nx + i] === 1;
  const narrowH = new Uint8Array(nx * ny); // for travel along x
  const narrowV = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (blocked[j * nx + i]) continue;
      if (isBlocked(i, j - 1) && isBlocked(i, j + 1)) narrowH[j * nx + i] = 1;
      if (isBlocked(i - 1, j) && isBlocked(i + 1, j)) narrowV[j * nx + i] = 1;
    }

  // Keep a way out of each end pin through the clearance zone.
  const clearOut = (i: number, j: number, d: number) => {
    const x0 = xs[i];
    const y0 = ys[j];
    while (i >= 0 && j >= 0 && i < nx && j < ny && Math.abs(xs[i] - x0) + Math.abs(ys[j] - y0) <= CLEARANCE + GRID) {
      blocked[j * nx + i] = 0;
      narrowH[j * nx + i] = narrowV[j * nx + i] = 0;
      i += DX[d];
      j += DY[d];
    }
  };
  clearOut(si, sj, startDir);
  clearOut(ti, tj, opposite(endDir));

  // Right in front of other pins: passing there looks like a connection.
  const keepOut = new Uint8Array(nx * ny);
  for (const P of pins) {
    if ((P.x === S.x && P.y === S.y) || (P.x === T.x && P.y === T.y)) continue;
    const n = sideNormal(P.side);
    const x0 = n.x ? P.x + Math.min(0, n.x * PIN_KEEP_OUT) : P.x - PIN_KEEP_SIDE;
    const x1 = n.x ? P.x + Math.max(0, n.x * PIN_KEEP_OUT) : P.x + PIN_KEEP_SIDE;
    const y0 = n.y ? P.y + Math.min(0, n.y * PIN_KEEP_OUT) : P.y - PIN_KEEP_SIDE;
    const y1 = n.y ? P.y + Math.max(0, n.y * PIN_KEEP_OUT) : P.y + PIN_KEEP_SIDE;
    if (x1 < xs[0] || x0 > xs[nx - 1] || y1 < ys[0] || y0 > ys[ny - 1]) continue;
    const [i0, i1] = range(xs, x0, x1, false);
    const [j0, j1] = range(ys, y0, y1, false);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) keepOut[j * nx + i] = 1;
  }
  buffers(nx * ny * 4);
  const g = gBuf;
  const parent = parentBuf;
  const stamp = stampBuf;
  const closed = closedBuf;
  const G = gen;
  const heap = new Heap();
  const h = (i: number, j: number) => (Math.abs(xs[i] - T.x) + Math.abs(ys[j] - T.y)) / GRID;
  const bias = costs.turnBias ?? 0;

  const start = (sj * nx + si) * 4 + startDir;
  g[start] = 0;
  parent[start] = -1;
  stamp[start] = G;
  heap.push(start, h(si, sj));

  while (heap.size) {
    const s = heap.pop();
    if (closed[s] === G) continue;
    closed[s] = G;
    const dir = s & 3;
    const cell = s >> 2;
    const i = cell % nx;
    const j = (cell - i) / nx;
    if (i === ti && j === tj) {
      if (dir !== endDir) continue;
      // Walk back to S, keeping corners.
      const pts: XY[] = [];
      let cur = s;
      while (cur !== -1) {
        const c = cur >> 2;
        pts.push({ x: xs[c % nx], y: ys[Math.floor(c / nx)] });
        cur = parent[cur];
      }
      return pts.reverse();
    }
    const atStart = s === start;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === opposite(dir)) continue;
      if (atStart && nd !== startDir) continue; // leave the pin straight out
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      if (blocked[nj * nx + ni]) continue;
      // Only enter T moving the right way.
      if (ni === ti && nj === tj && nd !== endDir) continue;
      const horizontal = nd < 2;
      const nc = nj * nx + ni;
      let cost = (Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j])) / GRID;
      if (nd !== dir) {
        cost += costs.bend;
        if (bias > 0) cost += bias * (Math.abs(xs[i] - S.x) + Math.abs(ys[j] - S.y)) / GRID;
        else if (bias < 0) cost -= bias * h(i, j);
      }
      if (horizontal ? stepH[j * nx + Math.min(i, ni)] : stepV[Math.min(j, nj) * nx + i]) cost += costs.overlap;
      if (horizontal ? crossForH[nc] : crossForV[nc]) cost += costs.cross;
      if (keepOut[nc]) cost += costs.pin;
      if (horizontal ? narrowH[nc] : narrowV[nc]) cost += costs.squeeze;
      const ns = nc * 4 + nd;
      const ng = g[s] + cost;
      if (stamp[ns] !== G || ng < g[ns]) {
        stamp[ns] = G;
        g[ns] = ng;
        parent[ns] = s;
        // Weighted heuristic: slightly less optimal, an order of magnitude fewer states.
        const hh = h(ni, nj);
        heap.push(ns, ng + hh * costs.heuristicWeight);
      }
    }
  }
  return null;
}

/** Corner points of an orthogonal polyline (drops points in the middle of runs). */
function corners(path: XY[]): XY[] {
  const out: XY[] = [];
  for (let k = 1; k < path.length - 1; k++) {
    const a = path[k - 1];
    const b = path[k];
    const c = path[k + 1];
    const h1 = a.y === b.y;
    const h2 = b.y === c.y;
    if (h1 !== h2) out.push(b);
  }
  return out;
}

/**
 * Route one wire around obstacles. Returns alternating coordinates, or null
 * if no route was found (callers fall back to the simple router).
 */
export function astarCoords(S: Anchor, T: Anchor, obstacles: Rect[], occ: Occupancy, pins: Anchor[] = []): number[] | null {
  const bends = astarBends(S, T, obstacles, occ, LIVE_COSTS, pins);
  return bends && coordsFromPoints(bends, isHorizontalSide(S.side));
}

/** Route one wire; returns its bend points (what a wire stores as `points`), or null. */
export function astarBends(
  S: Anchor,
  T: Anchor,
  obstacles: Rect[],
  occ: Occupancy,
  costs: RouteCosts,
  pins: Anchor[] = [],
): XY[] | null {
  if (S.x === T.x && S.y === T.y) return null;
  const path =
    search(S, T, obstacles, occ, pins, costs.margin, costs) ??
    search(S, T, obstacles, occ, pins, Math.max(WIDE_MARGIN, costs.margin), costs);
  return path && corners(path);
}
