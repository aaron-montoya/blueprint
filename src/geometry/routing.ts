/**
 * Wire routing.
 *
 * An orthogonal wire leaves its source pin along the pin's normal, so its
 * first segment is horizontal for left/right pins and vertical for top/bottom
 * pins. After that the segments alternate. We store a wire's bend points but
 * *interpret* them as a list of alternating coordinates:
 *
 *     S ─h→ (c1, S.y) ─v→ (c1, c2) ─h→ (c3, c2) … ─→ T
 *
 * Only c1, c2, … survive; everything that depends on the pins is recomputed.
 * That is what keeps wires attached and orthogonal while parts move, and
 * keeps manual edits exactly where the user put them.
 */
import type { PinSide, XY } from '../model/format';
import { GRID, isHorizontalSide, sideNormal } from './partLayout';

/** A pin's absolute position and the side of the part it sits on. */
export interface Anchor extends XY {
  side: PinSide;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a wire runs straight out of a pin before its first auto bend. */
export const STUB = 20;

const snap = (v: number) => Math.round(v / GRID) * GRID;

// ---------------------------------------------------------------- coords ⇄ points

/** Bend points → alternating coordinates. */
export function coordsFromPoints(points: XY[], firstHorizontal: boolean): number[] {
  const coords: number[] = [];
  for (let j = 0; j < points.length - 1; j++) {
    const takeX = (j % 2 === 0) === firstHorizontal;
    coords.push(takeX ? points[j].x : points[j].y);
  }
  return coords;
}

/** Full raw polyline (S, corners…, T) for alternating coordinates. */
export function pathFromCoords(S: XY, T: XY, coords: number[], firstHorizontal: boolean): XY[] {
  const pts: XY[] = [{ x: S.x, y: S.y }];
  let cur = { x: S.x, y: S.y };
  let horizontal = firstHorizontal;
  for (const c of coords) {
    cur = horizontal ? { x: c, y: cur.y } : { x: cur.x, y: c };
    pts.push(cur);
    horizontal = !horizontal;
  }
  pts.push(horizontal ? { x: T.x, y: cur.y } : { x: cur.x, y: T.y });
  pts.push({ x: T.x, y: T.y });
  return pts;
}

/** Interior corners of a raw path — what gets stored as `points`. */
export const interior = (path: XY[]) => path.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));

// ---------------------------------------------------------------- auto routing

function segmentHitsRect(a: XY, b: XY, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  // Strictly inside, so running along a body edge or leaving a pin is fine.
  return x1 > r.x + 1 && x0 < r.x + r.width - 1 && y1 > r.y + 1 && y0 < r.y + r.height - 1;
}

function scorePath(path: XY[], S: Anchor, T: Anchor, avoid: Rect[]): number {
  const nS = sideNormal(S.side);
  const nT = sideNormal(T.side);
  let score = 0;
  let bends = 0;
  let prevDir = '';
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    score += len;
    if (len > 0.5) {
      const dir = a.x === b.x ? 'v' : 'h';
      if (prevDir && dir !== prevDir) bends++;
      prevDir = dir;
    }
    for (const r of avoid) if (segmentHitsRect(a, b, r)) score += 2000;
  }
  // Must leave S outward and arrive at T from outside.
  const first = path[1];
  const out = (first.x - S.x) * nS.x + (first.y - S.y) * nS.y;
  if (out < STUB / 2) score += 5000;
  const last = path[path.length - 2];
  const inn = (last.x - T.x) * nT.x + (last.y - T.y) * nT.y;
  if (inn < STUB / 2) score += 5000;
  return score + bends * 25;
}

const transpose = (p: XY): XY => ({ x: p.y, y: p.x });
const transposeSide = (s: PinSide): PinSide =>
  s === 'left' ? 'top' : s === 'right' ? 'bottom' : s === 'top' ? 'left' : 'right';
const transposeAnchor = (a: Anchor): Anchor => ({ ...transpose(a), side: transposeSide(a.side) });
const transposeRect = (r: Rect): Rect => ({ x: r.y, y: r.x, width: r.height, height: r.width });

/**
 * Choose alternating coordinates for a fresh wire. Tries a handful of classic
 * connector shapes and keeps the shortest one that leaves/enters the pins
 * outward and avoids the two part bodies.
 */
