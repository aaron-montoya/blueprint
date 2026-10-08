/**
 * Diagrams embed a copy of every part they use, so library fixes don't reach
 * parts already placed. These helpers find placed parts whose library
 * version has changed and describe what updating them would do.
 */
import type { PartDefinition } from '../model/format';
import type { DiagramNode, PartNode, WireEdge } from '../store/types';
import { isPartNode } from '../store/types';

const same = (a: PartDefinition, b: PartDefinition) => JSON.stringify(a) === JSON.stringify(b);

/** Placed parts whose library definition (same id) differs from their embedded copy. */
export function outdatedParts(nodes: DiagramNode[], library: PartDefinition[]): { node: PartNode; latest: PartDefinition }[] {
  const byId = new Map(library.map((p) => [p.id, p]));
  const out: { node: PartNode; latest: PartDefinition }[] = [];
  for (const n of nodes) {
    if (!isPartNode(n)) continue;
    const latest = byId.get(n.data.def.id);
    if (latest && !same(latest, n.data.def)) out.push({ node: n, latest });
  }
  return out;
}

/**
 * Apply the latest definitions. Instance labels are kept (a part still named
 * after its old definition takes the new name). A wire on a pin that was
 * renamed moves to the new pin in the same spot (same side and position,
 * e.g. MOSFET "TRIG" -> "PWM+"); wires to pins that are really gone are
 * removed, and the count is returned so the UI can say so.
 */
export function applyPartUpdates(
  nodes: DiagramNode[],
  edges: WireEdge[],
  updates: { node: PartNode; latest: PartDefinition }[],
): { nodes: DiagramNode[]; edges: WireEdge[]; removedWires: number } {
  const latestFor = new Map(updates.map((u) => [u.node.id, u.latest]));
  // Per updated part: old pin id -> new pin id.
  const pinMap = new Map<string, Map<string, string>>();
  const nextNodes = nodes.map((n) => {
    const latest = latestFor.get(n.id);
    if (!latest || !isPartNode(n)) return n;
    pinMap.set(n.id, mapPins(n.data.def, latest));
    const label = n.data.label === n.data.def.name ? latest.name : n.data.label;
    return { ...n, data: { ...n.data, def: latest, label } };
  });
  const pinsOf = new Map<string, Set<string>>();
  for (const n of nextNodes) if (isPartNode(n)) pinsOf.set(n.id, new Set(n.data.def.pins.map((p) => p.id)));
  const moved = (part: string, pin: string | null | undefined) => (pin ? (pinMap.get(part)?.get(pin) ?? pin) : pin);
  // Pins that are somewhere else on the part now (renamed or not).
  const relocated = new Map<string, Set<string>>();
  for (const u of updates) {
    const at = new Map(u.latest.pins.map((p) => [p.id, `${p.side}:${p.index}`]));
    const map = pinMap.get(u.node.id);
    relocated.set(
      u.node.id,
      new Set(u.node.data.def.pins.filter((p) => at.get(map?.get(p.id) ?? p.id) !== `${p.side}:${p.index}`).map((p) => p.id)),
    );
  }
  const relocatedEnd = (part: string, pin: string | null | undefined) => !!pin && !!relocated.get(part)?.has(pin);
  const ok = (part: string, pin: string | null | undefined) => !!pin && !!pinsOf.get(part)?.has(pin);
  const nextEdges = edges
    .map((e) => {
      const sourceHandle = moved(e.source, e.sourceHandle);
      const targetHandle = moved(e.target, e.targetHandle);
      const endMoved = relocatedEnd(e.source, e.sourceHandle) || relocatedEnd(e.target, e.targetHandle);
      if (!endMoved && sourceHandle === e.sourceHandle && targetHandle === e.targetHandle) return e;
      // A renamed pin in the same spot keeps the wire's shape; if an end
      // moved, the old manual bends no longer fit.
      return { ...e, sourceHandle, targetHandle, data: e.data && (endMoved ? { ...e.data, points: undefined } : e.data) };
    })
    .filter((e) => ok(e.source, e.sourceHandle) && ok(e.target, e.targetHandle));
  return { nodes: nextNodes, edges: nextEdges, removedWires: edges.length - nextEdges.length };
}

/** Old pin id -> new pin id: same id if it still exists, else the new pin in the same side and slot. */
function mapPins(old: PartDefinition, latest: PartDefinition): Map<string, string> {
  const latestIds = new Set(latest.pins.map((p) => p.id));
  const oldIds = new Set(old.pins.map((p) => p.id));
  const map = new Map<string, string>();
  for (const p of old.pins) {
    if (latestIds.has(p.id)) continue;
    // Only take a pin that is itself new, so two wires never pile onto one existing pin.
    const same = latest.pins.find((q) => q.side === p.side && q.index === p.index && !oldIds.has(q.id));
    if (same) map.set(p.id, same.id);
  }
  return map;
}
