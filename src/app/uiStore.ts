import { create } from 'zustand';
import type { PartDefinition } from '../model/format';

/** What the Part Maker is doing: a new part, a copy of one, or editing a custom part in place. */
export type PartMakerRequest = { mode: 'new' } | { mode: 'copy' | 'edit'; source: PartDefinition };

type Toast = { id: number; text: string; kind: 'info' | 'error' };

interface UiState {
  toasts: Toast[];
  toast(text: string, kind?: Toast['kind']): void;
  dismiss(id: number): void;
  /** Canvas tool: normal editing, or drawing a new section. */
  tool: 'select' | 'section';
  setTool(tool: UiState['tool']): void;
  partMaker: PartMakerRequest | null;
  openPartMaker(req: PartMakerRequest | null): void;
}

let nextToast = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  toast(text, kind = 'info') {
    const id = nextToast++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 3500);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  tool: 'select',
  setTool: (tool) => set({ tool }),
  partMaker: null,
  openPartMaker: (partMaker) => set({ partMaker }),
}));

export const toast = (text: string, kind?: 'info' | 'error') => useUi.getState().toast(text, kind);
