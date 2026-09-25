import { useReactFlow } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { exportLibrary, importLibrary } from '../app/commands';
import { useUi } from '../app/uiStore';
import { PART_DRAG_TYPE } from '../canvas/Canvas';
import { categoryFill, categoryStrong, PIN_TYPE_INFO, type PartDefinition } from '../model/format';
import { allParts, categoriesOf, isCustom, useLibrary } from '../library/libraryStore';
import { useDiagram } from '../store/diagramStore';

function PartTile({ part, custom, onAdd }: { part: PartDefinition; custom: boolean; onAdd: () => void }) {
  const removeCustom = useLibrary((s) => s.removeCustom);
  const openPartMaker = useUi((s) => s.openPartMaker);
  const types = [...new Set(part.pins.map((p) => p.type))];
  return (
    <div
      className="part-tile"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PART_DRAG_TYPE, part.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={onAdd}
      title={`${part.name}${part.subtitle ? ` — ${part.subtitle}` : ''}\n${part.pins.length} pins${part.note ? `\n${part.note}` : ''}\n\nDrag onto the canvas (or double-click)`}
    >
      <div className="part-tile-main">
        <span className="part-tile-name">{part.name}</span>
        {part.subtitle && <span className="part-tile-sub">{part.subtitle}</span>}
      </div>
      <span className="part-tile-pins">
        {types.map((t) => (
          <i key={t} style={{ background: PIN_TYPE_INFO[t].color }} />
        ))}
        {part.pins.length}
      </span>
      <span className="part-tile-actions">
        {custom && (
          <button
            className="icon-btn tiny"
            title="Edit this part"
            onClick={(e) => {
              e.stopPropagation();
              openPartMaker({ mode: 'edit', source: part });
            }}
          >
            ✎
          </button>
        )}
        <button
          className="icon-btn tiny"
          title="Make a new part starting from a copy of this one"
          onClick={(e) => {
            e.stopPropagation();
            openPartMaker({ mode: 'copy', source: part });
          }}
        >
          ⧉
        </button>
      </span>
      {custom && (
        <button
          className="icon-btn tiny"
          title="Remove this part from your sidebar"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Remove "${part.name}" from your parts?`)) void removeCustom(part.id);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const custom = useLibrary((s) => s.custom);
  const addPart = useDiagram((s) => s.addPart);
  const { screenToFlowPosition } = useReactFlow();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const parts = useMemo(() => allParts(custom), [custom]);
  const categories = useMemo(() => categoriesOf(parts), [parts]);
  const q = query.trim().toLowerCase();
  const matches = (p: PartDefinition) =>
    !q ||
    [p.name, p.subtitle ?? '', p.category, p.note ?? '', ...p.pins.map((x) => x.label)].some((s) =>
      s.toLowerCase().includes(q),
    );

  const addAtCenter = (part: PartDefinition) => {
    const el = document.querySelector('.react-flow')!.getBoundingClientRect();
    const p = screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
    addPart(part, { x: p.x - 60, y: p.y - 40 });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <input
          type="search"
          className="text-input"
          placeholder="Search parts, pins, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} title="Clear search (Esc)" aria-label="Clear search">
            ×
          </button>
        )}
      </div>
      <div className="sidebar-scroll">
        {categories.map((cat) => {
          const list = parts.filter((p) => p.category === cat && matches(p));
          if (!list.length && (q || !parts.some((p) => p.category === cat))) return null;
          const open = q ? true : !collapsed[cat];
          return (
            <section
              key={cat}
              className="sidebar-section"
              style={{ '--cat-fill': categoryFill(cat), '--cat-strong': categoryStrong(cat) } as React.CSSProperties}
            >
              <header onClick={() => setCollapsed((c) => ({ ...c, [cat]: open }))}>
                <span className={`chevron${open ? ' open' : ''}`}>▸</span>
                <span className="sidebar-section-title">{cat}</span>
                <span className="count">{list.length}</span>
                <button
                  className="icon-btn tiny"
                  title={`Export the ${cat} section as a parts library file`}
                  onClick={(e) => {
                    e.stopPropagation();
                    exportLibrary(cat, parts.filter((p) => p.category === cat));
                  }}
                >
                  ⤓
                </button>
              </header>
              {open && (
                <div className="sidebar-section-body">
                  {list.map((p) => (
                    <PartTile key={p.id} part={p} custom={isCustom(custom, p.id)} onAdd={() => addAtCenter(p)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {q && !parts.some(matches) && <p className="empty">No parts match “{query}”.</p>}
      </div>
      <div className="sidebar-foot">
        <button className="btn small primary" onClick={() => useUi.getState().openPartMaker({ mode: 'new' })} title="Make a new part in the Part Maker">
          + New part
        </button>
        <button className="btn small" onClick={() => void importLibrary()} title="Merge a parts library JSON file into the sidebar">
          Import…
        </button>
        <button
          className="btn small"
          disabled={!custom.length}
          onClick={() => exportLibrary('Custom parts', custom)}
          title="Export every part you imported as one library file"
        >
          Export mine
        </button>
      </div>
    </aside>
  );
}
