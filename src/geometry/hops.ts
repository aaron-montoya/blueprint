/**
 * Wire crossings. A wire hops (small arc) over every wire drawn before it,
 * so a crossing can never be mistaken for a connection. Wires that meet at a
 * shared pin touch only at segment endpoints and never hop.
 */
import type { XY } from '../model/format';

export const HOP_RADIUS = 5;

export interface Hop {
  /** Segment index within the wire's polyline. */
  segment: number;
  /** Distance from the segment start. */
  at: number;
}

const EPS = 1e-6;

/** Intersection parameters (t on ab, u on cd), or null. Parallel = null. */
function intersect(a: XY, b: XY, c: XY, d: XY): { t: number; u: number } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return null;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return { t, u };
}

/** Compute the hops for every wire. `polylines[i]` is hopped over by nothing after it. */
export function computeHops(polylines: XY[][]): Hop[][] {
  const result: Hop[][] = polylines.map(() => []);
  for (let i = 1; i < polylines.length; i++) {
    const pi = polylines[i];
    for (let s = 0; s < pi.length - 1; s++) {
      const a = pi[s];
      const b = pi[s + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 2 * HOP_RADIUS + 2) continue;
      const found: number[] = [];
      for (let j = 0; j < i; j++) {
        const pj = polylines[j];
        for (let q = 0; q < pj.length - 1; q++) {
          const c = pj[q];
          const d = pj[q + 1];
          // Cheap bounding-box reject.
          if (Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.min(c.x, d.x) > Math.max(a.x, b.x)) continue;
          if (Math.max(c.y, d.y) < Math.min(a.y, b.y) || Math.min(c.y, d.y) > Math.max(a.y, b.y)) continue;
          const hit = intersect(a, b, c, d);
          if (!hit) continue;
          const lenCD = Math.hypot(d.x - c.x, d.y - c.y);
          // Strictly interior on both segments (touching at a corner/pin is not a crossing).
          const tMin = 0.5 / len;
          const uMin = 0.5 / Math.max(lenCD, EPS);
          if (hit.t <= tMin || hit.t >= 1 - tMin || hit.u <= uMin || hit.u >= 1 - uMin) continue;
          const at = hit.t * len;
          // Keep the arc on the segment.
          if (at < HOP_RADIUS + 1 || at > len - HOP_RADIUS - 1) continue;
          found.push(at);
        }
      }
      found.sort((x, y) => x - y);
      let last = -Infinity;
      for (const at of found) {
        if (at - last < 2 * HOP_RADIUS + 1) continue; // overlapping hops merge into one
        result[i].push({ segment: s, at });
        last = at;
      }
    }
  }
  return result;
}

const fmt = (n: number) => Math.round(n * 100) / 100;

/** SVG path data for a polyline, with semicircle hops. Hops bulge up (or left). */
export function pathWithHops(points: XY[], hops: Hop[]): string {
  if (points.length === 0) return '';
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s];
    const b = points[s + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / (len || 1);
    const uy = (b.y - a.y) / (len || 1);
    for (const h of hops) {
      if (h.segment !== s) continue;
      const r = HOP_RADIUS;
      const p0 = { x: a.x + ux * (h.at - r), y: a.y + uy * (h.at - r) };
      const p1 = { x: a.x + ux * (h.at + r), y: a.y + uy * (h.at + r) };
      // Sweep so the bulge points toward -y (or -x for vertical runs).
      // In SVG's y-down space, sweep = 1 bulges to the left of the travel direction.
      const leftNormal = { x: uy, y: -ux };
      const sweep = leftNormal.y < -EPS || (Math.abs(leftNormal.y) <= EPS && leftNormal.x < 0) ? 1 : 0;
      d += ` L ${fmt(p0.x)} ${fmt(p0.y)} A ${r} ${r} 0 0 ${sweep} ${fmt(p1.x)} ${fmt(p1.y)}`;
    }
    d += ` L ${fmt(b.x)} ${fmt(b.y)}`;
  }
  return d;
}
