import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useConnection,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type IsValidConnection,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportBlueprint } from '../app/commands';
import { useUi } from '../app/uiStore';
import { WIRE_COLORS } from '../model/format';
import { GRID } from '../geometry/partLayout';
import { computeWireGeometry } from '../geometry/wireGeometry';
import { allParts, useLibrary } from '../library/libraryStore';
import { useDiagram } from '../store/diagramStore';
import type { DiagramNode, PartNode as PartNodeType } from '../store/types';
import { NoteNode } from './NoteNode';
import { PartNode } from './PartNode';
import { SectionNode } from './SectionNode';
import { WireEdge } from './WireEdge';
import { WirePopover, type PopoverTarget } from './WirePopover';
import { WireGeometryContext } from './wireContext';

const nodeTypes = { part: PartNode, note: NoteNode, section: SectionNode };
const edgeTypes = { wire: WireEdge };

export const PART_DRAG_TYPE = 'application/x-blueprint-part';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Draw a rectangle to create a section. */
function SectionDrawOverlay() {
  const { screenToFlowPosition } = useReactFlow();
  const addSection = useDiagram((s) => s.addSection);
  const setTool = useUi((s) => s.setTool);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="section-draw-overlay"
      onPointerDown={(e) => {
        const r = ref.current!.getBoundingClientRect();
        e.currentTarget.setPointerCapture(e.pointerId);
        setBox({ x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
      }}
      onPointerMove={(e) => {
        if (!box) return;
        const r = ref.current!.getBoundingClientRect();
        setBox({ ...box, x1: e.clientX - r.left, y1: e.clientY - r.top });
      }}
      onPointerUp={(e) => {
        if (!box) return;
        const r = ref.current!.getBoundingClientRect();
        const a = screenToFlowPosition({ x: r.left + Math.min(box.x0, box.x1), y: r.top + Math.min(box.y0, box.y1) });
        const b = screenToFlowPosition({ x: r.left + Math.max(box.x0, box.x1), y: r.top + Math.max(box.y0, box.y1) });
        setBox(null);
        setTool('select');
        if (b.x - a.x > 20 && b.y - a.y > 20) addSection({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
        e.stopPropagation();
      }}
    >
      <div className="section-draw-hint">Drag to draw a section · Esc to cancel</div>
      {box && (
        <div
          className="section-draw-box"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      )}
    </div>
  );
}

export function Canvas() {
  const nodes = useDiagram((s) => s.nodes);
  const edges = useDiagram((s) => s.edges);
  const snapToGrid = useDiagram((s) => s.snapToGrid);
  const wireColor = useDiagram((s) => s.wireColor);
  const diagramId = useDiagram((s) => s.diagramId);
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<PopoverTarget | null>(null);
  const connecting = useConnection((c) => c.inProgress);

  const geometry = useMemo(() => computeWireGeometry(nodes, edges), [nodes, edges]);

  // Fit the view whenever a different diagram is opened.
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, maxZoom: 1.25, duration: 0 }), 50);
    return () => clearTimeout(t);
  }, [diagramId, fitView]);

  const s = useDiagram.getState;

  const isValidConnection: IsValidConnection<Edge> = useCallback((c) => {
    if (!c.sourceHandle || !c.targetHandle) return false;
    if (c.source === c.target && c.sourceHandle === c.targetHandle) return false;
    return !s().edges.some(
      (e) =>
        (e.source === c.source && e.sourceHandle === c.sourceHandle && e.target === c.target && e.targetHandle === c.targetHandle) ||
        (e.source === c.target && e.sourceHandle === c.targetHandle && e.target === c.source && e.targetHandle === c.sourceHandle),
    );
  }, [s]);

  const onConnect = useCallback((c: Connection) => void s().connect(c), [s]);

  const onNodeDragStart: OnNodeDrag<DiagramNode> = useCallback(
    (_e, _n, dragged) => {
      s().checkpoint();
      s().beginDrag(dragged);
    },
    [s],
  );
  const onNodeDrag: OnNodeDrag<DiagramNode> = useCallback((_e, _n, dragged) => s().dragUpdate(dragged), [s]);
  const onNodeDragStop: OnNodeDrag<DiagramNode> = useCallback((_e, _n, dragged) => {
    s().dragUpdate(dragged);
    s().endDrag();
  }, [s]);

  const onEdgeClick: EdgeMouseHandler = useCallback((e, edge) => {
    const r = wrapperRef.current!.getBoundingClientRect();
    setPopover({ wireId: edge.id, x: e.clientX - r.left, y: e.clientY - r.top, bounds: { width: r.width, height: r.height } });
  }, []);

  const closePopover = useCallback(() => setPopover(null), []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(PART_DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      const def = allParts(useLibrary.getState().custom).find((p) => p.id === id);
      if (!def) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Drop so the cursor sits on the part's title.
      s().addPart(def, { x: p.x - 60, y: p.y - 15 });
    },
    [screenToFlowPosition, s],
  );

  // Keyboard shortcuts (Delete/Backspace are handled by React Flow).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const st = s();
      if (mod && k === 'z' && !e.shiftKey) st.undo();
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) st.redo();
      else if (mod && k === 'c') st.copySelection();
      else if (mod && k === 'v') st.paste();
      else if (mod && k === 'd') st.duplicateSelection();
      else if (mod && k === 's') exportBlueprint();
      else if (mod && k === 'a') st.selectAll();
      else if (!mod && !e.altKey && k === 'r') st.rotateSelection();
      else if (!mod && !e.altKey && k === 'f') st.flipSelection();
      else if (e.key === 'F2') {
        const part = st.nodes.find((n): n is PartNodeType => n.type === 'part' && !!n.selected);
        if (part) window.dispatchEvent(new CustomEvent('blueprint:rename', { detail: part.id }));
      } else if (e.key === 'Escape') {
        if (useUi.getState().tool !== 'select') setTool('select');
        else if (popover) setPopover(null);
        else st.clearSelection();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, popover, setTool]);

  const connectionColor = WIRE_COLORS[wireColor].hex;

  return (
    <div className={`canvas-wrap${connecting ? ' is-connecting' : ''}`} ref={wrapperRef}>
      <WireGeometryContext.Provider value={geometry}>
        <ReactFlow<DiagramNode, Edge>
          nodes={nodes}
          edges={edges as Edge[]}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={(c) => s().onNodesChange(c)}
          onEdgesChange={(c) => s().onEdgesChange(c as never)}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={16}
          connectionLineType={ConnectionLineType.Step}
          connectionLineStyle={{ stroke: connectionColor, strokeWidth: 3, strokeDasharray: '6 4' }}
          onBeforeDelete={async () => {
            s().checkpoint();
            return true;
          }}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onSelectionDragStart={(e, dragged) => onNodeDragStart(e as never, dragged[0], dragged)}
          onSelectionDrag={(e, dragged) => onNodeDrag(e as never, dragged[0], dragged)}
          onSelectionDragStop={(e, dragged) => onNodeDragStop(e as never, dragged[0], dragged)}
          onEdgeClick={onEdgeClick}
          onPaneClick={closePopover}
          onNodeClick={closePopover}
          onDrop={onDrop}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(PART_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          snapToGrid={snapToGrid}
          snapGrid={[GRID, GRID]}
          deleteKeyCode={['Delete', 'Backspace']}
          multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
          selectionKeyCode={null}
          selectionOnDrag
          panOnDrag={[1, 2]}
          panActivationKeyCode="Space"
          onPaneContextMenu={(e) => e.preventDefault()}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect
          minZoom={0.1}
          maxZoom={4}
          fitView
        >
          <Background id="minor" variant={BackgroundVariant.Lines} gap={GRID} color="#f1f3f6" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={GRID * 10} color="#e2e6ec" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'section' ? '#e3e8ef' : '#9fb3c8')} />
        </ReactFlow>
      </WireGeometryContext.Provider>
      {tool === 'section' && <SectionDrawOverlay />}
      {popover && <WirePopover target={popover} onClose={closePopover} />}
    </div>
  );
}
