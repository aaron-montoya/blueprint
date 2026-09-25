import { BUILTIN_PARTS } from '../library/builtin';
import { GRID, layoutPart } from '../geometry/partLayout';
import type { Rotation } from '../model/format';

const esp = BUILTIN_PARTS.find((p) => p.id === 'esp32-devkit-v1-30')!;

describe('part layout', () => {
  it('puts every pin centre of every part on the grid, in every orientation', () => {
    for (const def of BUILTIN_PARTS)
      for (const rot of [0, 90, 180, 270] as Rotation[])
        for (const flip of [false, true]) {
          const l = layoutPart(def, rot, flip, def.name);
          expect(l.width % GRID, def.name).toBe(0);
          expect(l.height % GRID, def.name).toBe(0);
          expect(l.pins.length).toBe(def.pins.length);
          for (const p of l.pins) {
            expect(p.x % GRID, `${def.name} ${p.def.id} x`).toBe(0);
            expect(p.y % GRID, `${def.name} ${p.def.id} y`).toBe(0);
          }
        }
  });

  it('keeps ESP32 pins in board order, top to bottom', () => {
    const l = layoutPart(esp, 0, false, esp.name);
    const left = l.pins.filter((p) => p.side === 'left').sort((a, b) => a.y - b.y).map((p) => p.def.id);
    expect(left.slice(0, 3)).toEqual(['EN', 'VP', 'VN']);
    expect(left[left.length - 1]).toBe('VIN');
    expect(l.width).toBeGreaterThanOrEqual(190);
  });

  it('rotates pins with the part', () => {
    const r90 = layoutPart(esp, 90, false, esp.name);
    // Left side goes to the top, reading right→left (clockwise rotation).
    const top = r90.pins.filter((p) => p.side === 'top').sort((a, b) => a.x - b.x).map((p) => p.def.id);
    expect(top[0]).toBe('VIN');
    expect(top[top.length - 1]).toBe('EN');
    const r180 = layoutPart(esp, 180, false, esp.name);
    const right = r180.pins.filter((p) => p.side === 'right').sort((a, b) => a.y - b.y).map((p) => p.def.id);
    expect(right[0]).toBe('VIN');
  });

  it('flips left and right', () => {
    const f = layoutPart(esp, 0, true, esp.name);
    expect(f.pinById.get('EN')!.side).toBe('right');
    expect(f.pinById.get('D23')!.side).toBe('left');
    expect(f.pinById.get('EN')!.y).toBe(layoutPart(esp, 0, false, esp.name).pinById.get('EN')!.y);
  });
});
