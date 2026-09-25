/** Store (React Flow nodes/edges) ⇄ `.blueprint` file. */
import {
  FORMAT_VERSION,
  type DiagramFile,
  type NoteRecord,
  type PartInstanceRecord,
  type SectionRecord,
  type TitleBlock,
  type WireRecord,
} from '../model/format';
import type { DiagramNode, NoteNode, PartNode, SectionNode, WireEdge } from './types';
import { SECTION_DRAG_HANDLE, SECTION_Z } from './types';

export interface DiagramContent {
  nodes: DiagramNode[];
  edges: WireEdge[];
  title: TitleBlock;
}

const r = (v: number) => Math.round(v * 100) / 100;

export function toFile({ nodes, edges, title }: DiagramContent): DiagramFile {
  const parts: PartInstanceRecord[] = [];
  const notes: NoteRecord[] = [];
  const sections: SectionRecord[] = [];
  for (const n of nodes) {
    if (n.type === 'part') {
      parts.push({
        id: n.id,
        x: r(n.position.x),
        y: r(n.position.y),
        rotation: n.data.rotation,
        flip: n.data.flip,
        label: n.data.label,
        part: n.data.def,
      });
    } else if (n.type === 'note') {
      notes.push({
        id: n.id,
        x: r(n.position.x),
        y: r(n.position.y),
        width: r(n.width ?? n.measured?.width ?? 180),
        height: r(n.height ?? n.measured?.height ?? 80),
        text: n.data.text,
      });
    } else if (n.type === 'section') {
      sections.push({
        id: n.id,
        x: r(n.position.x),
        y: r(n.position.y),
        width: r(n.width ?? n.measured?.width ?? 300),
        height: r(n.height ?? n.measured?.height ?? 200),
        label: n.data.label,
        color: n.data.color,
      });
    }
  }
  const wires: WireRecord[] = edges.map((e) => {
    const w: WireRecord = {
      id: e.id,
      from: { part: e.source, pin: e.sourceHandle ?? '' },
      to: { part: e.target, pin: e.targetHandle ?? '' },
      color: e.data!.color,
      route: e.data!.route,
    };
    if (e.data!.stripe) w.stripe = e.data!.stripe;
    if (e.data!.label) w.label = e.data!.label;
    if (e.data!.points?.length) w.points = e.data!.points.map((p) => ({ x: r(p.x), y: r(p.y) }));
    return w;
  });
  return { formatVersion: FORMAT_VERSION, kind: 'blueprint-diagram', title: { ...title }, parts, wires, notes, sections };
}

export function wireToEdge(w: WireRecord): WireEdge {
  return {
    id: w.id,
    type: 'wire',
    source: w.from.part,
    sourceHandle: w.from.pin,
    target: w.to.part,
    targetHandle: w.to.pin,
    data: {
      color: w.color,
      ...(w.stripe ? { stripe: w.stripe } : {}),
      ...(w.label ? { label: w.label } : {}),
      route: w.route,
      ...(w.points?.length ? { points: w.points } : {}),
    },
  };
}

export function fromFile(file: DiagramFile): DiagramContent {
  const sections: SectionNode[] = file.sections.map((s) => ({
    id: s.id,
    type: 'section',
    position: { x: s.x, y: s.y },
    width: s.width,
    height: s.height,
    zIndex: SECTION_Z,
    dragHandle: SECTION_DRAG_HANDLE,
    data: { label: s.label, color: s.color },
  }));
  const parts: PartNode[] = file.parts.map((p) => ({
    id: p.id,
    type: 'part',
    position: { x: p.x, y: p.y },
    data: { def: p.part, label: p.label, rotation: p.rotation, flip: p.flip },
  }));
  const notes: NoteNode[] = file.notes.map((n) => ({
    id: n.id,
    type: 'note',
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    data: { text: n.text },
  }));
  return { nodes: [...sections, ...parts, ...notes], edges: file.wires.map(wireToEdge), title: { ...file.title } };
}
