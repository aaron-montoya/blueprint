/**
 * "Optimize wires": reroute a set of wires together instead of one at a time.
 *
 * The live router places each wire once, in drawing order, so early wires
 * never make room for later ones. Here every wire is ripped up and rerouted
 * several times with all the others in place (rip-up and reroute), from the
 * current layout and from fresh layouts, then crossing pairs are rerouted
 * together. The best layout by total score wins, so the result is never
 * worse than what was there. Results are stored as manual bends, so they stay put.
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
const TURN_BIAS = 0.05;
const REPAIR_ROUNDS = 4;
/** Stop improving after this long; the best layout so far wins. */
const TIME_BUDGET_MS = 2500;

const same = (a: XY[], b: XY[]) => a.length === b.length && a.every((p, k) => p.x === b[k].x && p.y === b[k].y);

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

interface Line {
  pts: XY[];
  pins: [string, string];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function line(pts: XY[], pins: [string, string]): Line {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { pts, pins, x0, x1, y0, y1 };
}

/** Length (grid steps) and bends of one wire. */
function own(l: Line) {
  let length = 0;
  const p = l.pts;
  for (let i = 0; i < p.length - 1; i++) length += (Math.abs(p[i + 1].x - p[i].x) + Math.abs(p[i + 1].y - p[i].y)) / GRID;
  return { length, bends: Math.max(0, p.length - 2) };
}

/** Crossings and overlap (grid steps; ignored for wires sharing a pin) between two wires. */
function between(a: Line, b: Line) {
  if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) return { crossings: 0, overlap: 0 };
  const crossings = computeHops([a.pts, b.pts])[1].length;
  let overlap = 0;
  if (!a.pins.some((p) => b.pins.includes(p))) {
    const p = a.pts;
    const q = b.pts;
    for (let i = 0; i < p.length - 1; i++)
      for (let j = 0; j < q.length - 1; j++) {
        const [s0, s1, t0, t1] = [p[i], p[i + 1], q[j], q[j + 1]];
        let len = 0;
        if (s0.y === s1.y && t0.y === t1.y && s0.y === t0.y)
          len = Math.min(Math.max(s0.x, s1.x), Math.max(t0.x, t1.x)) - Math.max(Math.min(s0.x, s1.x), Math.min(t0.x, t1.x));
        else if (s0.x === s1.x && t0.x === t1.x && s0.x === t0.x)
          len = Math.min(Math.max(s0.y, s1.y), Math.max(t0.y, t1.y)) - Math.max(Math.min(s0.y, s1.y), Math.min(t0.y, t1.y));
        if (len > 0) overlap += len / GRID;
      }
  }
  return { crossings, overlap };
}

function stats(lines: Line[]): OptimizeStats {
  const s: OptimizeStats = { crossings: 0, overlap: 0, bends: 0, length: 0 };
  lines.forEach((l, i) => {
    const o = own(l);
    s.length += o.length;
    s.bends += o.bends;
    for (let j = i + 1; j < lines.length; j++) {
      const b = between(l, lines[j]);
      s.crossings += b.crossings;
      s.overlap += b.overlap;
    }
  });
  return s;
}

const score = (s: OptimizeStats, c: RouteCosts) => s.length + s.bends * c.bend + s.overlap * c.overlap + s.crossings * c.cross;

/** Score of the wires in `moved` plus their interactions with everything (the rest cancels out in a comparison). */
function localScore(lines: Line[], moved: number[], c: RouteCosts) {
  let total = 0;
  for (const m of moved) {
    const o = own(lines[m]);
    total += o.length + o.bends * c.bend;
    for (let k = 0; k < lines.length; k++) {
      if (k === m || (moved.includes(k) && k < m)) continue;
      const b = between(lines[m], lines[k]);
      total += b.crossings * c.cross + b.overlap * c.overlap;
    }
  }
  return total;
}

/**
 * Optimize the routes of `ids` (all right-angle wires when omitted). Other
 * wires stay as they are and are routed around.
 */
