"""Generate the EIT draw.io parts library + a sample wiring diagram."""
import json, zlib, base64, urllib.parse, html, itertools

PIN = 10          # pin square size
PITCH = 20        # vertical spacing between pins
PAD_TOP = 34      # room for part title
PAD_BOT = 12

# pin kinds -> fill colors
PIN_FILL = {
    "io": "#F2C94C",      # GPIO / signal (gold)
    "in": "#56CCF2",      # input-only GPIO (blue)
    "pwr": "#EB5757",     # power (red)
    "gnd": "#333333",     # ground (black)
    "nc": "#BDBDBD",      # misc / passive
    "strap": "#F2994A",   # ESP32 strapping pin (orange)
}

CAT_FILL = {
    "ctrl": "#E8F0FE", "input": "#E6F4EA", "output": "#FEF3E0",
    "power": "#FDE8E8", "passive": "#F3F3F3", "conn": "#F1ECFA",
}

_ids = itertools.count(1)
def nid(p="c"):
    return f"{p}{next(_ids)}"

def esc(s):
    return html.escape(s, quote=True)

def kind_for(name):
    n = name.upper()
    if n in ("GND", "-", "−", "V-", "DC-", "IN-", "OUT-", "GND2", "VIN-", "OUT−", "IN−", "DC−", "V−") or n.startswith("GND") or n.endswith("−") or n.endswith("-"):
        return "gnd"
    if any(n.startswith(k) for k in ("VCC", "VIN", "3V3", "3.3V", "5V", "12V", "+", "V+", "VDD", "VMOT", "DC+", "IN+", "OUT+", "VOUT", "LV", "HV", "JD-VCC")) or n.endswith("+"):
        return "pwr"
    return "io"

class Part:
    def __init__(self, title, category, left=(), right=(), top=(), bottom=(),
                 w=None, subtitle="", note="", min_h=0):
        self.title, self.category = title, category
        self.left = [self._p(p) for p in left]
        self.right = [self._p(p) for p in right]
        self.top = [self._p(p) for p in top]
        self.bottom = [self._p(p) for p in bottom]
        self.subtitle, self.note = subtitle, note
        rows = max(len(self.left), len(self.right), 1)
        self.h = max(PAD_TOP + rows * PITCH + PAD_BOT + (14 if note else 0), min_h)
        longest = max([len(p[0]) for p in self.left + self.right] + [1])
        auto_w = max(110, len(title) * 7 + 20,
                     (longest * 7 + 18) * (2 if self.left and self.right else 1) + 20,
                     (max(len(self.top), len(self.bottom)) + 1) * 30)
        self.w = w or auto_w

    @staticmethod
    def _p(p):
        if isinstance(p, tuple):
            return p
        return (p, kind_for(p))

    def cells(self, x=0, y=0, pid_prefix=None):
        """Return (xml_cells, {pin_name: cell_id})."""
        out, pins = [], {}
        body = nid("b")
        label = f"<b>{esc(self.title)}</b>"
        if self.subtitle:
            label += f"<br><font style='font-size:9px' color='#555555'>{esc(self.subtitle)}</font>"
        style = (f"rounded=1;arcSize=4;whiteSpace=wrap;html=1;fillColor={CAT_FILL[self.category]};"
                 "strokeColor=#444444;verticalAlign=top;align=center;spacingTop=2;fontSize=11;"
                 "container=1;collapsible=0;recursiveResize=0;dropTarget=0;")
        out.append(f'<mxCell id="{body}" value="{esc(label)}" style="{esc(style)}" vertex="1" parent="1">'
                   f'<mxGeometry x="{x}" y="{y}" width="{self.w}" height="{self.h}" as="geometry"/></mxCell>')
        pin_base = ("html=1;fontSize=9;movable=0;resizable=0;rotatable=0;deletable=0;"
                    "strokeColor=#222222;fontFamily=Courier New;")

        def add_pin(name, kind, px, py, side):
            cid = nid("p")
            if side == "left":
                lab = f"labelPosition=right;align=left;spacingLeft=3;verticalLabelPosition=middle;verticalAlign=middle;portConstraint=west;"
            elif side == "right":
                lab = f"labelPosition=left;align=right;spacingRight=3;verticalLabelPosition=middle;verticalAlign=middle;portConstraint=east;"
            elif side == "top":
                lab = f"labelPosition=center;align=center;verticalLabelPosition=bottom;verticalAlign=top;portConstraint=north;"
            else:
                lab = f"labelPosition=center;align=center;verticalLabelPosition=top;verticalAlign=bottom;portConstraint=south;"
            st = pin_base + lab + f"fillColor={PIN_FILL[kind]};"
            out.append(f'<mxCell id="{cid}" value="{esc(name)}" style="{esc(st)}" vertex="1" parent="{body}">'
                       f'<mxGeometry x="{px}" y="{py}" width="{PIN}" height="{PIN}" as="geometry"/></mxCell>')
            pins[name] = cid

        for i, (n, k) in enumerate(self.left):
            add_pin(n, k, -PIN / 2, PAD_TOP + i * PITCH, "left")
        for i, (n, k) in enumerate(self.right):
            add_pin(n, k, self.w - PIN / 2, PAD_TOP + i * PITCH, "right")
        for pins_, side, py in ((self.top, "top", -PIN / 2), (self.bottom, "bottom", self.h - PIN / 2)):
            if pins_:
                step = self.w / (len(pins_) + 1)
                for i, (n, k) in enumerate(pins_):
                    add_pin(n, k, step * (i + 1) - PIN / 2, py, side)
        if self.note:
            cid = nid("n")
            st = "text;html=1;fontSize=8;fontColor=#8A1C1C;align=center;verticalAlign=bottom;movable=0;resizable=0;deletable=0;whiteSpace=wrap;"
            out.append(f'<mxCell id="{cid}" value="{esc(self.note)}" style="{esc(st)}" vertex="1" parent="{body}">'
                       f'<mxGeometry x="4" y="{self.h - 18 - (8 if self.bottom else 0)}" width="{self.w - 8}" height="14" as="geometry"/></mxCell>')
        return out, pins, body


