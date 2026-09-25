/**
 * Part Maker model: an editable draft of a part definition, and the
 * conversion back to the same part JSON the library and diagrams use.
 */
import { FORMAT_VERSION, PIN_SIDES, validatePart, type PartDefinition, type PinSide, type PinType } from '../model/format';

export interface DraftPin {
  /** Stable React key for the editor row. */
  key: string;
  /** Pin id carried over from the part being edited, if any. */
  id?: string;
  label: string;
  type: PinType;
  side: PinSide;
}

export interface PartDraft {
  name: string;
  subtitle: string;
  category: string;
  /** Text field; blank = auto width. */
  width: string;
  note: string;
  /** In display order; a side's pins are the ones with that side, in this order. */
  pins: DraftPin[];
}

let keySeq = 0;
export const pinKey = () => `pin${++keySeq}`;

export const emptyDraft = (category = 'Inputs'): PartDraft => ({
  name: '',
  subtitle: '',
  category,
  width: '',
  note: '',
  pins: [],
});

export function draftFromPart(def: PartDefinition, copy: boolean): PartDraft {
  const pins = [...def.pins]
    .sort((a, b) => PIN_SIDES.indexOf(a.side) - PIN_SIDES.indexOf(b.side) || a.index - b.index)
    .map((p) => ({ key: pinKey(), id: p.id, label: p.label, type: p.type, side: p.side }));
  return {
    name: copy ? `${def.name} (copy)` : def.name,
    subtitle: def.subtitle ?? '',
    category: def.category,
    width: def.width ? String(def.width) : '',
    note: def.note ?? '',
    pins,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/µ/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A fresh part id that doesn't collide with any existing part. */
export function uniquePartId(name: string, taken: Set<string>): string {
  const base = `custom-${slugify(name) || 'part'}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Same rule as the library converter: "VP · 36" → "VP". */
export const pinIdFromLabel = (label: string) => label.split(' · ')[0].trim() || 'pin';

/** Problems that block saving, in plain words. */
export function draftProblems(d: PartDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give the part a name.');
  if (!d.category.trim()) out.push('Pick or type a category.');
  if (!d.pins.length) out.push('Add at least one pin.');
  if (d.pins.some((p) => !p.label.trim())) out.push('Every pin needs a label.');
  if (d.width.trim() && !(Number(d.width) >= 40 && Number(d.width) <= 2000)) out.push('Width must be a number from 40 to 2000 (or blank for auto).');
  return out;
}

export function partFromDraft(d: PartDraft, id: string): PartDefinition {
  const used = new Set<string>();
  // Keep ids of pins carried over from the original part; derive the rest.
  for (const p of d.pins) if (p.id) used.add(p.id);
  const kept = new Set<string>();
  const counters: Record<PinSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  const pins = d.pins.map((p) => {
    let pid = p.id && !kept.has(p.id) ? p.id : '';
    if (pid) kept.add(pid);
    else {
      const base = pinIdFromLabel(p.label);
      pid = base;
      if (used.has(pid)) pid = `${base}.${p.side}`;
      for (let n = 2; used.has(pid); n++) pid = `${base}.${p.side}.${n}`;
      used.add(pid);
    }
    return { id: pid, label: p.label.trim(), side: p.side, index: counters[p.side]++, type: p.type };
  });
  const part: PartDefinition = {
    formatVersion: FORMAT_VERSION,
    id,
    name: d.name.trim(),
    ...(d.subtitle.trim() ? { subtitle: d.subtitle.trim() } : {}),
    category: d.category.trim(),
    ...(d.width.trim() ? { width: Math.round(Number(d.width)) } : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
    pins,
  };
  return validatePart(part);
}

/** Move a pin up/down within its side. */
export function movePin(pins: DraftPin[], key: string, dir: -1 | 1): DraftPin[] {
  const i = pins.findIndex((p) => p.key === key);
  if (i < 0) return pins;
  const side = pins[i].side;
  let j = i + dir;
  while (j >= 0 && j < pins.length && pins[j].side !== side) j += dir;
  if (j < 0 || j >= pins.length) return pins;
  const next = [...pins];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Change a pin's side; it goes to the end of the new side. */
export function setPinSide(pins: DraftPin[], key: string, side: PinSide): DraftPin[] {
  const pin = pins.find((p) => p.key === key);
  if (!pin || pin.side === side) return pins;
  return [...pins.filter((p) => p.key !== key), { ...pin, side }];
}

/** Guess a pin type from its label (same idea as the original script). */
export function guessPinType(label: string): PinType {
  const n = label.trim().toUpperCase();
  if (/^(GND|VSS|DC-|DC−|V-|V−|-|−)/.test(n) || /(-|−)$/.test(n)) return 'gnd';
  if (/^(VCC|VIN|VDD|VMOT|3V3|3\.3V|5V|12V|\+|V\+|DC\+)/.test(n) || /\+$/.test(n)) return 'power';
  return 'io';
}
