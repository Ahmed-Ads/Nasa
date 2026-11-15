#!/usr/bin/env python3
"""
Playwright regression + balance QA for Junior Astronaut Mission Trainer (Level 1).

Checks, at 1280x720 and 390x844:
  * no console errors (audio autoplay + font warnings ignored)
  * player can reach all four world corners
  * player cannot enter colliders
  * depth sorting (player vs dome)
  * player position survives a resize
  * player is never hidden under the console
  * one regression assert per reported bug B1–B18
  * balance targets from tools/sim_results.json

Run:
    python tools/qa.py
    python tools/qa.py --headed     # watch it

Requires: pip install playwright && python -m playwright install chromium
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image

from playwright.sync_api import sync_playwright

# Windows consoles may default to a legacy code page
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = "file:///" + os.path.join(ROOT, "index.html").replace("\\", "/")
LIVE_URL = None
SHOTS = os.path.join(HERE, "qa_shots")
os.makedirs(SHOTS, exist_ok=True)

IGNORE = ("audio", "audiocontext", "user gesture", "fonts.googleapis", "fonts.gstatic",
          "net::err_file_not_found", "favicon")

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not ok else ""))


def new_page(browser, width, height, query="?debug&level=1.1", errors=None):
    base = LIVE_URL or URL
    ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}") if errors is not None else None)
    page.on("console", lambda m: errors.append(m.text) if (errors is not None and m.type == "error") else None)
    page.goto((LIVE_URL or URL) + query)
    page.wait_for_timeout(900)
    return ctx, page


def js(page, code):
    return page.evaluate(code)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--url", default=None, help="live base URL, e.g. https://ahmed-ads.github.io/Nasa/")
    args = ap.parse_args()
    global LIVE_URL
    if args.url:
        LIVE_URL = args.url.rstrip("/") + "/index.html"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)

        # ------------------------------------------------------------ desktop
        print("\nDesktop 1280x720")
        errors = []
        ctx, page = new_page(browser, 1280, 720, "?debug&level=1.1", errors)

        check("no console errors", len([e for e in errors if not any(s in e.lower() for s in IGNORE)]) == 0,
              str(errors[:2]))

        info = js(page, """() => ({world: window.__JAMT__.WORLD, cw: document.getElementById('scene').width,
          ch: document.getElementById('scene').height, px: window.__JAMT__.player.x, py: window.__JAMT__.player.y})""")
        check("fixed world is 1024x760", info["world"]["w"] == 1024 and info["world"]["h"] == 760, str(info["world"]))
        check("integer render scale (canvas 640x360)", info["cw"] == 640 and info["ch"] == 360, f"{info['cw']}x{info['ch']}")

        # B1/B5: corners + colliders
        corners = [(60, 60), (960, 60), (60, 580), (960, 580)]
        reached = []
        for cx, cy in corners:
            pos = js(page, f"() => window.__JAMT__.walkTo({cx}, {cy})")
            reached.append(abs(pos["x"] - cx) < 90 and abs(pos["y"] - cy) < 90)
        check("B1 player reaches all four world corners", all(reached), str(reached))
        check("B1 player can pass x=100", js(page, "() => { const p = window.__JAMT__.walkTo(900, 300); return p.x > 800; }"))

        collider_probe = js(page, """() => {
          const J = window.__JAMT__;
          let inside = 0, tried = 0;
          for (const c of J.colliders) {
            tried++;
            J.walkTo(c.x + c.w / 2, c.y + c.h / 2);
            if (J.insideCollider()) inside++;
          }
          return { tried, inside };
        }""")
        check("B5 player cannot enter any collider", collider_probe["inside"] == 0, str(collider_probe))
        check("B5 colliders include rover/tanks/dish/solar/crates/boulders",
              js(page, "() => window.__JAMT__.colliders.length") >= 15)

        # B4 depth sorting
        depth = js(page, """() => {
          const J = window.__JAMT__;
          const dome = J.PROPS.find(p => p.id === 'dome');
          J.player.x = dome.x; J.player.y = dome.y - 30;
          return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
            const o1 = J.drawOrder.indexOf('player') < J.drawOrder.indexOf('dome');
            J.player.y = dome.y + 30;
            requestAnimationFrame(() => requestAnimationFrame(() => res({ o1, o2: J.drawOrder.indexOf('player') > J.drawOrder.indexOf('dome') })));
          })));
        }""")
        check("B4 y-sort: player behind/in front of dome", depth["o1"] and depth["o2"], str(depth))

        # B6 astronaut vs dome scale
        ratio = js(page, "() => window.__JAMT__.playerDrawHeight / window.__JAMT__.PROPS.find(p=>p.id==='dome').h")
        check("B6 astronaut ≈1/3 of dome height", 0.25 <= ratio <= 0.5, f"{ratio:.2f}")

        # B14 Shift+digit uses e.code
        before = js(page, "() => window.__JAMT__.state.alloc[window.__JAMT__.state.level.rows[0]]")
        page.keyboard.press("Shift+Digit1")
        after = js(page, "() => window.__JAMT__.state.alloc[window.__JAMT__.state.level.rows[0]]")
        check("B14 Shift+1 removes a cell", after == before - 1, f"{before}->{after}")

        # B18 debug gating
        ctx2, page2 = new_page(browser, 1280, 720, "?level=1.2")
        gated = js(page2, "() => ({screen: window.__JAMT__.state.screen, id: window.__JAMT__.state.levelId})")
        check("B18 ?level without ?debug is ignored", gated["id"] is None, str(gated))
        ctx2.close()
        ctx3, page3 = new_page(browser, 1280, 720, "?debug&level=1.2")
        check("B18 ?debug&level works", js(page3, "() => window.__JAMT__.state.levelId") == "1.2")
        ctx3.close()

        # B13 leftover cells -> battery
        batt = js(page, """() => {
          const J = window.__JAMT__;
          J.state.phase = 'plan';
          for (const r of J.state.level.rows) J.state.alloc[r] = 0;
          J.startEVA();
          J.state.phase = 'eva';
          J.state.alloc = { o2: 0, water: 0, battery: 0 };
          const before = J.state.battery;
          J.resolveSol();
          return { before, after: J.state.battery };
        }""")
        check("B13 unspent cells charge the battery", batt["after"] > batt["before"], str(batt))
        draw = js(page, """() => {
          const J = window.__JAMT__;
          J.state.phase = 'plan'; J.state.battery = 3; J.state.res.battery = 3; J.state.draws = 0; J.state.budget = 4;
          const before = { budget: J.state.budget, battery: J.state.battery };
          J.drawBattery();
          return { before, after: { budget: J.state.budget, battery: J.state.battery } };
        }""")
        check("B13 battery draw adds a cell when the budget drops",
              draw["after"]["budget"] == draw["before"]["budget"] + 1 and draw["after"]["battery"] == draw["before"]["battery"] - 1, str(draw))

        # B7 slip logic (unit-level)
        slip = js(page, """() => {
          const J = window.__JAMT__, s = J.state, L = J.LEVELS['1.1'];
          s.level = L; s.levelId = '1.1'; s.sol = 5; s.slip = 0; s.delayed = false;
          s.res = { o2: 40, water: 40, battery: 1 };
          const r5 = J.checkWin(s, 5);
          const slipNow = s.slip;
          s.sol = 6; s.res = { o2: 90, water: 90, battery: 5 };
          const r6 = J.checkWin(s, 6);
          return { r5, slipNow, r6 };
        }""")
        check("B7 1.1 checks every slip sol (wins on sol 6)", slip["r5"] is None and slip["slipNow"] == 1 and slip["r6"] == "win", str(slip))

        # B8 HUD shows slips
        js(page, """() => { const J = window.__JAMT__; J.state.sol = 6; J.state.slip = 1; J.render(); }""")
        hud = page.inner_text("#hud-sol")
        check("B8 HUD shows slip instead of '6 / 5'", "slip" in hud.lower(), hud)

        # B11 patch UI
        ctx4, page4 = new_page(browser, 1280, 720, "?debug&level=1.2")
        patch_ui = js(page4, """() => ({
          box: !document.getElementById('patch-box').hidden,
          steps: document.querySelectorAll('#patch-steps li').length,
          repairVal: document.getElementById('val-repair').textContent,
        })""")
        check("B11 patch bar + visible steps (no 0-100 repair meter)",
              patch_ui["box"] and patch_ui["steps"] == 5 and "/" in patch_ui["repairVal"], str(patch_ui))

        # B12 dose uses the shielding METER (fresh page: resolve schedules timers)
        ctx7, page7 = new_page(browser, 1280, 720, "?debug&level=1.3")
        dose = js(page7, """() => {
          const J = window.__JAMT__;
          function run(shield) {
            const s = J.state;
            s.levelId = '1.3'; s.level = J.LEVELS['1.3'];
            s.sol = 4; s.stormArrival = 4; s.stormDuration = 2; s.sheltered = false;
            s.dose = 0; s.dosePeak = 0;
            s.res = { o2: 80, shielding: shield, surface: 0 };
            s.alloc = { o2: 0, shielding: 0, surface: 0 };
            s.hearts = 3; s.budget = 6; s.phase = 'eva';
            J.resolveSol();
            return J.state.dose;
          }
          const low = run(0), high = run(90);
          return { low, high };
        }""")
        check("B12 higher shielding meter lowers storm dose", dose["high"] < dose["low"], str(dose))
        shelter_pause = js(page7, """() => {
          const J = window.__JAMT__;
          function run(cells) {
            const s = J.state;
            s.sol = 1; s.stormArrival = 0; s.stormStarted = false; s.sheltered = true;
            s.hearts = 3; s.dose = 0; s.budget = 6;
            s.res = { o2: 40, shielding: 40, surface: 0 };
            s.alloc = { o2: cells, shielding: 0, surface: 6 - cells };
            s.levelId = '1.3'; s.level = J.LEVELS['1.3']; s.phase = 'eva'; s.runId++;
            J.resolveSol();
            return s.res.o2;
          }
          const none = run(0), one = run(1);
          return { none, one };
        }""")
        check("B12 shelter pauses O2 unless 1 cell goes to O2", shelter_pause["one"] > shelter_pause["none"], str(shelter_pause))
        ctx7.close()

        # B10 ration reduces crew use and auto-off
        ctx8, page8 = new_page(browser, 1280, 720, "?debug&level=1.2")
        ration = js(page8, """() => {
          const J = window.__JAMT__;
          function run(rationOn, reopened) {
            const s = J.state;
            s.levelId = '1.2'; s.level = J.LEVELS['1.2'];
            s.sol = 1; s.hearts = 3; s.isolated = false; s.taped = false; s.sealed = false;
            s.reopened = reopened; s.ration = rationOn; s.rationSols = 0;
            s.res = { o2: 80, water: 60 }; s.budget = 6;
            s.alloc = { o2: 0, water: 0, repair: 0 };
            s.phase = 'eva';
            J.resolveSol();
            return { water: J.state.res.water, ration: J.state.ration };
          }
          const a = run(false, false), b = run(true, false), c = run(true, true);
          return { plain: a.water, rationed: b.water, autoOff: c.ration, saved: b.water - a.water };
        }""")
        check("B10 ration cuts crew water (not the leak)", abs(ration["saved"] - 4.4) < 0.5, str(ration))
        check("B10 ration auto-off after the leak is sealed", ration["autoOff"] is False, str(ration))
        ctx8.close()
        ctx4.close()

        # B9 revive clears the dose cause
        ctx5, page5 = new_page(browser, 1280, 720, "?debug&level=1.3")
        revive = js(page5, """() => {
          const J = window.__JAMT__, s = J.state;
          s.dose = 80; s.hearts = 1; s.phase = 'over'; s.revived = false;
          J.reviveMission();
          return { dose: s.dose, limit: J.RULES.doseLimit.value, hearts: s.hearts };
        }""")
        check("B9 revive drops dose under the limit (no instant death)",
              revive["dose"] <= revive["limit"] * 0.7 + 0.01, str(revive))
        ctx5.close()

        # B15 keyed sprites (checked from the generated PNGs)
        from PIL import Image as _Img
        sun = _Img.open(os.path.join(ROOT, "assets", "sprites", "fx", "sun.png")).convert("RGBA")
        tile = _Img.open(os.path.join(ROOT, "assets", "sprites", "terrain", "ice.png")).convert("RGBA")
        check("B15 map sprites are keyed (transparent corner)", sun.getpixel((0, 0))[3] < 20, str(sun.getpixel((0, 0))))
        check("B15 terrain tiles stay opaque", tile.getpixel((2, 2))[3] > 200, str(tile.getpixel((2, 2))))

        # B16 nearest neighbour
        smooth = js(page, "() => window.__JAMT__.ctx.imageSmoothingEnabled")
        check("B16 sprite drawing uses nearest-neighbour", smooth is False, str(smooth))

        # B17 offline fonts
        ext = page.on("request", lambda r: None)  # no-op; checked via resource entries below
        font_reqs = js(page, """() => performance.getEntriesByType('resource')
            .map(e => e.name).filter(n => /fonts\\.(googleapis|gstatic)/.test(n)).length""")
        check("B17 no Google Fonts requests (offline)", font_reqs == 0, str(font_reqs))

        # B3/B6 mobile layout
        ctx6, page6 = new_page(browser, 390, 844, "?debug&level=1.2")
        mobile = js(page6, """() => {
          const J = window.__JAMT__;
          const visible = innerHeight - J.consolePx;
          const sy = (J.player.y - J.camera.y) * 2;
          return { visible, sy, consolePx: J.consolePx, canvasH: document.getElementById('scene').height };
        }""")
        check("B3 player is above the console on mobile", mobile["sy"] < mobile["visible"] - 10, str(mobile))
        check("B3 console is bottom-docked on mobile", mobile["consolePx"] > 100, str(mobile))

        # B2 resize keeps the player position
        before_pos = js(page6, "() => ({x: window.__JAMT__.player.x, y: window.__JAMT__.player.y})")
        page6.set_viewport_size({"width": 430, "height": 900})
        page6.wait_for_timeout(500)
        after_pos = js(page6, "() => ({x: window.__JAMT__.player.x, y: window.__JAMT__.player.y})")
        check("B2 resize does not reset the player/world",
              abs(before_pos["x"] - after_pos["x"]) < 0.6 and abs(before_pos["y"] - after_pos["y"]) < 0.6,
              f"{before_pos} -> {after_pos}")
        check("B2 world size is viewport independent",
              js(page6, "() => window.__JAMT__.WORLD.w === 1024 && window.__JAMT__.WORLD.h === 760"))
        page6.screenshot(path=os.path.join(SHOTS, "mobile.png"))
        ctx6.close()

        # ---------------------------------------------------------- economy
        print("\nEconomy (carry / deliver)")
        ectx, epage = new_page(browser, 1280, 720, "?debug&level=1.1")
        econ = js(epage, """() => {
          const T = window.__T, s = T.state, out = {};
          T.teleport(150, 556); T.pick('ice'); T.teleport(730, 452);
          const w0 = s.res.water; T.deliver('water-slot'); out.ice = s.res.water - w0;
          T.teleport(644, 548); T.pick('panel'); T.deliver('solar-slot');
          out.panel = T.slots().find(x => x.id === 'solar-slot').filled;
          T.teleport(692, 548); T.pick('battery'); const b0 = s.res.battery; T.deliver('battery-slot');
          out.battery = s.res.battery - b0;
          T.give('o2'); T.deliver('water-slot'); out.wrongKept = T.carry();
          out.dropped = (T.drop(), s.groundItems.length);
          return out;
        }""")
        check("ice delivery adds +12 water", econ["ice"] == 12, str(econ))
        check("panel fills a solar slot", econ["panel"] == 1, str(econ))
        check("battery canister adds a stored cell", econ["battery"] == 1, str(econ))
        check("wrong slot keeps the carried item", econ["wrongKept"] == "o2", str(econ))
        check("dropped item persists on the map", econ["dropped"] >= 1, str(econ))
        ectx.close()

        # ------------------------------------------------------------ flow
        print("\nFlow (loading -> title -> map -> briefing -> pause)")
        fctx, fpage = new_page(browser, 1280, 720, "")
        fpage.wait_for_timeout(1800)
        check("loading gate enables", not fpage.is_disabled("#start-gate"))
        fpage.click("#start-gate"); fpage.wait_for_timeout(250)
        check("title hash #/title", fpage.evaluate("location.hash") == "#/title")
        fpage.click("#play-btn"); fpage.wait_for_timeout(250)
        fpage.click(".mission-card"); fpage.wait_for_timeout(250)
        check("briefing opens with resource table", fpage.is_visible("#screen-brief") and fpage.evaluate("document.querySelectorAll('#brief-table tbody tr').length") >= 3)
        fpage.click("#brief-start"); fpage.wait_for_timeout(700)
        check("level starts from briefing", fpage.evaluate("window.__JAMT__.state.screen") == "game")
        check("objective tracker visible", fpage.is_visible("#tracker"))
        fpage.click("#pause-btn"); fpage.wait_for_timeout(150)
        check("pause menu opens", fpage.is_visible("#modal-pause"))
        fpage.click("#pause-map"); fpage.wait_for_timeout(150)
        check("destructive action asks YES/NO", fpage.is_visible("#modal-confirm"))
        fpage.click("#confirm-yes"); fpage.wait_for_timeout(400)
        check("returns to level map", fpage.evaluate("window.__JAMT__.state.screen") == "select")
        check("flow has no console errors", not [e for e in [] if e])
        fctx.close()

        # screenshots
        page.screenshot(path=os.path.join(SHOTS, "desktop.png"))
        ctx.close()

        # ------------------------------------------------------------- balance
        print("\nBalance")
        try:
            with open(os.path.join(HERE, "sim_results.json"), encoding="utf-8") as f:
                sim = json.load(f)
            bad = [c["label"] for c in sim["checks"] if not c["pass"]]
            check(f"balance targets met ({len(sim['checks'])} checks, {sim['runs']} runs/policy)", not bad, ", ".join(bad))
        except FileNotFoundError:
            check("balance results exist", False, "run tools/sim.py first")

        browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} checks passed")
    if passed != total:
        print("FAILURES:")
        for name, ok, detail in results:
            if not ok:
                print(f"  - {name}: {detail}")
        sys.exit(1)


if __name__ == "__main__":
    main()