export function optimizeWires(
  nodes: DiagramNode[],
  edges: WireEdge[],
  ids?: Set<string>,
  costs: RouteCosts = OPTIMIZE_COSTS,
  budgetMs = TIME_BUDGET_MS,
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
  const fixedLines = fixed.map((pts, i) => line(pts, fixedPins[i]));
  const linesOf = (layout: Layout) => [...items.map((it, i) => line(polyline(it, layout[i]), it.pins)), ...fixedLines];
  const evaluate = (layout: Layout) => stats(linesOf(layout));

  const before = evaluate(current);
  if (!items.length) return { points: new Map(), before, after: before };
  const started = performance.now();
  const outOfTime = () => performance.now() - started > budgetMs;

  /** Route `order` one at a time with everything else in place; null entries are not routed yet. */
  const reroute = (layout: Layout, order: number[], c: RouteCosts) => {
    let changed = false;
    const lines = layout.map((b, k) => (b ? polyline(items[k], b) : null));
    for (const i of order) {
      const occ = new Occupancy();
      for (const pts of fixed) occ.add(pts);
      lines.forEach((pts, k) => k !== i && pts && occ.add(pts));
      const next = astarBends(items[i].S, items[i].T, obstacles, occ, c);
      if (next && !(layout[i] && same(next, layout[i]))) {
        layout[i] = next;
        lines[i] = polyline(items[i], next);
        changed = true;
      }
    }
    return changed;
  };

  const dist = (it: Item) => Math.abs(it.S.x - it.T.x) + Math.abs(it.S.y - it.T.y);
  const shortFirst = items.map((_, i) => i).sort((a, b) => dist(items[a]) - dist(items[b]));
  const longFirst = [...shortFirst].reverse();

  let best = current;
  let bestScore = score(before, costs);
  const consider = (layout: Layout) => {
    const sc = score(evaluate(layout), costs);
    if (sc < bestScore - 1e-6) {
      best = layout.map((b) => [...b]);
      bestScore = sc;
    }
  };
  const improve = (layout: Layout, order: number[], c: RouteCosts) => {
    for (let pass = 0; pass < PASSES && !outOfTime(); pass++) {
      if (!reroute(layout, order, c)) break;
      consider(layout);
    }
  };

  // 1. Rip-up and reroute, from the current layout and from fresh layouts
  //    built in different orders with bends biased early, late or neither.
  improve(current.map((b) => [...b]), shortFirst, costs);
  for (const turnBias of [0, TURN_BIAS, -TURN_BIAS])
    for (const order of [shortFirst, longFirst]) {
      if (outOfTime()) break;
      const c = { ...costs, turnBias };
      const layout: Layout = items.map(() => null as unknown as XY[]);
      reroute(layout, order, c);
      layout.forEach((b, i) => (layout[i] = b ?? current[i]));
      consider(layout);
      improve(layout, order, c);
    }

  // 2. Repair crossings pair by pair. A crossing often needs both wires to
  //    move at once (a fan of wires in the wrong nesting order), which the
  //    one-at-a-time passes can't do: rip up both and reroute them together,
  //    both ways round, keeping whatever scores better.
  const layout = best.map((b) => [...b]);
  const lines = linesOf(layout);
  for (let round = 0; round < REPAIR_ROUNDS && !outOfTime(); round++) {
    let improved = false;
    for (let a = 0; a < items.length && !outOfTime(); a++)
      for (let b = a + 1; b < items.length; b++) {
        if (!between(lines[a], lines[b]).crossings) continue;
        const pair = [a, b];
        let bestLocal = localScore(lines, pair, costs);
        let pick: [XY[], XY[]] | null = null;
        for (const turnBias of [0, TURN_BIAS, -TURN_BIAS])
          for (const order of [pair, [b, a]]) {
            const trial = layout.slice();
            trial[a] = trial[b] = null as unknown as XY[];
            reroute(trial, order, { ...costs, turnBias });
            if (!trial[a] || !trial[b]) continue;
            const was = [lines[a], lines[b]];
            lines[a] = line(polyline(items[a], trial[a]), items[a].pins);
            lines[b] = line(polyline(items[b], trial[b]), items[b].pins);
            const sc = localScore(lines, pair, costs);
            [lines[a], lines[b]] = was;
            if (sc < bestLocal - 1e-6) {
              bestLocal = sc;
              pick = [trial[a], trial[b]];
            }
          }
        if (pick) {
          [layout[a], layout[b]] = pick;
          lines[a] = line(polyline(items[a], pick[0]), items[a].pins);
          lines[b] = line(polyline(items[b], pick[1]), items[b].pins);
          improved = true;
        }
      }
    if (!improved) break;
  }
  consider(layout);

  const points = new Map<string, XY[]>();
  items.forEach((it, i) => {
    if (best !== current && !same(best[i], current[i])) points.set(it.id, best[i]);
  });
  return { points, before, after: best === current ? before : evaluate(best) };
}
