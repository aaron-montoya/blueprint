import { useEffect, useMemo, useRef, useState } from 'react';
import { toast, useUi, type PartMakerRequest } from '../app/uiStore';
import { PartBody } from '../canvas/PartNode';
import { layoutPart } from '../geometry/partLayout';
import { allParts, categoriesOf, useLibrary } from '../library/libraryStore';
import {
  draftFromPart,
  draftProblems,
  emptyDraft,
  guessPinType,
  movePin,
  partFromDraft,
  pinKey,
  setPinSide,
  uniquePartId,
  type DraftPin,
  type PartDraft,
} from '../library/partMaker';
import { PIN_SIDES, PIN_TYPE_INFO, PIN_TYPES, type PartDefinition, type PinSide, type PinType } from '../model/format';
import { freeSpot, useDiagram } from '../store/diagramStore';

const SIDE_LABEL: Record<PinSide, string> = {
  left: 'Left side (top → bottom)',
  right: 'Right side (top → bottom)',
  top: 'Top (left → right)',
  bottom: 'Bottom (left → right)',
};

function PinRow({
  pin,
  first,
  last,
  onChange,
  onMove,
  onSide,
  onRemove,
  autoFocus,
}: {
  pin: DraftPin;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<DraftPin>) => void;
  onMove: (dir: -1 | 1) => void;
  onSide: (side: PinSide) => void;
  onRemove: () => void;
  autoFocus: boolean;
}) {
  return (
    <div className="pm-pin">
      <i className="pm-pin-dot" style={{ background: PIN_TYPE_INFO[pin.type].color }} />
      <input
        className="text-input mono"
        value={pin.label}
        placeholder="Label, e.g. OUT"
        autoFocus={autoFocus}
        onChange={(e) => onChange({ label: e.target.value })}
        aria-label="Pin label"
      />
      <select className="text-input" value={pin.type} onChange={(e) => onChange({ type: e.target.value as PinType })} aria-label="Pin type">
        {PIN_TYPES.map((t) => (
          <option key={t} value={t}>
            {PIN_TYPE_INFO[t].label}
          </option>
        ))}
      </select>
      <select className="text-input" value={pin.side} onChange={(e) => onSide(e.target.value as PinSide)} aria-label="Pin side">
        {PIN_SIDES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button className="icon-btn tiny" disabled={first} onClick={() => onMove(-1)} title="Move up / left">
        ↑
      </button>
      <button className="icon-btn tiny" disabled={last} onClick={() => onMove(1)} title="Move down / right">
        ↓
      </button>
      <button className="icon-btn tiny" onClick={onRemove} title="Remove pin">
        ×
      </button>
    </div>
  );
}

function SidePins({
  side,
  draft,
  setPins,
}: {
  side: PinSide;
  draft: PartDraft;
  setPins: (fn: (pins: DraftPin[]) => DraftPin[]) => void;
}) {
  const pins = draft.pins.filter((p) => p.side === side);
  const [bulk, setBulk] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const add = () => {
    const key = pinKey();
    setFocusKey(key);
    setPins((all) => [...all, { key, label: '', type: 'io', side }]);
  };
  const addBulk = () => {
    const labels = (bulk ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    setPins((all) => [...all, ...labels.map((label) => ({ key: pinKey(), label, type: guessPinType(label), side }))]);
    setBulk(null);
  };

  return (
    <section className="pm-side">
      <header>
        <span>{SIDE_LABEL[side]}</span>
        <span className="count">{pins.length}</span>
      </header>
      {pins.map((p, i) => (
        <PinRow
          key={p.key}
          pin={p}
          first={i === 0}
          last={i === pins.length - 1}
          autoFocus={p.key === focusKey}
          onChange={(patch) => setPins((all) => all.map((x) => (x.key === p.key ? { ...x, ...patch } : x)))}
          onMove={(dir) => setPins((all) => movePin(all, p.key, dir))}
          onSide={(s) => setPins((all) => setPinSide(all, p.key, s))}
          onRemove={() => setPins((all) => all.filter((x) => x.key !== p.key))}
        />
      ))}
      {bulk === null ? (
        <div className="row">
          <button className="btn small" onClick={add}>
            + Add pin
          </button>
          <button className="btn small" onClick={() => setBulk('')} title="Paste a list of pin labels, one per line">
            + Add several…
          </button>
        </div>
      ) : (
        <div className="pm-bulk">
          <textarea
            className="text-input"
            rows={5}
            autoFocus
            placeholder={'One label per line, in order, e.g.\nVCC\nGND\nSDA\nSCL'}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
          <div className="row">
            <button className="btn small" onClick={addBulk}>
              Add pins
            </button>
            <button className="btn small" onClick={() => setBulk(null)}>
              Cancel
            </button>
            <span className="hint">Types are guessed (GND → ground, VCC/5V → power); adjust after.</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** The part as it will look on the canvas, scaled to fill the preview pane. */
function Preview({ def, rotation }: { def: PartDefinition; rotation: 0 | 90 | 180 | 270 }) {
  const layout = layoutPart(def, rotation, false, def.name);
  const scale = Math.max(0.5, Math.min(2, 330 / layout.width, 460 / layout.height));
  return (
    <div className="pm-preview-part" style={{ width: layout.width * scale, height: layout.height * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <PartBody
          layout={layout}
          def={def}
          renderPin={(pin, style) => (
            <span key={pin.def.id} className="pin preview-pin" style={style} title={PIN_TYPE_INFO[pin.def.type].label} />
          )}
        />
      </div>
    </div>
  );
}

function initialDraft(req: PartMakerRequest): PartDraft {
  if (req.mode === 'new') return emptyDraft();
  return draftFromPart(req.source, req.mode === 'copy');
}

function Editor({ req }: { req: PartMakerRequest }) {
  const close = () => useUi.getState().openPartMaker(null);
  const custom = useLibrary((s) => s.custom);
  const saveCustom = useLibrary((s) => s.saveCustom);
  const addPart = useDiagram((s) => s.addPart);
  const [draft, setDraft] = useState<PartDraft>(() => initialDraft(req));
  const [dirty, setDirty] = useState(false);
  const [previewRotation, setPreviewRotation] = useState<0 | 90 | 180 | 270>(0);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const parts = useMemo(() => allParts(custom), [custom]);
  const categories = useMemo(() => categoriesOf(parts), [parts]);
  const update = (patch: Partial<PartDraft>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setPins = (fn: (pins: DraftPin[]) => DraftPin[]) => {
    setDirty(true);
    setDraft((d) => ({ ...d, pins: fn(d.pins) }));
  };

  const problems = draftProblems(draft);
  const id = useMemo(() => {
    if (req.mode === 'edit') return req.source.id;
    return uniquePartId(draft.name, new Set(parts.map((p) => p.id)));
  }, [req, draft.name, parts]);

  // Live preview. Built even while incomplete, so unlabeled pins still show.
  const preview: PartDefinition | null = useMemo(() => {
    const tmp: PartDraft = {
      ...draft,
      name: draft.name.trim() || 'New part',
      category: draft.category.trim() || 'Custom',
      width: draft.width.trim() && Number(draft.width) >= 40 ? draft.width : '',
      pins: draft.pins.map((p) => ({ ...p, label: p.label.trim() || '?' })),
    };
    try {
      return partFromDraft(tmp, 'preview');
    } catch {
      return null;
    }
  }, [draft]);

  const tryClose = () => {
    if (dirty && !confirm('Discard this part? Your changes will be lost.')) return;
    close();
  };

  const save = async (place: boolean) => {
    if (problems.length) return;
    const part = partFromDraft(draft, id);
    await saveCustom(part);
    toast(`Saved "${part.name}" to ${part.category} (stored in this browser — use ⤓ to export it)`);
    if (place) {
      const el = document.querySelector('.react-flow')?.getBoundingClientRect();
      const vp = document.querySelector<HTMLElement>('.react-flow__viewport');
      if (el && vp) {
        const m = new DOMMatrix(getComputedStyle(vp).transform);
        const l = layoutPart(part, 0, false, part.name);
        const c = { x: (el.width / 2 - m.e) / m.a - l.width / 2, y: (el.height / 2 - m.f) / m.d - l.height / 2 };
        addPart(part, freeSpot(useDiagram.getState().nodes, l.width, l.height, c));
      }
    }
    close();
  };

  const title =
    req.mode === 'new' ? 'New part' : req.mode === 'copy' ? `New part from “${req.source.name}”` : `Edit “${req.source.name}”`;

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && tryClose()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') tryClose();
      }}
    >
      <div className="modal part-maker" role="dialog" aria-label="Part Maker">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={tryClose} title="Close (Esc)">
            ×
          </button>
        </header>
        <div className="pm-body">
          <div className="pm-form">
            <div className="pm-grid">
              <label>
                <span>Name</span>
                <input ref={nameRef} className="text-input" value={draft.name} placeholder="e.g. Hall Sensor" onChange={(e) => update({ name: e.target.value })} />
              </label>
              <label>
                <span>Subtitle</span>
                <input className="text-input" value={draft.subtitle} placeholder="e.g. A3144 module" onChange={(e) => update({ subtitle: e.target.value })} />
              </label>
              <label>
                <span>Category</span>
                <input
                  className="text-input"
                  list="pm-categories"
                  value={draft.category}
                  placeholder="Sidebar section"
                  onChange={(e) => update({ category: e.target.value })}
                />
                <datalist id="pm-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>Width</span>
                <input className="text-input" value={draft.width} placeholder="auto" inputMode="numeric" onChange={(e) => update({ width: e.target.value })} />
              </label>
              <label className="wide">
                <span>Note</span>
                <input
                  className="text-input"
                  value={draft.note}
                  placeholder="Shown in red on the part, e.g. flyback diode across coil"
                  onChange={(e) => update({ note: e.target.value })}
                />
              </label>
            </div>
            {PIN_SIDES.map((side) => (
              <SidePins key={side} side={side} draft={draft} setPins={setPins} />
            ))}
          </div>

          <div className="pm-preview">
            <div className="pm-preview-head">
              <span>Preview</span>
              <button
                className="btn small"
                onClick={() => setPreviewRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)}
                title="Check how the part looks rotated on the canvas"
              >
                ⟳ {previewRotation}°
              </button>
            </div>
            <div className="pm-preview-canvas">
              {preview && <Preview def={preview} rotation={previewRotation} />}
            </div>
            <div className="pm-id">
              id <code>{id}</code> · {draft.pins.length} pins
            </div>
          </div>
        </div>
        <footer className="modal-foot">
          <div className="pm-problems">{dirty && problems.length > 0 && problems.join(' ')}</div>
          <button className="btn" onClick={tryClose}>
            Cancel
          </button>
          <button className="btn" disabled={problems.length > 0} onClick={() => void save(true)}>
            Save & add to canvas
          </button>
          <button className="btn primary" disabled={problems.length > 0} onClick={() => void save(false)}>
            Save part
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Mounted once; shows the Part Maker when something asks for it. */
export function PartMaker() {
  const req = useUi((s) => s.partMaker);
  if (!req) return null;
  // Remount per request so the draft starts fresh.
  return <Editor key={req.mode + ('source' in req ? req.source.id : '')} req={req} />;
}