def model(cells_xml):
    return ('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
            + "".join(cells_xml) + "</root></mxGraphModel>")

def compress(xml):
    data = urllib.parse.quote(xml, safe="~()*!.'")
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    raw = c.compress(data.encode()) + c.flush()
    return base64.b64encode(raw).decode()

# ------------------------------------------------------------------ parts
G = "gnd"; P = "pwr"; IO = "io"; IN = "in"; S = "strap"; NC = "nc"

ESP32 = Part(
    "ESP32 DevKit V1", "ctrl", subtitle="30-pin · Elegoo", w=190,
    left=[("EN", NC), ("VP · 36", IN), ("VN · 39", IN), ("D34", IN), ("D35", IN),
          ("D32", IO), ("D33", IO), ("D25", IO), ("D26", IO), ("D27", IO),
          ("D14", IO), ("D12", S), ("D13", IO), ("GND", G), ("VIN", P)],
    right=[("D23", IO), ("D22", IO), ("TX0", NC), ("RX0", NC), ("D21", IO),
           ("D19", IO), ("D18", IO), ("D5", S), ("D17", IO), ("D16", IO),
           ("D4", IO), ("D2", S), ("D15", S), ("GND", G), ("3V3", P)],
    bottom=[("USB-C", P)])

PI_LEFT = ["3V3", "GPIO2 SDA", "GPIO3 SCL", "GPIO4", "GND", "GPIO17", "GPIO27", "GPIO22", "3V3",
           "GPIO10 MOSI", "GPIO9 MISO", "GPIO11 SCLK", "GND", "ID_SD", "GPIO5", "GPIO6", "GPIO13",
           "GPIO19", "GPIO26", "GND"]
PI_RIGHT = ["5V", "5V", "GND", "GPIO14 TXD", "GPIO15 RXD", "GPIO18", "GND", "GPIO23", "GPIO24", "GND",
            "GPIO25", "GPIO8 CE0", "GPIO7 CE1", "ID_SC", "GND", "GPIO12", "GND", "GPIO16", "GPIO20", "GPIO21"]
PI = Part("Raspberry Pi Zero W", "ctrl", subtitle="40-pin header (odd pins left)", w=230,
          left=[f"{2*i+1}: {n}" if False else n for i, n in enumerate(PI_LEFT)], right=PI_RIGHT)
# fix pin kinds for Pi names
PI.left = [(n, G if n == "GND" else P if n in ("3V3", "5V") else NC if n.startswith("ID") else IO) for n, _ in PI.left]
PI.right = [(n, G if n == "GND" else P if n in ("3V3", "5V") else NC if n.startswith("ID") else IO) for n, _ in PI.right]

