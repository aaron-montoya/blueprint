import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { exportBlueprint, exportPdf, exportPng, importBlueprint, optimizeWireRoutes } from '../app/commands';
import { newDiagram, onSaved, openDiagram, flushSave } from '../app/session';
import { toast, useUi } from '../app/uiStore';
import { WIRE_COLOR_NAMES, WIRE_COLORS } from '../model/format';
import { useDiagram } from '../store/diagramStore';
import { deleteDiagram, listDiagrams, type DiagramSummary } from '../store/persistence';

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function OptimizeButton() {
  const [busy, setBusy] = useState(false);
  const hasWires = useDiagram((s) => s.edges.length > 0);
  const scoped = useDiagram((s) => s.edges.some((e) => e.selected) || s.nodes.some((n) => n.selected));
  return (
    <button
      aria-label="Optimize wires"
      className="btn"
      disabled={!hasWires || busy}
      onClick={() => {
        setBusy(true);
        // Let the button repaint before the (up to a second or two) reroute.
        setTimeout(() => {
          try {
            optimizeWireRoutes();
          } finally {
            setBusy(false);
          }
        }, 30);
      }}
      title={
        scoped
          ? 'Reroute the selected wires (or the selected parts\' wires) to cut crossings and overlaps'
          : 'Reroute all wires together to cut crossings and overlaps. Select wires or parts to optimize just those.'
      }
    >
      ⚡ <span className="tb-label">{busy ? 'Optimizing…' : 'Optimize wires'}</span>
    </button>
  );
}

