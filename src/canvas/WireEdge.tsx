import { useReactFlow, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { WIRE_COLORS, type XY } from '../model/format';
import { GRID, isHorizontalSide } from '../geometry/partLayout';
import { coordsFromPoints, dragOrthoSegment, interior, normalizeCoords, orthoSegments, pathFromCoords } from '../geometry/routing';
import { labelAnchor } from '../geometry/wireGeometry';
import { useDiagram } from '../store/diagramStore';
import type { WireEdge as WireEdgeType } from '../store/types';
import { useWireGeometry } from './wireContext';

const WIRE_WIDTH = 3;

export function wireStrokes(color: keyof typeof WIRE_COLORS, stripe?: keyof typeof WIRE_COLORS) {
  const hex = WIRE_COLORS[color]?.hex ?? '#E53935';
  return {
    base: hex,
    // White wire needs a visible outline on a white canvas; the rest get a
    // subtle dark casing so light colors (yellow) read well too.
    casing: color === 'white' ? '#4a4a4a' : 'rgba(0,0,0,0.35)',
    stripe: stripe ? WIRE_COLORS[stripe]?.hex : undefined,
  };
}

/** Start a pointer drag that reports flow coordinates until release. */
function useFlowDrag() {
  const { screenToFlowPosition } = useReactFlow();
  return (e: React.PointerEvent, onMove: (p: XY) => void, onEnd?: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: PointerEvent) => onMove(screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
}

function WireEdgeView({ id, data, selected }: EdgeProps<WireEdgeType>) {
  const geo = useWireGeometry(id);
  const startDrag = useFlowDrag();
  const checkpoint = useDiagram((s) => s.checkpoint);
  const setWirePoints = useDiagram((s) => s.setWirePoints);
  const snapToGrid = useDiagram((s) => s.snapToGrid);
  if (!geo || !data) return null;

  const strokes = wireStrokes(data.color, data.stripe);
  const snap = (v: number) => (snapToGrid ? Math.round(v / GRID) * GRID : Math.round(v));
  const label = data.label ? labelAnchor(geo.points) : null;
  const { source: S, target: T } = geo;
  const firstH = isHorizontalSide(S.side);

  // ---- orthogonal: drag a segment sideways
  const onSegmentDown = (index: number, horizontal: boolean) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    checkpoint();
    const start = geo.coords;
    startDrag(
      e,
      (p) => {
        const c = dragOrthoSegment(S, T, start, index, horizontal ? p.y : p.x, snapToGrid);
        setWirePoints(id, interior(pathFromCoords(S, T, c, firstH)));
      },
      () => {
        const pts = useDiagram.getState().edges.find((w) => w.id === id)?.data?.points;
        if (!pts) return;
        const c = normalizeCoords(coordsFromPoints(pts, firstH));
        setWirePoints(id, interior(pathFromCoords(S, T, c, firstH)));
      },
    );
  };

  // ---- straight: drag a bend, or pull a new bend out of a segment
  const bends = data.points ?? [];
  const onBendDown = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    checkpoint();
    startDrag(e, (p) => {
      const next = [...bends];
      next[i] = { x: snap(p.x), y: snap(p.y) };
      setWirePoints(id, next);
    });
  };
  const onMidDown = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    checkpoint();
    startDrag(e, (p) => {
      const next = [...bends];
      next.splice(i, 0, { x: snap(p.x), y: snap(p.y) });
      setWirePoints(id, next);
    });
  };
  const removeBend = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    checkpoint();
    const next = bends.filter((_, j) => j !== i);
    setWirePoints(id, next.length ? next : undefined);
  };

  return (
    <g className={`wire${selected ? ' selected' : ''}`} data-wire-id={id}>
      <path d={geo.d} className="react-flow__edge-interaction" fill="none" stroke="transparent" strokeWidth={14} />
      {selected && <path d={geo.d} className="wire-glow" fill="none" />}
      <path d={geo.d} className="wire-casing" fill="none" stroke={strokes.casing} strokeWidth={WIRE_WIDTH + 2} strokeLinejoin="round" />
      <path d={geo.d} className="wire-core" fill="none" stroke={strokes.base} strokeWidth={WIRE_WIDTH} strokeLinejoin="round" />
      {strokes.stripe && (
        <path d={geo.d} fill="none" stroke={strokes.stripe} strokeWidth={WIRE_WIDTH} strokeDasharray="7 7" />
      )}
      {label && (
        <text
          className="wire-label"
          x={label.horizontal ? label.x : label.x + 6}
          y={label.horizontal ? label.y - 6 : label.y}
          textAnchor={label.horizontal ? 'middle' : 'start'}
          dominantBaseline={label.horizontal ? 'auto' : 'middle'}
        >
          {data.label}
        </text>
      )}

      {selected && data.route === 'orthogonal' &&
        orthoSegments(geo.raw).map((seg) => {
          const len = Math.abs(seg.b.x - seg.a.x) + Math.abs(seg.b.y - seg.a.y);
          if (len < 12) return null;
          const mx = (seg.a.x + seg.b.x) / 2;
          const my = (seg.a.y + seg.b.y) / 2;
          const w = seg.horizontal ? 16 : 6;
          const h = seg.horizontal ? 6 : 16;
          return (
            <rect
              key={`s${seg.index}`}
              className={`wire-handle segment nodrag nopan ${seg.horizontal ? 'ns' : 'ew'}`}
              x={mx - w / 2}
              y={my - h / 2}
              width={w}
              height={h}
              rx={2}
              onPointerDown={onSegmentDown(seg.index, seg.horizontal)}
            >
              <title>Drag to move this segment</title>
            </rect>
          );
        })}

      {selected && data.route === 'straight' && (
        <>
          {geo.raw.slice(0, -1).map((a, i) => {
            const b = geo.raw[i + 1];
            return (
              <circle
                key={`m${i}`}
                className="wire-handle mid nodrag nopan"
                cx={(a.x + b.x) / 2}
                cy={(a.y + b.y) / 2}
                r={3.5}
                onPointerDown={onMidDown(i)}
              >
                <title>Drag to add a bend</title>
              </circle>
            );
          })}
          {bends.map((p, i) => (
            <circle
              key={`b${i}`}
              className="wire-handle bend nodrag nopan"
              cx={p.x}
              cy={p.y}
              r={5}
              onPointerDown={onBendDown(i)}
              onDoubleClick={removeBend(i)}
            >
              <title>Drag to move · double-click to remove</title>
            </circle>
          ))}
        </>
      )}
    </g>
  );
}

export const WireEdge = memo(WireEdgeView);