def relay(n):
    left = [("VCC", P), ("GND", G)] + [(f"IN{i}", IO) for i in range(1, n + 1)]
    if n == 1:
        left = [("DC+", P), ("DC−", G), ("IN", IO)]
        right = [("COM", NC), ("NO", NC), ("NC", NC)]
    else:
        right = []
        for i in range(1, n + 1):
            right += [(f"NO{i}", NC), (f"COM{i}", NC), (f"NC{i}", NC)]
    return Part(f"Relay Module {n}-ch", "output", left=left, right=right,
                subtitle="5V coil", note="check H/L trigger jumper")

PARTS = {
 "Controllers": [ESP32, PI],
 "Inputs": [
    Part("Reed Switch", "input", right=[("COM", G), ("NO", IO), ("NC", NC)],
         note="EIT std: COM→GND, NO→GPIO"),
    Part("Reed Switch (2-wire)", "input", right=[("A", NC), ("B", NC)]),
    Part("RFID RC522", "input", subtitle="SPI · 13.56MHz",
         left=[("SDA/SS", IO), ("SCK", IO), ("MOSI", IO), ("MISO", IO), ("IRQ", NC), ("GND", G), ("RST", IO), ("3.3V", P)],
         note="3.3V only — use AMS1117"),
    Part("RFID PN532", "input", subtitle="I2C / SPI · NTAG215",
         left=[("VCC", P), ("GND", G), ("SDA", IO), ("SCL", IO)],
         right=[("SCK", IO), ("MISO", IO), ("MOSI", IO), ("SS", IO), ("IRQ", IO), ("RSTO", IO)]),
    Part("Push Button", "input", right=[("1", NC), ("2", NC)], subtitle="momentary"),
    Part("Illuminated Button", "input", subtitle="arcade / lit",
         right=[("COM", NC), ("NO", NC), ("NC", NC), ("LED+", P), ("LED−", G)]),
    Part("Toggle Switch SPST", "input", right=[("1", NC), ("2", NC)], subtitle="toggle / rocker"),
    Part("Toggle Switch SPDT", "input", right=[("A", NC), ("COM", NC), ("B", NC)]),
    Part("Key Switch", "input", right=[("1", NC), ("2", NC)]),
    Part("Microswitch / Limit", "input", right=[("COM", NC), ("NO", NC), ("NC", NC)]),
    Part("Rotary Encoder", "input", subtitle="KY-040",
         right=[("CLK", IO), ("DT", IO), ("SW", IO), ("+", P), ("GND", G)]),
    Part("Potentiometer", "input", subtitle="rotary / slide", right=[("1 (GND)", G), ("W (wiper)", IO), ("3 (VCC)", P)]),
    Part("Keypad 4x4", "input", bottom=[(f"R{i}", IO) for i in range(1, 5)] + [(f"C{i}", IO) for i in range(1, 5)], w=260, min_h=70),
    Part("Keypad 3x4", "input", bottom=[(f"R{i}", IO) for i in range(1, 5)] + [(f"C{i}", IO) for i in range(1, 4)], w=230, min_h=70),
    Part("Hall Sensor", "input", subtitle="A3144 module", right=[("VCC", P), ("GND", G), ("OUT", IO)]),
    Part("IR Break-Beam TX", "input", right=[("VCC", P), ("GND", G)]),
    Part("IR Break-Beam RX", "input", right=[("VCC", P), ("GND", G), ("OUT", IO)]),
    Part("PIR Motion", "input", subtitle="HC-SR501", right=[("VCC", P), ("OUT", IO), ("GND", G)]),
    Part("Touch Sensor", "input", subtitle="TTP223", right=[("VCC", P), ("I/O", IO), ("GND", G)]),
    Part("Light Sensor", "input", subtitle="LDR module", right=[("VCC", P), ("GND", G), ("DO", IO), ("AO", IO)]),
    Part("XLR Jack", "conn", subtitle="3-pin", left=[("1", NC), ("2", NC), ("3", NC)]),
    Part("3.5mm Jack", "conn", subtitle="TRS", left=[("T", NC), ("R", NC), ("S", NC)]),
    Part("Banana Jack", "conn", left=[("1", NC)]),
 ],
 "Outputs": [
    Part("LED", "output", left=[("− (K)", G)], right=[("+ (A)", P)], subtitle="long leg = +"),
    Part("RGB LED", "output", subtitle="common cathode", left=[("R", IO), ("G", IO), ("B", IO), ("− (K)", G)]),
    Part("LED Strip WS2812B", "output", subtitle="addressable", left=[("5V", P), ("DIN", IO), ("GND", G)],
         right=[("5V", P), ("DOUT", IO), ("GND", G)]),
    Part("LED Strip 12V", "output", subtitle="single color", left=[("+12V", P), ("−", G)]),
    relay(1), relay(2), relay(4), relay(8),
    Part("Solid State Relay", "output", left=[("DC+ (3)", P), ("DC− (4)", G)], right=[("Load 1", NC), ("Load 2", NC)]),
    Part("MOSFET Module", "output", subtitle="12V load switch",
         left=[("TRIG", IO), ("GND", G)], right=[("VIN+", P), ("VIN−", G), ("OUT+", P), ("OUT−", G)]),
    Part("Maglock", "output", subtitle="12V", left=[("+12V", P), ("GND", G)], note="flyback diode across coil"),
    Part("Solenoid Lock", "output", subtitle="12V", left=[("+", P), ("−", G)], note="flyback diode across coil"),
    Part("Push-Pull Solenoid", "output", left=[("+", P), ("−", G)], note="flyback diode across coil"),
    Part("Servo", "output", left=[("GND (brn)", G), ("+5V (red)", P), ("SIG (org)", IO)]),
    Part("Stepper Driver A4988", "output",
         left=[("EN", IO), ("MS1", IO), ("MS2", IO), ("MS3", IO), ("RST", IO), ("SLP", IO), ("STEP", IO), ("DIR", IO)],
         right=[("VMOT", P), ("GND", G), ("2B", NC), ("2A", NC), ("1A", NC), ("1B", NC), ("VDD", P), ("GND", G)]),
    Part("Stepper Motor", "output", left=[("A+", NC), ("A−", NC), ("B+", NC), ("B−", NC)]),
    Part("DC Motor", "output", left=[("+", P), ("−", G)]),
    Part("Buzzer", "output", left=[("+", P), ("−", G)]),
    Part("DFPlayer Mini", "output", subtitle="MP3 player",
         left=[("VCC", P), ("RX", IO), ("TX", IO), ("DAC_R", NC), ("DAC_L", NC), ("SPK1", NC), ("GND", G), ("SPK2", NC)],
         right=[("BUSY", IO), ("USB−", NC), ("USB+", NC), ("ADKEY2", NC), ("ADKEY1", NC), ("IO2", NC), ("GND", G), ("IO1", NC)]),
    Part("Speaker", "output", left=[("+", P), ("−", G)]),
    Part("7-Segment TM1637", "output", left=[("CLK", IO), ("DIO", IO), ("VCC", P), ("GND", G)]),
    Part("LCD 16x2 I2C", "output", left=[("GND", G), ("VCC", P), ("SDA", IO), ("SCL", IO)]),
    Part("OLED SSD1306", "output", subtitle="I2C 128x64", left=[("GND", G), ("VCC", P), ("SCL", IO), ("SDA", IO)]),
    Part("UV Light / AC Load", "output", subtitle="generic load", left=[("L / +", P), ("N / −", G)]),
 ],
 "Power": [
    Part("AMS1117-3.3", "power", subtitle="3.3V regulator", left=[("VIN", P), ("GND", G)], right=[("VOUT 3.3V", P), ("GND", G)]),
    Part("Buck Converter", "power", subtitle="LM2596 / mini-360", left=[("IN+", P), ("IN−", G)], right=[("OUT+", P), ("OUT−", G)]),
    Part("Boost Converter", "power", subtitle="MT3608", left=[("VIN+", P), ("VIN−", G)], right=[("VOUT+", P), ("VOUT−", G)]),
    Part("Power Supply 12V", "power", subtitle="wall adapter", right=[("+12V", P), ("GND", G)]),
    Part("Power Supply 5V", "power", subtitle="wall adapter", right=[("+5V", P), ("GND", G)]),
    Part("PSU Brick", "power", subtitle="LRS / enclosed", left=[("L", NC), ("N", NC), ("⏚ Earth", NC)], right=[("+V", P), ("+V", P), ("−V", G), ("−V", G)]),
    Part("DC Barrel Jack", "power", subtitle="5.5x2.1", right=[("+", P), ("−", G)]),
    Part("Kasa EP10 Smart Plug", "power", subtitle="outlet #__", right=[("AC out", NC)]),
    Part("Fuse Holder", "power", subtitle="__A", left=[("1", NC)], right=[("2", NC)]),
    Part("Flyback Diode", "passive", subtitle="1N4007 · stripe = K", left=[("A", NC)], right=[("K (stripe)", NC)]),
    Part("Capacitor", "passive", subtitle="__µF", left=[("+", P)], right=[("−", G)]),
    Part("Logic Level Shifter", "power", subtitle="4-ch", left=[("LV", P), ("LV1", IO), ("LV2", IO), ("LV3", IO), ("LV4", IO), ("GND", G)],
         right=[("HV", P), ("HV1", IO), ("HV2", IO), ("HV3", IO), ("HV4", IO), ("GND", G)]),
 ],
 "Passives & Connectors": [
    Part("Resistor", "passive", subtitle="220Ω", left=[("1", NC)], right=[("2", NC)]),
    Part("Terminal Block 2-pos", "conn", left=[("1", NC), ("2", NC)], right=[("1", NC), ("2", NC)]),
    Part("Terminal Block 4-pos", "conn", left=[(str(i), NC) for i in range(1, 5)], right=[(str(i), NC) for i in range(1, 5)]),
    Part("Wago 3-way", "conn", subtitle="all pins joined", left=[("a", NC)], right=[("b", NC), ("c", NC)]),
    Part("JST 2-pin", "conn", left=[("1", NC), ("2", NC)], right=[("1", NC), ("2", NC)]),
    Part("JST 3-pin", "conn", left=[(str(i), NC) for i in range(1, 4)], right=[(str(i), NC) for i in range(1, 4)]),
    Part("JST 4-pin", "conn", left=[(str(i), NC) for i in range(1, 5)], right=[(str(i), NC) for i in range(1, 5)]),
    Part("Dupont Header 4-pin", "conn", left=[(str(i), NC) for i in range(1, 5)], right=[(str(i), NC) for i in range(1, 5)]),
 ],
}