function FileMenu() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<DiagramSummary[]>([]);
  const currentId = useDiagram((s) => s.diagramId);
  const ref = useClickOutside(open, () => setOpen(false));

  const refresh = () => void listDiagrams().then(setRecent).catch(() => setRecent([]));
  useEffect(() => onSaved(refresh), []);
  useEffect(() => {
    if (open) void flushSave().then(refresh);
  }, [open]);

  const run = (fn: () => unknown) => () => {
    setOpen(false);
    void Promise.resolve(fn()).catch((e) => toast(String(e instanceof Error ? e.message : e), 'error'));
  };

  return (
    <div className="menu" ref={ref}>
      <button className={`btn${open ? ' active' : ''}`} onClick={() => setOpen(!open)}>
        File ▾
      </button>
      {open && (
        <div className="menu-panel">
          <button onClick={run(newDiagram)}>New diagram</button>
          <button onClick={run(importBlueprint)}>Import .blueprint…</button>
          <div className="menu-sep" />
          <button onClick={run(exportBlueprint)}>
            Export .blueprint <kbd>Ctrl+S</kbd>
          </button>
          <button onClick={run(exportPng)}>Export PNG</button>
          <button onClick={run(exportPdf)}>Export PDF</button>
          <div className="menu-sep" />
          <div className="menu-label">Recent in this browser</div>
          {recent.length === 0 && <div className="menu-empty">Nothing saved yet</div>}
          <div className="menu-recent">
            {recent.map((d) => (
              <div key={d.id} className={`menu-recent-row${d.id === currentId ? ' current' : ''}`}>
                <button onClick={run(() => openDiagram(d.id))} title={`Last edited ${new Date(d.updatedAt).toLocaleString()}`}>
                  <span className="recent-name">{d.name}</span>
                  <span className="recent-meta">
                    {d.partCount} parts · {new Date(d.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                {d.id !== currentId && (
                  <button
                    className="icon-btn tiny"
                    title="Delete this local copy"
                    onClick={async () => {
                      if (!confirm(`Delete the local copy of "${d.name}"? Exported files are not affected.`)) return;
                      await deleteDiagram(d.id);
                      refresh();
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WireColorPicker() {
  const color = useDiagram((s) => s.wireColor);
  const setWireColor = useDiagram((s) => s.setWireColor);
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  return (
    <div className="menu" ref={ref}>
      <button aria-label="New wire" className="btn" onClick={() => setOpen(!open)} title="Color for the next wire you draw">
        <span className={`swatch inline${color === 'white' ? ' white' : ''}`} style={{ background: WIRE_COLORS[color].hex }} />
        <span className="tb-label">New wire</span> ▾
      </button>
      {open && (
        <div className="menu-panel swatch-panel">
          {WIRE_COLOR_NAMES.map((c) => (
            <button
              key={c}
              className={`swatch${c === color ? ' active' : ''}${c === 'white' ? ' white' : ''}`}
              style={{ background: WIRE_COLORS[c].hex }}
              title={WIRE_COLORS[c].label}
              onClick={() => {
                setWireColor(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const st = useDiagram;
  const canUndo = useDiagram((s) => s.past.length > 0);
  const canRedo = useDiagram((s) => s.future.length > 0);
  const hasSelection = useDiagram((s) => s.nodes.some((n) => n.selected) || s.edges.some((e) => e.selected));
  const hasPartSelected = useDiagram((s) => s.nodes.some((n) => n.type === 'part' && n.selected));
  const snap = useDiagram((s) => s.snapToGrid);
  const route = useDiagram((s) => s.defaultRoute);
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const drawer = useUi((s) => s.drawer);
  const setDrawer = useUi((s) => s.setDrawer);
  const { screenToFlowPosition } = useReactFlow();

  const center = () => {
    const el = document.querySelector('.react-flow')!.getBoundingClientRect();
    return screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
  };

  return (
    <header className="toolbar">
      <button
        className={`btn compact-only${drawer === 'parts' ? ' active' : ''}`}
        onClick={() => setDrawer(drawer === 'parts' ? null : 'parts')}
        title="Parts"
        aria-label="Parts"
      >
        ☰ <span className="tb-label">Parts</span>
      </button>
      <div className="brand" title="Blueprint — wiring diagrams">
        <img src="./favicon.svg" alt="" width={22} height={22} />
        <span className="tb-label">Blueprint</span>
      </div>
      <div className="tb-scroll">
      <FileMenu />
      <div className="tb-sep" />
      <button className="btn icon" disabled={!canUndo} onClick={() => st.getState().undo()} title="Undo (Ctrl+Z)" aria-label="Undo">
        ↶
      </button>
      <button className="btn icon" disabled={!canRedo} onClick={() => st.getState().redo()} title="Redo (Ctrl+Y)" aria-label="Redo">
        ↷
      </button>
      <div className="tb-sep" />
      <button aria-label="Rotate" className="btn" disabled={!hasPartSelected} onClick={() => st.getState().rotateSelection()} title="Rotate 90° (R)">
        ⟳ <span className="tb-label">Rotate</span>
      </button>
      <button aria-label="Flip" className="btn" disabled={!hasPartSelected} onClick={() => st.getState().flipSelection()} title="Flip horizontally (F)">
        ⇋ <span className="tb-label">Flip</span>
      </button>
      <button aria-label="Duplicate" className="btn" disabled={!hasSelection} onClick={() => st.getState().duplicateSelection()} title="Duplicate (Ctrl+D)">
        ⧉ <span className="tb-label">Duplicate</span>
      </button>
      <button aria-label="Delete" className="btn" disabled={!hasSelection} onClick={() => st.getState().deleteSelection()} title="Delete (Del)">
        ✕ <span className="tb-label">Delete</span>
      </button>
      <div className="tb-sep" />
      <button aria-label="Section"
        className={`btn${tool === 'section' ? ' active' : ''}`}
        onClick={() => {
          if (st.getState().wrapSelectionInSection()) return;
          setTool(tool === 'section' ? 'select' : 'section');
        }}
        title="Draw a labeled section. With parts selected, wraps them in a section."
      >
        ▭ <span className="tb-label">Section</span>
      </button>
      <button aria-label="Note" className="btn" onClick={() => st.getState().addNote({ x: center().x - 90, y: center().y - 40 })} title="Add a note">
        ✎ <span className="tb-label">Note</span>
      </button>
      <div className="tb-sep" />
      <WireColorPicker />
      <div className="segmented" title="Routing for new wires">
        <button aria-label="Right-angle" className={route === 'orthogonal' ? 'active' : ''} onClick={() => st.getState().setDefaultRoute('orthogonal')}>
          ┐ <span className="tb-label">Right-angle</span>
        </button>
        <button aria-label="Straight" className={route === 'straight' ? 'active' : ''} onClick={() => st.getState().setDefaultRoute('straight')}>
          ╱ <span className="tb-label">Straight</span>
        </button>
      </div>
      <OptimizeButton />
      <label className="toggle" title="Snap parts and wire bends to the grid">
        <input type="checkbox" checked={snap} onChange={(e) => st.getState().setSnapToGrid(e.target.checked)} />
        <span className="tb-label">Snap</span>
      </label>
      </div>
      <button
        className={`btn compact-only${drawer === 'panel' ? ' active' : ''}`}
        onClick={() => setDrawer(drawer === 'panel' ? null : 'panel')}
        title="Title block & connections"
        aria-label="Title block and connections"
      >
        ☷ <span className="tb-label">Info</span>
      </button>
    </header>
  );
}
