/**
 * Every Blueprint data format lives here: part definitions, parts libraries
 * and diagram files, plus the shared constants (pin types, wire colors) and
 * validators. Import/export, the sidebar and the future Part Maker all share
 * this module, so change formats here and bump FORMAT_VERSION when needed.
 */

export const FORMAT_VERSION = 1;

// ---------------------------------------------------------------- pins

export const PIN_SIDES = ['left', 'right', 'top', 'bottom'] as const;
export type PinSide = (typeof PIN_SIDES)[number];

export const PIN_TYPES = ['io', 'input', 'strap', 'power', 'gnd', 'other'] as const;
export type PinType = (typeof PIN_TYPES)[number];

export const PIN_TYPE_INFO: Record<PinType, { label: string; color: string }> = {
  io: { label: 'GPIO / signal', color: '#F2C94C' },
  input: { label: 'Input-only GPIO', color: '#56CCF2' },
  strap: { label: 'Boot / strapping pin', color: '#F2994A' },
  power: { label: 'Power', color: '#EB5757' },
  gnd: { label: 'Ground', color: '#333333' },
  other: { label: 'Other / passive', color: '#BDBDBD' },
};

export interface PinDefinition {
  id: string;
  label: string;
  side: PinSide;
  /** Slot along the side: left/right count top→bottom, top/bottom count left→right. */
  index: number;
  type: PinType;
}

// ---------------------------------------------------------------- parts

export interface PartDefinition {
  formatVersion: number;
  id: string;
  name: string;
  subtitle?: string;
  category: string;
  /** Preferred body width in px. Omit to size automatically. */
  width?: number;
  note?: string;
  pins: PinDefinition[];
}

export const DEFAULT_CATEGORIES = ['Boards', 'Inputs', 'Outputs', 'Inline Parts', 'Power & Wiring'];

export interface PartsLibraryFile {
  formatVersion: number;
  name: string;
  parts: PartDefinition[];
}

// ---------------------------------------------------------------- wires

export const WIRE_COLORS = {
  red: { label: 'Red', hex: '#E53935' },
  black: { label: 'Black', hex: '#111111' },
  white: { label: 'White', hex: '#FFFFFF' },
  yellow: { label: 'Yellow', hex: '#F9C80E' },
  green: { label: 'Green', hex: '#2E9E44' },
  blue: { label: 'Blue', hex: '#1E63D6' },
  orange: { label: 'Orange', hex: '#F57C00' },
  purple: { label: 'Purple', hex: '#8E44AD' },
  brown: { label: 'Brown', hex: '#7B4A21' },
  gray: { label: 'Gray', hex: '#808080' },
} as const;
export type WireColor = keyof typeof WIRE_COLORS;
export const WIRE_COLOR_NAMES = Object.keys(WIRE_COLORS) as WireColor[];

export type WireRoute = 'orthogonal' | 'straight';

export interface XY {
  x: number;
  y: number;
}

export interface PinRef {
  /** Part instance id. */
  part: string;
  /** Pin id within that part. */
  pin: string;
}

export interface WireRecord {
  id: string;
  from: PinRef;
  to: PinRef;
  color: WireColor;
  /** Second color for striped cable, e.g. color "white" + stripe "blue". */
  stripe?: WireColor;
  label?: string;
  route: WireRoute;
  /** Manual bend points (interior corners). Absent = auto-routed. */
  points?: XY[];
}

export function wireColorName(w: Pick<WireRecord, 'color' | 'stripe'>): string {
  const base = WIRE_COLORS[w.color]?.label ?? w.color;
  return w.stripe ? `${base}/${WIRE_COLORS[w.stripe]?.label ?? w.stripe}` : base;
}

// ---------------------------------------------------------------- diagram file

export type Rotation = 0 | 90 | 180 | 270;

export interface TitleBlock {
  room: string;
  prop: string;
  firmware: string;
  wiredBy: string;
  updated: string;
}

export const EMPTY_TITLE: TitleBlock = { room: '', prop: '', firmware: '', wiredBy: '', updated: '' };

export const TITLE_FIELDS: { key: keyof TitleBlock; label: string }[] = [
  { key: 'room', label: 'Room' },
  { key: 'prop', label: 'Prop' },
  { key: 'firmware', label: 'Firmware' },
  { key: 'wiredBy', label: 'Wired by' },
  { key: 'updated', label: 'Updated' },
];

