import type { XY } from '../model/format';
import type { DiagramNode, PartNode, WireEdge } from '../store/types';
import { isPartNode } from '../store/types';
import { computeHops, pathWithHops, type Hop } from './hops';
import { isHorizontalSide, layoutPart, type PartLayout } from './partLayout';
import { astarCoords, Occupancy } from './astar';
import { autoCoords, coordsFromPoints, pathFromCoords, simplify, type Anchor, type Rect } from './routing';

export interface WireGeometry {
  source: Anchor;
  target: Anchor;
  /** Raw path (orthogonal: S, corners…, T incl. zero-length bits). */
  raw: XY[];
  /** Alternating coordinates (orthogonal wires only). */
  coords: number[];
  /** Simplified polyline used for drawing and crossings. */
  points: XY[];
  hops: Hop[];
  d: string;
}

export const partLayoutOf = (n: PartNode): PartLayout =>
  layoutPart(n.data.def, n.data.rotation, n.data.flip, n.data.label);

export function partRect(n: PartNode): Rect {
  const l = partLayoutOf(n);
  return { x: n.position.x, y: n.position.y, width: l.width, height: l.height };
}

/** Absolute anchor of a pin, or null if the part/pin is gone. */
export function pinAnchor(node: PartNode | undefined, pinId: string | null | undefined): Anchor | null {
  if (!node || !pinId) return null;
  const pin = partLayoutOf(node).pinById.get(pinId);
  if (!pin) return null;
  return { x: node.position.x + pin.x, y: node.position.y + pin.y, side: pin.side };
}

let lastNodes: DiagramNode[] | null = null;
let lastEdges: WireEdge[] | null = null;
let lastResult = new Map<string, WireGeometry>();

/**
 * Geometry for every wire in the diagram, including crossing hops. Memoised
 * on the node/edge arrays, so every edge component can call it cheaply.
 */
export function computeWireGeometry(nodes: DiagramNode[], edges: WireEdge[]): Map<string, WireGeometry> {
  if (nodes === lastNodes && edges === lastEdges) return lastResult;
  const parts = new Map<string, PartNode>();
  for (const n of nodes) if (isPartNode(n)) parts.set(n.id, n);

  // Manual (frozen) and straight wires are fixed; route them first so the
  // auto-router can steer the rest around them.
  const obstacles = [...parts.values()].map(partRect);
  const occupancy = new Occupancy();
  const pending: ({ id: string; g: Omit<WireGeometry, 'hops' | 'd'> } | null)[] = [];
  const auto: { index: number; id: string; source: Anchor; target: Anchor; sNode: PartNode; tNode: PartNode }[] = [];
  for (const e of edges) {
    const sNode = parts.get(e.source);
    const tNode = parts.get(e.target);
    const source = pinAnchor(sNode, e.sourceHandle);
    const target = pinAnchor(tNode, e.targetHandle);
    if (!source || !target || !e.data) continue;
    const firstH = isHorizontalSide(source.side);
    if (e.data.route === 'straight') {
      const raw = [{ x: source.x, y: source.y }, ...(e.data.points ?? []), { x: target.x, y: target.y }];
      pending.push({ id: e.id, g: { source, target, raw, coords: [], points: simplify(raw) } });
    } else if (e.data.points?.length) {
      const coords = coordsFromPoints(e.data.points, firstH);
      const raw = pathFromCoords(source, target, coords, firstH);
      const points = simplify(raw);
      occupancy.add(points);
      pending.push({ id: e.id, g: { source, target, raw, coords, points } });
    } else {
      auto.push({ index: pending.length, id: e.id, source, target, sNode: sNode!, tNode: tNode! });
      pending.push(null);
    }
  }
  for (const { index, id, source, target, sNode, tNode } of auto) {
    const firstH = isHorizontalSide(source.side);
    const coords =
      astarCoords(source, target, obstacles, occupancy) ??
      autoCoords(source, target, [partRect(sNode), ...(tNode !== sNode ? [partRect(tNode)] : [])]);
    const raw = pathFromCoords(source, target, coords, firstH);
    const points = simplify(raw);
    occupancy.add(points);
    pending[index] = { id, g: { source, target, raw, coords, points } };
  }

  const routed = pending.filter((p) => p !== null);
  const hops = computeHops(routed.map((p) => p.g.points));
  const result = new Map<string, WireGeometry>();
  routed.forEach((p, i) => result.set(p.id, { ...p.g, hops: hops[i], d: pathWithHops(p.g.points, hops[i]) }));

  lastNodes = nodes;
  lastEdges = edges;
  lastResult = result;
  return result;
}

/** Point along a polyline to hang a label on: middle of its longest segment. */
export function labelAnchor(points: XY[]): { x: number; y: number; horizontal: boolean } | null {
  let best = -1;
  let at = null as null | { x: number; y: number; horizontal: boolean };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal: Math.abs(a.y - b.y) <= Math.abs(a.x - b.x) };
    }
  }
  return at;
}
