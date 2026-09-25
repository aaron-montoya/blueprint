import 'fake-indexeddb/auto';
import { BUILTIN_PARTS } from '../library/builtin';
import { EMPTY_TITLE, validateDiagram } from '../model/format';
import { fromFile, toFile } from '../store/convert';
import { freeSpot, nodeRect, useDiagram } from '../store/diagramStore';
import { listDiagrams, loadDiagram, saveDiagram } from '../store/persistence';
import type { DiagramNode } from '../store/types';

const def = (name: string) => BUILTIN_PARTS.find((p) => p.name === name)!;
const st = () => useDiagram.getState();

function setup() {
  st().load({ nodes: [], edges: [], title: { ...EMPTY_TITLE } }, 'test');
  const esp = st().addPart(def('ESP32 DevKit V1'), { x: 100, y: 100 });
  const xlr = st().addPart(def('XLR Jack'), { x: 500, y: 100 });
  const wire = st().connect({ source: esp, sourceHandle: 'D23', target: xlr, targetHandle: '1' })!;
  return { esp, xlr, wire };
}

describe('diagram store', () => {
  it('undoes and redoes everything, wires included', () => {
    const { wire } = setup();
    expect(st().edges).toHaveLength(1);
    st().updateWire(wire, { color: 'blue' });
    st().undo();
    expect(st().edges[0].data!.color).toBe('red');
    st().undo(); // the connection
    expect(st().edges).toHaveLength(0);
    st().redo();
    st().redo();
    expect(st().edges[0].data!.color).toBe('blue');
  });

  it('refuses duplicate wires and pin-to-itself', () => {
    const { esp, xlr } = setup();
    expect(st().connect({ source: xlr, sourceHandle: '1', target: esp, targetHandle: 'D23' })).toBeNull();
    expect(st().connect({ source: esp, sourceHandle: 'D23', target: esp, targetHandle: 'D23' })).toBeNull();
    // Several wires on one pin are fine (shared ground).
    expect(st().connect({ source: esp, sourceHandle: 'GND', target: xlr, targetHandle: '2' })).not.toBeNull();
    expect(st().connect({ source: esp, sourceHandle: 'GND', target: xlr, targetHandle: '3' })).not.toBeNull();
  });

  it('shifts manual bends when both ends move together, keeps them when one end moves', () => {
    const { esp, xlr, wire } = setup();
    st().setWirePoints(wire, [{ x: 400, y: 160 }, { x: 400, y: 130 }]);
    const move = (ids: string[], dx: number) => {
      const dragged = st().nodes.filter((n) => ids.includes(n.id));
      st().beginDrag(dragged);
      useDiagram.setState({
        nodes: st().nodes.map((n) => (ids.includes(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y } } : n)),
      });
      st().dragUpdate(st().nodes.filter((n) => ids.includes(n.id)));
      st().endDrag();
    };
    move([esp, xlr], 50);
    expect(st().edges[0].data!.points).toEqual([{ x: 450, y: 160 }, { x: 450, y: 130 }]);
    move([xlr], 50);
    expect(st().edges[0].data!.points).toEqual([{ x: 450, y: 160 }, { x: 450, y: 130 }]);
  });

  it('moves everything inside a section with it', () => {
    const { esp, xlr } = setup();
    const sec = st().addSection({ x: 460, y: 60, width: 300, height: 300 }, 'Box');
    const secNode = st().nodes.find((n) => n.id === sec)!;
    st().beginDrag([secNode]);
    const moved: DiagramNode = { ...secNode, position: { x: 560, y: 60 } };
    useDiagram.setState({ nodes: st().nodes.map((n) => (n.id === sec ? moved : n)) });
    st().dragUpdate([moved]);
    st().endDrag();
    expect(st().nodes.find((n) => n.id === xlr)!.position.x).toBe(600);
    expect(st().nodes.find((n) => n.id === esp)!.position.x).toBe(100);
  });

  it('rotating a part resets manual routes of its wires and keeps it centred', () => {
    const { esp, wire } = setup();
    st().setWirePoints(wire, [{ x: 400, y: 160 }, { x: 400, y: 130 }]);
    useDiagram.setState({ nodes: st().nodes.map((n) => ({ ...n, selected: n.id === esp })) });
    st().rotateSelection();
    const n = st().nodes.find((x) => x.id === esp)!;
    expect(n.type === 'part' && n.data.rotation).toBe(90);
    expect(st().edges.find((e) => e.id === wire)!.data!.points).toBeUndefined();
  });

  it('copies and pastes parts with the wires between them', () => {
    setup();
    st().selectAll();
    st().copySelection();
    st().paste();
    expect(st().nodes.filter((n) => n.type === 'part')).toHaveLength(4);
    expect(st().edges).toHaveLength(2);
    const pasted = st().edges[1];
    expect(st().nodes.find((n) => n.id === pasted.source)!.selected).toBe(true);
  });

  it('round-trips through the .blueprint format', () => {
    const { wire } = setup();
    st().updateWire(wire, { color: 'white', stripe: 'blue', label: 'D23 → XLR', points: [{ x: 400, y: 160 }, { x: 400, y: 130 }] });
    st().setTitle('room', 'Test Room');
    st().addNote({ x: 0, y: 0 });
    st().addSection({ x: 0, y: 0, width: 200, height: 200 }, 'Panel');
    const file = toFile(st());
    const json = JSON.parse(JSON.stringify(file));
    const again = toFile(fromFile(validateDiagram(json)));
    expect(again).toEqual(file);
    expect(file.parts[0].part.pins.length).toBe(30); // full definition embedded
  });

  it('keeps a custom heading and defaults it for older files', () => {
    setup();
    st().setTitle('heading', 'MY SHOP — WIRING');
    const file = JSON.parse(JSON.stringify(toFile(st())));
    expect(validateDiagram(file).title.heading).toBe('MY SHOP — WIRING');
    delete file.title.heading;
    expect(validateDiagram(file).title.heading).toBe('ESCAPES IN TIME — WIRING');
  });

  it('finds a free spot for a new part instead of stacking it on another', () => {
    setup();
    const esp = nodeRect(st().nodes[0]);
    const spot = freeSpot(st().nodes, 120, 80, { x: esp.x + 10, y: esp.y + 10 });
    const overlaps = st().nodes.some((n) => {
      const r = nodeRect(n);
      return spot.x < r.x + r.width && spot.x + 120 > r.x && spot.y < r.y + r.height && spot.y + 80 > r.y;
    });
    expect(overlaps).toBe(false);
    // An empty area is used as-is.
    expect(freeSpot(st().nodes, 120, 80, { x: 2000, y: 2000 })).toEqual({ x: 2000, y: 2000 });
  });

  it('rejects wires that point at missing pins', () => {
    setup();
    const file = JSON.parse(JSON.stringify(toFile(st())));
    file.wires[0].to.pin = 'nope';
    expect(() => validateDiagram(file)).toThrow(/has no pin "nope"/);
  });
});

describe('IndexedDB persistence', () => {
  it('saves, lists and loads diagrams', async () => {
    setup();
    st().setTitle('room', 'Room A');
    st().setTitle('prop', 'Music box');
    await saveDiagram('d1', toFile(st()));
    const list = await listDiagrams();
    expect(list.map((d) => d.name)).toContain('Room A — Music box');
    const back = await loadDiagram('d1');
    expect(back!.file.parts).toHaveLength(2);
  });
});
