import type { PartDefinition, PinDefinition, PinSide, Rotation, XY } from '../model/format';

/** Canvas grid. Pin centres land on grid lines when a part sits on the grid. */
export const GRID = 10;
export const PIN_SIZE = 10;
export const PIN_PITCH = 20;

const PIN_FONT_CHAR = 5.6; // px per char, 9px monospace
const TITLE_CHAR = 7.2; // px per char, 12px bold
const HEADER_ONE_LINE = 30;
const HEADER_TWO_LINES = 40;
const NOTE_LINE = 11;
const NOTE_CHAR = 4.5;

export interface LaidOutPin {
  def: PinDefinition;
  side: PinSide;
  /** Pin centre, relative to the part's top-left corner. */
  x: number;
  y: number;
  /** Top/bottom labels are drawn vertically when they are long. */
  verticalLabel: boolean;
}

export interface PartLayout {
  width: number;
  height: number;
  /** Header area (instance label + subtitle), relative to the body. */
  headerTop: number;
  headerHeight: number;
  /** Two header lines: bold instance label, then a small subtitle line. */
  titleLine: string;
  subtitleLine: string;
  note?: { top: number; height: number };
  pins: LaidOutPin[];
  pinById: Map<string, LaidOutPin>;
}

const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;

/** Outward unit normal of a side. */
export function sideNormal(side: PinSide): XY {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
  }
}

export const isHorizontalSide = (side: PinSide) => side === 'left' || side === 'right';

/**
 * Where a pin ends up after rotating the part clockwise and then flipping it
 * horizontally. Returns the new side and whether order along the side reverses.
 * Order convention: left/right count top→bottom, top/bottom count left→right.
 */
function rotateSideCW(side: PinSide): { side: PinSide; reverse: boolean } {
  switch (side) {
    case 'left':
      return { side: 'top', reverse: true };
    case 'top':
      return { side: 'right', reverse: false };
    case 'right':
      return { side: 'bottom', reverse: true };
    case 'bottom':
      return { side: 'left', reverse: false };
  }
}

/** Group a part's pins by their displayed side, in display order. */
export function pinsBySide(
  def: PartDefinition,
  rotation: Rotation,
  flip: boolean,
): Record<PinSide, PinDefinition[]> {
  const out: Record<PinSide, { pin: PinDefinition; key: number }[]> = { left: [], right: [], top: [], bottom: [] };
  const sideCount: Record<PinSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const p of def.pins) sideCount[p.side] = Math.max(sideCount[p.side], p.index + 1);
  for (const pin of def.pins) {
    let side = pin.side;
    // Position along the side as a 0..1 fraction so reversals are simple.
    let t = pin.index;
    const span = sideCount[pin.side];
    for (let r = 0; r < rotation; r += 90) {
      const next = rotateSideCW(side);
      if (next.reverse) t = span - 1 - t;
      side = next.side;
    }
    if (flip) {
      if (side === 'left') side = 'right';
      else if (side === 'right') side = 'left';
      else t = span - 1 - t;
    }
    out[side].push({ pin, key: t });
  }
  const sorted = {} as Record<PinSide, PinDefinition[]>;
  for (const s of ['left', 'right', 'top', 'bottom'] as PinSide[])
    sorted[s] = out[s].sort((a, b) => a.key - b.key).map((e) => e.pin);
  return sorted;
}

const cache = new WeakMap<PartDefinition, Map<string, PartLayout>>();

/**
 * Lay out a part body and its pins. Pure and cached: the part node, the wire
 * router and the exporters all call this, so wires always meet their pins.
 */
export function layoutPart(
  def: PartDefinition,
  rotation: Rotation,
  flip: boolean,
  label: string,
  /** Instance value shown in place of the subtitle (e.g. a resistor's "1kΩ"). */
  value?: string,
): PartLayout {
  const key = `${rotation}|${flip}|${label}|${value ?? '\u0000'}`;
  let perDef = cache.get(def);
  if (!perDef) cache.set(def, (perDef = new Map()));
  const hit = perDef.get(key);
  if (hit) return hit;
  const result = computeLayout(def, rotation, flip, label, value);
  perDef.set(key, result);
  return result;
}

/** Schematic symbols (the GND flag) are a small square with each pin centred on its side. */
export const SYMBOL_SIZE = 40;

