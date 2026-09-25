import { pdfText } from '../export/pdf';
import { BUILTIN_PARTS } from '../library/builtin';
import { connectionRows } from '../model/connections';
import type { DiagramNode, WireEdge } from '../store/types';

const def = (name: string) => BUILTIN_PARTS.find((p) => p.name === name)!;

describe('connection list', () => {
  const nodes: DiagramNode[] = [
    { id: 'esp', type: 'part', position: { x: 0, y: 0 }, data: { def: def('ESP32 DevKit V1'), label: 'ESP32', rotation: 0, flip: false } },
    { id: 'x1', type: 'part', position: { x: 0, y: 0 }, data: { def: def('XLR Jack'), label: 'Top XLR 1', rotation: 0, flip: false } },
    { id: 'led', type: 'part', position: { x: 0, y: 0 }, data: { def: def('LED'), label: 'LED 1', rotation: 0, flip: false } },
  ];
  const edges: WireEdge[] = [
    // Drawn from the LED to the board: listed from the board's side.
    { id: 'w2', type: 'wire', source: 'led', sourceHandle: '− (K)', target: 'esp', targetHandle: 'GND', data: { color: 'black', route: 'orthogonal' } },
    { id: 'w1', type: 'wire', source: 'esp', sourceHandle: 'D23', target: 'x1', targetHandle: '1', data: { color: 'white', stripe: 'blue', label: 'D23 → Top XLR 1', route: 'orthogonal' } },
  ];

  it('lists every wire from pin → color → to pin → label, board side first, in pin order', () => {
    const rows = connectionRows({ nodes, edges });
    expect(rows.map((r) => [r.from.part, r.from.pin, r.colorName, r.to.part, r.to.pin, r.label])).toEqual([
      ['ESP32', 'GND', 'Black', 'LED 1', '− (K)', ''],
      ['ESP32', 'D23', 'White/Blue', 'Top XLR 1', '1', 'D23 → Top XLR 1'],
    ]);
  });

  it('makes names printable in the PDF font', () => {
    expect(pdfText('− (K) → R1 220Ω ⏚ Earth · ok')).toBe('- (K) -> R1 220 ohm Earth · ok');
  });
});
