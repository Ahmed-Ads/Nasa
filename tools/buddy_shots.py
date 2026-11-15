#!/usr/bin/env python3
"""Generate review screenshots for the 8 Buddy states (EN/AR, desktop/phone).

Run after `python tools/slice_buddy.py`:
    python tools/buddy_shots.py
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "file:///" + str(ROOT / "index.html").replace("\\", "/")
OUT = ROOT / "tools" / "out" / "buddy"
STATES = ("idle", "listen", "think", "talk", "happy", "alert", "confused", "sleep")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width, height, touch in ((1280, 720, False), (390, 844, True)):
            ctx = browser.new_context(viewport={"width": width, "height": height},
                                      has_touch=touch, is_mobile=touch)
            page = ctx.new_page()
            page.goto(URL + "?debug&level=1.3")
            page.wait_for_timeout(900)
            page.evaluate("() => window.JuniorBuddy.open()")
            for lang in ("en", "ar"):
                page.evaluate("(l) => window.JuniorBuddy.setLanguage(l)", lang)
                page.wait_for_timeout(200)
                for state in STATES:
                    page.evaluate("(s) => window.JuniorBuddy.debugLockState(s)", state)
                    page.wait_for_timeout(120)
                    path = OUT / f"buddy_{lang}_{width}x{height}_{state}.png"
                    page.screenshot(path=str(path))
                    print(path.relative_to(ROOT))
                page.evaluate("() => window.JuniorBuddy.debugUnlockState()")
            ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
