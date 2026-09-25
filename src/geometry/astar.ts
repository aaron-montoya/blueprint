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
const CLEARANCE = 4; // obstacles are inflated by this much
const BEND_COST = 3; // in grid steps
const OVERLAP_COST = 12; // per grid step shared with an earlier wire
const CROSS_COST = 1;
const MAX_STATES = 400_000;
const HEURISTIC_WEIGHT = 1.3;

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

function search(S: Anchor, T: Anchor, obstacles: Rect[], occ: Occupancy, margin: number): XY[] | null {
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
  blocked[sj * nx + si] = 0;
  blocked[tj * nx + ti] = 0;

  const startDir = dirOf(sideNormal(S.side));
  const endDir = opposite(dirOf(sideNormal(T.side))); // direction of travel into T
  buffers(nx * ny * 4);
  const g = gBuf;
  const parent = parentBuf;
  const stamp = stampBuf;
  const closed = closedBuf;
  const G = gen;
  const heap = new Heap();
  const h = (i: number, j: number) => (Math.abs(xs[i] - T.x) + Math.abs(ys[j] - T.y)) / GRID;

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
      if (nd !== dir) cost += BEND_COST;
      if (horizontal ? stepH[j * nx + Math.min(i, ni)] : stepV[Math.min(j, nj) * nx + i]) cost += OVERLAP_COST;
      if (horizontal ? crossForH[nc] : crossForV[nc]) cost += CROSS_COST;
      const ns = nc * 4 + nd;
      const ng = g[s] + cost;
      if (stamp[ns] !== G || ng < g[ns]) {
        stamp[ns] = G;
        g[ns] = ng;
        parent[ns] = s;
        // Weighted heuristic: slightly less optimal, an order of magnitude fewer states.
        const hh = h(ni, nj);
        heap.push(ns, ng + hh * HEURISTIC_WEIGHT);
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
export function astarCoords(S: Anchor, T: Anchor, obstacles: Rect[], occ: Occupancy): number[] | null {
  if (S.x === T.x && S.y === T.y) return null;
  const path = search(S, T, obstacles, occ, MARGIN) ?? search(S, T, obstacles, occ, WIDE_MARGIN);
  if (!path) return null;
  return coordsFromPoints(corners(path), isHorizontalSide(S.side));
}
