#!/usr/bin/env python3
"""Converts a few pieces of original game art for the web shell.

Usage: make-art.py <Nanosaur Data dir> <output dir>
  infobar.png  - the full 1998 infobar frame (launcher frame, panel texture)
  raptor.png   - Nano's head from the infobar's lives counter (rotate prompt)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tga2png  # noqa: E402


def main():
    data_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    w, h, rows = tga2png.read_tga(os.path.join(data_dir, "Images", "Infobar.tga"))
    tga2png.write_png(os.path.join(out_dir, "infobar.png"), w, h, rows)
    x0, y0, x1, y1 = 20, 398, 84, 442
    tga2png.write_png(os.path.join(out_dir, "raptor.png"), x1 - x0, y1 - y0, [r[x0:x1] for r in rows[y0:y1]])


if __name__ == "__main__":
    main()
