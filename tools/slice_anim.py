#!/usr/bin/env python3
"""
Slice the animation source sheets into transparent frames + a manifest.

Usage:
    python tools/slice_anim.py img10

img10 (2752x1536): 9x5 grid of non-uniform cells separated by dark-magenta
grid lines (~#900090) on a magenta (#FF00FF) background. Cells are found from
the detected line positions (relative to the image), never from fixed sizes.

Outputs:
    assets/anim/img10/<name>.png
    assets/anim/img10/frames.json
    tools/out/img10_contact.png
    tools/out/img10_report.txt
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.join(ASSETS, "anim", "img10")
PROOF = os.path.join(ROOT, "tools", "out")


def hsvish(rgb: np.ndarray):
    r = rgb[:, :, 0].astype(np.float32) / 255.0
    g = rgb[:, :, 1].astype(np.float32) / 255.0
    b = rgb[:, :, 2].astype(np.float32) / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    return mx, mn


def magenta_mask(rgb: np.ndarray, loose: bool = False) -> np.ndarray:
    """Bright #FF00FF plus the darker magenta shadows/grid lines."""
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    mn = np.minimum(r, b)
    if loose:
        return (r > 90) & (b > 90) & (g < mn * 0.72) & (np.abs(r - b) < 70)
    return (r > 110) & (b > 110) & (g < mn * 0.55) & (np.abs(r - b) < 55)


def key_frame(rgb: np.ndarray):
    """Magenta -> transparent, 1 px erode, edge decontamination."""
    from scipy import ndimage

    bg = magenta_mask(rgb)
    # grow the keyed region by 1 px so the JPEG fringe is included
    bg = ndimage.binary_dilation(bg, iterations=1)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # decontaminate: any surviving pinkish edge pixel is mixed toward its
    # non-pink neighbours (removes the classic magenta halo)
    fringe = magenta_mask(rgb, loose=True) & ~bg
    if fringe.any():
        out = rgb.copy()
        for c in range(3):
            ch = out[:, :, c].astype(np.float32)
            blur = ndimage.uniform_filter(ch, size=3)
            ch[fringe] = blur[fringe]
            out[:, :, c] = np.clip(ch, 0, 255).astype(np.uint8)
        rgb = out

    # erode the silhouette by 1 px
    solid = ndimage.binary_erosion(alpha > 8, iterations=1)
    alpha = np.where(solid, alpha, 0).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    return rgba


def detect_lines(dark: np.ndarray, axis: int, size: int) -> list[int]:
    """Centres of the dark-magenta grid lines along one axis."""
    counts = dark.sum(axis=axis)
    # a line covers a large part of the perpendicular axis; the art sometimes
    # covers it, so use a low relative threshold
    thresh = 0.18 * (size)
    on = counts > thresh
    groups = []
    start = None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            groups.append((start, i - 1))
            start = None
    if start is not None:
        groups.append((start, len(on) - 1))
    # keep plausible line groups (wider than 0.25% and narrower than 3% of the axis)
    lo, hi = 0.0015 * size, 0.05 * size
    groups = [g for g in groups if lo <= (g[1] - g[0] + 1) <= hi]
    centres = [int(round((a + b) / 2)) for a, b in groups]
    # merge split lines (JPEG/antialiasing can split one line into two)
    merged = []
    for c in centres:
        if merged and c - merged[-1] < 0.012 * size:
            merged[-1] = (merged[-1] + c) // 2
        else:
            merged.append(c)
    return merged


def cell_bounds(lines: list[int], size: int, expect: int, add_top: bool = False) -> list[tuple[int, int]]:
    if len(lines) < expect:
        return []
    use = lines[:expect + 1]
    cells = [(use[i], use[i + 1]) for i in range(len(use) - 1)]
    if add_top and len(cells) + 1 == expect:
        spacing = max(1, cells[0][1] - cells[0][0])
        cells = [(max(0, use[0] - spacing), use[0])] + cells
    return cells[:expect]


FRAMES = {
    1: [("walk_01", 1), ("walk_02", 2), ("walk_03", 3), ("walk_04", 4), ("walk_05", 5), ("walk_06", 6),
        ("kneel_reach", 7), ("hold_rock", 8), ("idle", 9)],
    2: [("idle2", 1)] + [(f"pick_{i:02d}", i + 1) for i in range(1, 9)],
    3: [(f"dig_{i:02d}", i) for i in range(1, 4)] + [(f"bag_{i:02d}", i + 3) for i in range(1, 6)] + [("idle3", 9)],
    4: [(f"drill_{i:02d}", i) for i in range(1, 6)] + [(f"idle{3 + i}", 5 + i) for i in range(1, 5)],
    5: [(f"carry_{i:02d}", i) for i in range(1, 6)] + [("idle8", 9)],
}


def find_sheet(which: str) -> str:
    for ext in (".jpg", ".jpeg", ".png"):
        p = os.path.join(ASSETS, which + ext)
        if os.path.exists(p):
            return p
    sys.exit(f"missing assets/{which}.jpg")


