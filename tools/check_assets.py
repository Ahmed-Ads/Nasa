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
html = open(index, encoding="utf-8").read()
refs.update(re.findall(r'(?:src|href)="([^"#:]+)"', html))
refs.update(["assets/manifest.js", "game.js", "style.css", "index.html"])

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
