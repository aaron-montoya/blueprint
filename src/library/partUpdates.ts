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
 * after its old definition takes the new name). Wires to pins that no longer
 * exist are removed; the count is returned so the UI can say so.
 */
export function applyPartUpdates(
  nodes: DiagramNode[],
  edges: WireEdge[],
  updates: { node: PartNode; latest: PartDefinition }[],
): { nodes: DiagramNode[]; edges: WireEdge[]; removedWires: number } {
  const latestFor = new Map(updates.map((u) => [u.node.id, u.latest]));
  const nextNodes = nodes.map((n) => {
    const latest = latestFor.get(n.id);
    if (!latest || !isPartNode(n)) return n;
    const label = n.data.label === n.data.def.name ? latest.name : n.data.label;
    return { ...n, data: { ...n.data, def: latest, label } };
  });
  const pinsOf = new Map<string, Set<string>>();
  for (const n of nextNodes) if (isPartNode(n)) pinsOf.set(n.id, new Set(n.data.def.pins.map((p) => p.id)));
  const ok = (part: string, pin: string | null | undefined) => !!pin && !!pinsOf.get(part)?.has(pin);
  const nextEdges = edges.filter((e) => ok(e.source, e.sourceHandle) && ok(e.target, e.targetHandle));
  return { nodes: nextNodes, edges: nextEdges, removedWires: edges.length - nextEdges.length };
}
