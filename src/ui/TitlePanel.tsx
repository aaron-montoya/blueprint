import { useState } from 'react';
import { PIN_TYPE_INFO, PIN_TYPES, TITLE_FIELDS } from '../model/format';
import { useDiagram } from '../store/diagramStore';
import { ConnectionsPanel } from './ConnectionsPanel';

type Tab = 'title' | 'connections';

/** Right-hand panel: title block & legend, or the connection list. */
export function SidePanel() {
  const [tab, setTab] = useState<Tab>('title');
  const wireCount = useDiagram((s) => s.edges.length);
  return (
    <aside className={`title-panel${tab === 'connections' ? ' wide' : ''}`}>
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'title'} className={tab === 'title' ? 'active' : ''} onClick={() => setTab('title')}>
          Title block
        </button>
        <button
          role="tab"
          aria-selected={tab === 'connections'}
          className={tab === 'connections' ? 'active' : ''}
          onClick={() => setTab('connections')}
        >
          Connections <span className="count">{wireCount}</span>
        </button>
      </div>
      {tab === 'title' ? <TitleBlockTab /> : <ConnectionsPanel />}
    </aside>
  );
}

function TitleBlockTab() {
  const title = useDiagram((s) => s.title);
  const setTitle = useDiagram((s) => s.setTitle);
  const partCount = useDiagram((s) => s.nodes.filter((n) => n.type === 'part').length);
  const wireCount = useDiagram((s) => s.edges.length);

  return (
    <>
      <h3>Title block</h3>
      {TITLE_FIELDS.map((f) => (
        <label key={f.key} className="tb-field">
          <span>{f.label}</span>
          <input
            className="text-input"
            value={title[f.key]}
            placeholder={f.key === 'updated' ? new Date().toLocaleDateString() : ''}
            onChange={(e) => setTitle(f.key, e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
      ))}
      <button
        className="btn small"
        onClick={() => setTitle('updated', new Date().toISOString().slice(0, 10))}
        title="Set 'Updated' to today"
      >
        Updated = today
      </button>

      <h3>Pin colors</h3>
      <ul className="legend">
        {PIN_TYPES.map((t) => (
          <li key={t}>
            <i style={{ background: PIN_TYPE_INFO[t].color }} />
            {PIN_TYPE_INFO[t].label}
          </li>
        ))}
      </ul>

      <h3>How to</h3>
      <ul className="howto">
        <li>Drag parts in from the left.</li>
        <li>Drag from a pin to another pin to wire them.</li>
        <li>Click a wire for color, stripe, label.</li>
        <li>Select a wire, then drag its handles to reshape.</li>
        <li>Double-click a part's title to rename it.</li>
        <li>Drag on empty canvas to box-select; right-drag or Space-drag to pan; wheel to zoom.</li>
        <li>R rotate · F flip · Ctrl+D duplicate · Ctrl+S export.</li>
      </ul>
      <p className="stats">
        {partCount} parts · {wireCount} wires · autosaved in this browser
      </p>
    </>
  );
}
