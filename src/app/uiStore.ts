import { create } from 'zustand';

type Toast = { id: number; text: string; kind: 'info' | 'error' };

interface UiState {
  toasts: Toast[];
  toast(text: string, kind?: Toast['kind']): void;
  dismiss(id: number): void;
  /** Canvas tool: normal editing, or drawing a new section. */
  tool: 'select' | 'section';
  setTool(tool: UiState['tool']): void;
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
}));

export const toast = (text: string, kind?: 'info' | 'error') => useUi.getState().toast(text, kind);
