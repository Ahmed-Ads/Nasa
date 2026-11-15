#!/usr/bin/env python3
"""Slice the clean right-facing rover riding frame from assets/img6.jpg.

The sheet uses a flat dark-navy backdrop. The astronaut and rover share that
backdrop's dark tones, so a border flood fill (rather than a global threshold)
keeps the wheels and outline intact. The result is mirrored in game.js for the
left-facing direction; the sheet has no distinct wheel-spin frame.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "img6.jpg"
OUT = ROOT / "assets" / "rover"
OUT.mkdir(parents=True, exist_ok=True)


def cut_background(im: Image.Image, tolerance: int = 24) -> Image.Image:
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    bg = px[0, 0]
    outside = bytearray(w * h)
    q = deque()

    def near(x: int, y: int) -> bool:
        r, g, b = px[x, y]
        return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) <= tolerance

    def push(x: int, y: int) -> None:
        i = y * w + x
        if not outside[i] and near(x, y):
            outside[i] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0); push(x, h - 1)
    for y in range(h):
        push(0, y); push(w - 1, y)
    while q:
        x, y = q.popleft()
        if x > 0: push(x - 1, y)
        if x + 1 < w: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y + 1 < h: push(x, y + 1)

    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if outside[y * w + x]:
                ap[x, y] = 0
    # Shave the one-pixel dark fringe left by JPEG edge blending.
    alpha = alpha.filter(ImageFilter.MinFilter(3))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def main() -> None:
    sheet = Image.open(SRC)
    # The clean right-facing rider in the "riding" cell.
    rider = cut_background(sheet.crop((2490, 55, 2735, 280)))
    h = max(1, round(rider.height * 128 / rider.width))
    rider = rider.resize((128, h), Image.Resampling.LANCZOS)
    rider.save(OUT / "ride.png", optimize=True)
    print(f"ride.png: {rider.width}x{rider.height}")


if __name__ == "__main__":
    main()
