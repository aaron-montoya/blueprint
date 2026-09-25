"""Convert Aaron's draw.io parts script into Blueprint's default library JSON.

tools/eit_parts_library_build.py is the source of truth for the built-in parts.
This script imports its PARTS table and writes src/library/default-library.json
in the Blueprint part format (see src/model/format.ts). Pin labels, pin order,
subtitles and notes are copied exactly.

    python3 tools/convert_parts_library.py
"""
import importlib.util
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "eit_parts_library_build.py"
OUT = ROOT / "src" / "library" / "default-library.json"

spec = importlib.util.spec_from_file_location("eit_parts", SRC)
eit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eit)  # only defines data; the draw.io build is behind __main__

PIN_TYPE = {"io": "io", "in": "input", "strap": "strap", "pwr": "power", "gnd": "gnd", "nc": "other"}

# The script's groups map onto Blueprint's starting sidebar sections. Inline
# parts (things spliced into a wire) are pulled out by name.
GROUP_CATEGORY = {
    "Controllers": "Boards",
    "Inputs": "Inputs",
    "Outputs": "Outputs",
    "Power": "Power & Wiring",
    "Passives & Connectors": "Power & Wiring",
}
INLINE = {"Resistor", "Flyback Diode", "Capacitor", "Fuse Holder", "Logic Level Shifter"}

ID_OVERRIDES = {"ESP32 DevKit V1": "esp32-devkit-v1-30"}


def slug(s):
    s = s.lower().replace("µ", "u").replace("·", " ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def pin_id(label):
    # "D23 · MOSI" -> "D23"; "VP · 36" -> "VP"; other labels are used as-is.
    return label.split(" · ")[0].strip()


def convert(part, category):
    pins, used = [], set()
    for side in ("left", "right", "top", "bottom"):
        for index, (label, kind) in enumerate(getattr(part, side)):
            pid = pin_id(label)
            if pid in used:  # e.g. the ESP32's two GND pins
                pid = f"{pid}.{side}"
            n = 2
            base = pid
            while pid in used:  # e.g. PSU Brick's two "+V" on one side
                pid = f"{base}.{n}"
                n += 1
            used.add(pid)
            pins.append({"id": pid, "label": label, "side": side, "index": index, "type": PIN_TYPE[kind]})
    d = {
        "formatVersion": 1,
        "id": ID_OVERRIDES.get(part.title, slug(part.title)),
        "name": part.title,
    }
    if part.subtitle:
        d["subtitle"] = part.subtitle
    d["category"] = category
    # Only keep widths the script set by hand; everything else auto-sizes.
    explicit_w = part.w if part.w != _auto_width(part) else None
    if explicit_w:
        d["width"] = explicit_w
    if part.note:
        d["note"] = part.note
    d["pins"] = pins
    return d


def _auto_width(part):
    longest = max([len(p[0]) for p in part.left + part.right] + [1])
    return max(110, len(part.title) * 7 + 20,
               (longest * 7 + 18) * (2 if part.left and part.right else 1) + 20,
               (max(len(part.top), len(part.bottom)) + 1) * 30)


def ground_flag():
    """The script's GND flag symbol, as a one-pin ground reference."""
    return {
        "formatVersion": 1,
        "id": "gnd",
        "name": "GND",
        "subtitle": "ground reference",
        "category": "Power & Wiring",
        "pins": [{"id": "GND", "label": "GND", "side": "top", "index": 0, "type": "gnd"}],
    }


def supply(volts):
    """The script's 3.3V/5V/12V flag symbols, as supplies with + and − pins."""
    return {
        "formatVersion": 1,
        "id": slug(f"supply {volts}"),
        "name": f"{volts} Supply",
        "subtitle": "power rail",
        "category": "Power & Wiring",
        "pins": [
            {"id": "+", "label": "+", "side": "right", "index": 0, "type": "power"},
            {"id": "−", "label": "−", "side": "right", "index": 1, "type": "gnd"},
        ],
    }


def main():
    parts = []
    for group, group_parts in eit.PARTS.items():
        for p in group_parts:
            cat = "Inline Parts" if p.title in INLINE else GROUP_CATEGORY[group]
            parts.append(convert(p, cat))
    # The script's power/ground flag symbols.
    parts.append(ground_flag())
    for v in ("3.3V", "5V", "12V"):
        parts.append(supply(v))

    ids = [p["id"] for p in parts]
    assert len(ids) == len(set(ids)), "duplicate part ids"
    lib = {"formatVersion": 1, "name": "EIT default parts", "parts": parts}
    OUT.write_text(json.dumps(lib, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(parts)} parts to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
