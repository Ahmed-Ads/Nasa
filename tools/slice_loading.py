#!/usr/bin/env python3
"""Slice the tiny loading-screen sprites out of assets/img14.jpg.

img14 is a full reference mock-up with the old title, a fake bar and text baked
in. We only take the astronaut, two planets, two satellites and two asteroids.
The source JPG stays uncommitted; the loading screen uses these small PNGs.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "img14.jpg"
OUT = ROOT / "assets" / "loading"
OUT.mkdir(parents=True, exist_ok=True)


def flood_alpha(im: Image.Image, tolerance: int = 32, keep_largest: bool = False) -> Image.Image:
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    bg = px[0, 0]
    seen = bytearray(w * h)
    q = deque()

    def near(x, y):
        r, g, b = px[x, y]
        return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) <= tolerance

    def push(x, y):
        i = y * w + x
        if not seen[i] and near(x, y):
            seen[i] = 1
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

    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if not seen[y * w + x]:
                ap[x, y] = 255

    if keep_largest:
        # Remove isolated stars: keep only the largest 4-connected alpha blob.
        seen2 = bytearray(w * h)
        best = []
        for y in range(h):
            for x in range(w):
                i = y * w + x
                if seen2[i] or ap[x, y] == 0:
                    continue
                comp = []
                dq = deque([(x, y)]); seen2[i] = 1
                while dq:
                    cx, cy = dq.popleft(); comp.append((cx, cy))
                    for nx, ny in ((cx-1,cy),(cx+1,cy),(cx,cy-1),(cx,cy+1)):
                        if 0 <= nx < w and 0 <= ny < h:
                            j = ny * w + nx
                            if not seen2[j] and ap[nx, ny]:
                                seen2[j] = 1; dq.append((nx, ny))
                if len(comp) > len(best):
                    best = comp
        ap = alpha.load()
        alpha = Image.new("L", (w, h), 0)
        ap = alpha.load()
        for x, y in best:
            ap[x, y] = 255

    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())




def flood_alpha_local(im: Image.Image, tolerance: int = 18, absolute: int = 80,
                      keep_largest: bool = True) -> Image.Image:
    """Remove a smooth space gradient from a small cutout.

    The single-colour flood in ``flood_alpha`` works for the planets and the
    astronaut, but the source has a vignette behind the satellites/asteroids.
    Grow the background pixel-by-pixel, comparing each step with its parent,
    so the gradient is removed without eating the object's dark side.
    """
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    border = ([px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)]
              + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)])
    bg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    seen = bytearray(w * h)
    q = deque()

    def dist(a, b):
        return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])

    def push(x, y, ref):
        i = y * w + x
        if not seen[i] and (dist(px[x, y], ref) <= tolerance
                            or dist(px[x, y], bg) <= absolute):
            seen[i] = 1
            q.append((x, y, px[x, y]))

    for x in range(w):
        push(x, 0, bg); push(x, h - 1, bg)
    for y in range(h):
        push(0, y, bg); push(w - 1, y, bg)
    while q:
        x, y, ref = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny, ref)

    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if not seen[y * w + x]:
                ap[x, y] = 255

    if keep_largest:
        seen2 = bytearray(w * h)
        best = []
        for y in range(h):
            for x in range(w):
                i = y * w + x
                if seen2[i] or ap[x, y] == 0:
                    continue
                comp = []
                dq = deque([(x, y)]); seen2[i] = 1
                while dq:
                    cx, cy = dq.popleft(); comp.append((cx, cy))
                    for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                        if 0 <= nx < w and 0 <= ny < h:
                            j = ny * w + nx
                            if not seen2[j] and ap[nx, ny]:
                                seen2[j] = 1; dq.append((nx, ny))
                if len(comp) > len(best):
                    best = comp
        alpha = Image.new("L", (w, h), 0)
        ap = alpha.load()
        for x, y in best:
            ap[x, y] = 255

    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def circle_alpha(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    # The planets are nearly circular; mask a centered disc slightly inside the crop.
    w, h = im.size
    mask = Image.new("L", (w * 2, h * 2), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((2, 2, w * 2 - 2, h * 2 - 2), fill=255)
    mask = mask.resize((w, h), Image.Resampling.LANCZOS)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out.crop(out.getbbox())


def save(im: Image.Image, name: str, width: int, blur: bool = True) -> None:
    if im.width > width:
        h = max(1, round(im.height * width / im.width))
        im = im.resize((width, h), Image.Resampling.LANCZOS)
    if blur:
        # Keep the PNG palette small without changing the transparent edge.
        im = im.quantize(colors=96, method=Image.Quantize.FASTOCTREE).convert("RGBA")
    im.save(OUT / name, optimize=True)
    print(f"{name}: {im.width}x{im.height} ({im.width * im.height} px)")


def main() -> None:
    sheet = Image.open(SRC)
    save(flood_alpha_local(sheet.crop((1260, 470, 1515, 805)), 10, 50), "astronaut.png", 128, False)
    save(flood_alpha_local(sheet.crop((180, 95, 295, 210)), 10, 50), "planet_orange.png", 64)
    save(flood_alpha_local(sheet.crop((875, 135, 995, 255)), 10, 50), "planet_blue.png", 64)
    save(flood_alpha_local(sheet.crop((2035, 470, 2180, 600)), 10, 50), "planet_ring.png", 80)
    save(flood_alpha_local(sheet.crop((2410, 1245, 2580, 1395)), 10, 50), "planet_bottom.png", 72)
    save(flood_alpha_local(sheet.crop((2210, 220, 2390, 385))), "satellite_top.png", 96)
    save(flood_alpha_local(sheet.crop((210, 550, 385, 715))), "satellite_left.png", 80)
    save(flood_alpha_local(sheet.crop((2350, 585, 2490, 705))), "asteroid_right.png", 64)
    save(flood_alpha_local(sheet.crop((350, 1125, 490, 1245))), "asteroid_left.png", 64)


if __name__ == "__main__":
    main()
