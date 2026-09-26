/**
 * "Optimize wires": reroute a set of wires together instead of one at a time.
 *
 * The live router places each wire once, in drawing order, so early wires
 * never make room for later ones. Here every wire is ripped up and rerouted
 * several times with all the others in place (rip-up and reroute), from two
 * starting points: the current layout and a fresh shortest-first layout.
 * The best layout by total score wins, so the result is never worse than
 * what was there. Results are stored as manual bends, so they stay put.
 */
import type { XY } from '../model/format';
import type { DiagramNode, PartNode, WireEdge } from '../store/types';
import { isPartNode } from '../store/types';
import { astarBends, Occupancy, type RouteCosts } from './astar';
import { computeHops } from './hops';
import { GRID, isHorizontalSide } from './partLayout';
import { coordsFromPoints, interior, pathFromCoords, simplify, type Anchor } from './routing';
import { computeWireGeometry, partRect, pinAnchor } from './wireGeometry';

/** Slower, more thorough than live routing: crossings and overlaps matter more. */
export const OPTIMIZE_COSTS: RouteCosts = { bend: 3, overlap: 20, cross: 5, margin: 150, heuristicWeight: 1.1 };
const PASSES = 3;

export interface OptimizeStats {
  crossings: number;
  /** Grid steps where two unrelated wires run on top of each other. */
  overlap: number;
  bends: number;
  /** Total length in grid steps. */
  length: number;
}

export interface OptimizeResult {
  /** New bend points per wire id (only wires that changed). */
  points: Map<string, XY[]>;
  before: OptimizeStats;
  after: OptimizeStats;
}

interface Item {
  id: string;
  S: Anchor;
  T: Anchor;
  /** Pin keys, so wires sharing a pin don't count as overlapping. */
  pins: [string, string];
}

type Layout = XY[][]; // bend points per item

function polyline(it: Item, bends: XY[]): XY[] {
  const firstH = isHorizontalSide(it.S.side);
  return simplify(pathFromCoords(it.S, it.T, coordsFromPoints(bends, firstH), firstH));
}

/** Overlapping length (grid steps) of collinear segments from wires that don't share a pin. */
function overlapSteps(lines: XY[][], pins: [string, string][]): number {
  type Seg = { w: number; key: string; a: number; b: number };
  const groups = new Map<string, Seg[]>();
  lines.forEach((pts, w) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      let seg: Seg | null = null;
      if (p.y === q.y && p.x !== q.x) seg = { w, key: `h${p.y}`, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) };
      else if (p.x === q.x && p.y !== q.y) seg = { w, key: `v${p.x}`, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y) };
      if (!seg) continue;
      const list = groups.get(seg.key) ?? [];
      list.push(seg);
      groups.set(seg.key, list);
    }
  });
  const sharePin = (i: number, j: number) => pins[i].some((p) => pins[j].includes(p));
  let total = 0;
  for (const list of groups.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const s = list[i];
        const t = list[j];
        if (s.w === t.w || sharePin(s.w, t.w)) continue;
        const len = Math.min(s.b, t.b) - Math.max(s.a, t.a);
        if (len > 0) total += len / GRID;
      }
  return total;
}

function stats(lines: XY[][], pins: [string, string][]): OptimizeStats {
  let length = 0;
  let bends = 0;
  for (const pts of lines) {
    bends += Math.max(0, pts.length - 2);
    for (let i = 0; i < pts.length - 1; i++) length += (Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y)) / GRID;
  }
  const crossings = computeHops(lines).reduce((n, h) => n + h.length, 0);
  return { crossings, overlap: overlapSteps(lines, pins), bends, length };
}

const score = (s: OptimizeStats, c: RouteCosts) => s.length + s.bends * c.bend + s.overlap * c.overlap + s.crossings * c.cross;

/**
 * Optimize the routes of `ids` (all right-angle wires when omitted). Other
 * wires stay as they are and are routed around.
 */
export function optimizeWires(
  nodes: DiagramNode[],
  edges: WireEdge[],
  ids?: Set<string>,
  costs: RouteCosts = OPTIMIZE_COSTS,
): OptimizeResult {
  const geometry = computeWireGeometry(nodes, edges);
  const parts = new Map<string, PartNode>();
  for (const n of nodes) if (isPartNode(n)) parts.set(n.id, n);
  const obstacles = [...parts.values()].map(partRect);

  const items: Item[] = [];
  const current: Layout = [];
  const fixed: XY[][] = [];
  const fixedPins: [string, string][] = [];
  for (const e of edges) {
    const g = geometry.get(e.id);
    if (!g || !e.data) continue;
    const pins: [string, string] = [`${e.source}:${e.sourceHandle}`, `${e.target}:${e.targetHandle}`];
    const S = pinAnchor(parts.get(e.source), e.sourceHandle);
    const T = pinAnchor(parts.get(e.target), e.targetHandle);
    if (e.data.route === 'orthogonal' && (!ids || ids.has(e.id)) && S && T) {
      items.push({ id: e.id, S, T, pins });
      current.push(interior(g.raw)); // lossless: keeps zero-length jogs
    } else {
      fixed.push(g.points);
      fixedPins.push(pins);
    }
  }
  const allPins = [...items.map((it) => it.pins), ...fixedPins];
  const evaluate = (layout: Layout) =>
    stats([...items.map((it, i) => polyline(it, layout[i])), ...fixed], allPins);

  const before = evaluate(current);
  if (!items.length) return { points: new Map(), before, after: before };

  const reroute = (layout: Layout, order: number[], skipUnrouted: boolean) => {
    for (const i of order) {
      const occ = new Occupancy();
      for (const pts of fixed) occ.add(pts);
      layout.forEach((b, k) => {
        if (k !== i && (!skipUnrouted || b)) occ.add(polyline(items[k], b));
      });
      const next = astarBends(items[i].S, items[i].T, obstacles, occ, costs);
      if (next) layout[i] = next;
    }
  };

  const byLength = items
    .map((it, i) => ({ i, d: Math.abs(it.S.x - it.T.x) + Math.abs(it.S.y - it.T.y) }))
    .sort((a, b) => a.d - b.d)
    .map((e) => e.i);

  // Start A: the current layout. Start B: fresh, shortest wires first.
  const startA: Layout = current.map((b) => [...b]);
  const startB: Layout = items.map(() => null as unknown as XY[]);
  reroute(startB, byLength, true);
  startB.forEach((b, i) => (startB[i] = b ?? current[i]));

  let best = current;
  let bestScore = score(before, costs);
  let bestStats = before;
  for (const layout of [startA, startB]) {
    for (let pass = 0; pass < PASSES; pass++) {
      reroute(layout, byLength, false);
      const s = evaluate(layout);
      const sc = score(s, costs);
      if (sc < bestScore - 1e-6) {
        best = layout.map((b) => [...b]);
        bestScore = sc;
        bestStats = s;
      }
    }
  }

  const same = (a: XY[], b: XY[]) => a.length === b.length && a.every((p, k) => p.x === b[k].x && p.y === b[k].y);
  const points = new Map<string, XY[]>();
  items.forEach((it, i) => {
    if (best !== current && !same(best[i], current[i])) points.set(it.id, best[i]);
  });
  return { points, before, after: bestStats };
}
