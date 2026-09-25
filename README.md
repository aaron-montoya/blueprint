# Blueprint

A browser-based wiring diagram editor for escape-room props at Escapes in Time.
Each diagram shows a microcontroller, the parts wired to it, and **the real
color of every wire**, so someone who didn't build a prop can trace and fix it.

It runs entirely in the browser (Chrome/Edge) with nothing to install. There is
no server, and diagrams never leave your machine unless you export them.

> **This repo is public. Never commit real room diagrams** — they're spoilers.
> Examples and test fixtures use made-up props only. `*.blueprint` files are
> git-ignored outside `examples/`.

## Using it

| To… | Do this |
| --- | --- |
| Add a part | Drag it from the left sidebar (or double-click it). Search covers names, pins and notes. |
| Wire two pins | Drag from one pin to another. Valid targets light up. |
| Set a wire's color | New wires come out selected: click a color in the bar at the top of the canvas. Or click any wire for the full popover (color, two-color stripe, label, routing, delete). |
| Move a wire's end | Select the wire, then drag the blue dot at either end onto another pin. |
| Reshape a wire | Select it and drag the small handles on its segments. Your shape stays put when parts move. **Reset route** in the popover goes back to automatic routing. |
| Rename a part | Double-click its title (or select it and press F2), e.g. "XLR Jack" → "Top XLR 1". |
| Rotate / flip | `R` / `F`, or the toolbar. Pins move with the part. |
| Group parts | Select them and click **Section** (or click Section with nothing selected and draw a box). Drag the section's tab to move it and everything inside. |
| Notes | **Note** in the toolbar; double-click to edit. |
| Title block | Right panel → **Title block** tab: heading (printed at the top of the PDF/PNG title block), room, prop, firmware, wired by, updated. Hide the panel with **»** at its top right; bring it back with the strip on the right edge. |
| Connection list | Right panel → **Connections** tab: every wire as from pin → color → to pin → label. Click a row to find the wire, click its color to recolor or relabel it, × to delete it. It's also printed on page 2 of the PDF. |
| Make a part | **+ New part** (bottom of the sidebar) opens the Part Maker: name, category, pins per side with label and type, reorder with ↑/↓, live preview. Hover any part in the sidebar for **⧉** (new part from a copy) or **✎** (edit one of your own parts). |

**Canvas:** drag on empty space to box-select, Shift/Ctrl-click to add to the
selection, right-drag / middle-drag / Space-drag to pan, wheel to zoom, and the ⛶ button under the zoom controls to fit
the whole diagram. Snap to grid can be turned off in the toolbar.

**Shortcuts:** `Ctrl+Z` undo · `Ctrl+Y` redo · `Del` delete · `Ctrl+C`/`Ctrl+V`
copy/paste · `Ctrl+D` duplicate · `Ctrl+A` select all · `Ctrl+S` export
`.blueprint` · `R` rotate · `F` flip · `F2` rename · `Esc` deselect.

### Saving and sharing

* Your working copy **autosaves in this browser** (IndexedDB). **File → Recent**
  lists every diagram stored in this browser.
* **File → Export .blueprint** (`Ctrl+S`) downloads the editable file. Put it in
  the team Google Drive folder; that is the shared copy.
* **File → Import .blueprint** (or drop the file onto the page) opens a file to
  keep editing. Every part's full definition is embedded in the file, so it
  opens even on a machine that doesn't have the part library.
* **Export PNG** and **Export PDF** render the whole diagram with the title
  block and pin-color legend. The PDF puts the diagram on one landscape Letter
  page and the connection list on the page(s) after it.

Clearing browser data deletes local copies, so export anything you want to keep.

### Parts library

The built-in parts come from `tools/eit_parts_library_build.py` (Aaron's
original draw.io script, the source of truth). To regenerate after editing it:

```sh
npm run library   # writes src/library/default-library.json
```

Parts you make in the Part Maker or bring in with **Import…** (sidebar) are
kept in this browser, like diagrams. Share them as files: the ⤓ button on a
sidebar section exports that section as a parts library, and **Export mine**
exports every part you made or imported. Editing a part changes it for new
placements only; diagrams keep the copy of the part they were drawn with.

## File formats

All formats are versioned JSON (`formatVersion`). The TypeScript types and
validators live in [`src/model/format.ts`](src/model/format.ts).

* **Part:** `{ formatVersion, id, name, subtitle?, category, width?, note?, pins: [{ id, label, side, index, type }] }`.
  `side` is left/right/top/bottom and `index` is the slot along that side.
  Pin `type` is `io`, `input`, `strap`, `power`, `gnd` or `other`.
* **Parts library:** `{ formatVersion, name, parts: [...] }`.
* **Diagram (`.blueprint`):** `{ formatVersion, kind: "blueprint-diagram", title, parts, wires, notes, sections }`.
  Each wire has `from`/`to` `{ part, pin }`, `color`, optional `stripe`,
  `label`, `route` (`orthogonal`/`straight`) and optional bend `points`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it works inside,
including how wires stay attached and orthogonal and the designs for the v1.5
Part Maker and connection list.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run e2e        # the brief's acceptance test in Chromium (Playwright)
npm run build      # typecheck + production build into dist/
```

`npm run e2e` downloads Playwright's Chromium on first use
(`npx playwright install chromium`), or set `CHROMIUM_PATH` to use an existing
Chromium.

## Deploying

**GitHub Pages:** the workflow in `.github/workflows/deploy.yml` typechecks,
runs the unit and end-to-end tests, and deploys `dist/` on every push to
`main`. One-time setup: *Settings → Pages → Source: GitHub Actions*.

**Cloudflare Pages (fallback):** build command `npm run build`, output
directory `dist`. The build uses relative asset paths, so it works at any URL
path.