export function autoCoords(S: Anchor, T: Anchor, avoid: Rect[] = []): number[] {
  if (!isHorizontalSide(S.side)) {
    // Solve the mirrored problem; coordinates keep their meaning.
    return autoCoords(transposeAnchor(S), transposeAnchor(T), avoid.map(transposeRect));
  }
  const nS = sideNormal(S.side);
  const nT = sideNormal(T.side);
  const sx = S.x + nS.x * STUB;
  const midX = snap((S.x + T.x) / 2);
  const midY = snap((S.y + T.y) / 2);
  const candidates: number[][] = [];

  if (isHorizontalSide(T.side)) {
    const tx = T.x + nT.x * STUB;
    for (const c1 of [midX, sx, tx, Math.max(sx, tx), Math.min(sx, tx)]) candidates.push([c1]);
    const ys = [midY];
    for (const r of avoid) ys.push(r.y - STUB, r.y + r.height + STUB);
    for (const y of ys) candidates.push([sx, snap(y), tx]);
  } else {
    const ty = T.y + nT.y * STUB;
    candidates.push([]);
    for (const c1 of [sx, midX]) candidates.push([c1, ty]);
    const ys = [ty, midY];
    for (const r of avoid) ys.push(r.y - STUB, r.y + r.height + STUB);
    for (const y of ys) candidates.push([sx, snap(y)]);
    for (const x of [midX, ...avoid.flatMap((r) => [r.x - STUB, r.x + r.width + STUB])])
      candidates.push([sx, midY, snap(x), ty]);
  }

  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const s = scorePath(pathFromCoords(S, T, c, true), S, T, avoid);
    if (s < bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- public routing

export interface RouteInput {
  source: Anchor;
  target: Anchor;
  route: 'orthogonal' | 'straight';
  points?: XY[];
  /** Part bodies to steer auto-routes around (usually the two end parts). */
  avoid?: Rect[];
}

/** Raw polyline for a wire (may contain zero-length segments). */
export function routeWire({ source, target, route, points, avoid }: RouteInput): XY[] {
  if (route === 'straight') return [{ x: source.x, y: source.y }, ...(points ?? []), { x: target.x, y: target.y }];
  const firstH = isHorizontalSide(source.side);
  const coords = points && points.length ? coordsFromPoints(points, firstH) : autoCoords(source, target, avoid);
  return pathFromCoords(source, target, coords, firstH);
}

/** Drop zero-length segments and merge collinear runs, for drawing. */
export function simplify(path: XY[]): XY[] {
  const out: XY[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = last;
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
      if (Math.abs(cross) < 0.01 && dot >= 0) {
        out[out.length - 1] = { x: p.x, y: p.y };
        continue;
      }
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

// ---------------------------------------------------------------- editing

/**
 * Remove redundant coordinate pairs: when c[i] == c[i+2] the segment at
 * c[i+1] has zero length and the two can go.
 */
export function normalizeCoords(coords: number[]): number[] {
  const c = [...coords];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i + 2 < c.length; i++) {
      if (Math.abs(c[i] - c[i + 2]) < 0.5) {
        c.splice(i + 1, 2);
        changed = true;
        break;
      }
    }
  }
  return c;
}

export interface SegmentInfo {
  index: number;
  a: XY;
  b: XY;
  /** Segment runs left-right (so it is dragged up/down). */
  horizontal: boolean;
}

/** Draggable segments of an orthogonal raw path (zero-length ones skipped). */
export function orthoSegments(path: XY[]): SegmentInfo[] {
  const segs: SegmentInfo[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1) continue;
    segs.push({ index: i, a, b, horizontal: Math.abs(a.y - b.y) < 0.5 });
  }
  return segs;
}

/**
 * Move one segment of an orthogonal wire perpendicular to itself.
 * Returns the new alternating coordinates.
 *
 * Raw path segment `index`:  0 is bound to the source pin, 1..k are the
 * coordinate segments, k+1 is bound to the target pin. Dragging a bound
 * segment inserts a jog next to the pin instead of detaching the wire.
 */
export function dragOrthoSegment(
  source: Anchor,
  target: Anchor,
  coords: number[],
  index: number,
  value: number,
  snapToGrid = true,
): number[] {
  const firstH = isHorizontalSide(source.side);
  const k = coords.length;
  const v = snapToGrid ? snap(value) : Math.round(value);
  if (index >= 1 && index <= k) {
    const next = [...coords];
    next[index - 1] = v;
    return next;
  }
  if (index === 0) {
    const n = sideNormal(source.side);
    const stub = firstH ? source.x + n.x * STUB : source.y + n.y * STUB;
    return [stub, v, ...coords];
  }
  // Last segment (bound to the target). After k coordinates the path makes
  // one more move (same axis as the next coordinate would be), then the final
  // move into the pin runs on the other axis.
  const lastHorizontal = k % 2 === 0 ? !firstH : firstH;
  const n = sideNormal(target.side);
  const stub = lastHorizontal ? target.x + n.x * STUB : target.y + n.y * STUB;
  return [...coords, v, stub];
}
