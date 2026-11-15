#!/usr/bin/env python3
"""
Slice the Space Buddy sprite sheets into game-ready PNGs.

The five source sheets are AI-generated "catalog" art (JPG, no alpha):

  assets/img5.jpg  main sheet, flat gray background  -> keyed to transparency
  assets/img1..4   dark navy background             -> kept opaque (use on dark panels)

Boxes below were measured on the sheets with a connected-component pass
(tools notes in README) and then curated by eye. Every crop is trimmed,
downscaled with LANCZOS to a game-friendly max size (keeps the art crisp when
drawn 1:1 or 2x with image-rendering: pixelated) and written to:

    assets/sprites/<group>/<name>.png

A JS manifest is written to assets/manifest.js so the browser can preload
everything without fetch() (works on file://).

Usage:
    python tools/slice_assets.py            # slice everything
    python tools/slice_assets.py --preview  # also write preview contact sheets
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image, ImageOps
import numpy as np
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.join(ASSETS, "sprites")
MANIFEST = os.path.join(ASSETS, "manifest.js")

SHEETS = {
    "img5": "img5.jpg",
    "img4": "img4.jpg",
    "img3": "img3.jpg",
    "img2": "img2.jpg",
    "img1": "img1.jpg",
}

# Sprites that are re-tinted in code after slicing (Mars art used on the Moon)
TINT_GRAY = {"habitat/tunnel"}

# sheet, "group/name", (x, y, w, h), max_size, keyed
SPRITES = [
    # ---------------------------------------------------------------- img5 ---
    # terrain tiles
    ("img5", "terrain/moon_tile",     (9, 26, 288, 289), 96, True),
    ("img5", "terrain/metal_tile",    (616, 26, 288, 288), 96, True),

    # habitat
    ("img5", "habitat/dome",          (1321, 53, 262, 260), 128, True),
    ("img5", "habitat/dome_module",   (958, 82, 354, 232), 160, True),
    ("img5", "habitat/dome_dark",     (35, 386, 255, 227), 128, True),
    ("img5", "habitat/dome_door",     (327, 386, 271, 232), 128, True),
    ("img5", "habitat/tunnel",        (1308, 380, 294, 235), 128, True),
    ("img5", "habitat/rad_module",    (1085, 400, 190, 215), 96, True),
    ("img5", "habitat/greenhouse",    (612, 688, 207, 224), 96, True),
    ("img5", "habitat/greenhouse_dome", (844, 688, 255, 225), 96, True),
    ("img5", "habitat/crates",        (1124, 749, 143, 162), 64, True),

    # power
    ("img5", "power/solar_a",         (27, 987, 199, 171), 96, True),
    ("img5", "power/solar_b",         (236, 987, 200, 171), 96, True),
    ("img5", "power/battery",         (474, 1007, 89, 135), 64, True),
    ("img5", "power/battery_green",   (596, 1001, 77, 143), 64, True),
    ("img5", "power/cable",           (702, 1003, 134, 139), 64, True),
    ("img5", "power/relay",           (867, 990, 83, 165), 64, True),
    ("img5", "power/relay2",          (987, 990, 96, 165), 64, True),
    ("img5", "power/unit",            (1118, 986, 150, 174), 96, True),
    ("img5", "power/nuclear",         (1276, 986, 120, 174), 96, True),

    # life support
    ("img5", "life/o2_tank",          (39, 1233, 95, 192), 64, True),
    ("img5", "life/co2_tank",         (154, 1233, 94, 192), 64, True),
    ("img5", "life/air_unit",         (272, 1245, 159, 180), 80, True),
    ("img5", "life/water_recycler",   (455, 1254, 164, 171), 80, True),
    ("img5", "life/water_tank",       (644, 1252, 167, 173), 80, True),
    ("img5", "life/pipes",            (1117, 1258, 142, 167), 80, True),
    ("img5", "life/monitor",          (1287, 1252, 123, 130), 64, True),
    ("img5", "life/console",          (1438, 1252, 122, 130), 64, True),

    # HUD / status icons
    ("img5", "icons/alarm",           (1798, 78, 110, 120), 32, True),
    ("img5", "icons/water",           (1967, 71, 90, 124), 32, True),
    ("img5", "icons/o2",              (2096, 70, 117, 119), 32, True),
    ("img5", "icons/bolt",            (2250, 70, 85, 121), 32, True),
    ("img5", "icons/shield",          (2384, 72, 106, 116), 32, True),
    ("img5", "icons/power",           (2096, 222, 117, 119), 32, True),
    ("img5", "icons/plant",           (2238, 222, 110, 119), 32, True),
    ("img5", "icons/battery",         (1798, 264, 109, 117), 32, True),
    ("img5", "icons/up",              (1975, 244, 74, 136), 32, True),
    ("img5", "icons/rad",             (2383, 222, 108, 115), 32, True),

    # repair items
    ("img5", "repair/toolbox",        (1756, 760, 152, 112), 64, True),
    ("img5", "repair/wires",          (1951, 750, 146, 129), 64, True),
    ("img5", "repair/tape",           (2136, 757, 143, 126), 64, True),
    ("img5", "repair/gears",          (2309, 732, 165, 155), 64, True),
    ("img5", "repair/wrench",         (2146, 602, 118, 70), 64, True),
    ("img5", "repair/gluegun",        (2324, 557, 130, 114), 64, True),
    ("img5", "repair/alarm_light",    (1790, 570, 97, 101), 64, True),

    # hazards
    ("img5", "hazard/rad_triangle",   (1727, 1037, 251, 218), 96, True),
    ("img5", "hazard/dust",           (2015, 1135, 215, 115), 64, True),
    ("img5", "hazard/water_leak",     (2263, 1056, 204, 143), 96, True),

    # crew + external equipment
    ("img5", "crew/walk",             (1740, 1459, 117, 197), 64, True),
    ("img5", "crew/wrench",           (1908, 1459, 152, 198), 64, True),
    ("img5", "crew/plant",            (2101, 1481, 192, 173), 64, True),
    ("img5", "crew/solar",            (2315, 1475, 192, 178), 64, True),
    ("img5", "external/rover",        (26, 1522, 174, 144), 80, True),
    ("img5", "external/dish_a",       (248, 1497, 125, 169), 64, True),
    ("img5", "external/dish_b",       (448, 1497, 124, 169), 64, True),
    ("img5", "external/antenna",      (646, 1485, 107, 184), 64, True),
    ("img5", "external/drill",        (815, 1525, 189, 143), 64, True),
    ("img5", "external/drill2",       (1041, 1523, 155, 145), 64, True),

    # ---------------------------------------------------------------- img4 ---
    ("img4", "hazard/meteor_a",       (2234, 85, 109, 132), 32, False),
    ("img4", "hazard/meteor_b",       (2406, 85, 62, 108), 32, False),
    ("img4", "hazard/meteor_c",       (2547, 110, 71, 139), 32, False),
    ("img4", "hazard/explosion",      (1780, 295, 150, 115), 64, False),
    ("img4", "hazard/broken_pipe",    (1545, 285, 205, 115), 64, False),
    ("img4", "hazard/rad_sign",       (1440, 285, 115, 110), 48, False),
    ("img4", "crew/crate",            (103, 1319, 160, 195), 80, False),
    ("img4", "crew/tablet",           (235, 1320, 147, 196), 80, False),
    ("img4", "crew/welding",          (415, 1329, 155, 183), 80, False),
    ("img4", "crew/rover",            (604, 1317, 202, 199), 80, False),

    # ---------------------------------------------------------------- img3 ---
    ("img3", "terrain/plain",         (36, 133, 187, 141), 96, False),
    ("img3", "terrain/ridge",         (237, 85, 194, 189), 96, False),
    ("img3", "terrain/slope",         (445, 85, 207, 189), 96, False),
    ("img3", "terrain/cave_tile",     (666, 85, 213, 152), 96, False),
    ("img3", "terrain/cracks",        (895, 85, 207, 188), 96, False),
    ("img3", "terrain/ice",           (1116, 85, 217, 191), 96, False),
    ("img3", "mech/door",             (1993, 1326, 112, 195), 64, False),
    ("img3", "mech/ladder",           (2128, 1324, 62, 187), 64, False),

    # ---------------------------------------------------------------- img2 ---
    ("img2", "select/moon_satellite", (1706, 106, 185, 193), 128, False),
    ("img2", "select/moon_base",      (1975, 108, 185, 193), 128, False),
    ("img2", "select/star",           (600, 1225, 55, 70), 40, False),
    ("img2", "select/level_01",       (358, 1439, 73, 73), 44, False),
    ("img2", "select/level_02",       (468, 1439, 73, 73), 44, False),
    ("img2", "select/level_03",       (577, 1439, 73, 73), 44, False),
    ("img2", "select/mission_confirmed", (38, 1222, 333, 74), 160, False),
    ("img2", "select/badge_completed", (2240, 620, 200, 90), 96, False),
    ("img2", "fx/sun",                (1425, 1345, 195, 185), 96, False),
    ("img2", "fx/comet",              (1645, 1330, 265, 130), 128, False),
    ("img2", "fx/shuttle",            (1425, 1065, 225, 150), 96, False),

    # ---------------------------------------------------------------- img1 ---
    ("img1", "select/sector_cislunar", (50, 90, 380, 410), 160, False),
    ("img1", "select/sector_mars",     (500, 360, 360, 360), 160, False),
    ("img1", "select/sector_ocean",    (980, 70, 360, 430), 160, False),
    ("img1", "select/planet_moon",     (1470, 160, 220, 230), 96, False),
    ("img1", "select/planet_mars",     (2120, 160, 180, 220), 96, False),
    ("img1", "select/planet_europa",   (1470, 600, 220, 220), 96, False),
    ("img1", "fx/capsule",             (1430, 1070, 230, 130), 96, False),
    ("img1", "fx/lander",              (1730, 1060, 270, 140), 128, False),
    ("img1", "ui/launch_window",       (480, 1290, 420, 70), 160, False),
]


def load_sheet(name: str) -> Image.Image:
    path = os.path.join(ASSETS, SHEETS[name])
    if not os.path.exists(path):
        sys.exit(f"missing sheet: {path}")
    return Image.open(path).convert("RGB")


def key_background(img: Image.Image, tol: int = 46) -> Image.Image:
    """Remove the flat sheet background, flood-filling only from the edges.

    Grey JPG background + AI art means hard edges need a soft fringe, so alpha
    is feathered by colour distance after the flood fill.
    """
    rgb = np.asarray(img).astype(np.int16)
    h, w, _ = rgb.shape

    # Use the four corner patches: catalog sections sit on slightly different
    # backdrops (gray sheet, navy panels, black FX panels). Median beats the
    # mode because JPEG noise means no colour repeats exactly.
    k = 8
    corners = np.concatenate([
        rgb[0:k, 0:k].reshape(-1, 3), rgb[0:k, -k:].reshape(-1, 3),
        rgb[-k:, 0:k].reshape(-1, 3), rgb[-k:, -k:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0).astype(np.int16)

    dist = np.abs(rgb - bg).max(axis=2)

    near_bg = dist <= tol
    labels, _ = ndimage.label(near_bg)
    edge_labels = set(np.unique(np.concatenate([
        labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1],
    ])))
    edge_labels.discard(0)
    background = np.isin(labels, list(edge_labels))

    # feather: 0 where background, ramp up for near-background fringe pixels
    alpha = np.clip((dist.astype(np.float32) - 18.0) / 42.0, 0.0, 1.0) * 255.0
    alpha[background] = 0.0

    out = np.dstack([rgb.astype(np.uint8), alpha.astype(np.uint8)])
    return Image.fromarray(out, "RGBA")


def erode_alpha(img: Image.Image, px: int = 1) -> Image.Image:
    a = np.asarray(img)[:, :, 3]
    solid = ndimage.binary_erosion(a > 8, iterations=px)
    out = np.array(img)
    out[:, :, 3] = np.where(solid, out[:, :, 3], 0)
    return Image.fromarray(out, "RGBA")


def tint_gray(img: Image.Image) -> Image.Image:
    """Desaturate a sheet sprite and cool it down (Mars art reused on the Moon)."""
    alpha = img.split()[-1]
    gray = ImageOps.grayscale(img.convert("RGB"))
    tinted = Image.merge("RGB", (
        gray.point(lambda v: min(255, int(v * 0.96))),
        gray.point(lambda v: min(255, int(v * 1.00))),
        gray.point(lambda v: min(255, int(v * 1.10))),
    ))
    tinted.putalpha(alpha)
    return tinted


def trim(img: Image.Image, keyed: bool) -> Image.Image:
    if not keyed:
        return img
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return img
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    return img.crop((x0, y0, x1, y1))


def fit(img: Image.Image, max_size: int) -> Image.Image:
    w, h = img.size
    if max(w, h) <= max_size:
        return img
    s = max_size / float(max(w, h))
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    return img.resize((nw, nh), Image.LANCZOS)


def slice_all(preview: bool) -> None:
    os.makedirs(OUT, exist_ok=True)
    sheets = {key: load_sheet(key) for key in SHEETS}
    manifest = {}
    written = []

    for sheet, rel, (x, y, w, h), max_size, keyed in SPRITES:
        src = sheets[sheet]
        x2, y2 = min(src.width, x + w), min(src.height, y + h)
        crop = src.crop((x, y, x2, y2))

        # B15: key every *sprite* background (gray on img5, navy on img1-4),
        # then erode one pixel so the JPG fringe leaves no dark halo.
        # Terrain tiles are full-bleed ground art: keep them opaque.
        is_tile = rel.startswith("terrain/")
        if not is_tile:
            crop = key_background(crop)
            crop = erode_alpha(crop, 1)

        crop = trim(crop, not is_tile)

        if rel in TINT_GRAY:
            crop = tint_gray(crop)

        if crop.width < 4 or crop.height < 4:
            print(f"  ! {rel}: empty crop, skipped")
            continue

        crop = fit(crop, max_size)

        dest = os.path.join(OUT, rel + ".png")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        # every sprite is keyed now, so always keep the alpha channel
        crop.save(dest, optimize=True)

        manifest[rel] = {"src": f"assets/sprites/{rel}.png", "w": crop.width, "h": crop.height}
        written.append((sheet, rel, crop.size))

    # JS manifest (works with file://, unlike fetch)
    lines = [
        "/* Generated by tools/slice_assets.py - do not edit by hand. */",
        "window.JAMT_ASSETS = {",
    ]
    for rel, info in manifest.items():
        lines.append(f'  "{rel}": {{ "src": "{info["src"]}", "w": {info["w"]}, "h": {info["h"]} }},')
    lines.append("};")
    with open(MANIFEST, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"sliced {len(written)} sprites -> {OUT}")
    print(f"manifest -> {MANIFEST}")

    if preview:
        write_preview_preview()


def write_preview_preview() -> None:
    """Contact sheet of every crop (for eyeballing the boxes)."""
    from PIL import ImageDraw, ImageFont

    try:
        font = ImageFont.truetype("arial.ttf", 13)
    except Exception:
        font = ImageFont.load_default()

    tiles = []
    for sheet, rel, (x, y, w, h), max_size, keyed in SPRITES:
        path = os.path.join(OUT, rel + ".png")
        if not os.path.exists(path):
            continue
        img = Image.open(path).convert("RGBA")
        tiles.append((rel, img))

    cell_w, cell_h = 190, 170
    cols = 6
    rows = (len(tiles) + cols - 1) // cols
    sheet_img = Image.new("RGB", (cell_w * cols, cell_h * rows), (30, 34, 50))
    d = ImageDraw.Draw(sheet_img)

    for i, (name, img) in enumerate(tiles):
        cx = (i % cols) * cell_w
        cy = (i // cols) * cell_h
        # checkerboard so transparency is visible
        for by in range(0, cell_h - 26, 10):
            for bx in range(0, cell_w, 10):
                if (bx // 10 + by // 10) % 2 == 0:
                    d.rectangle([cx + bx, cy + by, cx + bx + 9, cy + by + 9], fill=(52, 57, 78))
        thumb = img.copy()
        thumb.thumbnail((cell_w - 10, cell_h - 34))
        sheet_img.paste(thumb, (cx + (cell_w - thumb.width) // 2, cy + 4), thumb)
        d.text((cx + 4, cy + cell_h - 24), name.split("/")[1], fill=(230, 236, 255), font=font)
        d.text((cx + 4, cy + cell_h - 11), f"{img.width}x{img.height}", fill=(150, 160, 190), font=font)

    out = os.path.join(ROOT, "tools", "preview_sprites.png")
    sheet_img.save(out)
    print(f"preview -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="write tools/preview_sprites.png contact sheet")
    args = ap.parse_args()
    slice_all(preview=args.preview)
