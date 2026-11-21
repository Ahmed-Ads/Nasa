#!/usr/bin/env python3
"""Slice the ice-deposit sheet (assets/img13.jpg) into transparent PNGs.

The source sheet has a magenta chroma background and a baked heading. We crop
below the heading, key magenta with a soft edge, defringe the edge pixels, trim
to the alpha bbox, and write small nearest-neighbour-friendly PNGs.

The source JPG is intentionally ignored by git (assets/img*.jpg). Only the
sliced files under assets/ice/ are committed.
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "img13.jpg"
OUT = ROOT / "assets" / "ice"
OUT.mkdir(parents=True, exist_ok=True)


def key_magenta(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    src = im.load()
    dst = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = src[x, y]
            pink = min(r, b) - g
            if pink >= 72:
                continue
            if pink <= 12:
                a = 255
            else:
                a = int(round(255 * (72 - pink) / 60))
            if a and pink > 10:
                # Pull the magenta spill back toward green on antialiased edges.
                r = int(g + (r - g) * 0.25)
                b = int(g + (b - g) * 0.25)
            dst[x, y] = (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)), a)
    return out


def trim(im: Image.Image) -> Image.Image:
    box = im.getbbox()
    return im.crop(box) if box else im


def save(im: Image.Image, name: str, width: int) -> None:
    if im.width > width:
        h = max(1, round(im.height * width / im.width))
        im = im.resize((width, h), Image.Resampling.LANCZOS)
    im.save(OUT / name, optimize=True)
    print(f"{name}: {im.width}x{im.height}")


def main() -> None:
    sheet = Image.open(SRC)
    # The large outcrop is below the heading in the top-left cell.
    deposit = trim(key_magenta(sheet.crop((0, 90, 760, 445))))
    save(deposit, "deposit.png", 128)
    # A square-ish loose chunk for the carried-item icon.
    chunk = trim(key_magenta(sheet.crop((0, 145, 250, 355))))
    save(chunk, "chunk.png", 40)


if __name__ == "__main__":
    main()
