import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import {
  EMPTY_TITLE,
  SECTION_COLORS,
  type PartDefinition,
  type Rotation,
  type TitleBlock,
  type WireColor,
  type WireRoute,
  type XY,
} from '../model/format';
import { newId } from '../model/ids';
import { GRID } from '../geometry/partLayout';
import { partLayoutOf, partRect } from '../geometry/wireGeometry';
import type { Rect } from '../geometry/routing';
import type { DiagramContent } from './convert';
import {
  SECTION_DRAG_HANDLE,
  SECTION_Z,
  isPartNode,
  isSectionNode,
  type DiagramNode,
  type PartNode,
  type WireData,
  type WireEdge,
} from './types';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1200;

interface Snapshot {
  nodes: DiagramNode[];
  edges: WireEdge[];
  title: TitleBlock;
}

interface Clipboard {
  nodes: DiagramNode[];
  edges: WireEdge[];
}

export interface DiagramState extends Snapshot {
  /** IndexedDB key of the diagram being edited. */
  diagramId: string;
  past: Snapshot[];
  future: Snapshot[];
  lastCheckpoint: { key: string; at: number } | null;

  snapToGrid: boolean;
  wireColor: WireColor;
  defaultRoute: WireRoute;

  /** Active drag: start positions, section members, and wire bends. */
  drag: {
    nodeStart: Map<string, XY>;
    members: Map<string, string[]>;
    edgePoints: Map<string, XY[]>;
  } | null;

  checkpoint(key?: string): void;
  undo(): void;
  redo(): void;

  load(content: DiagramContent, diagramId: string): void;
  onNodesChange(changes: NodeChange<DiagramNode>[]): void;
  onEdgesChange(changes: EdgeChange<WireEdge>[]): void;
  connect(c: Connection): string | null;

  addPart(def: PartDefinition, at: XY): string;
  addNote(at: XY): string;
  addSection(rect: Rect, label?: string): string;
  wrapSelectionInSection(): string | null;
  setPartLabel(id: string, label: string): void;
  setNoteText(id: string, text: string): void;
  setSection(id: string, patch: Partial<{ label: string; color: string }>): void;
  updateWire(id: string, patch: Partial<WireData>, coalesceKey?: string): void;
  /** Live update while dragging a wire segment (checkpoint first). */
  setWirePoints(id: string, points: XY[] | undefined): void;
  deleteWire(id: string): void;
  /** Move one end of a wire to another pin. Returns false if that isn't allowed. */
  reconnectWire(id: string, end: 'source' | 'target', part: string, pin: string): boolean;
  deleteSelection(): void;
  rotateSelection(): void;
  flipSelection(): void;
  selectAll(): void;
  /** Select just this wire. */
  selectWire(id: string): void;
  clearSelection(): void;

  copySelection(): boolean;
  paste(): void;
  duplicateSelection(): void;

  setTitle(key: keyof TitleBlock, value: string): void;
  setSnapToGrid(v: boolean): void;
  setWireColor(c: WireColor): void;
  setDefaultRoute(r: WireRoute): void;

  beginDrag(dragged: DiagramNode[]): void;
  dragUpdate(dragged: DiagramNode[]): void;
  endDrag(): void;
}

let clipboard: Clipboard | null = null;
let pasteCount = 0;

const snapV = (v: number) => Math.round(v / GRID) * GRID;

export function nodeRect(n: DiagramNode): Rect {
  if (isPartNode(n)) return partRect(n);
  return {
    x: n.position.x,
    y: n.position.y,
    width: n.width ?? n.measured?.width ?? 0,
    height: n.height ?? n.measured?.height ?? 0,
  };
}

/**
 * Nearest spot to `at` where a w×h part doesn't touch any other part or
 * note (sections are fine to land in). Searches outward in rings.
 */
