/**
 * Local storage in IndexedDB. Nothing here leaves the browser: the team's
 * shared copy is whatever file the user exports.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DiagramFile, PartDefinition } from '../model/format';

export interface StoredDiagram {
  id: string;
  name: string;
  updatedAt: number;
  file: DiagramFile;
}

interface BlueprintDB extends DBSchema {
  diagrams: { key: string; value: StoredDiagram; indexes: { updatedAt: number } };
  parts: { key: string; value: PartDefinition };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<BlueprintDB>> | null = null;

function db() {
  if (!dbPromise)
    dbPromise = openDB<BlueprintDB>('blueprint', 1, {
      upgrade(d) {
        const diagrams = d.createObjectStore('diagrams', { keyPath: 'id' });
        diagrams.createIndex('updatedAt', 'updatedAt');
        d.createObjectStore('parts', { keyPath: 'id' });
        d.createObjectStore('meta');
      },
    });
  return dbPromise;
}

/** For tests: forget the open connection. */
export function resetDbConnection() {
  dbPromise = null;
}

export function diagramName(file: DiagramFile): string {
  const { room, prop } = file.title;
  return [room, prop].filter((s) => s.trim()).join(' — ') || 'Untitled diagram';
}

export async function saveDiagram(id: string, file: DiagramFile): Promise<void> {
  await (await db()).put('diagrams', { id, name: diagramName(file), updatedAt: Date.now(), file });
}

export async function loadDiagram(id: string): Promise<StoredDiagram | undefined> {
  return (await db()).get('diagrams', id);
}

export async function deleteDiagram(id: string): Promise<void> {
  await (await db()).delete('diagrams', id);
}

export type DiagramSummary = Omit<StoredDiagram, 'file'> & { partCount: number };

export async function listDiagrams(): Promise<DiagramSummary[]> {
  const all = await (await db()).getAllFromIndex('diagrams', 'updatedAt');
  return all.reverse().map(({ id, name, updatedAt, file }) => ({
    id,
    name,
    updatedAt,
    partCount: file.parts.length,
  }));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

export async function listCustomParts(): Promise<PartDefinition[]> {
  return (await db()).getAll('parts');
}

export async function putCustomParts(parts: PartDefinition[]): Promise<void> {
  const tx = (await db()).transaction('parts', 'readwrite');
  await Promise.all([...parts.map((p) => tx.store.put(p)), tx.done]);
}

export async function deleteCustomPart(id: string): Promise<void> {
  await (await db()).delete('parts', id);
}