# ------------------------------------------------------------------ wires & symbols
WIRES = [("Red", "#E53935"), ("Black", "#111111"), ("White", "#BDBDBD"), ("Yellow", "#F9C80E"),
         ("Green", "#2E9E44"), ("Blue", "#1E63D6"), ("Orange", "#F57C00"), ("Purple", "#8E44AD"),
         ("Brown", "#7B4A21"), ("Gray", "#808080")]

def wire_style(color, dashed=False):
    return (f"endArrow=none;startArrow=none;html=1;strokeWidth=2.5;strokeColor={color};"
            "edgeStyle=orthogonalEdgeStyle;rounded=1;jumpStyle=arc;jumpSize=8;fontSize=9;"
            "labelBackgroundColor=#FFFFFF;" + ("dashed=1;" if dashed else ""))

def wire_entry(name, color):
    eid = nid("w")
    xml = model([f'<mxCell id="{eid}" value="" style="{esc(wire_style(color, name=="White"))}" edge="1" parent="1">'
                 f'<mxGeometry width="100" relative="1" as="geometry"><mxPoint x="0" y="10" as="sourcePoint"/>'
                 f'<mxPoint x="100" y="10" as="targetPoint"/></mxGeometry></mxCell>'])
    return {"xml": compress(xml), "w": 100, "h": 20, "title": f"Wire – {name}"}

