import { BUILTIN_PARTS } from '../library/builtin';
import {
  draftFromPart,
  draftProblems,
  emptyDraft,
  guessPinType,
  movePin,
  partFromDraft,
  pinKey,
  setPinSide,
  uniquePartId,
  type PartDraft,
} from '../library/partMaker';

const esp = BUILTIN_PARTS.find((p) => p.id === 'esp32-devkit-v1-30')!;

describe('Part Maker model', () => {
  it('round-trips an existing part unchanged (except the id)', () => {
    const back = partFromDraft(draftFromPart(esp, false), esp.id);
    expect(back).toEqual(esp);
  });

  it('copies a part with a new name and keeps its pins', () => {
    const d = draftFromPart(esp, true);
    expect(d.name).toBe('ESP32 DevKit V1 (copy)');
    const part = partFromDraft(d, 'custom-esp32-copy');
    expect(part.pins.map((p) => p.label)).toEqual(esp.pins.map((p) => p.label));
  });

  it('builds a new part: ids from labels, indexes from order, duplicates made unique', () => {
    const d: PartDraft = {
      ...emptyDraft('Inputs'),
      name: 'Test Sensor',
      subtitle: 'made-up',
      pins: [
        { key: pinKey(), label: 'VCC', type: 'power', side: 'left' },
        { key: pinKey(), label: 'GND', type: 'gnd', side: 'left' },
        { key: pinKey(), label: 'OUT · A0', type: 'io', side: 'right' },
        { key: pinKey(), label: 'GND', type: 'gnd', side: 'right' },
      ],
    };
    expect(draftProblems(d)).toEqual([]);
    const p = partFromDraft(d, 'custom-test-sensor');
    expect(p.pins).toEqual([
      { id: 'VCC', label: 'VCC', side: 'left', index: 0, type: 'power' },
      { id: 'GND', label: 'GND', side: 'left', index: 1, type: 'gnd' },
      { id: 'OUT', label: 'OUT · A0', side: 'right', index: 0, type: 'io' },
      { id: 'GND.right', label: 'GND', side: 'right', index: 1, type: 'gnd' },
    ]);
    expect(p.subtitle).toBe('made-up');
    expect(p.width).toBeUndefined();
  });

  it('reorders within a side and moves pins between sides', () => {
    const pins = [
      { key: 'a', label: 'A', type: 'io' as const, side: 'left' as const },
      { key: 'x', label: 'X', type: 'io' as const, side: 'right' as const },
      { key: 'b', label: 'B', type: 'io' as const, side: 'left' as const },
    ];
    expect(movePin(pins, 'b', -1).filter((p) => p.side === 'left').map((p) => p.key)).toEqual(['b', 'a']);
    expect(movePin(pins, 'a', -1)).toBe(pins); // already first
    const moved = setPinSide(pins, 'a', 'right');
    expect(moved.filter((p) => p.side === 'right').map((p) => p.key)).toEqual(['x', 'a']);
  });

  it('explains what blocks saving', () => {
    expect(draftProblems(emptyDraft())).toEqual(['Give the part a name.', 'Add at least one pin.']);
    const d = { ...emptyDraft(), name: 'X', width: '5', pins: [{ key: 'k', label: ' ', type: 'io' as const, side: 'left' as const }] };
    expect(draftProblems(d)).toHaveLength(2);
  });

  it('never reuses an existing part id', () => {
    const taken = new Set(['custom-relay', 'custom-relay-2']);
    expect(uniquePartId('Relay', taken)).toBe('custom-relay-3');
  });

  it('guesses pin types from labels', () => {
    expect(guessPinType('GND')).toBe('gnd');
    expect(guessPinType('VCC')).toBe('power');
    expect(guessPinType('5V')).toBe('power');
    expect(guessPinType('SDA')).toBe('io');
  });
});
