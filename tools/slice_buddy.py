"""Slice the 8 Buddy icons out of assets/ui/assistant_sheet.jpg.

The source is a 4x2 sheet of circular badges on a magenta key background.
Each badge is cropped to a square, circle-masked with a small inset so the
magenta key never survives at the rim, and written as a transparent 512px PNG.

Run from the repository root:
    python tools/slice_buddy.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "ui" / "assistant_sheet.jpg"
OUT_DIR = ROOT / "assets" / "ui" / "buddy"
STATES = ("idle", "listen", "think", "talk", "happy", "alert", "confused", "sleep")

# Detected from the sheet: four columns and two rows of badges. The label
# strip below each row is outside these boxes.
COL_X = ((23, 670), (710, 1357), (1395, 2042), (2081, 2728))
ROW_Y = ((17, 664), (785, 1438))
OUT_SIZE = 512


def near_magenta(r: int, g: int, b: int) -> bool:
    # JPEG edges around the key colour are not perfectly (255, 0, 255).
    return r > 150 and b > 130 and g < 110 and r > g + 70 and b > g + 60


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source: {SOURCE}")
    src = Image.open(SOURCE).convert("RGBA")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    made = []
    for index, state in enumerate(STATES):
        col, row = index % 4, index // 4
        x0, x1 = COL_X[col]
        y0, y1 = ROW_Y[row]
        side = min(x1 - x0, y1 - y0)
        # centre the square crop on the badge
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
        crop = src.crop(box)

        # Work at source resolution first: key out magenta, then apply a
        # gently antialiased circular alpha mask inset by 5 px.
        px = crop.load()
        for y in range(crop.height):
            for x in range(crop.width):
                r, g, b, a = px[x, y]
                if near_magenta(r, g, b):
                    px[x, y] = (r, g, b, 0)

        mask = Image.new("L", crop.size, 0)
        draw = ImageDraw.Draw(mask)
        inset = 5
        draw.ellipse((inset, inset, crop.width - inset - 1, crop.height - inset - 1), fill=255)
        crop.putalpha(mask)
        out = crop.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)
        # Resampling can resurrect a single magenta-tinted pixel at the rim.
        op = out.load()
        for y in range(out.height):
            for x in range(out.width):
                r, g, b, a = op[x, y]
                if a and near_magenta(r, g, b):
                    op[x, y] = (r, g, b, 0)
        path = OUT_DIR / f"{state}.png"
        out.save(path, "PNG", optimize=True)
        made.append((state, path.stat().st_size))

    # A contact sheet is useful when reviewing the mask, but not shipped.
    proof = Image.new("RGBA", (OUT_SIZE * 4, OUT_SIZE * 2), (18, 22, 38, 255))
    for index, state in enumerate(STATES):
        icon = Image.open(OUT_DIR / f"{state}.png")
        proof.alpha_composite(icon, ((index % 4) * OUT_SIZE, (index // 4) * OUT_SIZE))
    proof_dir = ROOT / "tools" / "out"
    proof_dir.mkdir(parents=True, exist_ok=True)
    proof.save(proof_dir / "buddy_states.png", "PNG", optimize=True)
    print(f"sliced {len(made)} buddy states -> {OUT_DIR}")
    for state, size in made:
        print(f"  {state:8s} {size:,} bytes")


if __name__ == "__main__":
    main()