export interface PartInstanceRecord {
  id: string;
  x: number;
  y: number;
  rotation: Rotation;
  flip: boolean;
  /** Instance label, e.g. "Top XLR 1". Defaults to the part name. */
  label: string;
  /** Full embedded definition so the diagram opens without the library. */
  part: PartDefinition;
}

export interface NoteRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface SectionRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
}

export const SECTION_COLORS = ['#E3F2FD', '#E8F5E9', '#FFF8E1', '#FCE4EC', '#F3E5F5', '#ECEFF1'];

export interface DiagramFile {
  formatVersion: number;
  kind: 'blueprint-diagram';
  title: TitleBlock;
  parts: PartInstanceRecord[];
  wires: WireRecord[];
  notes: NoteRecord[];
  sections: SectionRecord[];
}

export const DIAGRAM_EXTENSION = '.blueprint';

// ---------------------------------------------------------------- validation

export class FormatError extends Error {}

function fail(path: string, msg: string): never {
  throw new FormatError(`${path}: ${msg}`);
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function str(v: unknown, path: string, optional = false): string | undefined {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string') fail(path, 'expected text');
  return v;
}
function num(v: unknown, path: string, optional = false): number | undefined {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a number');
  return v;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected a list');
  return v;
}
function checkVersion(v: unknown, path: string) {
  const n = num(v, `${path}.formatVersion`)!;
  if (n > FORMAT_VERSION)
    fail(path, `made by a newer version of Blueprint (format ${n}); please update the app`);
}

export function validatePart(raw: unknown, path = 'part'): PartDefinition {
  if (!isObj(raw)) fail(path, 'expected an object');
  checkVersion(raw.formatVersion ?? FORMAT_VERSION, path);
  const id = str(raw.id, `${path}.id`)!;
  if (!id.trim()) fail(`${path}.id`, 'must not be empty');
  const pins = arr(raw.pins, `${path}.pins`).map((p, i) => {
    const pp = `${path}.pins[${i}]`;
    if (!isObj(p)) fail(pp, 'expected an object');
    const side = str(p.side, `${pp}.side`) as PinSide;
    if (!PIN_SIDES.includes(side)) fail(`${pp}.side`, `must be one of ${PIN_SIDES.join(', ')}`);
    const type = str(p.type, `${pp}.type`) as PinType;
    if (!PIN_TYPES.includes(type)) fail(`${pp}.type`, `must be one of ${PIN_TYPES.join(', ')}`);
    const pin: PinDefinition = {
      id: str(p.id, `${pp}.id`)!,
      label: str(p.label ?? p.id, `${pp}.label`)!,
      side,
      index: num(p.index, `${pp}.index`)!,
      type,
    };
    return pin;
  });
  const seen = new Set<string>();
  for (const p of pins) {
    if (seen.has(p.id)) fail(`${path}.pins`, `duplicate pin id "${p.id}"`);
    seen.add(p.id);
  }
  const part: PartDefinition = {
    formatVersion: FORMAT_VERSION,
    id,
    name: str(raw.name, `${path}.name`)!,
    category: str(raw.category ?? 'Custom', `${path}.category`)!,
    pins,
  };
  const subtitle = str(raw.subtitle, `${path}.subtitle`, true);
  if (subtitle) part.subtitle = subtitle;
  const width = num(raw.width, `${path}.width`, true);
  if (width !== undefined) part.width = width;
  const note = str(raw.note, `${path}.note`, true);
  if (note) part.note = note;
  return part;
}

export function validateLibrary(raw: unknown): PartsLibraryFile {
  if (!isObj(raw)) fail('library', 'expected an object');
  checkVersion(raw.formatVersion, 'library');
  return {
    formatVersion: FORMAT_VERSION,
    name: str(raw.name ?? 'Imported parts', 'library.name')!,
    parts: arr(raw.parts, 'library.parts').map((p, i) => validatePart(p, `library.parts[${i}]`)),
  };
}

function xy(v: unknown, path: string): XY {
  if (!isObj(v)) fail(path, 'expected {x, y}');
  return { x: num(v.x, `${path}.x`)!, y: num(v.y, `${path}.y`)! };
}

function wireColor(v: unknown, path: string, optional = false): WireColor | undefined {
  const c = str(v, path, optional);
  if (c === undefined) return undefined;
  if (!(c in WIRE_COLORS)) fail(path, `unknown wire color "${c}"`);
  return c as WireColor;
}

export function validateDiagram(raw: unknown): DiagramFile {
  if (!isObj(raw)) fail('diagram', 'expected an object');
  if (raw.kind !== 'blueprint-diagram') fail('diagram', 'this is not a Blueprint diagram file');
  checkVersion(raw.formatVersion, 'diagram');

  const t = isObj(raw.title) ? raw.title : {};
  const title: TitleBlock = { ...EMPTY_TITLE };
  for (const { key } of TITLE_FIELDS) title[key] = str(t[key] ?? '', `title.${key}`)!;

  const parts = arr(raw.parts ?? [], 'parts').map((p, i): PartInstanceRecord => {
    const pp = `parts[${i}]`;
    if (!isObj(p)) fail(pp, 'expected an object');
    const rotation = num(p.rotation ?? 0, `${pp}.rotation`)!;
    if (![0, 90, 180, 270].includes(rotation)) fail(`${pp}.rotation`, 'must be 0, 90, 180 or 270');
    const part = validatePart(p.part, `${pp}.part`);
    return {
      id: str(p.id, `${pp}.id`)!,
      x: num(p.x, `${pp}.x`)!,
      y: num(p.y, `${pp}.y`)!,
      rotation: rotation as Rotation,
      flip: p.flip === true,
      label: str(p.label ?? part.name, `${pp}.label`)!,
      part,
    };
  });
  const partPins = new Map(parts.map((p) => [p.id, new Set(p.part.pins.map((pin) => pin.id))]));

  const pinRef = (v: unknown, path: string): PinRef => {
    if (!isObj(v)) fail(path, 'expected {part, pin}');
    const ref = { part: str(v.part, `${path}.part`)!, pin: str(v.pin, `${path}.pin`)! };
    const pins = partPins.get(ref.part);
    if (!pins) fail(path, `no part with id "${ref.part}"`);
    if (!pins.has(ref.pin)) fail(path, `part "${ref.part}" has no pin "${ref.pin}"`);
    return ref;
  };

  const wires = arr(raw.wires ?? [], 'wires').map((w, i): WireRecord => {
    const wp = `wires[${i}]`;
    if (!isObj(w)) fail(wp, 'expected an object');
    const route = (w.route ?? 'orthogonal') as WireRoute;
    if (route !== 'orthogonal' && route !== 'straight') fail(`${wp}.route`, 'must be orthogonal or straight');
    const wire: WireRecord = {
      id: str(w.id, `${wp}.id`)!,
      from: pinRef(w.from, `${wp}.from`),
      to: pinRef(w.to, `${wp}.to`),
      color: wireColor(w.color ?? 'red', `${wp}.color`)!,
      route,
    };
    const stripe = wireColor(w.stripe, `${wp}.stripe`, true);
    if (stripe) wire.stripe = stripe;
    const label = str(w.label, `${wp}.label`, true);
    if (label) wire.label = label;
    if (w.points !== undefined)
      wire.points = arr(w.points, `${wp}.points`).map((pt, j) => xy(pt, `${wp}.points[${j}]`));
    return wire;
  });

  const notes = arr(raw.notes ?? [], 'notes').map((n, i): NoteRecord => {
    const np = `notes[${i}]`;
    if (!isObj(n)) fail(np, 'expected an object');
    return {
      id: str(n.id, `${np}.id`)!,
      x: num(n.x, `${np}.x`)!,
      y: num(n.y, `${np}.y`)!,
      width: num(n.width ?? 180, `${np}.width`)!,
      height: num(n.height ?? 80, `${np}.height`)!,
      text: str(n.text ?? '', `${np}.text`)!,
    };
  });

  const sections = arr(raw.sections ?? [], 'sections').map((s, i): SectionRecord => {
    const sp = `sections[${i}]`;
    if (!isObj(s)) fail(sp, 'expected an object');
    return {
      id: str(s.id, `${sp}.id`)!,
      x: num(s.x, `${sp}.x`)!,
      y: num(s.y, `${sp}.y`)!,
      width: num(s.width, `${sp}.width`)!,
      height: num(s.height, `${sp}.height`)!,
      label: str(s.label ?? '', `${sp}.label`)!,
      color: str(s.color ?? SECTION_COLORS[0], `${sp}.color`)!,
    };
  });

  return { formatVersion: FORMAT_VERSION, kind: 'blueprint-diagram', title, parts, wires, notes, sections };
}
