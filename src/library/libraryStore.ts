import { create } from 'zustand';
import {
  DEFAULT_CATEGORIES,
  FORMAT_VERSION,
  validateLibrary,
  type PartDefinition,
  type PartsLibraryFile,
} from '../model/format';
import { deleteCustomPart, listCustomParts, putCustomParts } from '../store/persistence';
import { BUILTIN_PARTS } from './builtin';

interface LibraryState {
  /** Parts imported by the user (stored in IndexedDB). */
  custom: PartDefinition[];
  loaded: boolean;
  load(): Promise<void>;
  /** Merge a library file into the sidebar. Returns how many parts were added/updated. */
  importLibrary(raw: unknown): Promise<number>;
  removeCustom(id: string): Promise<void>;
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  custom: [],
  loaded: false,
  async load() {
    try {
      set({ custom: await listCustomParts(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async importLibrary(raw) {
    const lib = validateLibrary(raw);
    await putCustomParts(lib.parts);
    const byId = new Map(get().custom.map((p) => [p.id, p]));
    for (const p of lib.parts) byId.set(p.id, p);
    set({ custom: [...byId.values()] });
    return lib.parts.length;
  },
  async removeCustom(id) {
    await deleteCustomPart(id);
    set({ custom: get().custom.filter((p) => p.id !== id) });
  },
}));

const customIds = (custom: PartDefinition[]) => new Set(custom.map((p) => p.id));

/** Built-in parts plus custom parts; a custom part replaces a built-in with the same id. */
export function allParts(custom: PartDefinition[]): PartDefinition[] {
  const ids = customIds(custom);
  return [...BUILTIN_PARTS.filter((p) => !ids.has(p.id)), ...custom];
}

export function isCustom(custom: PartDefinition[], id: string) {
  return customIds(custom).has(id);
}

/** Category names in sidebar order: the starting sections first, then the rest A→Z. */
export function categoriesOf(parts: PartDefinition[]): string[] {
  const extra = [...new Set(parts.map((p) => p.category))].filter((c) => !DEFAULT_CATEGORIES.includes(c)).sort();
  return [...DEFAULT_CATEGORIES, ...extra];
}

export function makeLibraryFile(name: string, parts: PartDefinition[]): PartsLibraryFile {
  return { formatVersion: FORMAT_VERSION, name, parts };
}