export function freeSpot(nodes: DiagramNode[], w: number, h: number, at: XY, gap = 30): XY {
  const rects = nodes.filter((n) => n.type !== 'section').map(nodeRect);
  const clear = (x: number, y: number) =>
    rects.every((r) => x + w + gap <= r.x || x >= r.x + r.width + gap || y + h + gap <= r.y || y >= r.y + r.height + gap);
  const step = 40;
  for (let ring = 0; ring < 40; ring++) {
    const spots: XY[] = [];
    for (let i = -ring; i <= ring; i++)
      for (let j = -ring; j <= ring; j++)
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) spots.push({ x: at.x + i * step, y: at.y + j * step });
    spots.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
    const hit = spots.find((p) => clear(p.x, p.y));
    if (hit) return { x: snapV(hit.x), y: snapV(hit.y) };
  }
  return at;
}

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export const useDiagram = create<DiagramState>()((set, get) => {
  /** Apply a change to the document, recording undo history first. */
  const commit = (fn: (s: DiagramState) => Partial<DiagramState>, key?: string) => {
    get().checkpoint(key);
    set((s) => fn(s));
  };

  const selectedParts = (s: DiagramState) => s.nodes.filter((n): n is PartNode => isPartNode(n) && !!n.selected);

  /** Rotate/flip changes which way pins face, so manual routes of touching wires reset. */
  const reorient = (transform: (n: PartNode) => PartNode['data']) =>
    commit((s) => {
      const changed = new Set<string>();
      const nodes = s.nodes.map((n) => {
        if (!isPartNode(n) || !n.selected) return n;
        changed.add(n.id);
        const before = partLayoutOf(n);
        const data = transform(n);
        const after = partLayoutOf({ ...n, data });
        // Keep the part centred where it was.
        const cx = n.position.x + before.width / 2;
        const cy = n.position.y + before.height / 2;
        return { ...n, data, position: { x: snapV(cx - after.width / 2), y: snapV(cy - after.height / 2) } };
      });
      const edges = s.edges.map((e) =>
        (changed.has(e.source) || changed.has(e.target)) && e.data?.points
          ? { ...e, data: { ...e.data, points: undefined } }
          : e,
      );
      return { nodes, edges };
    });

  return {
    nodes: [],
    edges: [],
    title: { ...EMPTY_TITLE },
    diagramId: '',
    past: [],
    future: [],
    lastCheckpoint: null,
    snapToGrid: true,
    wireColor: 'red',
    defaultRoute: 'orthogonal',
    drag: null,

    checkpoint(key) {
      const s = get();
      const now = Date.now();
      if (key && s.lastCheckpoint?.key === key && now - s.lastCheckpoint.at < COALESCE_MS) {
        set({ lastCheckpoint: { key, at: now } });
        return;
      }
      const snap: Snapshot = { nodes: s.nodes, edges: s.edges, title: s.title };
      set({
        past: [...s.past, snap].slice(-HISTORY_LIMIT),
        future: [],
        lastCheckpoint: key ? { key, at: now } : null,
      });
    },

    undo() {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        ...prev,
        past: s.past.slice(0, -1),
        future: [{ nodes: s.nodes, edges: s.edges, title: s.title }, ...s.future],
        lastCheckpoint: null,
      });
    },

    redo() {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({
        ...next,
        future: s.future.slice(1),
        past: [...s.past, { nodes: s.nodes, edges: s.edges, title: s.title }],
        lastCheckpoint: null,
      });
    },

    load(content, diagramId) {
      set({ ...content, diagramId, past: [], future: [], lastCheckpoint: null, drag: null });
    },

    onNodesChange(changes) {
      // Removals go through onBeforeDelete → checkpoint; resizes checkpoint on start.
      set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
    },

    onEdgesChange(changes) {
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
    },

    connect(c) {
      const s = get();
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return null;
      if (c.source === c.target && c.sourceHandle === c.targetHandle) return null;
      const dup = s.edges.some(
        (e) =>
          (e.source === c.source && e.sourceHandle === c.sourceHandle && e.target === c.target && e.targetHandle === c.targetHandle) ||
          (e.source === c.target && e.sourceHandle === c.targetHandle && e.target === c.source && e.targetHandle === c.sourceHandle),
      );
      if (dup) return null;
      const id = newId('w');
      const edge: WireEdge = {
        id,
        type: 'wire',
        source: c.source,
        sourceHandle: c.sourceHandle,
        target: c.target,
        targetHandle: c.targetHandle,
        selected: true,
        data: { color: s.wireColor, route: s.defaultRoute },
      };
      commit((s) => ({
        nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        edges: [...s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)), edge],
      }));
      return id;
    },

    addPart(def, at) {
      const id = newId('p');
      const node: PartNode = {
        id,
        type: 'part',
        position: { x: snapV(at.x), y: snapV(at.y) },
        selected: true,
        data: { def, label: def.name, rotation: 0 as Rotation, flip: false },
      };
      commit((s) => ({
        nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
        edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      }));
      return id;
    },

    addNote(at) {
      const id = newId('n');
      commit((s) => ({
        nodes: [
          ...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          { id, type: 'note', position: { x: snapV(at.x), y: snapV(at.y) }, width: 180, height: 80, selected: true, data: { text: '' } },
        ],
      }));
      return id;
    },

    addSection(rect, label = 'Section') {
      const id = newId('s');
      const count = get().nodes.filter(isSectionNode).length;
      commit((s) => ({
        nodes: [
          {
            id,
            type: 'section',
            position: { x: snapV(rect.x), y: snapV(rect.y) },
            width: Math.max(80, snapV(rect.width)),
            height: Math.max(60, snapV(rect.height)),
            zIndex: SECTION_Z,
            dragHandle: SECTION_DRAG_HANDLE,
            data: { label, color: SECTION_COLORS[count % SECTION_COLORS.length] },
          },
          ...s.nodes,
        ],
      }));
      return id;
    },

    wrapSelectionInSection() {
      const sel = get().nodes.filter((n) => n.selected && !isSectionNode(n));
      if (!sel.length) return null;
      const rects = sel.map(nodeRect);
      const pad = 30;
      const x0 = Math.min(...rects.map((r) => r.x)) - pad;
      const y0 = Math.min(...rects.map((r) => r.y)) - pad - 10;
      const x1 = Math.max(...rects.map((r) => r.x + r.width)) + pad;
      const y1 = Math.max(...rects.map((r) => r.y + r.height)) + pad;
      return get().addSection({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    },

    setPartLabel(id, label) {
      commit(
        (s) => ({
          nodes: s.nodes.map((n) => (n.id === id && isPartNode(n) ? { ...n, data: { ...n.data, label } } : n)),
        }),
        `label:${id}`,
      );
    },

    setNoteText(id, text) {
      commit(
        (s) => ({ nodes: s.nodes.map((n) => (n.id === id && n.type === 'note' ? { ...n, data: { text } } : n)) }),
        `note:${id}`,
      );
    },

    setSection(id, patch) {
      commit(
        (s) => ({
          nodes: s.nodes.map((n) => (n.id === id && isSectionNode(n) ? { ...n, data: { ...n.data, ...patch } } : n)),
        }),
        `section:${id}:${Object.keys(patch).join()}`,
      );
    },

    updateWire(id, patch, coalesceKey) {
      commit(
        (s) => ({ edges: s.edges.map((e) => (e.id === id && e.data ? { ...e, data: { ...e.data, ...patch } } : e)) }),
        coalesceKey,
      );
    },

    setWirePoints(id, points) {
      set((s) => ({
        edges: s.edges.map((e) => (e.id === id && e.data ? { ...e, data: { ...e.data, points } } : e)),
      }));
    },

    reconnectWire(id, end, part, pin) {
      const s = get();
      const w = s.edges.find((e) => e.id === id);
      if (!w) return false;
      const next = end === 'source' ? { ...w, source: part, sourceHandle: pin } : { ...w, target: part, targetHandle: pin };
      if (next.source === w.source && next.sourceHandle === w.sourceHandle && next.target === w.target && next.targetHandle === w.targetHandle)
        return false; // dropped back where it was
      if (next.source === next.target && next.sourceHandle === next.targetHandle) return false;
      const dup = s.edges.some(
        (e) =>
          e.id !== id &&
          ((e.source === next.source && e.sourceHandle === next.sourceHandle && e.target === next.target && e.targetHandle === next.targetHandle) ||
            (e.source === next.target && e.sourceHandle === next.targetHandle && e.target === next.source && e.targetHandle === next.sourceHandle)),
      );
      if (dup) return false;
      // The old bends were shaped for the old pin; re-route.
      commit((s) => ({
        edges: s.edges.map((e) => (e.id === id ? { ...next, data: { ...next.data!, points: undefined } } : e)),
      }));
      return true;
    },

    deleteWire(id) {
      commit((s) => ({ edges: s.edges.filter((e) => e.id !== id) }));
    },

    deleteSelection() {
      const s = get();
      const gone = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id));
      if (!gone.size && !s.edges.some((e) => e.selected)) return;
      commit((s) => ({
        nodes: s.nodes.filter((n) => !gone.has(n.id)),
        edges: s.edges.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)),
      }));
    },

    rotateSelection() {
      if (!selectedParts(get()).length) return;
      reorient((n) => ({ ...n.data, rotation: ((n.data.rotation + 90) % 360) as Rotation }));
    },

    flipSelection() {
      if (!selectedParts(get()).length) return;
      reorient((n) => ({ ...n.data, flip: !n.data.flip }));
    },

    selectAll() {
      set((s) => ({
        nodes: s.nodes.map((n) => (n.selected ? n : { ...n, selected: true })),
        edges: s.edges.map((e) => (e.selected ? e : { ...e, selected: true })),
      }));
    },

    selectWire(id) {
      set((s) => ({
        nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        edges: s.edges.map((e) => (e.id === id ? { ...e, selected: true } : e.selected ? { ...e, selected: false } : e)),
      }));
    },

    clearSelection() {
      set((s) => ({
        nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      }));
    },

    copySelection() {
      const s = get();
      const nodes = s.nodes.filter((n) => n.selected);
      if (!nodes.length) return false;
      const ids = new Set(nodes.map((n) => n.id));
      // A wire comes along when both of its ends are copied.
      const edges = s.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
      clipboard = structuredClone({ nodes, edges });
      pasteCount = 0;
      return true;
    },

    paste() {
      if (!clipboard) return;
      pasteCount++;
      const offset = 20 * pasteCount;
      const idMap = new Map<string, string>();
      const nodes: DiagramNode[] = clipboard.nodes.map((n) => {
        const id = newId(n.id.split('_')[0] || 'p');
        idMap.set(n.id, id);
        return {
          ...structuredClone(n),
          id,
          selected: true,
          position: { x: n.position.x + offset, y: n.position.y + offset },
        } as DiagramNode;
      });
      const edges: WireEdge[] = clipboard.edges.map((e) => ({
        ...structuredClone(e),
        id: newId('w'),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        selected: false,
        data: {
          ...e.data!,
          points: e.data!.points?.map((p) => ({ x: p.x + offset, y: p.y + offset })),
        },
      }));
      commit((s) => ({
        nodes: [
          ...nodes.filter(isSectionNode),
          ...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          ...nodes.filter((n) => !isSectionNode(n)),
        ],
        edges: [...s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)), ...edges],
      }));
    },

    duplicateSelection() {
      if (get().copySelection()) get().paste();
    },

    setTitle(key, value) {
      commit((s) => ({ title: { ...s.title, [key]: value } }), `title:${key}`);
    },

    setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
    setWireColor: (wireColor) => set({ wireColor }),
    setDefaultRoute: (defaultRoute) => set({ defaultRoute }),

    beginDrag(dragged) {
      const s = get();
      const draggedIds = new Set(dragged.map((d) => d.id));
      const nodeStart = new Map(s.nodes.map((n) => [n.id, { ...n.position }]));
      const members = new Map<string, string[]>();
      for (const d of dragged) {
        const sec = s.nodes.find((n) => n.id === d.id);
        if (!sec || !isSectionNode(sec)) continue;
        const rect = nodeRect(sec);
        members.set(
          sec.id,
          s.nodes.filter((n) => n.id !== sec.id && !draggedIds.has(n.id) && inside(nodeRect(n), rect)).map((n) => n.id),
        );
      }
      const edgePoints = new Map<string, XY[]>();
      for (const e of s.edges) if (e.data?.points?.length) edgePoints.set(e.id, e.data.points);
      set({ drag: { nodeStart, members, edgePoints } });
    },

    dragUpdate(dragged) {
      const drag = get().drag;
      if (!drag) return;
      set((s) => {
        let nodes = s.nodes;
        // Everything inside a dragged section rides along.
        const moves = new Map<string, XY>();
        for (const d of dragged) {
          const ids = drag.members.get(d.id);
          const start = drag.nodeStart.get(d.id);
          if (!ids || !start) continue;
          const dx = d.position.x - start.x;
          const dy = d.position.y - start.y;
          for (const id of ids) {
            const p = drag.nodeStart.get(id)!;
            moves.set(id, { x: p.x + dx, y: p.y + dy });
          }
        }
        if (moves.size) nodes = nodes.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n));

        // A wire whose two ends moved together keeps its shape: shift its bends.
        const delta = new Map<string, XY>();
        for (const n of nodes) {
          const st = drag.nodeStart.get(n.id);
          if (st) delta.set(n.id, { x: n.position.x - st.x, y: n.position.y - st.y });
        }
        let edgesChanged = false;
        const edges = s.edges.map((e) => {
          const pts = drag.edgePoints.get(e.id);
          if (!pts || !e.data) return e;
          const a = delta.get(e.source);
          const b = delta.get(e.target);
          if (!a || !b || a.x !== b.x || a.y !== b.y) return e;
          const moved = pts.map((p) => ({ x: p.x + a.x, y: p.y + a.y }));
          const cur = e.data.points;
          if (cur && cur.length === moved.length && cur.every((p, i) => p.x === moved[i].x && p.y === moved[i].y))
            return e;
          edgesChanged = true;
          return { ...e, data: { ...e.data, points: moved } };
        });
        return edgesChanged ? { nodes, edges } : { nodes };
      });
    },

    endDrag() {
      set({ drag: null });
    },
  };
});

/** Undo-able snapshot of the document for persistence/export. */
export const currentContent = (): DiagramContent => {
  const { nodes, edges, title } = useDiagram.getState();
  return { nodes, edges, title };
};
