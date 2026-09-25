/** User commands shared by the toolbar, menus and keyboard shortcuts. */
import { DIAGRAM_EXTENSION, FormatError, type PartDefinition } from '../model/format';
import { downloadBlob, downloadJson, pickFile, readJsonFile, safeFilename } from '../export/files';
import { renderPdf } from '../export/pdf';
import { renderPng } from '../export/render';
import { makeLibraryFile, useLibrary } from '../library/libraryStore';
import { toFile } from '../store/convert';
import { currentContent } from '../store/diagramStore';
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
    downloadBlob(await renderPng(currentContent()), `${baseName()}.png`);
  } catch (e) {
    toast(`PNG export failed: ${describe(e)}`, 'error');
  }
}

export async function exportPdf() {
  try {
    toast('Rendering PDF…');
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