def slice_img10(report_lines: list[str]):
    path = find_sheet("img10")
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    h, w = rgb.shape[:2]

    # dark-magenta grid lines (exclude the bright #FF00FF background)
    r = rgb[:, :, 0].astype(np.int16); g = rgb[:, :, 1].astype(np.int16); b = rgb[:, :, 2].astype(np.int16)
    dark = (r > 70) & (r < 200) & (b > 70) & (b < 200) & (g < 60) & (np.abs(r - b) < 45)

    vlines = detect_lines(dark, axis=0, size=h)
    hlines = detect_lines(dark, axis=1, size=w)
    report_lines.append(f"sheet: {os.path.basename(path)} {w}x{h}")
    report_lines.append(f"vertical grid lines ({len(vlines)}): {vlines}")
    report_lines.append(f"horizontal grid lines ({len(hlines)}): {hlines}")
    if len(vlines) != 10 or len(hlines) != 6:
        report_lines.append("WARNING: expected 10 vertical and 6 horizontal lines; using detected bounds")

    cols = cell_bounds(vlines, w, 9)
    rows = cell_bounds(hlines, h, 5, add_top=True)
    if len(cols) < 9 or len(rows) < 5:
        sys.exit("grid detection failed: not enough cells")

    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PROOF, exist_ok=True)
    frames = []
    rejected = []

    for row_idx, entries in FRAMES.items():
        if row_idx > len(rows):
            report_lines.append(f"row {row_idx}: missing")
            continue
        y0, y1 = rows[row_idx - 1]
        for name, col_idx in entries:
            x0, x1 = cols[col_idx - 1]
            if x1 - x0 < 4 or y1 - y0 < 4:
                report_lines.append(f'{name}: EMPTY CELL ({x1-x0}x{y1-y0})')
                rejected.append(name)
                continue
            cell = rgb[y0:y1, x0:x1]
            rgba = key_frame(cell)
            alpha = rgba[:, :, 3]
            ys, xs = np.where(alpha > 8)
            if len(xs) == 0:
                report_lines.append(f"{name}: EMPTY")
                rejected.append(name)
                continue
            bx0, bx1 = int(xs.min()), int(xs.max()) + 1
            by0, by1 = int(ys.min()), int(ys.max()) + 1

            # tighten by 1 px to avoid grid-line residue
            pad = 1
            bx0 = max(0, bx0 + pad); by0 = max(0, by0 + pad)
            bx1 = min(rgba.shape[1], bx1 - pad); by1 = min(rgba.shape[0], by1 - pad)
            if x1 - x0 < 4 or y1 - y0 < 4:
                report_lines.append(f"{name}: EMPTY CELL")
                rejected.append(name)
                continue
            raw_alpha = alpha > 0
            touches = bool(raw_alpha[0, :].any() or raw_alpha[-1, :].any() or raw_alpha[:, 0].any() or raw_alpha[:, -1].any())
            crop = Image.fromarray(rgba[by0:by1, bx0:bx1], "RGBA")
            fw, fh = crop.size

            # leftover pink after keying
            arr = np.asarray(crop)
            left = int((magenta_mask(arr[:, :, :3], loose=True) & (arr[:, :, 3] > 0)).sum())

            # helmet width: widest opaque run in the top 32% of the sprite
            top = alpha[by0:by0 + max(2, int(fh * 0.32)), bx0:bx1] > 8
            helmet = 0
            for line in top:
                run = best = 0
                for v in line:
                    run = run + 1 if v else 0
                    best = max(best, run)
                helmet = max(helmet, best)

            out_path = os.path.join(OUT, name + ".png")
            crop.save(out_path)
            frames.append({
                "name": name, "file": f"assets/anim/img10/{name}.png",
                "w": fw, "h": fh, "footX": round(fw / 2, 1), "footY": fh,
                "helmetWidth": helmet, "sheet": "img10", "row": row_idx, "col": col_idx,
            })
            report_lines.append(f"{name:14s} {fw:3d}x{fh:<3d} helmet={helmet:2d} pink={left:<3d} edge={'YES' if touches else 'no'}")
            if left > 6 or touches:
                rejected.append(name)

    with open(os.path.join(OUT, "frames.json"), "w", encoding="utf-8") as f:
        json.dump({"sheet": "img10", "frameCount": len(frames), "frames": frames}, f, indent=1)

    write_contact(frames, report_lines)
    return frames, rejected


def write_contact(frames, report_lines):
    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except Exception:
        font = ImageFont.load_default()
    cw, ch = 150, 190
    cols = 6
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (cw * cols, ch * rows), (20, 22, 32))
    d = ImageDraw.Draw(sheet)
    for i, fr in enumerate(frames):
        path = os.path.join(ROOT, fr["file"])
        im = Image.open(path).convert("RGBA")
        im.thumbnail((cw - 16, ch - 60))
        x = (i % cols) * cw
        y = (i // cols) * ch
        # dark half / light half
        d.rectangle([x, y, x + cw, y + (ch - 40) // 2], fill=(18, 20, 34))
        d.rectangle([x, y + (ch - 40) // 2, x + cw, y + ch - 40], fill=(214, 218, 228))
        sheet.paste(im, (x + (cw - im.width) // 2, y + (ch - 40 - im.height) // 2), im)
        d.text((x + 4, y + ch - 36), fr["name"], fill=(255, 235, 120), font=font)
        d.text((x + 4, y + ch - 22), f'{fr["w"]}x{fr["h"]} H{fr["helmetWidth"]}', fill=(150, 160, 190), font=font)
    sheet.save(os.path.join(PROOF, "img10_contact.png"))
    report_lines.append("")
    report_lines.append(f"contact sheet: tools/out/img10_contact.png ({len(frames)} frames)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet", choices=["img10"])
    args = ap.parse_args()
    report = []
    frames, rejected = slice_img10(report)
    report.append("")
    report.append(f"frames: {len(frames)}   rejected: {len(rejected)}")
    if rejected:
        report.append("REJECT: " + ", ".join(sorted(set(rejected))))
    os.makedirs(PROOF, exist_ok=True)
    with open(os.path.join(PROOF, "img10_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main()
