/**
 * The connection list: every wire as "from pin → color → to pin → label",
 * derived from the diagram (nothing extra is stored).
 */
import type { DiagramContent } from '../store/convert';
import { isPartNode, type PartNode } from '../store/types';
import { WIRE_COLORS, wireColorName, type WireColor } from './format';

export interface ConnectionEnd {
  part: string;
  pin: string;
}

export interface ConnectionRow {
  wireId: string;
  from: ConnectionEnd;
  to: ConnectionEnd;
  color: WireColor;
  stripe?: WireColor;
  colorName: string;
  label: string;
}

const isBoard = (n: PartNode | undefined) => n?.data.def.category === 'Boards';

export function connectionRows({ nodes, edges }: Pick<DiagramContent, 'nodes' | 'edges'>): ConnectionRow[] {
  const parts = new Map<string, PartNode>();
  for (const n of nodes) if (isPartNode(n)) parts.set(n.id, n);
  const end = (partId: string, pinId: string | null | undefined): ConnectionEnd & { order: number } => {
    const p = parts.get(partId);
    const pins = p?.data.def.pins ?? [];
    const i = pins.findIndex((x) => x.id === pinId);
    // Order pins as they sit on the part: left, right, top, bottom, then index.
    const pin = pins[i];
    const sideRank = pin ? ['left', 'right', 'top', 'bottom'].indexOf(pin.side) : 9;
    return { part: p?.data.label ?? '?', pin: pin?.label ?? pinId ?? '?', order: sideRank * 1000 + (pin?.index ?? 0) };
  };

  const rows = edges.flatMap((e) => {
    if (!e.data) return [];
    let a = end(e.source, e.sourceHandle);
    let b = end(e.target, e.targetHandle);
    // Read from the controller outward, so a board's pins line up in the table.
    if (isBoard(parts.get(e.target)) && !isBoard(parts.get(e.source))) [a, b] = [b, a];
    return [{ a, b, e }];
  });
  rows.sort((x, y) => x.a.part.localeCompare(y.a.part) || x.a.order - y.a.order || x.b.part.localeCompare(y.b.part));
  return rows.map(({ a, b, e }) => ({
    wireId: e.id,
    from: { part: a.part, pin: a.pin },
    to: { part: b.part, pin: b.pin },
    color: e.data!.color,
    ...(e.data!.stripe ? { stripe: e.data!.stripe } : {}),
    colorName: wireColorName(e.data!),
    label: e.data!.label ?? '',
  }));
}

export const wireHex = (c: WireColor) => WIRE_COLORS[c]?.hex ?? '#999';
