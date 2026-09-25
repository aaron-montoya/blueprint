/**
 * The diagram session: which diagram is open, autosave to IndexedDB, and
 * opening/creating/importing diagrams.
 */
import { DEFAULT_HEADING, EMPTY_TITLE, TITLE_FIELDS, validateDiagram, type DiagramFile } from '../model/format';
import { newId } from '../model/ids';
import { fromFile, toFile, type DiagramContent } from '../store/convert';
import { useDiagram } from '../store/diagramStore';
import { getMeta, loadDiagram, saveDiagram, setMeta } from '../store/persistence';

const AUTOSAVE_MS = 400;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { id: string; content: DiagramContent } | null = null;
let listeners: (() => void)[] = [];

/** Called after every save so the recent list can refresh. */
export function onSaved(fn: () => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

const isEmpty = (c: DiagramContent) =>
  c.nodes.length === 0 && c.edges.length === 0 && TITLE_FIELDS.every((f) => !c.title[f.key].trim());

const HEADING_KEY = 'blueprint:heading';
/** New diagrams start with the heading you used last. */
export function rememberHeading(heading: string) {
  try {
    localStorage.setItem(HEADING_KEY, heading);
  } catch {
    /* ignore */
  }
}
function lastHeading(): string {
  try {
    return localStorage.getItem(HEADING_KEY) ?? DEFAULT_HEADING;
  } catch {
    return DEFAULT_HEADING;
  }
}

export async function flushSave() {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = pending;
  pending = null;
  if (!p || !p.id) return;
  if (isEmpty(p.content) && !(await loadDiagram(p.id))) return; // don't clutter the list with blank diagrams
  await saveDiagram(p.id, toFile(p.content));
  listeners.forEach((l) => l());
}

/** Start watching the store and autosaving. Returns an unsubscribe function. */
export function startAutosave() {
  const unsub = useDiagram.subscribe((s, prev) => {
    if (s.diagramId !== prev.diagramId) return; // a load, not an edit
    if (s.nodes === prev.nodes && s.edges === prev.edges && s.title === prev.title) return;
    pending = { id: s.diagramId, content: { nodes: s.nodes, edges: s.edges, title: s.title } };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushSave().catch((e) => console.error('autosave failed', e)), AUTOSAVE_MS);
  });
  const beforeUnload = () => void flushSave();
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    unsub();
    window.removeEventListener('beforeunload', beforeUnload);
  };
}

async function open(content: DiagramContent, id: string) {
  await flushSave();
  useDiagram.getState().load(content, id);
  await setMeta('current', id);
}

export async function newDiagram() {
  await open({ nodes: [], edges: [], title: { ...EMPTY_TITLE, heading: lastHeading() } }, newId('d'));
}

export async function openDiagram(id: string) {
  const stored = await loadDiagram(id);
  if (!stored) throw new Error('That diagram is no longer stored in this browser');
  await open(fromFile(validateDiagram(stored.file)), id);
}

/** Import an exported file as a new local diagram. */
export async function importDiagram(raw: unknown): Promise<DiagramFile> {
  const file = validateDiagram(raw);
  const id = newId('d');
  await open(fromFile(file), id);
  await saveDiagram(id, file);
  listeners.forEach((l) => l());
  return file;
}

/** Reopen whatever was open last time, or start fresh. */
export async function restoreSession() {
  try {
    const id = await getMeta<string>('current');
    if (id && (await loadDiagram(id))) {
      await openDiagram(id);
      return;
    }
  } catch (e) {
    console.error('could not restore the last diagram', e);
  }
  await newDiagram();
}
