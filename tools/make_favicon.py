#!/usr/bin/env python3
"""Generate the Space Buddy moon favicon in the game's palette.

The mark is a 16 x 16 pixel moon on a transparent field. It is deliberately
outline-led rather than black-fringed so it reads on both light and dark tabs.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

# 1 outline, 2 moon, 3 crater, 4 highlight
GRID = [
    "................",
    "................",
    "................",
    ".....111111.....",
    "....12222211....",
    "...1222222221...",
    "..122233222221..",
    "..122333222221..",
    "..122332222221..",
    "..122222244221..",
    "..122222444221..",
    "..122222244221..",
    "...1222222221...",
    "....12222211....",
    ".....111111.....",
    "................",
]
COLORS = {
    "1": (75, 80, 104, 255),
    "2": (194, 198, 212, 255),
    "3": (142, 147, 168, 255),
    "4": (238, 241, 255, 255),
}


def make(size: int) -> Image.Image:
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(GRID):
        for x, ch in enumerate(row):
            if ch in COLORS:
                px[x, y] = COLORS[ch]
    if size != 16:
        im = im.resize((size, size), Image.Resampling.NEAREST)
    return im


def svg() -> str:
    rects = []
    for y, row in enumerate(GRID):
        for x, ch in enumerate(row):
            if ch in COLORS:
                r, g, b, _ = COLORS[ch]
                rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" '
        'role="img" aria-label="Space Buddy moon">\n'
        + "\n".join(rects)
        + "\n</svg>\n"
    )


def main() -> None:
    (OUT / "favicon.svg").write_text(svg(), encoding="utf-8", newline="\n")
    for s in (16, 32, 48, 180, 192, 512):
        make(s).save(OUT / f"favicon-{s}.png", optimize=True)
    make(48).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon.svg, favicon.ico, favicon-16/32/48/180/192/512.png")


if __name__ == "__main__":
    main()