def flag(label, kind):
    """Power / ground flag: small labelled symbol with one pin."""
    body = nid("f")
    pin = nid("p")
    if kind == "gnd":
        st = "shape=mxgraph.electrical.signal_sources.signal_ground;html=1;verticalLabelPosition=bottom;verticalAlign=top;fontSize=10;fontStyle=1;strokeWidth=2;container=1;collapsible=0;dropTarget=0;"
        pin_xy = (10 - PIN / 2, -PIN / 2)
        pc = "portConstraint=north;"
        fill = PIN_FILL["gnd"]
    else:
        st = "shape=mxgraph.electrical.signal_sources.vdd;html=1;verticalLabelPosition=top;verticalAlign=bottom;fontSize=10;fontStyle=1;strokeWidth=2;fontColor=#C62828;strokeColor=#C62828;container=1;collapsible=0;dropTarget=0;"
        pin_xy = (10 - PIN / 2, 20 - PIN / 2)
        pc = "portConstraint=south;"
        fill = PIN_FILL["pwr"]
    cells = [f'<mxCell id="{body}" value="{esc(label)}" style="{esc(st)}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="20" height="20" as="geometry"/></mxCell>',
             f'<mxCell id="{pin}" value="" style="{esc("html=1;movable=0;resizable=0;deletable=0;strokeColor=#222222;fillColor=" + fill + ";" + pc)}" vertex="1" parent="{body}"><mxGeometry x="{pin_xy[0]}" y="{pin_xy[1]}" width="{PIN}" height="{PIN}" as="geometry"/></mxCell>']
    return cells, pin, body

