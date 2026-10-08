import { applyPartUpdates, outdatedParts } from '../library/partUpdates';
import { BUILTIN_PARTS } from '../library/builtin';
import type { PartDefinition, PinDefinition } from '../model/format';
import type { DiagramNode, WireEdge } from '../store/types';

const latest = (name: string) => BUILTIN_PARTS.find((p) => p.name === name)!;
const pin = (id: string, side: PinDefinition['side'], index: number, type: PinDefinition['type']): PinDefinition => ({
  id,
  label: id,
  side,
  index,
  type,
});

/** The MOSFET before its pins were renamed, and a Wago with all its pins on one side (briefly the library's). */
const oldMosfet: PartDefinition = {
  ...latest('MOSFET Module'),
  subtitle: '12V load switch',
  pins: [
    pin('TRIG', 'left', 0, 'io'),
    pin('GND', 'left', 1, 'gnd'),
    pin('VIN+', 'right', 0, 'power'),
    pin('VIN−', 'right', 1, 'gnd'),
    pin('OUT+', 'right', 2, 'power'),
    pin('OUT−', 'right', 3, 'gnd'),
  ],
};
const oldWago: PartDefinition = {
  ...latest('Wago 3-way'),
  pins: [pin('a', 'left', 0, 'other'), pin('b', 'left', 1, 'other'), pin('c', 'left', 2, 'other')],
};

describe('updating placed parts to the library version', () => {
  const part = (id: string, def: PartDefinition): DiagramNode => ({
    id,
    type: 'part',
    position: { x: 0, y: 0 },
    data: { def, label: def.name, rotation: 0, flip: false },
  });
  const nodes = [part('m', oldMosfet), part('w', oldWago), part('esp', latest('ESP32 DevKit V1'))];
  const wire = (id: string, pinId: string, part = 'm'): WireEdge => ({
    id,
    type: 'wire',
    source: 'esp',
    sourceHandle: 'D23',
    target: part,
    targetHandle: pinId,
    data: { color: 'red', route: 'orthogonal', points: [{ x: 5, y: 5 }] },
  });
  const edges = [
    ...['TRIG', 'GND', 'VIN+', 'VIN−', 'OUT+', 'OUT−'].map((p) => wire(`m-${p}`, p)),
    ...['a', 'b', 'c'].map((p) => wire(`w-${p}`, p, 'w')),
  ];

  it('keeps every wire, moving wires on renamed pins to the pin in the same spot', () => {
    const updates = outdatedParts(nodes, BUILTIN_PARTS);
    expect(updates.map((u) => u.node.id).sort()).toEqual(['m', 'w']);
    const r = applyPartUpdates(nodes, edges, updates);
    expect(r.removedWires).toBe(0);
    const to = (id: string) => r.edges.find((e) => e.id === id)!.targetHandle;
    expect(to('m-TRIG')).toBe('PWM+');
    expect(to('m-GND')).toBe('GND');
    expect(to('m-VIN+')).toBe('DC+');
    expect(to('m-VIN−')).toBe('DC−');
    expect(to('m-OUT+')).toBe('OUT+');
    expect(to('m-OUT−')).toBe('OUT−');
    // The Wago's pins kept their names; b and c moved back to the other side.
    expect(['a', 'b', 'c'].map((p) => to(`w-${p}`))).toEqual(['a', 'b', 'c']);
    // Wires whose pin moved elsewhere on the part lose their old bends;
    // the rest (including renamed pins in the same spot) keep theirs.
    expect(r.edges.find((e) => e.id === 'm-TRIG')!.data!.points).toEqual([{ x: 5, y: 5 }]);
    expect(r.edges.find((e) => e.id === 'w-b')!.data!.points).toBeUndefined();
    expect(r.edges.find((e) => e.id === 'm-GND')!.data!.points).toEqual([{ x: 5, y: 5 }]);
    expect(r.edges.find((e) => e.id === 'w-a')!.data!.points).toEqual([{ x: 5, y: 5 }]);
  });
});
