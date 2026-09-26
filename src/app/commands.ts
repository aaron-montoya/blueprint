/** User commands shared by the toolbar, menus and keyboard shortcuts. */
import { DIAGRAM_EXTENSION, FormatError, type PartDefinition, type XY } from '../model/format';
import { downloadBlob, downloadJson, pickFile, readJsonFile, safeFilename } from '../export/files';
import { makeLibraryFile, useLibrary } from '../library/libraryStore';
import { toFile } from '../store/convert';
import { optimizeWires, type OptimizeResult, type OptimizeStats } from '../geometry/optimize';
import type { OptimizeRequest } from '../geometry/optimize.worker';
import { isPartNode, type DiagramNode, type WireEdge } from '../store/types';
import { currentContent, useDiagram } from '../store/diagramStore';
import { diagramName } from '../store/persistence';
import { importDiagram } from './session';
import { toast } from './uiStore';

const baseName = () => safeFilename(diagramName(toFile(currentContent())), 'wiring-diagram');

const describe = (e: unknown) => (e instanceof FormatError || e instanceof Error ? e.message : String(e));

export function exportBlueprint() {
  const file = toFile(currentContent());
  downloadJson(file, `${baseName()}${DIAGRAM_EXTENSION}`);
  toast(`Exported ${baseName()}${DIAGRAM_EXTENSION} — keep it in the team Drive folder`);
}

export async function importBlueprintFile(file: File) {
  try {
    const d = await importDiagram(await readJsonFile(file));
    toast(`Opened ${file.name} (${d.parts.length} parts, ${d.wires.length} wires)`);
  } catch (e) {
    toast(`Could not open ${file.name}: ${describe(e)}`, 'error');
  }
}

export async function importBlueprint() {
  const file = await pickFile(`${DIAGRAM_EXTENSION},.json,application/json`);
  if (file) await importBlueprintFile(file);
}

export async function exportPng() {
  try {
    toast('Rendering PNG…');
    const { renderPng } = await import('../export/render');
    downloadBlob(await renderPng(currentContent()), `${baseName()}.png`);
  } catch (e) {
    toast(`PNG export failed: ${describe(e)}`, 'error');
  }
}

export async function exportPdf() {
  try {
    toast('Rendering PDF…');
    const { renderPdf } = await import('../export/pdf');
    downloadBlob(await renderPdf(currentContent()), `${baseName()}.pdf`);
  } catch (e) {
    toast(`PDF export failed: ${describe(e)}`, 'error');
  }
}

export async function importLibrary() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const n = await useLibrary.getState().importLibrary(await readJsonFile(file));
    toast(`Imported ${n} part${n === 1 ? '' : 's'} from ${file.name}`);
  } catch (e) {
    toast(`Could not import ${file.name}: ${describe(e)}`, 'error');
  }
}

export function exportLibrary(name: string, parts: PartDefinition[]) {
  if (!parts.length) {
    toast('Nothing to export', 'error');
    return;
  }
  downloadJson(makeLibraryFile(name, parts), `${safeFilename(name, 'parts')}.parts.json`);
}

/** Run the optimizer in a worker (inline where workers aren't available, e.g. tests). */
function runOptimizer(nodes: DiagramNode[], edges: WireEdge[], ids?: Set<string>): Promise<OptimizeResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(optimizeWires(nodes, edges, ids));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../geometry/optimize.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ points: [string, XY[]][]; before: OptimizeStats; after: OptimizeStats }>) => {
      worker.terminate();
      resolve({ ...e.data, points: new Map(e.data.points) });
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Optimizer failed'));
    };
    const req: OptimizeRequest = { nodes, edges, ids: ids && [...ids] };
    worker.postMessage(req);
  });
}

/** What the optimizer's result depends on: part placement and wire routes, not selection. */
const routingKey = (nodes: DiagramNode[], edges: WireEdge[]) =>
  JSON.stringify([
    nodes.map((n) => [n.id, n.position.x, n.position.y, isPartNode(n) ? [n.data.rotation, n.data.flip, n.data.label, n.data.def.id] : 0]),
    edges.map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle, e.data?.route, e.data?.points]),
  ]);

/**
 * Reroute wires together to cut crossings and overlaps. Works on the
 * selected wires, else the wires of the selected parts, else every wire.
 */
export async function optimizeWireRoutes() {
  const { nodes, edges } = useDiagram.getState();
  let ids: Set<string> | undefined;
  const pickedWires = edges.filter((e) => e.selected);
  const pickedParts = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  if (pickedWires.length) ids = new Set(pickedWires.map((e) => e.id));
  else if (pickedParts.size)
    ids = new Set(edges.filter((e) => pickedParts.has(e.source) || pickedParts.has(e.target)).map((e) => e.id));
  if (ids && !ids.size) return toast('The selected parts have no wires');
  if (!edges.some((e) => e.data?.route === 'orthogonal' && (!ids || ids.has(e.id))))
    return toast('No right-angle wires to optimize');

  const key = routingKey(nodes, edges);
  const r = await runOptimizer(nodes, edges, ids);
  const now = useDiagram.getState();
  if (routingKey(now.nodes, now.edges) !== key) return toast('The diagram changed while optimizing — try again', 'error');
  if (!r.points.size) return toast('Wires are already as tidy as the optimizer can get them');
  now.setRoutes(r.points);
  const change = (label: string, a: number, b: number) => (a === b ? null : `${label} ${a} → ${b}`);
  const summary = [
    change('crossings', r.before.crossings, r.after.crossings),
    change('overlaps', Math.round(r.before.overlap), Math.round(r.after.overlap)),
  ]
    .filter(Boolean)
    .join(', ');
  toast(`Rerouted ${r.points.size} wire${r.points.size === 1 ? '' : 's'}${summary ? ` — ${summary}` : ''}. Ctrl+Z to undo.`);
}