function symbolLayout(def: PartDefinition, rotation: Rotation, flip: boolean, label: string): PartLayout {
  const sides = pinsBySide(def, rotation, flip);
  const s = SYMBOL_SIZE;
  const at: Record<PinSide, { x: number; y: number }> = {
    top: { x: s / 2, y: 0 },
    bottom: { x: s / 2, y: s },
    left: { x: 0, y: s / 2 },
    right: { x: s, y: s / 2 },
  };
  const pins: LaidOutPin[] = [];
  for (const side of ['top', 'right', 'bottom', 'left'] as PinSide[])
    for (const p of sides[side]) pins.push({ def: p, side, ...at[side], verticalLabel: false });
  return {
    width: s,
    height: s,
    headerTop: 0,
    headerHeight: 0,
    titleLine: label || def.name,
    subtitleLine: '',
    pins,
    pinById: new Map(pins.map((p) => [p.def.id, p])),
  };
}

function computeLayout(def: PartDefinition, rotation: Rotation, flip: boolean, label: string, value?: string): PartLayout {
  if (def.symbol) return symbolLayout(def, rotation, flip, label);
  const sides = pinsBySide(def, rotation, flip);
  const { left, right, top, bottom } = sides;

  const titleLine = label || def.name;
  const renamed = titleLine !== def.name;
  const subtitle = value ?? def.subtitle;
  const subtitleLine = renamed ? [def.name, subtitle].filter(Boolean).join(' · ') : (subtitle ?? '');
  const headerHeight = subtitleLine ? HEADER_TWO_LINES : HEADER_ONE_LINE;

  const longest = (pins: PinDefinition[]) => Math.max(0, ...pins.map((p) => p.label.length));

  // ---- width
  const lrWidth =
    (left.length ? longest(left) * PIN_FONT_CHAR + 16 : 0) +
    (right.length ? longest(right) * PIN_FONT_CHAR + 16 : 0) +
    (left.length && right.length ? 16 : 24);
  const titleWidth = Math.max(titleLine.length * TITLE_CHAR, subtitleLine.length * 5.2) + 24;
  const tbCount = Math.max(top.length, bottom.length);
  const tbWidth = (tbCount + 1) * PIN_PITCH;
  const preferred = rotation % 180 === 0 ? (def.width ?? 0) : 0;
  const width = ceilTo(Math.max(100, lrWidth, Math.min(titleWidth, 260), tbWidth, preferred), 2 * GRID);
  const tbPitch = Math.max(PIN_PITCH, Math.floor(width / (tbCount + 1) / (2 * GRID)) * 2 * GRID);
  // Top/bottom labels stay horizontal when they fit between neighbouring pins.
  const tbVertical = (pins: PinDefinition[]) => longest(pins) * PIN_FONT_CHAR > tbPitch - 4;
  const tbLabelSpace = (pins: PinDefinition[]) =>
    pins.length === 0 ? 0 : ceilTo((tbVertical(pins) ? longest(pins) * PIN_FONT_CHAR : 10) + 10, GRID);

  // ---- height
  const topSpace = tbLabelSpace(top);
  const headerTop = topSpace;
  const rowsTop = headerTop + headerHeight;
  const rows = Math.max(left.length, right.length);
  let y = rowsTop + rows * PIN_PITCH;
  let note: PartLayout['note'];
  if (def.note) {
    const lines = Math.max(1, Math.ceil((def.note.length * NOTE_CHAR) / (width - 12)));
    const h = lines * NOTE_LINE + 6;
    note = { top: y + 2, height: h };
    y += h + 2;
  }
  y += tbLabelSpace(bottom);
  const height = ceilTo(Math.max(y + 6, 50), GRID);

  // ---- pins
  const pins: LaidOutPin[] = [];
  left.forEach((def, i) =>
    pins.push({ def, side: 'left', x: 0, y: rowsTop + i * PIN_PITCH + PIN_PITCH / 2, verticalLabel: false }),
  );
  right.forEach((def, i) =>
    pins.push({ def, side: 'right', x: width, y: rowsTop + i * PIN_PITCH + PIN_PITCH / 2, verticalLabel: false }),
  );
  const placeTB = (list: PinDefinition[], side: 'top' | 'bottom') => {
    const vertical = tbVertical(list);
    list.forEach((def, i) =>
      pins.push({
        def,
        side,
        x: width / 2 + (i - (list.length - 1) / 2) * tbPitch,
        y: side === 'top' ? 0 : height,
        verticalLabel: vertical,
      }),
    );
  };
  placeTB(top, 'top');
  placeTB(bottom, 'bottom');

  return {
    width,
    height,
    headerTop,
    headerHeight,
    titleLine,
    subtitleLine,
    note,
    pins,
    pinById: new Map(pins.map((p) => [p.def.id, p])),
  };
}
