#!/usr/bin/env python3
"""Verify every local asset referenced by the build exists with exact case.

GitHub Pages is case-sensitive while Windows file:// is not, so this walks the
real directory entries and compares names exactly. Exits non-zero on a miss.
"""
from __future__ import annotations
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
manifest = os.path.join(ROOT, "assets", "manifest.js")
index = os.path.join(ROOT, "index.html")

refs = set()
text = open(manifest, encoding="utf-8").read()
refs.update(re.findall(r'"src"\s*:\s*"([^"]+)"', text))
anim = os.path.join(ROOT, "assets", "anim_manifest.js")
if os.path.exists(anim):
    atext = open(anim, encoding="utf-8").read()
    refs.update(re.findall(r'"(assets/anim/[^"]+\.png)"', atext))
    refs.add("assets/anim_manifest.js")
html = open(index, encoding="utf-8").read()
refs.update(re.findall(r'(?:src|href)="([^"#:]+)"', html))
refs.update(["assets/manifest.js", "assets/anim_manifest.js", "game.js", "style.css", "index.html"])

# Buddy states are referenced from game.js as assets/ui/buddy/<state>.png and
# registered in the manifest. Keep the exact eight names checked here too.
BUDDY_STATES = ("idle", "listen", "think", "talk", "happy", "alert", "confused", "sleep")
for state in BUDDY_STATES:
    refs.add(f"assets/ui/buddy/{state}.png")
    if f'"buddy/{state}"' not in text:
        print(f"manifest missing buddy/{state}")
        sys.exit(1)

# Sliced ice outcrops; the source JPG is intentionally uncommitted.
ICE_SPRITES = ("deposit", "chunk")
for name in ICE_SPRITES:
    refs.add(f"assets/ice/{name}.png")
    if f'"ice/{name}"' not in text:
        print(f"manifest missing ice/{name}")
        sys.exit(1)
ROVER_SPRITES = ("ride",)
for name in ROVER_SPRITES:
    refs.add(f"assets/rover/{name}.png")
    if f'"rover/{name}"' not in text:
        print(f"manifest missing rover/{name}")
        sys.exit(1)
LOADING_SPRITES = ("astronaut", "planet_orange", "planet_blue", "planet_ring", "planet_bottom",
                   "satellite_top", "satellite_left", "asteroid_right", "asteroid_left")
for name in LOADING_SPRITES:
    refs.add(f"assets/loading/{name}.png")
    if f'"loading/{name}"' not in text:
        print(f"manifest missing loading/{name}")
        sys.exit(1)
ICON_FILES = ("favicon.svg", "favicon.ico", "favicon-16.png", "favicon-32.png", "favicon-48.png",
              "favicon-180.png", "favicon-192.png", "favicon-512.png")
for name in ICON_FILES:
    refs.add(f"assets/icons/{name}")
for size in (16, 32, 48, 180, 192, 512):
    if f'"icons/favicon_{size}"' not in text:
        print(f"manifest missing icons/favicon_{size}")
        sys.exit(1)

missing = []
for ref in sorted(refs):
    ref = ref.split("?")[0]
    if ref.startswith("data:") or ref.startswith("http"):
        continue
    path = os.path.join(ROOT, ref.replace("/", os.sep))
    # exact-case check component by component
    cur = ROOT
    ok = True
    for part in ref.split("/"):
        try:
            entries = os.listdir(cur)
        except OSError:
            ok = False
            break
        if part not in entries:
            ok = False
            break
        cur = os.path.join(cur, part)
    if not ok or not os.path.isfile(path):
        missing.append(ref)

print(f"checked {len(refs)} references")
if missing:
    print("MISSING / WRONG CASE:")
    for m in missing:
        print("  ", m)
    sys.exit(1)
print("all asset paths exist with exact case")
