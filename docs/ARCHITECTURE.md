# Blueprint — architecture & plan

Blueprint is a static single-page app (React + Vite + TypeScript) for drawing
wiring diagrams of escape-room props. There is no backend: the working copy
lives in IndexedDB, and the shared copy is a `.blueprint` file the team keeps
in Google Drive.

## Project layout

```
src/
  model/format.ts        ← every on-disk data format (part, library, diagram),
                           pin types, colors, wire palette, validators.
                           The Part Maker (v1.5) and import/export share it.
  library/               ← built-in library (generated JSON) + custom parts
  geometry/
    partLayout.ts        ← part def + rotation/flip → body size + pin positions
    routing.ts           ← orthogonal/straight wire routing, segment dragging
    hops.ts              ← crossing detection + SVG path with jump arcs
    wireGeometry.ts      ← all wires' polylines for the current diagram
  store/
    diagramStore.ts      ← zustand store: nodes, wires, title block, undo/redo
    convert.ts           ← store ⇄ .blueprint file
    persistence.ts       ← IndexedDB (autosave, recent diagrams, custom parts)
  canvas/                ← React Flow canvas, custom nodes/edge, wire popover
  ui/                    ← sidebar, toolbar, title block, menus
  export/                ← PNG / PDF / file download helpers
tools/
  eit_parts_library_build.py   ← Aaron's original script (source of truth)
  convert_parts_library.py     ← converts it to src/library/default-library.json
  add-parts.mjs                ← promotes exported parts into src/library/added-parts.json
examples/                      ← made-up props only (the repo is public)
```

## How React Flow is used

* **Parts are custom nodes** (`type: "part"`). The node's `data` holds the full
  embedded part definition, the instance label, `rotation` (0/90/180/270) and
  `flip`.
* **Every pin is a `<Handle>`** whose `id` is the pin id. All handles are
  `type="source"` and the canvas runs in `ConnectionMode.Loose`, so any pin
  can connect to any other pin. The handle *is* the colored pin square.
* Pin positions are **computed, not measured**: `layoutPart()` is a pure
  function that returns the body size and every pin's (x, y, side). The node
  places its handles at those coordinates, and the wire geometry uses the same
  function. That guarantees wires land exactly on the pin and makes routing,
  crossing detection and export independent of the DOM.
* **Wires are custom edges** (`type: "wire"`). React Flow owns connection
  gestures, selection, box-select and deletion; the edge component draws the
  path we computed (ignoring React Flow's own handle coordinates).
* Rotation/flip does not CSS-rotate the node. It remaps pins to new sides and
  re-lays out the body, so text stays upright and pins stay on the grid.
* Sections and notes are nodes too (`type: "section"` rendered behind parts,
  `type: "note"`). Dragging a section drags every node fully inside it.

## Wire routing (the core of the app)

A wire has a `route` style (`orthogonal` default, or `straight`) and optional
bend `points`.

**Orthogonal wires** are stored as the interior corner points of the path, but
interpreted as a list of alternating coordinates. A wire leaving a left/right
pin starts horizontal, so the corners mean:

```
S ─h→ (c1, S.y) ─v→ (c1, c2) ─h→ (c3, c2) … ─→ T
```

Only `c1, c2, …` are kept; the parts of each corner that come from the pins are
recomputed from the current pin positions. Consequences:

* When a part moves, the first and last segments stretch but **every
  segment stays horizontal or vertical** and every manual bend stays put.
* Dragging a middle segment changes exactly one coordinate. Dragging a
  first/last segment (the ones bound to pins) inserts a jog.
* With no points the wire is auto-routed each render. The moment the user
  drags a segment the current route is frozen into points. Nothing ever
  re-routes a frozen wire except "Reset route", "Optimize wires", or
  rotating/flipping one of its parts (which changes which way the pin faces).

**Optimize wires** (`geometry/optimize.ts`): the live router places wires one
at a time in drawing order, so early wires never make room for later ones.
The optimizer does rip-up-and-reroute: every wire is rerouted with all the
others in place, for a few passes, starting from both the current layout and
a fresh shortest-wire-first layout, with higher crossing/overlap costs and a
wider search area than live routing. Layouts are scored on length, bends,
overlaps and crossings and the best one wins (never worse than the current
layout). The result is stored as manual bends, in one undo step.

**Straight wires** are a polyline through the points; dragging a segment
inserts a bend.

**Crossings:** after all polylines are known, a wire gets a small arc (hop)
wherever it crosses a wire drawn before it. Wires that merely meet at a pin
never hop.

## Undo/redo

The store keeps immutable snapshots of `{nodes, wires, title}` in past/future
stacks. Every user action calls `checkpoint()` before mutating (drags
checkpoint on drag start, typing coalesces per field). Undo covers parts,
wires, bends, colors, labels, sections, notes and the title block.

## Persistence

* IndexedDB (`idb`): `diagrams` store (id, name, updatedAt, file JSON),
  `parts` store (imported custom parts), `meta` store (last-open diagram).
* The current diagram autosaves 400 ms after each change.
* `.blueprint` export/import is the JSON diagram format below; nothing is sent
  anywhere.

## Data formats (all versioned with `formatVersion`)

See `src/model/format.ts` for the canonical TypeScript types.

* **Part definition** — as in the brief: `id, name, subtitle?, category,
  width?, note?, pins[] {id, label, side, index, type}`.
* **Parts library** — `{ formatVersion, name, parts[] }`.
* **Diagram** —
  ```jsonc
  {
    "formatVersion": 1,
    "kind": "blueprint-diagram",
    "title": { "room": "", "prop": "", "firmware": "", "wiredBy": "", "updated": "" },
    "parts":    [{ "id", "x", "y", "rotation", "flip", "label", "part": { …full part definition… } }],
    "wires":    [{ "id", "from": { "part", "pin" }, "to": { "part", "pin" },
                   "color": "white", "stripe": "blue", "label": "…",
                   "route": "orthogonal", "points": [{ "x", "y" }] }],
    "notes":    [{ "id", "x", "y", "width", "height", "text" }],
    "sections": [{ "id", "x", "y", "width", "height", "label", "color" }]
  }
  ```

## v1.5: Part Maker and connection list (built)

**Part Maker** (`src/ui/PartMaker.tsx`, model in `src/library/partMaker.ts`).
A modal with a form on the left and a live preview on the right, drawn by the
same `PartBody` component the canvas uses. It edits a `PartDefinition` object directly: name, subtitle,
category (free text with suggestions), width, note, and four pin lists (one per
side) where each row is label + type with drag-to-reorder. `index` is written
from list order on save. "Edit a copy" clones an existing definition with a
new id. Saving goes through the same `validatePart()` used by library import
and stores into the IndexedDB `parts` store, so the sidebar picks it up.

**Connection list** (`src/model/connections.ts`, `src/ui/ConnectionsPanel.tsx`).
A derived view: `wires.map(w => from part/pin, color,
to part/pin, label)` sorted by from-part. It needs no new data. It renders
as the Connections tab of the right panel and as a table on the PDF page(s)
after the diagram. Rows read from the board outward and follow pin order.

## Build steps

1. Data formats + converted default library (with tests for the ESP32).
2. Part layout + part node + sidebar drag-and-drop.
3. Wires: connect, orthogonal routing, bound ends, segment drag, hops,
   popover. Tests for routing.
4. Undo/redo, selection, clipboard, shortcuts.
5. Sections, notes, title block.
6. IndexedDB autosave, recent diagrams, `.blueprint` import/export.
7. PNG/PDF export, library import/export.
8. GitHub Pages workflow.
