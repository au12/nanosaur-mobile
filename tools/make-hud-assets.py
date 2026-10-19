#!/usr/bin/env python3
"""
Cuts the original 1998 infobar (Data/Images/Infobar.tga) into separate HUD "plaques"
and converts the infobar sprites (digits, weapon icons, fuel gauge, eggs) to PNG.

The web shell reassembles these into a compact overlay HUD: every element keeps the
original artwork, and sprites are positioned using the game's own pixel coordinates
(see Infobar.c), just relative to their plaque instead of the full 640x480 frame.

Usage: make-hud-assets.py <Nanosaur Data dir> <output dir>
Writes <output dir>/*.png and <output dir>/hud.json (plaque geometry).
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tga2png  # noqa: E402

# Plaque crops in original infobar coordinates: (x0, y0, x1, y1)
PLAQUES = {
    "time":   (0, 0, 108, 80),
    "weapon": (4, 96, 108, 238),
    "fuel":   (18, 240, 88, 386),
    "score":  (140, 384, 300, 438),
    "lives":  (14, 396, 100, 478),
    "health": (118, 446, 410, 476),
    "eggs":   (452, 380, 616, 462),
}

# Sprite slots (absolute infobar coords, from Infobar.c constants)
NUMBERS_XOFF, NUMBERS_YOFF, NUMBERS_WIDTH = -7, -6, 16


def digit_slots(x, y, count):
    """PrintNumber() draws right-to-left starting at (x+XOFF, y+YOFF)."""
    x += NUMBERS_XOFF
    y += NUMBERS_YOFF
    return [(x - i * NUMBERS_WIDTH, y) for i in range(count)]  # index 0 = ones digit


SLOTS = {
    "time": {
        "seconds": digit_slots(38 + 38, 58, 2),
        "minutes": digit_slots(38, 58, 2),
    },
    "weapon": {
        "icon": [(21, 133)],
        "ammo": digit_slots(71, 219, 3),
    },
    "fuel": {"gauge": [(52 - 14, 327 - 53)]},
    "score": {"digits": digit_slots(270, 419, 8)},
    "lives": {"digits": digit_slots(51, 458, 1)},
    "health": {"meter": [(189, 457, 213, 9)]},
    "eggs": {"eggs": [((476 - 13) + i * 29, 435 - 20) for i in range(5)]},
}


def crop(rows, box):
    x0, y0, x1, y1 = box
    return [r[x0:x1] for r in rows[y0:y1]]


def main():
    data_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    w, h, rows = tga2png.read_tga(os.path.join(data_dir, "Images", "Infobar.tga"))
    meta = {"plaques": {}, "slots": {}}
    for name, box in PLAQUES.items():
        x0, y0, x1, y1 = box
        tga2png.write_png(os.path.join(out_dir, f"plaque-{name}.png"), x1 - x0, y1 - y0, crop(rows, box))
        meta["plaques"][name] = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
        rel = {}
        for slot, pts in SLOTS[name].items():
            rel[slot] = [[p[0] - x0, p[1] - y0] + list(p[2:]) for p in pts]
        meta["slots"][name] = rel

    sprite_dir = os.path.join(data_dir, "Sprites")
    frames = []
    i = 0
    while os.path.exists(os.path.join(sprite_dir, f"Infobar{1000 + i}.tga")):
        frames.append(tga2png.read_tga(os.path.join(sprite_dir, f"Infobar{1000 + i}.tga")))
        i += 1

    # Frame layout (objtypes.h): 0-4 weapons, 5-14 digits, 15 blank, 16-44 fuel gauge, 45-49 eggs
    for n in range(5):
        fw, fh, fr = frames[n]
        tga2png.write_png(os.path.join(out_dir, f"weapon-{n}.png"), fw, fh, fr)
    for d in range(10):
        fw, fh, fr = frames[5 + d]
        tga2png.write_png(os.path.join(out_dir, f"digit-{d}.png"), fw, fh, fr)
    for e in range(5):
        fw, fh, fr = frames[45 + e]
        tga2png.write_png(os.path.join(out_dir, f"egg-{e}.png"), fw, fh, fr)

    # Fuel gauge: vertical sprite sheet, frame 0 = full ... frame 28 = empty
    fuel = frames[16:45]
    fw, fh = fuel[0][0], fuel[0][1]
    sheet = []
    for (_, _, fr) in fuel:
        sheet.extend(fr)
    tga2png.write_png(os.path.join(out_dir, "fuel-sheet.png"), fw, fh * len(fuel), sheet)
    meta["fuel"] = {"frameW": fw, "frameH": fh, "frames": len(fuel), "firstFrame": 16}

    with open(os.path.join(out_dir, "hud.json"), "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    main()
