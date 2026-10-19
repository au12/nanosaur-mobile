#!/usr/bin/env python3
"""
Dependency-free TGA -> PNG converter (stdlib only), used at build time to turn
Nanosaur's original infobar sprites into PNGs for the web HUD.

Supports TGA image types 1/2/3 (raw) and 9/10/11 (RLE): color-mapped,
truecolor (15/16/24/32 bpp) and grayscale.

Usage:
    tga2png.py IN.tga OUT.png [--crop] [--scale N]
    tga2png.py --batch SRC_DIR DST_DIR [--crop] [--scale N]
"""

import os
import struct
import sys
import zlib


def _read_pixel(data, off, bpp):
    if bpp == 8:
        return data[off], off + 1
    if bpp in (15, 16):
        v = data[off] | (data[off + 1] << 8)
        return v, off + 2
    if bpp == 24:
        return (data[off], data[off + 1], data[off + 2]), off + 3
    if bpp == 32:
        return (data[off], data[off + 1], data[off + 2], data[off + 3]), off + 4
    raise ValueError("unsupported bpp %d" % bpp)


def _to_rgba(raw, bpp, cmap, itype, has_alpha_bits):
    # Color-mapped
    if itype in (1, 9):
        return cmap[raw] if raw < len(cmap) else (0, 0, 0, 255)
    # Grayscale
    if itype in (3, 11):
        if bpp == 8:
            return (raw, raw, raw, 255)
        g = raw & 0xFF
        return (g, g, g, (raw >> 8) & 0xFF)
    # Truecolor
    if bpp in (15, 16):
        r = ((raw >> 10) & 0x1F) * 255 // 31
        g = ((raw >> 5) & 0x1F) * 255 // 31
        b = (raw & 0x1F) * 255 // 31
        a = 255 if (bpp == 15 or not has_alpha_bits) else (255 if raw & 0x8000 else 0)
        return (r, g, b, a)
    if bpp == 24:
        b, g, r = raw
        return (r, g, b, 255)
    b, g, r, a = raw
    if not has_alpha_bits:
        a = 255
    return (r, g, b, a)


def read_tga(path):
    data = open(path, "rb").read()
    (idlen, cmtype, itype, cmstart, cmlen, cmdepth,
     _xo, _yo, w, h, bpp, desc) = struct.unpack("<BBBHHBHHHHBB", data[:18])
    off = 18 + idlen
    alpha_bits = desc & 0x0F
    cmap = []
    if cmtype == 1:
        for _ in range(cmlen):
            raw, off = _read_pixel(data, off, cmdepth)
            cmap.append(_to_rgba(raw, cmdepth, None, 2, alpha_bits))
        cmap = [(0, 0, 0, 255)] * cmstart + cmap

    n = w * h
    pixels = []
    if itype in (1, 2, 3):
        for _ in range(n):
            raw, off = _read_pixel(data, off, bpp)
            pixels.append(_to_rgba(raw, bpp, cmap, itype, alpha_bits))
    elif itype in (9, 10, 11):
        while len(pixels) < n:
            hdr = data[off]
            off += 1
            count = (hdr & 0x7F) + 1
            if hdr & 0x80:
                raw, off = _read_pixel(data, off, bpp)
                px = _to_rgba(raw, bpp, cmap, itype, alpha_bits)
                pixels.extend([px] * count)
            else:
                for _ in range(count):
                    raw, off = _read_pixel(data, off, bpp)
                    pixels.append(_to_rgba(raw, bpp, cmap, itype, alpha_bits))
        pixels = pixels[:n]
    else:
        raise ValueError("unsupported TGA type %d in %s" % (itype, path))

    rows = [pixels[y * w:(y + 1) * w] for y in range(h)]
    if not (desc & 0x20):          # origin at bottom-left -> flip
        rows.reverse()
    if desc & 0x10:                # origin at right -> mirror
        rows = [list(reversed(r)) for r in rows]
    return w, h, rows


def crop_rows(w, h, rows):
    ys = [y for y in range(h) if any(p[3] for p in rows[y])]
    if not ys:
        return w, h, rows
    xs = [x for x in range(w) if any(rows[y][x][3] for y in ys)]
    y0, y1, x0, x1 = ys[0], ys[-1] + 1, xs[0], xs[-1] + 1
    rows = [r[x0:x1] for r in rows[y0:y1]]
    return x1 - x0, y1 - y0, rows


def scale_rows(w, h, rows, s):
    out = []
    for r in rows:
        line = []
        for p in r:
            line.extend([p] * s)
        for _ in range(s):
            out.append(list(line))
    return w * s, h * s, out


def write_png(path, w, h, rows):
    raw = bytearray()
    for r in rows:
        raw.append(0)
        for p in r:
            raw.extend(p)

    def chunk(tag, payload):
        c = struct.pack(">I", len(payload)) + tag + payload
        return c + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def convert(src, dst, crop=False, scale=1):
    w, h, rows = read_tga(src)
    if crop:
        w, h, rows = crop_rows(w, h, rows)
    if scale > 1:
        w, h, rows = scale_rows(w, h, rows, scale)
    write_png(dst, w, h, rows)
    return w, h


def main(argv):
    crop = "--crop" in argv
    scale = 1
    if "--scale" in argv:
        scale = int(argv[argv.index("--scale") + 1])
    args = [a for i, a in enumerate(argv)
            if not a.startswith("--") and (i == 0 or argv[i - 1] != "--scale")]
    if "--batch" in argv:
        src_dir, dst_dir = args
        os.makedirs(dst_dir, exist_ok=True)
        for name in sorted(os.listdir(src_dir)):
            if name.lower().endswith(".tga"):
                out = os.path.join(dst_dir, os.path.splitext(name)[0] + ".png")
                convert(os.path.join(src_dir, name), out, crop, scale)
    else:
        convert(args[0], args[1], crop, scale)


if __name__ == "__main__":
    main(sys.argv[1:])
