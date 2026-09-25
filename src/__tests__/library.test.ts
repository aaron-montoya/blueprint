import { BUILTIN_PARTS } from '../library/builtin';

const part = (name: string) => {
  const p = BUILTIN_PARTS.find((x) => x.name === name);
  if (!p) throw new Error(`missing ${name}`);
  return p;
};
const side = (name: string, s: string) =>
  part(name)
    .pins.filter((p) => p.side === s)
    .sort((a, b) => a.index - b.index);

describe('built-in library', () => {
  it('has about 70 parts with unique ids', () => {
    expect(BUILTIN_PARTS.length).toBeGreaterThanOrEqual(69);
    expect(new Set(BUILTIN_PARTS.map((p) => p.id)).size).toBe(BUILTIN_PARTS.length);
  });

  it('matches the physical ESP32 DevKit V1 30-pin board', () => {
    const esp = part('ESP32 DevKit V1');
    expect(esp.id).toBe('esp32-devkit-v1-30');
    expect(esp.subtitle).toBe('30-pin · Elegoo');
    expect(esp.width).toBe(190);
    expect(side('ESP32 DevKit V1', 'left').map((p) => p.label)).toEqual([
      'EN', 'VP · 36', 'VN · 39', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN',
    ]);
    expect(side('ESP32 DevKit V1', 'right').map((p) => p.label)).toEqual([
      'D23 · MOSI', 'D22 · SCL', 'TX0', 'RX0', 'D21 · SDA', 'D19 · MISO', 'D18 · SCK', 'D5 · SS', 'D17', 'D16', 'D4', 'D2', 'D15', 'GND', '3V3',
    ]);
    const byType = (t: string) => esp.pins.filter((p) => p.type === t).map((p) => p.id).sort();
    expect(byType('input')).toEqual(['D34', 'D35', 'VN', 'VP']);
    expect(byType('strap')).toEqual(['D12', 'D15', 'D2', 'D5']);
    expect(esp.pins.find((p) => p.id === 'D23')?.label).toBe('D23 · MOSI');
  });

  it('keeps the required notes', () => {
    expect(part('Reed Switch').note).toBe('EIT std: COM→GND, NO→GPIO');
    expect(part('RFID RC522').note).toBe('3.3V only — use AMS1117');
    for (const n of ['Maglock', 'Solenoid Lock', 'Push-Pull Solenoid'])
      expect(part(n).note).toBe('flyback diode across coil');
  });

  it('has power supplies with + and − and no "symbol" names', () => {
    expect(BUILTIN_PARTS.filter((p) => /symbol/i.test(p.name))).toEqual([]);
    for (const v of ['3.3V', '5V', '12V']) {
      const s = part(`${v} Supply`);
      expect(s.pins.map((p) => [p.label, p.type])).toEqual([['+', 'power'], ['−', 'gnd']]);
    }
    expect(part('GND').pins.map((p) => p.type)).toEqual(['gnd']);
  });

  it('files parts into the starting sections', () => {
    const cats = new Set(BUILTIN_PARTS.map((p) => p.category));
    expect([...cats].sort()).toEqual(['Boards', 'Inline Parts', 'Inputs', 'Outputs', 'Power & Wiring']);
    expect(part('Resistor').category).toBe('Inline Parts');
    expect(part('ESP32 DevKit V1').category).toBe('Boards');
  });
});