def title_block(x=0, y=0):
    tid = nid("t")
    val = ("<table style='font-size:11px;border-collapse:collapse' cellpadding='3'>"
           "<tr><td colspan='2' style='font-size:13px'><b>ESCAPES IN TIME — WIRING</b></td></tr>"
           "<tr><td><b>Room</b></td><td>________________</td></tr>"
           "<tr><td><b>Prop</b></td><td>________________</td></tr>"
           "<tr><td><b>Firmware</b></td><td>________________</td></tr>"
           "<tr><td><b>Wired by</b></td><td>________________</td></tr>"
           "<tr><td><b>Updated</b></td><td>________________</td></tr></table>")
    st = "rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;fillColor=#FFFFFF;strokeColor=#222222;strokeWidth=2;spacingLeft=6;"
    return f'<mxCell id="{tid}" value="{esc(val)}" style="{esc(st)}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="260" height="170" as="geometry"/></mxCell>'

def note_box():
    i = nid("n")
    st = "shape=note;whiteSpace=wrap;html=1;size=14;fillColor=#FFF9C4;strokeColor=#C9B400;align=left;verticalAlign=top;spacingLeft=6;fontSize=11;"
    return f'<mxCell id="{i}" value="Note…" style="{esc(st)}" vertex="1" parent="1"><mxGeometry width="180" height="80" as="geometry"/></mxCell>'

def legend(x=0, y=0):
    i = nid("l")
    rows = "".join(f"<tr><td><span style='display:inline-block;width:12px;height:12px;background:{c};border:1px solid #333'></span></td><td>{n}</td></tr>"
                   for n, c in (("Signal / GPIO", PIN_FILL["io"]), ("Input-only GPIO", PIN_FILL["in"]),
                                ("Boot/strapping pin", PIN_FILL["strap"]), ("Power", PIN_FILL["pwr"]),
                                ("Ground", PIN_FILL["gnd"]), ("Other / passive", PIN_FILL["nc"])))
    val = f"<b>Pin colors</b><table style='font-size:10px'>{rows}</table>"
    st = "rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;fillColor=#FFFFFF;strokeColor=#999999;spacingLeft=6;fontSize=11;"
    return f'<mxCell id="{i}" value="{esc(val)}" style="{esc(st)}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="150" height="130" as="geometry"/></mxCell>'

# ------------------------------------------------------------------ build library
def build_library():
    entries = []
    for group, parts in PARTS.items():
        for p in parts:
            cells, _, _ = p.cells()
            entries.append({"xml": compress(model(cells)), "w": p.w, "h": p.h, "title": p.title})
    for name, c in WIRES:
        entries.append(wire_entry(name, c))
    for label, kind in (("GND", "gnd"), ("3.3V", "pwr"), ("5V", "pwr"), ("12V", "pwr")):
        cells, _, _ = flag(label, kind)
        entries.append({"xml": compress(model(cells)), "w": 20, "h": 20, "title": f"{label} symbol"})
    entries.append({"xml": compress(model([title_block()])), "w": 260, "h": 170, "title": "Title Block"})
    entries.append({"xml": compress(model([legend()])), "w": 150, "h": 130, "title": "Pin Color Legend"})
    entries.append({"xml": compress(model([note_box()])), "w": 180, "h": 80, "title": "Note"})
    return entries

if __name__ == "__main__":
    lib = build_library()
    with open("EIT-Parts-Library.xml", "w") as f:
        f.write("<mxlibrary>" + json.dumps(lib) + "</mxlibrary>")
    print(len(lib), "library entries")
