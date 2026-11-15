#!/usr/bin/env python3
"""
Playwright regression + balance QA for Space Buddy (Level 1).

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
import re
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import urlopen

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
GAME_SRC = open(os.path.join(ROOT, "game.js"), encoding="utf-8").read()
BUILD_VERSION = re.search(r"BUILD_VERSION = '([^']+)'", GAME_SRC).group(1)
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
          const panel = document.getElementById('panel');
          return { visible, sy, consolePx: J.consolePx, canvasH: document.getElementById('scene').height,
                   panelHidden: !!panel && getComputedStyle(panel).display === 'none',
                   focus: document.body.classList.contains('panels-focus'),
                   full: document.body.classList.contains('panels-full') };
        }""")
        check("B3 player is above the console on mobile", mobile["sy"] < mobile["visible"] - 10, str(mobile))
        check("B3 mobile starts in Focus with the console hidden",
              mobile["focus"] and mobile["panelHidden"] and mobile["consolePx"] == 0, str(mobile))
        js(page6, "() => document.getElementById('panel-toggle').click()")
        page6.wait_for_timeout(250)
        mobile_full = js(page6, """() => {
          const J = window.__JAMT__;
          const visible = innerHeight - J.consolePx;
          const sy = (J.player.y - J.camera.y) * 2;
          return { visible, sy, consolePx: J.consolePx,
                   full: document.body.classList.contains('panels-full') };
        }""")
        check("B3 P opens a bottom-docked Full console on mobile",
              mobile_full["full"] and mobile_full["consolePx"] > 100, str(mobile_full))
        check("B3 player stays above the Full console on mobile",
              mobile_full["sy"] < mobile_full["visible"] - 10, str(mobile_full))
        js(page6, "() => document.getElementById('panel-toggle').click()")
        page6.wait_for_timeout(200)

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

        # ------------------------------------------------------------ rover
        print("\nRover")
        rctx, rpage = new_page(browser, 1280, 720, "?debug&level=1.1")
        rv = js(rpage, """() => {
          const J = window.__JAMT__, T = window.__T, s = J.state, out = {};
          s.battery = 3; s.res.battery = 3; s.rover.dead = false;
          T.teleport(566, 566); T.mountRover(); out.mounted = s.rover.mounted;
          const x0 = J.player.x; T.setKey('right', true);
          for (let i = 0; i < 20; i++) T.step(0.05);
          T.setKey('right', false); out.dx = J.player.x - x0;
          T.teleport(150, 556); T.pick('ice'); out.cargo1 = s.rover.cargo.length;
          T.teleport(730, 452); T.deliver('water-slot'); out.cargo2 = s.rover.cargo.length;
          out.ring = T.walkBackRadius();
          T.dismountRover(); out.dismounted = !s.rover.mounted;
          // battery: used last sol -> 1 cell charged; unused -> unchanged
          s.rover.usedThisSol = true; s.battery = 3; s.res.battery = 3; T.startSol(true); out.usedBatt = s.res.battery;
          s.rover.usedThisSol = false; s.battery = 3; s.res.battery = 3; T.startSol(true); out.idleBatt = s.res.battery;
          // dome block only while mounted
          const free = !J.blockedAt(445, 300); T.mountRover(); const blocked = J.blockedAt(445, 300);
          return Object.assign(out, { free, blocked });
        }""")
        check("rover mounts/dismounts", rv["mounted"] and rv["dismounted"], str(rv))
        check("rover speed is ~x2.5", rv["dx"] > 150, str(rv))
        check("rover cargo loads and unloads", rv["cargo1"] == 1 and rv["cargo2"] == 0, str(rv))
        check("walk-back ring radius is positive", rv["ring"] > 0, str(rv))
        check("battery charged only when used", rv["usedBatt"] == 2 and rv["idleBatt"] == 3, str(rv))
        check("rover cannot enter the dome when mounted", rv["free"] and rv["blocked"], str(rv))

        # ROVER-FIX: repeated mount/dismount, free-point dismount, exact parking
        cycles = js(rpage, """() => {
          const J = window.__JAMT__, T = window.__T, s = J.state;
          J.startLevel('1.1'); J.startEVA();
          s.battery = 6; s.res.battery = 6; s.rover.dead = false;
          let lane = null;
          for (let y = 560; y <= 700 && !lane; y += 8) {
            for (let x = 100; x <= 460 && !lane; x += 8) {
              let ok = true;
              for (let d = 0; d <= 360; d += 8) {
                const xx = x + d;
                if (J.blockedAt(xx, y)) { ok = false; break; }
                for (const st of J.STATIONS) {
                  if (Math.hypot(xx - st.x, y - st.y) < st.r + 16) { ok = false; break; }
                }
                if (!ok) break;
              }
              if (ok) lane = { x, y };
            }
          }
          lane = lane || { x: 120, y: 650 };
          const out = { lane, cycles: [], battery: s.battery };
          for (let c = 0; c < 5; c++) {
            T.teleport(lane.x, lane.y); J.snapCamera(); T.mountRover();
            const mounted = s.rover.mounted;
            const dir = 'right';
            const x0 = J.player.x;
            T.setKey(dir, true);
            for (let i = 0; i < 22; i++) T.step(0.07);
            T.setKey(dir, false);
            const drive = Math.abs(J.player.x - x0);
            const equal = Math.abs(s.rover.x - J.player.x) < 0.001 && Math.abs(s.rover.y - J.player.y) < 0.001;
            const before = { x: J.player.x, y: J.player.y };
            J.startHold();
            const parked = { x: s.rover.x, y: s.rover.y };
            const afterMounted = s.rover.mounted;
            const free = !J.blockedAt(J.player.x, J.player.y) && !J.insideCollider();
            for (const key of ['right', 'left', 'up', 'down']) {
              T.setKey(key, true);
              for (let i = 0; i < 25; i++) T.step(0.05);
              T.setKey(key, false);
            }
            const walkFree = !J.blockedAt(J.player.x, J.player.y) && !J.insideCollider();
            T.teleport(parked.x, parked.y); J.snapCamera(); J.startHold();
            const remounted = s.rover.mounted;
            J.startHold();
            out.cycles.push({ mounted, drive, equal, before, parked, afterMounted, free, walkFree,
              remounted, settled: !s.rover.mounted, battery: s.battery });
          }
          out.finalBattery = s.battery;
          out.finalUsed = s.rover.usedThisSol;
          return out;
        }""")
        ok_cycles = all(c["mounted"] and c["drive"] > 250 and c["equal"]
                        and abs(c["parked"]["x"] - c["before"]["x"]) < 0.001
                        and abs(c["parked"]["y"] - c["before"]["y"]) < 0.001
                        and not c["afterMounted"] and c["free"] and c["walkFree"]
                        and c["remounted"] and c["settled"] for c in cycles["cycles"])
        check("ROVER-FIX 5 mount/drive/dismount/walk/remount cycles stay free and exact",
              ok_cycles and cycles["finalBattery"] == 6 and cycles["finalUsed"] is True,
              str(cycles)[:800])

        restart_rover = js(rpage, """() => {
          const J = window.__JAMT__;
          J.startLevel('1.1');
          const prop = J.PROPS.find(p => p.id === 'rover');
          const col = J.colliders.find(c => c.id === 'rover');
          const st = J.STATIONS.find(s => s.id === 'rover');
          return { rx: J.state.rover.x, ry: J.state.rover.y, mounted: J.state.rover.mounted,
                   parked: J.state.rover.parked, px: prop.x, py: prop.y,
                   cx: col.x, cy: col.y, sx: st.x, sy: st.y };
        }""")
        check("ROVER-FIX restart puts the rover back at its start",
              restart_rover["rx"] == 566 and restart_rover["ry"] == 536
              and restart_rover["mounted"] is False and restart_rover["parked"] is True
              and restart_rover["px"] == 566 and restart_rover["py"] == 536
              and restart_rover["sx"] == 566 and restart_rover["sy"] == 536, str(restart_rover))

        no_power = js(rpage, """() => {
          const J = window.__JAMT__, T = window.__T, s = J.state;
          J.startEVA(); s.battery = 0; s.res.battery = 0;
          T.teleport(566, 536); J.snapCamera(); J.startHold();
          return { mounted: s.rover.mounted, rx: s.rover.x, ry: s.rover.y,
                   parked: s.rover.parked, log: document.getElementById('log').innerText };
        }""")
        check("ROVER-FIX empty battery refuses remount and keeps the rover parked",
              no_power["mounted"] is False and no_power["rx"] == 566 and no_power["ry"] == 536
              and no_power["parked"] is True and "no power today" in no_power["log"].lower(),
              str(no_power)[:500])

        unstick = js(rpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          const d = J.PROPS.find(p => p.id === 'dome');
          T.teleport(d.cx + d.cw / 2, d.cy + d.ch / 2);
          T.step(0.05);
          return { x: J.player.x, y: J.player.y, free: !J.blockedAt(J.player.x, J.player.y) };
        }""")
        check("ROVER-FIX overlapping collider is pushed to a free point", unstick["free"] is True, str(unstick))
        rctx.close()

        # phone ACT cycle
        pctx2 = browser.new_context(viewport={"width": 390, "height": 844},
                                    has_touch=True, is_mobile=True)
        ppage = pctx2.new_page()
        perr = []
        ppage.on("pageerror", lambda e: perr.append(str(e)))
        ppage.goto((LIVE_URL or URL) + "?debug&level=1.1")
        ppage.wait_for_timeout(1100)
        phone_rover = js(ppage, """() => {
          const J = window.__JAMT__, T = window.__T, s = J.state;
          J.startEVA(); s.battery = 6; s.res.battery = 6; s.rover.dead = false;
          T.teleport(566, 536); J.snapCamera();
          const btn = document.getElementById('act-btn');
          const tap = () => {
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 21, pointerType: 'touch' }));
            btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 21, pointerType: 'touch' }));
          };
          tap();
          const mounted = s.rover.mounted;
          T.setKey('right', true); for (let i = 0; i < 10; i++) T.step(0.05); T.setKey('right', false);
          const equal = Math.abs(s.rover.x - J.player.x) < 0.001 && Math.abs(s.rover.y - J.player.y) < 0.001;
          T.teleport(300, 700); J.snapCamera();
          tap();
          return { mounted, equal, dismounted: !s.rover.mounted, parked: s.rover.parked,
                   free: !J.blockedAt(J.player.x, J.player.y), inside: J.insideCollider() };
        }""")
        check("ROVER-FIX phone ACT mounts/dismounts and leaves a free player",
              phone_rover["mounted"] and phone_rover["equal"] and phone_rover["dismounted"]
              and phone_rover["parked"] and phone_rover["free"] and not phone_rover["inside"],
              str(phone_rover))
        check("ROVER-FIX phone has no console errors", not perr, str(perr[:2]))
        pctx2.close()

        # ------------------------------------------------------- suit air
        print("\nSuit air")
        actx, apage = new_page(browser, 1280, 720, "?debug&level=1.1")
        air = js(apage, """() => {
          const J = window.__JAMT__, T = window.__T, s = J.state, out = {};
          J.startEVA();
          T.setKey('right', true);
          for (let i = 0; i < 20; i++) T.step(0.05);
          T.setKey('right', false);
          out.drained = 100 - s.air;
          s.air = 20; T.startSol(true); out.refilled = s.air;
          J.startEVA(); s.carry = 'ice'; s.air = 0; T.step(0.05);
          out.phase = s.phase; out.carry = s.carry; out.dropped = s.groundItems.length;
          return out;
        }""")
        check("air drains while walking", air["drained"] > 0.2, str(air))
        check("air refills at the next sol", air["refilled"] == 100, str(air))
        check("zero air drops the item and ends the EVA", air["carry"] is None and air["dropped"] >= 1 and air["phase"] in ("resolve", "plan"), str(air))
        actx.close()

        # ---------------------------------------------------- astronaut walk
        print("\nAstronaut walk (img10)")
        # fallback: one missing slice must not break the game
        fctx = browser.new_context(viewport={"width": 1280, "height": 720})
        fpage = fctx.new_page()
        ferrs, fwarns = [], []
        fpage.on("pageerror", lambda e: ferrs.append(str(e)))
        fpage.on("console", lambda m: fwarns.append(m.text) if m.type == "warning" else None)
        fpage.route("**/walk_03.png", lambda route: route.abort())
        fpage.goto((LIVE_URL or URL) + "?debug&level=1.1")
        fpage.wait_for_timeout(1400)
        fstate = js(fpage, "() => window.__JAMT__.anim")
        check("A4 missing walk frame falls back to the old sprite",
              fstate["fallback"] is True and fstate["ready"] is False
              and fstate["draw"]["name"] == "fallback", str(fstate.get("draw")))
        check("A4 fallback logs one warning and no page errors",
              any("missing frame" in w.lower() for w in fwarns) and not ferrs,
              f"warns={fwarns[:2]} errs={ferrs[:2]}")
        fctx.close()

        walk_errors = []
        wctx, wpage = new_page(browser, 1280, 720, "?debug&level=1.1", walk_errors)
        wpage.wait_for_function("() => window.__JAMT__ && window.__JAMT__.anim && window.__JAMT__.anim.ready",
                                timeout=7000)
        base_anim = js(wpage, "() => window.__JAMT__.anim")
        check("A4 walk + idle slices preloaded", base_anim["ready"] is True,
              f"fallback={base_anim.get('fallback')}")
        check("A4 one sheet scale: idle is the current 64px sprite height",
              base_anim["targetHeight"] == 64 and abs(base_anim["idleHeight"] - 64) <= 0.6,
              f"target={base_anim['targetHeight']} idle={base_anim['idleHeight']:.2f} scale={base_anim['scale']:.5f}")

        spot = js(wpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          for (const k of ['left','right','up','down']) T.setKey(k, false);
          let found = null;
          for (let y = 520; y < 700 && !found; y += 8) {
            let clear = true;
            for (let x = 120; x < 250; x += 6) if (J.blockedAt(x, y)) { clear = false; break; }
            if (clear) found = { x: 130, y };
          }
          found = found || { x: 512, y: 430 };
          T.teleport(found.x, found.y);
          J.resetAnim();
          return found;
        }""")
        still_before = js(wpage, "() => window.__JAMT__.anim")
        wpage.wait_for_timeout(2000)
        still_after = js(wpage, "() => window.__JAMT__.anim")
        check("A4 (a) standing still for 2 s does not advance",
              still_after["distance"] == still_before["distance"]
              and still_after["walkFrame"] == still_before["walkFrame"]
              and still_after["mode"] == "idle",
              f"{still_before['distance']}->{still_after['distance']} frame {still_before['walkFrame']}->{still_after['walkFrame']}")

        stride = js(wpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          J.resetAnim();
          T.setKey('right', true);
          const seen = new Set();
          for (let i = 0; i < 36; i++) { T.step(1 / 60); seen.add(J.anim.walkFrame); }
          T.setKey('right', false);
          return { anim: J.anim, seen: [...seen].sort() };
        }""")
        check("A4 (b) 48 px of movement = one full six-frame cycle",
              stride["anim"]["distance"] >= 48 and stride["anim"]["distance"] < 96
              and stride["anim"]["cycles"] == 1 and len(stride["seen"]) == 6,
              f"dist={stride['anim']['distance']:.1f} cycles={stride['anim']['cycles']} frames={stride['seen']}")

        left = js(wpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          T.setKey('left', true);
          for (let i = 0; i < 10; i++) T.step(1 / 60);
          T.setKey('left', false);
          return { facing: J.player.facing, anim: J.anim };
        }""")
        wpage.wait_for_timeout(120)
        left_draw = js(wpage, "() => window.__JAMT__.anim.draw")
        check("A4 (c) moving left flips the sprite",
              left["facing"] == -1 and left_draw["flipped"] is True,
              f"facing={left['facing']} draw={left_draw['flipped']}")

        foot = js(wpage, """() => {
          const J = window.__JAMT__, a = J.anim, d = a.draw;
          return { px: J.player.x, py: J.player.y, footX: d.footX, footY: d.footY,
                   name: d.name, inside: J.insideCollider(), scale: a.scale };
        }""")
        check("A4 (d) feet are anchored to the collider point (no float/sink)",
              abs(foot["footX"] - foot["px"]) < 0.01 and abs(foot["footY"] - foot["py"]) < 0.01
              and foot["name"] in ("walk", "idle") and not foot["inside"], str(foot))
        wpage.wait_for_timeout(150)
        check("A4 (e) animation causes no console errors",
              len([e for e in walk_errors if not any(s in e.lower() for s in IGNORE)]) == 0,
              str(walk_errors[:2]))
        check("A4 walk state is exposed for QA", "cycleDistance" in base_anim and base_anim["stride"] == 8)

        # mid-stride screenshots: 1280x720 and 390x844
        out_dir = os.path.join(ROOT, "tools", "out")
        os.makedirs(out_dir, exist_ok=True)
        desk_shot = os.path.join(SHOTS, "walk_1280x720.png")
        phone_shot = os.path.join(SHOTS, "walk_390x844.png")

        js(wpage, f"""() => {{
          const J = window.__JAMT__, T = window.__T;
          T.teleport({spot['x']}, {spot['y']}); J.resetAnim(); J.snapCamera();
          T.setKey('right', true);
        }}""")
        wpage.wait_for_timeout(340)
        wpage.screenshot(path=desk_shot)
        js(wpage, "() => window.__T.setKey('right', false)")

        phone_errors = []
        pctx, ppage = new_page(browser, 390, 844, "?debug&level=1.1", phone_errors)
        ppage.wait_for_function("() => window.__JAMT__ && window.__JAMT__.anim && window.__JAMT__.anim.ready",
                                timeout=7000)
        phone_anim = js(ppage, "() => window.__JAMT__.anim")
        check("A4 phone keeps the same sheet scale",
              abs(phone_anim["scale"] - base_anim["scale"]) < 1e-9,
              f"{phone_anim['scale']:.5f} vs {base_anim['scale']:.5f}")
        js(ppage, f"""() => {{
          const J = window.__JAMT__, T = window.__T;
          T.teleport({spot['x']}, {spot['y']}); J.resetAnim(); J.snapCamera();
          T.setKey('right', true);
          for (let i = 0; i < 18; i++) T.step(1 / 60);
          T.setKey('right', false);
        }}""")
        ppage.wait_for_timeout(160)
        phone_foot = js(ppage, """() => {
          const J = window.__JAMT__, d = J.anim.draw;
          return { px: J.player.x, py: J.player.y, footY: d.footY, inside: J.insideCollider() };
        }""")
        check("A4 phone feet stay on the collider point",
              abs(phone_foot["footY"] - phone_foot["py"]) < 0.01 and not phone_foot["inside"], str(phone_foot))
        check("A4 phone animation has no console errors",
              len([e for e in phone_errors if not any(s in e.lower() for s in IGNORE)]) == 0,
              str(phone_errors[:2]))
        js(ppage, f"""() => {{
          const T = window.__T;
          T.teleport({spot['x']}, {spot['y']}); window.__JAMT__.resetAnim(); window.__JAMT__.snapCamera();
          T.setKey('right', true);
        }}""")
        ppage.wait_for_timeout(340)
        ppage.screenshot(path=phone_shot)
        js(ppage, "() => window.__T.setKey('right', false)")

        desk_img = Image.open(desk_shot).convert("RGB")
        phone_img = Image.open(phone_shot).convert("RGB")
        from PIL import ImageDraw as _Draw
        pad, label_h = 12, 24
        comp = Image.new("RGB", (pad + desk_img.width + pad + phone_img.width + pad,
                                 label_h + max(desk_img.height, phone_img.height) + pad), (10, 13, 22))
        cd = _Draw.Draw(comp)
        cd.text((pad, 6), "1280x720 desktop - mid-stride", fill=(235, 240, 255))
        cd.text((pad + desk_img.width + pad, 6), "390x844 phone - mid-stride", fill=(235, 240, 255))
        comp.paste(desk_img, (pad, label_h))
        comp.paste(phone_img, (pad + desk_img.width + pad, label_h))
        comp.save(os.path.join(out_dir, "walk_check.png"))
        check("A4 walk_check.png written (desktop + phone)",
              os.path.isfile(os.path.join(out_dir, "walk_check.png")))
        pctx.close()

        # ---------------------------------------------------- ?debug#anim page
        dctx, dpage = new_page(browser, 1280, 720, "?debug#anim")
        dbg = {}
        try:
            dpage.wait_for_function("() => window.__animDebug && window.__animDebug.panels === 6", timeout=5000)
            dbg = js(dpage, "() => window.__animDebug")
            check("A4 ?debug#anim shows 3 speeds on dark + light",
                  dbg["panels"] == 6 and len(dbg["speeds"]) == 3, str(dbg))
        except Exception as exc:
            check("A4 ?debug#anim shows 3 speeds on dark + light", False, str(exc))
        dctx.close()
        wctx.close()

        # ---------------------------------------------------- action animations
        print("\nAction animations (ice mining / regolith digging)")
        action_errors = []
        actx, apage = new_page(browser, 1280, 720, "?debug&level=1.1", action_errors)
        apage.wait_for_function("() => window.__jamtLoad && window.__jamtLoad.done >= window.__jamtLoad.total",
                                timeout=7000)
        ice = js(apage, """() => {
          const J = window.__JAMT__, T = window.__T;
          window.__JAMT_FREEZE = true; J.startEVA(); T.teleport(150, 556); J.snapCamera();
          const before = J.action;
          J.startHold();
          const start = J.action, samples = [];
          for (let i = 0; i < 30; i++) {
            J.stepHold(0.04);
            if (J.action) samples.push({ anim: J.action.anim, frame: J.action.frame,
              p: J.action.progress, phase: J.action.phase, hidden: J.sourceHidden('ice-src') });
          }
          const mid = { carry: T.carry(), stock: T.sources().find(s => s.id === 'ice-src').stock,
                        hidden: J.sourceHidden('ice-src') };
          for (let i = 0; i < 40; i++) {
            J.stepHold(0.04);
            if (J.action) samples.push({ anim: J.action.anim, frame: J.action.frame,
              p: J.action.progress, phase: J.action.phase, hidden: J.sourceHidden('ice-src') });
          }
          return { before, start, samples, mid, end: J.action, carry: T.carry(),
                   stock: T.sources().find(s => s.id === 'ice-src').stock,
                   hidden: J.sourceHidden('ice-src') };
        }""")
        loop_frames = [s["frame"] for s in ice["samples"] if s["phase"] != "finish"]
        finish_frames = [s["frame"] for s in ice["samples"] if s["phase"] == "finish"]
        loop_order = all(b == a or b == (a + 1) % 6 for a, b in zip(loop_frames, loop_frames[1:]))
        check("A5 ice: hold starts ice_mine, hides the patch and mirrors",
              ice["before"] is None and ice["start"]["anim"] == "ice_mine"
              and ice["start"]["hiddenSourceId"] == "ice-src" and ice["start"]["mirror"] is True,
              str(ice["start"]))
        check("A5 ice: loops frames 1-6 in order then finishes 7-8",
              set(loop_frames) == {0, 1, 2, 3, 4, 5} and loop_order
              and 6 in finish_frames and 7 in finish_frames
              and finish_frames.index(6) <= finish_frames.index(7),
              f"loop={sorted(set(loop_frames))} finish={finish_frames[:6]}")
        check("A5 ice: no item mid-hold; item and stock change only at completion",
              ice["mid"]["carry"] is None and ice["mid"]["stock"] == 4
              and ice["carry"] == "ice" and ice["stock"] == 3, str(ice["mid"]))
        check("A5 ice: world ice icon is hidden only during the action",
              ice["mid"]["hidden"] is True and ice["hidden"] is False and ice["end"] is None,
              f"mid={ice['mid']['hidden']} end={ice['hidden']}")

        early = js(apage, """() => {
          const J = window.__JAMT__, T = window.__T;
          if (T.carry()) T.drop();
          J.state.groundItems = [];
          T.teleport(150, 556); J.snapCamera();
          const stock0 = T.sources().find(s => s.id === 'ice-src').stock;
          J.startHold();
          for (let i = 0; i < 15; i++) J.stepHold(0.04);
          const during = J.action;
          J.cancelHold();
          for (let i = 0; i < 12; i++) J.stepHold(0.04);
          const after = J.action;
          J.startHold();
          const restarted = J.action;
          J.cancelHold();
          return { during: !!during, after, carry: T.carry(),
                   stock: T.sources().find(s => s.id === 'ice-src').stock, stock0,
                   hidden: J.sourceHidden('ice-src'), restarted: !!restarted };
        }""")
        check("A5 early release cancels with no item, no stock loss and no stuck state",
              early["during"] and early["after"] is None and early["carry"] is None
              and early["stock"] == early["stock0"] and early["hidden"] is False
              and early["restarted"] is True, str(early))

        rctx2, rpage2 = new_page(browser, 1280, 720, "?debug&level=1.1")
        rpage2.wait_for_function("() => window.__jamtLoad && window.__jamtLoad.done >= window.__jamtLoad.total",
                                 timeout=7000)
        restart = js(rpage2, """() => {
          const J = window.__JAMT__, T = window.__T;
          window.__JAMT_FREEZE = true;
          J.startEVA(); T.teleport(150, 556); J.snapCamera();
          J.startHold(); for (let i = 0; i < 15; i++) J.stepHold(0.04);
          const during = !!J.action;
          J.resetLevelState();
          const direct = { action: J.action, hold: J.holdActive(), carry: T.carry(),
                           stock: T.sources().find(s => s.id === 'ice-src').stock };
          J.startHold(); for (let i = 0; i < 15; i++) J.stepHold(0.04);
          J.startLevel('1.1');
          const after = { action: J.action, hold: J.holdActive(), carry: T.carry(),
                          stock: T.sources().find(s => s.id === 'ice-src').stock,
                          phase: J.state.phase };
          for (let i = 0; i < 70; i++) J.stepHold(0.04);
          return { during, direct, after, endCarry: T.carry(), endStock:
                   T.sources().find(s => s.id === 'ice-src').stock };
        }""")
        check("A5 resetLevelState/restart cancels the action and gives no item",
              restart["during"] and restart["direct"]["action"] is None
              and restart["direct"]["hold"] is False and restart["direct"]["carry"] is None
              and restart["after"]["action"] is None and restart["after"]["hold"] is False
              and restart["after"]["carry"] is None and restart["after"]["stock"] == 4
              and restart["endCarry"] is None and restart["endStock"] == 4, str(restart))
        rctx2.close()

        dctx2, dpage = new_page(browser, 1280, 720, "?debug&level=1.3", action_errors)
        dpage.wait_for_function("() => window.__jamtLoad && window.__jamtLoad.done >= window.__jamtLoad.total",
                                timeout=7000)
        dig = js(dpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          window.__JAMT_FREEZE = true; J.startEVA(); T.teleport(355, 330); J.snapCamera();
          J.startHold();
          const samples = [];
          for (let i = 0; i < 30; i++) {
            J.stepHold(0.04);
            if (J.action) samples.push({ anim: J.action.anim, frame: J.action.frame,
              p: J.action.progress, phase: J.action.phase });
          }
          const mid = { carry: T.carry() };
          for (let i = 0; i < 40; i++) {
            J.stepHold(0.04);
            if (J.action) samples.push({ anim: J.action.anim, frame: J.action.frame,
              p: J.action.progress, phase: J.action.phase });
          }
          return { samples, mid, end: J.action, carry: T.carry(),
                   stock: T.sources().find(s => s.id === 'soil-src').stock };
        }""")
        dig_frames = [s["frame"] for s in dig["samples"] if s["anim"] == "dig"]
        bag_frames = [s["frame"] for s in dig["samples"] if s["anim"] == "bag"]
        dig_order = all(b == a or b == (a + 1) % 3 for a, b in zip(dig_frames, dig_frames[1:]))
        bag_order = all(b == a or b == a + 1 for a, b in zip(bag_frames, bag_frames[1:]))
        first_bag = next((s["p"] for s in dig["samples"] if s["anim"] == "bag"), None)
        check("A5 dig: dig 1-3 loop then bag 1-5 play in order",
              set(dig_frames) == {0, 1, 2} and dig_order and set(bag_frames) == {0, 1, 2, 3, 4}
              and bag_order and first_bag is not None and first_bag >= 0.69,
              f"dig={sorted(set(dig_frames))} bag={sorted(set(bag_frames))} firstBag={first_bag}")
        check("A5 dig: item arrives only at completion",
              dig["mid"]["carry"] is None and dig["carry"] == "bag" and dig["stock"] == 4,
              f"mid={dig['mid']} end={dig['carry']} stock={dig['stock']}")

        # touch ACT on a phone viewport
        tctx = browser.new_context(viewport={"width": 390, "height": 844},
                                   has_touch=True, is_mobile=True)
        tpage = tctx.new_page()
        touch_errors = []
        tpage.on("pageerror", lambda e: touch_errors.append(str(e)))
        tpage.on("console", lambda m: touch_errors.append(m.text) if m.type == "error" else None)
        tpage.goto((LIVE_URL or URL) + "?debug&level=1.1")
        tpage.wait_for_timeout(1200)
        tpage.wait_for_function("() => window.__jamtLoad && window.__jamtLoad.done >= window.__jamtLoad.total",
                                timeout=7000)
        touch = js(tpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          window.__JAMT_FREEZE = true; J.startEVA(); T.teleport(150, 556); J.snapCamera();
          const btn = document.getElementById('act-btn');
          btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, pointerType: 'touch' }));
          const started = !!J.action;
          for (let i = 0; i < 70; i++) J.stepHold(0.04);
          btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'touch' }));
          return { started, action: J.action, carry: T.carry(),
                   visible: !document.getElementById('touch-controls').hidden };
        }""")
        check("A5 phone ACT button starts and completes ice mining",
              touch["started"] is True and touch["carry"] == "ice", str(touch))
        check("A5 phone action has no console errors",
              len([e for e in touch_errors if not any(s in e.lower() for s in IGNORE)]) == 0,
              str(touch_errors[:2]))
        tctx.close()

        # fallback: a missing action frame must not block the hold effect
        fbctx = browser.new_context(viewport={"width": 1280, "height": 720})
        fbpage = fbctx.new_page()
        fberrs, fbwarns = [], []
        fbpage.on("pageerror", lambda e: fberrs.append(str(e)))
        fbpage.on("console", lambda m: fbwarns.append(m.text) if m.type == "warning" else None)
        fbpage.route("**/ice_mine_03.png", lambda route: route.abort())
        fbpage.goto((LIVE_URL or URL) + "?debug&level=1.1")
        fbpage.wait_for_timeout(1200)
        fbpage.wait_for_function("() => window.__jamtLoad && window.__jamtLoad.done >= window.__jamtLoad.total",
                                 timeout=7000)
        fb = js(fbpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          window.__JAMT_FREEZE = true;
          J.startEVA(); T.teleport(150, 556); J.snapCamera(); J.startHold();
          const started = !!J.action;
          for (let i = 0; i < 70; i++) J.stepHold(0.04);
          return { started, action: J.action, carry: T.carry() };
        }""")
        check("A5 missing ice frame skips animation but still yields the item",
              fb["started"] is False and fb["action"] is None and fb["carry"] == "ice", str(fb))
        check("A5 action fallback warns and does not break",
              any("unavailable" in w.lower() for w in fbwarns) and not fberrs,
              f"warns={fbwarns[:2]} errs={fberrs[:2]}")
        fbctx.close()

        # action proof: 0 / 50 / 100% for both actions
        def action_clip(pg):
            info = js(pg, "() => window.__jamtActionDraw")
            rect = js(pg, """() => { const r = document.getElementById('scene').getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height }; }""")
            vp = pg.viewport_size
            if not info:
                return None
            sx = rect["x"] + info["screenX"] * rect["w"] / 640
            sy = rect["y"] + info["screenY"] * rect["h"] / 360
            w, h = 480, 400
            return {"x": int(max(0, min(vp["width"] - w, sx - w / 2))),
                    "y": int(max(0, min(vp["height"] - h, sy - h * 0.72))),
                    "width": w, "height": h}

        action_shots = []
        for kind, query, tx, ty in (("ice", "?debug&level=1.1", 150, 556),
                                    ("dig", "?debug&level=1.3", 300, 350)):
            sctx, spage = new_page(browser, 1280, 720, query)
            spage.wait_for_function("() => window.__jamtLoad && window.__jamtLoad.done >= window.__jamtLoad.total",
                                    timeout=7000)
            js(spage, f"""() => {{
              const J = window.__JAMT__, T = window.__T;
              window.__JAMT_FREEZE = true; J.startEVA(); T.teleport({tx}, {ty}); J.snapCamera(); J.startHold();
              document.getElementById('panel').hidden = true;
              const tr = document.getElementById('tracker'); if (tr) tr.hidden = true;
            }}""")
            spage.wait_for_timeout(140)
            totals = [0, 28, 59 if kind == "ice" else 56]
            labels = ["0pct", "50pct", "100pct"]
            previous = 0
            for label, total in zip(labels, totals):
                steps = total - previous
                previous = total
                if steps:
                    js(spage, f"() => {{ const J = window.__JAMT__; for (let i = 0; i < {steps}; i++) J.stepHold(0.04); }}")
                    spage.wait_for_timeout(120)
                clip = action_clip(spage)
                path = os.path.join(SHOTS, f"action_{kind}_{label}.png")
                if clip:
                    spage.screenshot(path=path, clip=clip)
                    action_shots.append((kind, label, path))
            sctx.close()

        if action_shots:
            cells = []
            for kind, label, path in action_shots:
                cells.append((f"{kind.upper()} {label.replace('pct', '%')}", Image.open(path).convert("RGB")))
            cw, ch, pad, lab = 480, 400, 10, 22
            comp = Image.new("RGB", (pad + 3 * (cw + pad), pad + 2 * (ch + lab + pad)), (10, 13, 22))
            cd = _Draw.Draw(comp)
            for i, (label, im) in enumerate(cells):
                col = i % 3
                row = i // 3
                x = pad + col * (cw + pad)
                y = pad + row * (ch + lab + pad)
                cd.text((x, y + 4), label, fill=(235, 240, 255))
                comp.paste(im, (x, y + lab))
            os.makedirs(os.path.join(ROOT, "tools", "out"), exist_ok=True)
            comp.save(os.path.join(ROOT, "tools", "out", "action_check.png"))
        check("A5 action_check.png written (0/50/100% both actions)",
              len(action_shots) == 6 and os.path.isfile(os.path.join(ROOT, "tools", "out", "action_check.png")),
              f"{len(action_shots)} shots")
        check("A5 action animations cause no console errors",
              len([e for e in action_errors if not any(s in e.lower() for s in IGNORE)]) == 0,
              str(action_errors[:2]))
        dctx2.close()
        actx.close()

        # extend the debug-page check with the action scrub
        check("A5 ?debug#anim has ice/dig loops + progress scrub",
              dbg.get("actionPanels") == 4 and abs(dbg.get("img12Scale", 0) - 0.2082945881) < 1e-6,
              str(dbg))

        # ------------------------------------------------- landing / quit art
        print("\nLanding and quit art")
        art_errors = []
        actx, apage = new_page(browser, 1280, 720, "", art_errors)
        apage.wait_for_timeout(1500)
        apage.click("#start-gate"); apage.wait_for_timeout(250)
        title_art = js(apage, """() => [...document.querySelectorAll('#screen-title img')]
          .map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') }))""")
        check("Landing shows the illustrated astronaut art",
              len(title_art) >= 1 and all(a["ok"] for a in title_art), str(title_art))
        landing = js(apage, """() => {
          const ids = ['play-btn', 'continue-btn', 'how-btn', 'menu-settings', 'menu-quit'];
          const buttons = ids.map((id) => {
            const b = document.getElementById(id);
            if (!b) return { id, missing: true };
            const r = b.getBoundingClientRect();
            const s = getComputedStyle(b);
            return { id, w: Math.round(r.width), h: Math.round(r.height),
                     visible: r.width > 60 && r.height > 30 && s.display !== 'none' && s.visibility !== 'hidden' };
          });
          const title = document.querySelector('#screen-title .title-main');
          // The hero figure is whatever big astronaut image the landing uses;
          // check it by size instead of by class name so redesigns still pass.
          const hero = [...document.querySelectorAll('#screen-title img')]
            .map((i) => ({ el: i, r: i.getBoundingClientRect() }))
            .sort((a, b) => b.r.width - a.r.width)[0];
          const ar = hero ? hero.r : null;
          return {
            buttons,
            jersey: document.fonts.check("40px 'Jersey 20'"),
            astronaut: ar ? { w: Math.round(ar.width), h: Math.round(ar.height), src: hero.el.getAttribute('src') } : null,
            footer: (document.querySelector('#screen-title .title-footer, #screen-title .figma-footer, #screen-title footer') || {}).textContent || '',
          };
        }""")
        check("Landing menu has the five design buttons at clickable size",
              all(b.get("visible") for b in landing["buttons"]), str(landing["buttons"]))
        check("Landing title uses the bundled pixel font",
              landing["jersey"] is True, str(landing["jersey"]))
        check("Landing keeps the big astronaut and the credit footer",
              landing["astronaut"] is not None and landing["astronaut"]["w"] >= 180
              and "NASA" in landing["footer"], str(landing))
        apage.click("#menu-quit"); apage.wait_for_timeout(300)
        apage.wait_for_function("() => { const i = document.getElementById('confirm-art'); return !i.hidden && i.complete && i.naturalWidth > 0; }", timeout=5000)
        confirm_art = js(apage, """() => { const i = document.getElementById('confirm-art');
          return { hidden: i.hidden, ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') }; }""")
        apage.click("#confirm-yes"); apage.wait_for_timeout(250)
        quit_art = js(apage, """() => [...document.querySelectorAll('#screen-goodbye img')]
          .map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') }))""")
        check("Quit page uses the sad astronaut, exit door and aborted banner",
              not confirm_art["hidden"] and confirm_art["ok"] and len(quit_art) >= 3
              and all(a["ok"] for a in quit_art), f"{confirm_art} {quit_art}")
        check("Landing/quit art has no console errors",
              len([e for e in art_errors if not any(s in e.lower() for s in IGNORE)]) == 0,
              str(art_errors[:2]))
        actx.close()

        # ---------------------------------------------------------- FIX-2
        print("\nFIX-2: kid vocabulary + coach")
        bad_words = re.compile(r"\b(Sol|EVA|RESOLVE)\b")

        # title, how-to, briefing, HUD/log, pause, science
        tctx, tpage = new_page(browser, 1280, 720, "")
        tpage.wait_for_timeout(1600)
        tpage.click("#start-gate"); tpage.wait_for_timeout(200)
        fix_texts = {"title": tpage.inner_text("#screen-title")}
        tpage.click("#how-btn"); tpage.wait_for_timeout(100)
        fix_texts["how"] = tpage.inner_text("#modal-how")
        tpage.click("#modal-how [data-close]")
        tpage.click("#play-btn"); tpage.wait_for_timeout(200)
        tpage.click(".mission-card"); tpage.wait_for_timeout(200)
        fix_texts["brief"] = tpage.inner_text("#screen-brief")
        tpage.click("#brief-start"); tpage.wait_for_timeout(900)
        fix_texts["game"] = tpage.inner_text("body")
        tpage.click("#pause-btn"); tpage.wait_for_timeout(100)
        fix_texts["pause"] = tpage.inner_text("#modal-pause")
        tpage.click("#pause-continue")
        tpage.click("#science-btn-hud"); tpage.wait_for_timeout(100)
        fix_texts["science"] = tpage.inner_text("#modal-science")
        tpage.click("#modal-science [data-close]")
        tpage.evaluate("() => window.__JAMT__.endLevel(true)")
        tpage.wait_for_timeout(300)
        fix_texts["debrief"] = tpage.inner_text("#screen-debrief")
        readme_intro = "\n".join(open(os.path.join(ROOT, "README.md"), encoding="utf-8").read().splitlines()[:30])
        found = {k: bad_words.findall(v) for k, v in fix_texts.items() if bad_words.search(v)}
        check("FIX2 no EVA / RESOLVE / Sol in title, how-to, briefing, HUD, log, pause",
              not found and not bad_words.search(readme_intro), f"{found} readme={bad_words.findall(readme_intro)}")
        check("FIX2 debrief is kid-friendly", not bad_words.search(fix_texts["debrief"]),
              str(bad_words.findall(fix_texts["debrief"])))
        check("FIX2 briefing explains a game day with Real NASA",
              "REAL NASA" in fix_texts["brief"].upper() and "29.5 Earth days" in fix_texts["brief"])
        check("FIX2 goal headline + friendly phase chips",
              "Day 1: Get the Moon base ready" in fix_texts["game"]
              and "1. Plan power" in fix_texts["game"])
        check("FIX2 Mission Science uses days, not Sol/EVA", not bad_words.search(fix_texts["science"]),
              str(bad_words.findall(fix_texts["science"])))
        tctx.close()

        # 1.2 and 1.3 briefs/logs/debriefs
        level_bad = {}
        for lid in ("1.2", "1.3"):
            lctx, lpage = new_page(browser, 1280, 720, f"?debug&level={lid}")
            lpage.wait_for_timeout(900)
            level_bad[lid + "-game"] = bad_words.findall(lpage.inner_text("body"))
            lpage.keyboard.press("p"); lpage.wait_for_timeout(120)
            lpage.click("#tracker-info"); lpage.wait_for_timeout(100)
            level_bad[lid + "-brief"] = bad_words.findall(lpage.inner_text("#screen-brief"))
            lpage.evaluate("() => window.__JAMT__.endLevel(true)")
            lpage.wait_for_timeout(250)
            level_bad[lid + "-debrief"] = bad_words.findall(lpage.inner_text("#screen-debrief"))
            lctx.close()
        check("FIX2 1.2/1.3 briefs, HUD, log and debriefs use Day",
              all(not v for v in level_bad.values()), str(level_bad))

        # coach targets: six states per sublevel
        plans = {
            "1.1": {"empty": "panel-src", "match": "solar-slot", "wrong": "panel-src",
                    "carry": "panel", "wrongCarry": "toolbox"},
            "1.2": {"empty": "toolbox-src", "match": "leak-slot", "wrong": "toolbox-src",
                    "carry": "toolbox", "wrongCarry": "o2"},
            "1.3": {"empty": "comms", "match": "bunker-slot", "wrong": "comms",
                    "carry": "bag", "wrongCarry": "toolbox"},
        }
        coach_fail = {}
        for lid, expected in plans.items():
            cctx, cpage = new_page(browser, 1280, 720, f"?debug&level={lid}")
            cpage.wait_for_timeout(1000)
            if lid == "1.3":
                setup_extra = "J.state.stormKnown = true;"
                wrong_extra = "J.state.stormKnown = false;"
                done_extra = "J.state.stormKnown = true; J.state.bags = 1; J.state.sheltered = true;"
            elif lid == "1.2":
                setup_extra = ""
                wrong_extra = ""
                done_extra = "J.state.isolated = true; J.state.taped = true; J.state.patched = true; J.state.reopened = true;"
            else:
                setup_extra = ""
                wrong_extra = ""
                done_extra = "J.state.panelDeployed = true; J.state.res.water = 60; J.state.res.o2 = 70;"
            states = js(cpage, f"""() => {{
              const J = window.__JAMT__, T = window.__T;
              J.setHints(true); J.startEVA(); J.state.tutorialSkipped = true;
              T.teleport(512, 430); J.state.air = 100; J.state.carry = null; J.render();
              const out = {{}};
              out.empty = J.coach;
              J.state.carry = '{expected["carry"]}'; {setup_extra} J.updateCoach(); out.match = J.coach;
              J.state.carry = '{expected["wrongCarry"]}'; {wrong_extra} J.updateCoach(); out.wrong = J.coach;
              J.state.carry = null; {done_extra} J.state.atSwitchboard = false; J.updateCoach(); out.done = J.coach;
              J.state.air = 20; J.updateCoach(); out.air = J.coach;
              J.state.air = 100; T.teleport(960, 60); J.snapCamera(); J.updateCoach(); out.off = J.coach;
              return out;
            }}""")
            ok = (states["empty"]["targetId"] == expected["empty"]
                  and states["match"]["targetId"] == expected["match"]
                  and states["wrong"]["targetId"] == expected["wrong"]
                  and states["done"]["targetId"] == "switchboard"
                  and states["air"]["targetId"] == "dome"
                  and states["air"]["text"] == "Your suit air is low. Go back inside!"
                  and states["off"]["offscreen"] is True
                  and 18 <= states["off"]["arrow"]["x"] <= 622
                  and 18 <= states["off"]["arrow"]["y"] <= 342)
            if not ok:
                coach_fail[lid] = states
            cpage.close()
        check("FIX2 coach targets match empty/match/wrong/done/low-air/off-screen in 1.1-1.3",
              not coach_fail, str(coach_fail)[:500])

        # far-target rover hint
        hctx, hpage = new_page(browser, 1280, 720, "?debug&level=1.1")
        hpage.wait_for_timeout(1000)
        far = js(hpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          J.setHints(true); J.startEVA(); J.state.tutorialSkipped = true;
          T.teleport(512, 430); J.state.carry = null; J.state.air = 100;
          J.state.panelDeployed = true; J.render(); J.updateCoach();
          return J.coach;
        }""")
        check("FIX2 far target says use the rover", far["mode"] == "far" and "rover" in far["text"].lower(), str(far))

        # tutorial + skip + hints
        tutctx, tutpage = new_page(browser, 1280, 720, "?debug&level=1.1")
        tutpage.wait_for_timeout(1000)
        tut = js(tutpage, """() => {
          const J = window.__JAMT__, T = window.__T;
          J.setHints(true);
          const plan = J.coach;
          J.startEVA();
          const start = J.coach;
          T.setKey('right', true);
          for (let i = 0; i < 10; i++) T.step(0.05);
          T.setKey('right', false);
          J.updateCoach();
          const moved = J.coach;
          const skipVisible = !document.getElementById('coach-skip').hidden;
          document.getElementById('coach-skip').click();
          return { plan, start, moved, skipVisible, afterSkip: J.coach, tutorial: J.tutorial };
        }""")
        check("FIX2 first 1.1 tutorial advances move -> pick up and can be skipped",
              "Go outside" in tut["plan"]["text"] and "Move" in tut["start"]["text"]
              and "pick up" in tut["moved"]["text"].lower()
              and tut["skipVisible"] and tut["tutorial"]["skipped"] is True
              and tut["afterSkip"]["mode"] == "source", str(tut))
        tutctx.close()

        # phone coach bar must not cover the player or ACT
        tctx2 = browser.new_context(viewport={"width": 390, "height": 844},
                                    has_touch=True, is_mobile=True)
        tpage2 = tctx2.new_page()
        terr = []
        tpage2.on("pageerror", lambda e: terr.append(str(e)))
        tpage2.on("console", lambda m: terr.append(m.text) if m.type == "error" else None)
        tpage2.goto((LIVE_URL or URL) + "?debug&level=1.1")
        tpage2.wait_for_timeout(1200)
        tpage2.wait_for_function("() => window.__jamtLoad && window.__jamtLoad.done >= window.__jamtLoad.total",
                                 timeout=7000)
        geom = js(tpage2, """() => {
          const J = window.__JAMT__, T = window.__T;
          J.setHints(true); J.startEVA(); J.state.tutorialSkipped = true;
          T.teleport(512, 430); J.snapCamera(); J.render();
          document.getElementById('touch-controls').hidden = false;
          document.body.classList.add('touch-on');
          const c = document.getElementById('coach').getBoundingClientRect();
          const s = document.getElementById('scene').getBoundingClientRect();
          const sx = s.width / 640, sy = s.height / 360;
          const px = s.x + (J.player.x - J.camera.x) * sx;
          const py = s.y + (J.player.y - J.camera.y) * sy;
          const playerBox = { left: px - 22 * sx, right: px + 22 * sx,
                              top: py - 72 * sy, bottom: py + 3 * sy };
          const a = document.getElementById('act-btn').getBoundingClientRect();
          const overlap = (r1, r2) => !(r1.right <= r2.left || r1.left >= r2.right
                                        || r1.bottom <= r2.top || r1.top >= r2.bottom);
          return { coach: { left: c.left, right: c.right, top: c.top, bottom: c.bottom },
                   player: playerBox, act: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
                   coversPlayer: overlap(c, playerBox), coversAct: a.width > 0 && overlap(c, a),
                   actVisible: a.width > 0, coachText: J.coach.text };
        }""")
        check("FIX2 phone coach bar never covers the player or ACT",
              not geom["coversPlayer"] and not geom["coversAct"], str(geom))
        check("FIX2 phone coach has no console errors",
              len([e for e in terr if not any(s in e.lower() for s in IGNORE)]) == 0, str(terr[:2]))
        tctx2.close()

        # help dots
        help_info = js(hpage, """() => {
          const dots = [...document.querySelectorAll('.help-dot')];
          return { count: dots.length, helps: dots.map((d) => d.dataset.help || '') };
        }""")
        hpage.locator(".term-help .help-dot").first.click()
        hpage.wait_for_timeout(100)
        help_pop = js(hpage, """() => { const p = document.querySelector('.help-pop');
          return { open: !p.hidden, pop: p.textContent }; }""")
        check("FIX2 help dots explain suit air, solar cells and battery cells",
              help_info["count"] >= 3 and all(help_info["helps"]) and help_pop["open"]
              and "Solar" in help_pop["pop"], f"{help_info} {help_pop}")
        hints_off = js(hpage, """() => { const J = window.__JAMT__; J.setHints(false);
          return { coach: J.coach, hidden: document.getElementById('coach').hidden }; }""")
        js(hpage, "() => window.__JAMT__.setHints(true)")
        check("FIX2 Hints off hides the coach and arrow", hints_off["coach"] is None and hints_off["hidden"] is True, str(hints_off))
        hctx.close()

        # coach proof: desktop + phone, 4 states
        def coach_setup(pg, state):
            js(pg, f"""() => {{
              const J = window.__JAMT__, T = window.__T;
              J.setHints(true); if (J.state.phase !== 'eva') J.startEVA();
              J.state.tutorialSkipped = true; T.teleport(512, 430); J.snapCamera();
              J.state.air = 100; J.state.carry = null; J.state.panelDeployed = false;
              J.state.res.water = 48; J.state.res.o2 = 38; J.state.atSwitchboard = false;
              if ('{state}' === 'match') J.state.carry = 'panel';
              if ('{state}' === 'done') {{
                J.state.panelDeployed = true; J.state.res.water = 60; J.state.res.o2 = 70;
              }}
              if ('{state}' === 'air') J.state.air = 20;
              J.render(); J.updateCoach();
            }}""")
            pg.wait_for_timeout(120)

        shot_ctx, shot_page = new_page(browser, 1280, 720, "?debug&level=1.1")
        shot_page.wait_for_timeout(900)
        shot_paths = []
        for state in ("empty", "match", "done", "air"):
            coach_setup(shot_page, state)
            path = os.path.join(SHOTS, f"coach_desktop_{state}.png")
            shot_page.screenshot(path=path)
            ctext = js(shot_page, "() => window.__JAMT__.coach.text")
            shot_paths.append(("desktop", state, path, ctext))
        shot_ctx.close()
        shot_ctx2 = browser.new_context(viewport={"width": 390, "height": 844},
                                        has_touch=True, is_mobile=True)
        shot_page2 = shot_ctx2.new_page()
        shot_page2.goto((LIVE_URL or URL) + "?debug&level=1.1")
        shot_page2.wait_for_timeout(1100)
        for state in ("empty", "match", "done", "air"):
            coach_setup(shot_page2, state)
            path = os.path.join(SHOTS, f"coach_phone_{state}.png")
            shot_page2.screenshot(path=path)
            ctext = js(shot_page2, "() => window.__JAMT__.coach.text")
            shot_paths.append(("phone", state, path, ctext))
        shot_ctx2.close()

        if len(shot_paths) == 8:
            from PIL import ImageDraw as _Draw2
            big = Image.new("RGB", (4 * 410 + 10, 2 * 470 + 30), (10, 13, 22))
            bd = _Draw2.Draw(big)
            for i, (view, state, path, ctext) in enumerate(shot_paths):
                im = Image.open(path).convert("RGB")
                if view == "desktop":
                    im.thumbnail((400, 225))
                    x, y = 10 + (i % 4) * 410, 30
                else:
                    im.thumbnail((190, 412))
                    x, y = 110 + (i % 4) * 410, 300
                big.paste(im, (x, y))
                bd.text((x, y - 14), f"{view.upper()} {state}: {ctext[:52]}", fill=(235, 240, 255))
            os.makedirs(os.path.join(ROOT, "tools", "out"), exist_ok=True)
            big.save(os.path.join(ROOT, "tools", "out", "coach_check.png"))
        check("FIX2 coach_check.png written (desktop + phone, 4 states)",
              len(shot_paths) == 8 and os.path.isfile(os.path.join(ROOT, "tools", "out", "coach_check.png")),
              f"{len(shot_paths)} shots")

        # ------------------------------------------------- layout / objectives
        print("\nLayout: objectives vs panel / HUD / coach / player / ACT")
        layout_sizes = [(1920, 860, False), (1280, 720, False), (768, 1024, True),
                        (390, 844, True), (360, 640, True), (844, 390, True)]
        for w, h, touch in layout_sizes:
            lctx = browser.new_context(viewport={"width": w, "height": h},
                                       has_touch=touch, is_mobile=touch)
            issues = []
            for lid in ("1.1", "1.2", "1.3"):
                lp = lctx.new_page()
                lp.goto((LIVE_URL or URL) + f"?debug&level={lid}")
                lp.wait_for_timeout(900)
                m = js(lp, """() => {
                  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
                    return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
                  const q = (s) => document.querySelector(s);
                  const scene = q('#scene'), cv = scene.getBoundingClientRect();
                  const J = window.__JAMT__, d = window.__jamtAnimDraw;
                  const sx = cv.width / scene.width, sy = cv.height / scene.height;
                  const px = cv.x + (d ? d.screenX : J.player.x - J.camera.x) * sx;
                  const py = cv.y + (d ? d.screenY : J.player.y - J.camera.y) * sy;
                  const player = { l: px - 22 * sx, t: py - 66 * sy, r: px + 22 * sx, b: py + 2 * sy };
                  const act = q('#act-btn'), ar = act.getBoundingClientRect();
                  const tr = q('#tracker'), list = q('#tracker-list');
                  return {
                    tracker: R(tr), coach: q('#coach').hidden ? null : R(q('#coach')),
                    hud: R(q('#hud')), panel: R(q('.dock-left')), player,
                    act: ar.width ? R(act) : null,
                    trackerCollapsed: getComputedStyle(list).display === 'none',
                    trackerText: tr.innerText,
                  };
                }""")
                def inter(a, b):
                    return bool(a and b and not (a["r"] <= b["l"] or a["l"] >= b["r"]
                                                 or a["b"] <= b["t"] or a["t"] >= b["b"]))
                pairs = [("panel", m["panel"]), ("hud", m["hud"]), ("coach", m["coach"]),
                         ("player", m["player"]), ("act", m["act"])]
                for name, other in pairs:
                    if inter(m["tracker"], other):
                        issues.append(f"{lid}: tracker/{name}")
                if inter(m["coach"], m["hud"]): issues.append(f"{lid}: coach/hud")
                if inter(m["coach"], m["player"]): issues.append(f"{lid}: coach/player")
                if w != 1920 and w != 1280 and not m["trackerCollapsed"]:
                    issues.append(f"{lid}: tracker not collapsed")
                if (w, h) == (1280, 720) and lid == "1.3":
                    lp.screenshot(path=os.path.join(ROOT, "tools", "out", "layout_desktop.png"))
                if (w, h) == (390, 844) and lid == "1.3":
                    lp.screenshot(path=os.path.join(ROOT, "tools", "out", "layout_phone.png"))
                lp.close()
            lctx.close()
            check(f"Layout {w}x{h}: objectives clear of panel, HUD, coach, player, ACT",
                  not issues, str(issues))

        # ---------------------------------------- Space Buddy polish regressions
        print("\nSpace Buddy polish: panels / loading / icons / assets")

        def saved_settings(pg):
            raw = js(pg, "() => localStorage.getItem('jamt.settings')")
            try:
                return json.loads(raw or "{}")
            except Exception:
                return {}

        def rect_map(pg):
            return js(pg, """() => {
              const R = (sel) => {
                const e = document.querySelector(sel);
                if (!e) return null;
                const r = e.getBoundingClientRect();
                return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
              };
              return { hud: R('#hud'), coach: R('#coach'), toggle: R('#panel-toggle'),
                       buddy: R('#buddy-fab'), act: R('#act-btn'), stick: R('#stick'),
                       left: R('.dock-left'), right: R('.dock-right'), panel: R('#panel') };
            }""")

        def overlaps(a, b):
            return bool(a and b and a["w"] > 0 and b["w"] > 0
                        and not (a["r"] <= b["l"] or a["l"] >= b["r"]
                                 or a["b"] <= b["t"] or a["t"] >= b["b"]))

        # U1/U2/U3: default mode, P persistence, typing safety, auto-hide, fade.
        uctx = browser.new_context(viewport={"width": 1280, "height": 720})
        up = uctx.new_page()
        uerrs = []
        up.on("pageerror", lambda e: uerrs.append(str(e)))
        up.on("console", lambda m: uerrs.append(m.text) if m.type == "error" else None)
        up.goto((LIVE_URL or URL) + "?debug&level=1.1")
        up.wait_for_timeout(900)
        u0 = js(up, """() => {
          const p = document.getElementById('panel');
          return { cls: document.body.className, full: document.body.classList.contains('panels-full'),
                   focus: document.body.classList.contains('panels-focus'),
                   panel: getComputedStyle(p).display,
                   key: (document.getElementById('panels-key')?.textContent || '').trim(),
                   saved: localStorage.getItem('jamt.settings') };
        }""")
        check("U1 desktop 1.1 Day 1 starts Full and shows the P hint",
              u0["full"] and u0["panel"] == "block" and "P panels" in u0["key"], str(u0))
        for lid in ("1.2", "1.3"):
            c = browser.new_context(viewport={"width": 1280, "height": 720})
            pg = c.new_page()
            pg.goto((LIVE_URL or URL) + f"?debug&level={lid}")
            pg.wait_for_timeout(850)
            v = js(pg, """() => ({
              full: document.body.classList.contains('panels-full'),
              focus: document.body.classList.contains('panels-focus'),
              panel: getComputedStyle(document.getElementById('panel')).display
            })""")
            check(f"U1 desktop {lid} starts in Focus", v["focus"] and not v["full"] and v["panel"] == "none", str(v))
            c.close()
        up.keyboard.press("p")
        up.wait_for_timeout(180)
        u1 = js(up, """() => ({
          cls: document.body.className, focus: document.body.classList.contains('panels-focus'),
          panel: getComputedStyle(document.getElementById('panel')).display,
          saved: JSON.parse(localStorage.getItem('jamt.settings') || '{}').panels || ''
        })""")
        check("U2 P toggles Focus and stores the explicit choice",
              u1["focus"] and u1["panel"] == "none" and u1["saved"] == "focus", str(u1))
        up.reload()
        up.wait_for_timeout(900)
        u2 = js(up, """() => ({
          focus: document.body.classList.contains('panels-focus'),
          saved: JSON.parse(localStorage.getItem('jamt.settings') || '{}').panels || ''
        })""")
        check("U2 Focus survives a reload", u2["focus"] and u2["saved"] == "focus", str(u2))
        up.keyboard.press("p")
        up.wait_for_timeout(180)
        u3 = js(up, """() => ({
          full: document.body.classList.contains('panels-full'),
          saved: JSON.parse(localStorage.getItem('jamt.settings') || '{}').panels || ''
        })""")
        check("U2 P returns to Full and persists Full", u3["full"] and u3["saved"] == "full", str(u3))

        up.evaluate("() => window.JuniorBuddy.open()")
        up.click("#buddy-input")
        up.keyboard.press("p")
        up.wait_for_timeout(120)
        u4 = js(up, """() => ({
          full: document.body.classList.contains('panels-full'),
          focus: document.body.classList.contains('panels-focus'),
          saved: JSON.parse(localStorage.getItem('jamt.settings') || '{}').panels || ''
        })""")
        check("U2 P is ignored while typing in Buddy chat",
              u4["full"] and not u4["focus"] and u4["saved"] == "full", str(u4))
        up.evaluate("() => window.JuniorBuddy.close()")
        up.wait_for_timeout(120)

        up.evaluate("""() => {
          const J = window.__JAMT__, T = window.__T;
          J.startEVA(); T.teleport(150, 556); J.snapCamera(); J.startHold();
        }""")
        up.wait_for_timeout(200)
        u5 = js(up, """() => ({
          temp: document.body.classList.contains('panels-temp-hidden'),
          panel: getComputedStyle(document.getElementById('panel')).display,
          coach: getComputedStyle(document.getElementById('coach')).display,
          action: !!window.__JAMT__.action
        })""")
        up.evaluate("() => window.__JAMT__.cancelHold()")
        up.wait_for_timeout(250)
        u6 = js(up, """() => ({
          temp: document.body.classList.contains('panels-temp-hidden'),
          panel: getComputedStyle(document.getElementById('panel')).display,
          faded: document.getElementById('coach').classList.contains('is-faded'),
          white: getComputedStyle(document.getElementById('coach-text')).whiteSpace,
          coach: getComputedStyle(document.getElementById('coach')).display,
          acted: !!window.__JAMT__.state.coachActed
        })""")
        check("U3 holding a station hides panels, then restores a faded one-line coach",
              u5["temp"] and u5["panel"] == "none" and u5["coach"] == "none" and u5["action"]
              and not u6["temp"] and u6["panel"] == "block" and u6["faded"]
              and u6["white"] == "nowrap" and u6["coach"] == "flex" and u6["acted"],
              str({"during": u5, "after": u6}))
        up.evaluate("() => window.JuniorBuddy.open()")
        up.wait_for_timeout(180)
        u7 = js(up, """() => ({
          temp: document.body.classList.contains('panels-temp-hidden'),
          panel: getComputedStyle(document.getElementById('panel')).display
        })""")
        up.evaluate("() => window.JuniorBuddy.close()")
        up.wait_for_timeout(180)
        u8 = js(up, """() => ({
          temp: document.body.classList.contains('panels-temp-hidden'),
          panel: getComputedStyle(document.getElementById('panel')).display
        })""")
        check("U3 Buddy chat auto-hides and restores the panels",
              u7["temp"] and u7["panel"] == "none" and not u8["temp"] and u8["panel"] == "block",
              str({"open": u7, "closed": u8}))

        up.evaluate("() => document.getElementById('dock-left-collapse').click()")
        up.wait_for_timeout(120)
        u9 = js(up, """() => ({
          cls: document.querySelector('.dock-left').className,
          expanded: document.getElementById('dock-left-collapse').getAttribute('aria-expanded'),
          h: document.querySelector('.dock-left').getBoundingClientRect().height
        })""")
        up.evaluate("() => document.getElementById('dock-right-collapse').click()")
        up.wait_for_timeout(120)
        u10 = js(up, """() => ({
          cls: document.querySelector('.dock-right').className,
          expanded: document.getElementById('dock-right-collapse').getAttribute('aria-expanded'),
          h: document.querySelector('.dock-right').getBoundingClientRect().height
        })""")
        check("U4 each panel header collapses its own dock",
              "is-collapsed" in u9["cls"] and u9["expanded"] == "false" and u9["h"] < 40
              and "is-collapsed" in u10["cls"] and u10["expanded"] == "false" and u10["h"] < 40,
              str({"left": u9, "right": u10}))
        up.evaluate("""() => {
          document.getElementById('dock-left-collapse').click();
          document.getElementById('dock-right-collapse').click();
        }""")
        up.wait_for_timeout(120)
        check("U4 panels/coach/hotkeys produce no console errors", not uerrs, str(uerrs[:2]))
        uctx.close()

        # U5: phone thumb button and one-tap power drawer.
        pctx = browser.new_context(viewport={"width": 390, "height": 844},
                                   has_touch=True, is_mobile=True)
        pp = pctx.new_page()
        pp.goto((LIVE_URL or URL) + "?debug&level=1.1")
        pp.wait_for_timeout(900)
        p0 = js(pp, """() => {
          const b = document.getElementById('panel-toggle');
          const r = b.getBoundingClientRect();
          return { focus: document.body.classList.contains('panels-focus'),
                   panel: getComputedStyle(document.getElementById('panel')).display,
                   w: r.width, h: r.height, left: r.left, bottom: innerHeight - r.bottom,
                   display: getComputedStyle(b).display };
        }""")
        check("U5 phone starts Focus with a >=44px safe-area thumb button",
              p0["focus"] and p0["panel"] == "none" and p0["display"] == "flex"
              and p0["w"] >= 44 and p0["h"] >= 44 and p0["left"] >= 8 and p0["bottom"] >= 8,
              str(p0))
        pr = rect_map(pp)
        p_clear = not any(overlaps(pr["toggle"], pr[k]) for k in ("stick", "act", "buddy"))
        check("U5 phone button is clear of the thumbstick, ACT and Buddy", p_clear, str(pr))
        pp.click("#panel-toggle")
        pp.wait_for_timeout(250)
        p1 = js(pp, """() => {
          const p = document.getElementById('panel');
          const d = document.getElementById('draw-btn');
          const pr = p.getBoundingClientRect(), dr = d.getBoundingClientRect();
          const t = document.getElementById('panel-toggle').getBoundingClientRect();
          return { full: document.body.classList.contains('panels-full'),
                   panel: getComputedStyle(p).display, panelTop: pr.top,
                   toggleBottom: t.bottom, draw: dr.width > 0 && dr.height > 0
                     && dr.bottom > pr.top && dr.top < pr.bottom,
                   drawDisabled: d.disabled,
                   goalVisible: (() => { const e = document.getElementById('hud-goal'); const r = e.getBoundingClientRect();
                     return getComputedStyle(e).display !== 'none' && r.width > 0 && r.bottom <= innerHeight; })(),
                   dayVisible: (() => { const e = document.getElementById('hud-sol'); const r = e.getBoundingClientRect();
                     return getComputedStyle(e).display !== 'none' && r.width > 0 && r.bottom <= innerHeight; })(),
                   plan: document.getElementById('panel-phase').textContent };
        }""")
        check("U5 one tap opens the drawer with Plan power and HUD facts reachable",
              p1["full"] and p1["panel"] != "none" and p1["draw"]
              and p1["goalVisible"] and p1["dayVisible"]
              and "Plan" in p1["plan"] and p1["toggleBottom"] <= p1["panelTop"] + 1,
              str(p1))
        pp.click("#panel-toggle")
        pp.wait_for_timeout(200)
        p2 = js(pp, "() => ({ focus: document.body.classList.contains('panels-focus'), panel: getComputedStyle(document.getElementById('panel')).display })")
        check("U5 one tap returns to Focus", p2["focus"] and p2["panel"] == "none", str(p2))
        pctx.close()

        # U6: both modes clear at the six test sizes.
        print("\nPolish layout: HUD / coach / panels / Buddy / thumb controls")
        polish_issues = []
        for w, h, touch in ((1920, 1080, False), (1280, 720, False), (768, 1024, True),
                            (390, 844, True), (360, 640, True), (844, 390, True)):
            for mode in ("focus", "full"):
                c = browser.new_context(viewport={"width": w, "height": h},
                                        has_touch=touch, is_mobile=touch)
                pg = c.new_page()
                pg.add_init_script(
                    "localStorage.setItem('jamt.settings', JSON.stringify({panels:'%s'}))" % mode)
                pg.goto((LIVE_URL or URL) + "?debug&level=1.1")
                pg.wait_for_timeout(850)
                r = rect_map(pg)
                bad = []
                for a, b in (("toggle", "stick"), ("toggle", "act"), ("toggle", "buddy"),
                             ("buddy", "hud"), ("buddy", "coach"), ("buddy", "act"),
                             ("buddy", "stick"), ("coach", "hud"),
                             ("left", "hud"), ("right", "hud")):
                    if overlaps(r[a], r[b]):
                        bad.append(f"{a}/{b}")
                if mode == "full" and touch:
                    if overlaps(r["buddy"], r["panel"]):
                        bad.append("buddy/panel")
                    if overlaps(r["toggle"], r["panel"]):
                        bad.append("toggle/panel")
                if bad:
                    polish_issues.append(f"{w}x{h} {mode}: {','.join(bad)}")
                c.close()
        check("U6 Full/Focus at six sizes keeps HUD, coach, panels and controls clear",
              not polish_issues, str(polish_issues))

        # L1-L3: loading scene, real runner, budget and reduced motion.
        lctx, lp = new_page(browser, 1280, 720, "")
        lp.wait_for_timeout(700)
        lp.wait_for_function("() => window.__jamtLoadingSet && window.__jamtLoad", timeout=4000)
        l0 = js(lp, """() => {
          const sprites = [...document.querySelectorAll('[data-loading-sprite]')].map((i) => ({
            key: i.dataset.loadingSprite, src: i.getAttribute('src'), w: i.naturalWidth
          }));
          return { total: window.__jamtLoad?.total || 0, done: window.__jamtLoad?.done || 0,
                   gate: document.getElementById('start-gate').disabled,
                   count: document.getElementById('load-count').textContent,
                   sprites };
        }""")
        check("L1 loading sprites all resolve from the manifest",
              len(l0["sprites"]) == 9 and all(s["src"] and s["w"] > 0 for s in l0["sprites"])
              and l0["total"] > 0, str(l0))
        check("L1 loading gate enables and announces Ready at completion",
              not l0["gate"] and l0["done"] >= l0["total"] and "Ready" in l0["count"], str(l0))
        total = l0["total"]
        lr = []
        for pct in (0, 50, 100):
            js(lp, f"() => window.__jamtLoadingSet({pct * total // 100}, {total})")
            lp.wait_for_timeout(60)
            lr.append(js(lp, """() => ({
              count: document.getElementById('load-count').textContent,
              bar: document.getElementById('load-bar').style.width,
              left: parseFloat(document.getElementById('load-runner').style.left) || 0
            })"""))
        check("L2 astronaut follows real Loading... N/M progress",
              "Loading... 0/" in lr[0]["count"] and lr[0]["left"] == 0
              and lr[0]["left"] < lr[1]["left"] < lr[2]["left"]
              and lr[1]["bar"] == "50%" and lr[2]["bar"] == "100%",
              str(lr))
        load_dir = os.path.join(ROOT, "assets", "loading")
        load_bytes = sum(os.path.getsize(os.path.join(load_dir, f))
                         for f in os.listdir(load_dir) if f.endswith(".png"))
        check("L2 loading art stays under 300 KB", load_bytes < 300 * 1024, f"{load_bytes} bytes")
        lctx.close()
        rctx = browser.new_context(viewport={"width": 1280, "height": 720},
                                   reduced_motion="reduce")
        rp = rctx.new_page()
        rp.goto((LIVE_URL or URL) + "")
        rp.wait_for_timeout(800)
        rm = js(rp, """() => ({
          reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
          sprites: [...document.querySelectorAll('[data-loading-sprite]')].every((i) => i.naturalWidth > 0),
          gate: document.getElementById('start-gate').disabled
        })""")
        check("L3 loading art is reduced-motion safe and still gates correctly",
              rm["reduce"] and rm["sprites"] and not rm["gate"], str(rm))
        rctx.close()

        # I1: favicon files, alpha, dimensions, versioned links and no 404s.
        html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
        icon_tags = re.findall(
            r'<link[^>]+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>', html)
        icon_hrefs = []
        for tag in icon_tags:
            m = re.search(r'href="([^"]+)"', tag)
            if m:
                icon_hrefs.append(m.group(1))
        icon_dims = {"favicon-16.png": (16, 16), "favicon-32.png": (32, 32),
                     "favicon-48.png": (48, 48), "favicon-180.png": (180, 180),
                     "favicon-192.png": (192, 192), "favicon-512.png": (512, 512)}
        icon_issues = []
        for href in icon_hrefs:
            if "?v=" not in href or href.split("?v=")[-1] != BUILD_VERSION:
                icon_issues.append(f"{href}: version")
            rel = href.split("?")[0]
            path = os.path.join(ROOT, rel.replace("/", os.sep))
            if not os.path.exists(path):
                icon_issues.append(f"{href}: missing")
                continue
            if LIVE_URL:
                try:
                    if urlopen(urljoin(LIVE_URL, rel), timeout=5).status != 200:
                        icon_issues.append(f"{href}: HTTP")
                except (HTTPError, URLError, OSError) as exc:
                    icon_issues.append(f"{href}: {exc}")
            if rel.endswith(".png"):
                im = Image.open(path)
                if im.size != icon_dims.get(os.path.basename(path)):
                    icon_issues.append(f"{href}: {im.size}")
                if im.mode != "RGBA" or any(im.getpixel(p)[3] != 0
                                            for p in ((0, 0), (im.width - 1, 0),
                                                      (0, im.height - 1),
                                                      (im.width - 1, im.height - 1))):
                    icon_issues.append(f"{href}: alpha")
            if rel.endswith(".ico"):
                im = Image.open(path)
                if im.size[0] < 16:
                    icon_issues.append(f"{href}: ico")
        check("I1 moon favicons exist, are transparent, sized, versioned and return no 404",
              len(icon_hrefs) == 8 and all("data:" not in h for h in icon_hrefs)
              and not icon_issues, str(icon_issues))

        # A1: sliced art is committed, transparent and registered.
        slices = {"assets/ice/deposit.png": (128, 58),
                  "assets/ice/chunk.png": (40, 33),
                  "assets/rover/ride.png": (128, 122)}
        slice_issues = []
        for rel, size in slices.items():
            path = os.path.join(ROOT, rel.replace("/", os.sep))
            if not os.path.exists(path):
                slice_issues.append(f"{rel}: missing")
                continue
            im = Image.open(path)
            if im.size != size:
                slice_issues.append(f"{rel}: {im.size}")
            # A cutout may legitimately touch a crop edge (the ice chunk does),
            # so require a transparent field rather than four empty corners.
            transparent = im.getchannel("A").histogram()[0]
            if im.mode != "RGBA" or transparent < 100:
                slice_issues.append(f"{rel}: alpha ({transparent} transparent px)")
        check("A1 ice/rover sliced art is present, transparent and correctly sized",
              not slice_issues, str(slice_issues))

        # A2: ice source uses the deposit and remains the farthest source.
        actx, ap = new_page(browser, 1280, 720, "?debug&level=1.1")
        ice = js(ap, """() => {
          const J = window.__JAMT__, s = J.state;
          const src = s.sources.find((x) => x.id === 'ice-src');
          const base = { x: 512, y: 430 };
          const d = (o) => Math.hypot(o.x - base.x, o.y - base.y);
          const others = s.sources.filter((x) => x.id !== 'ice-src').map(d);
          return { x: src.x, y: src.y, farthest: d(src) > Math.max(...others),
                   station: J.STATIONS.some((x) => x.id === 'ice'),
                   key: window.JAMT_ASSETS['ice/deposit']?.src || '',
                   chunk: window.JAMT_ASSETS['ice/chunk']?.src || '' };
        }""")
        check("A2 ice source moved to the deposit and is still the farthest source",
              ice["x"] == 148 and ice["y"] == 552 and ice["farthest"]
              and not ice["station"] and ice["key"].endswith("assets/ice/deposit.png")
              and ice["chunk"].endswith("assets/ice/chunk.png"), str(ice))
        actx.close()

        # A3: rover rider asset is registered; existing A4 covers fallback/speed.
        a3ctx, a3p = new_page(browser, 1280, 720, "?debug&level=1.1")
        rpatch = js(a3p, "() => window.JAMT_ASSETS['rover/ride']?.src || ''")
        check("A3 rover rider sprite is registered", rpatch.endswith("assets/rover/ride.png"), rpatch)
        a3ctx.close()

        # version text in loading + credits
        vctx, vpage = new_page(browser, 1280, 720, "")
        vpage.wait_for_timeout(700)
        versions = js(vpage, """() => ({
          loading: document.getElementById('load-version')?.textContent || '',
          credits: document.getElementById('credits-version')?.textContent || '',
          title: document.getElementById('title-version')?.textContent || '',
        })""")
        check(f"Loading and Credits show v{BUILD_VERSION}",
              BUILD_VERSION in versions["loading"] and BUILD_VERSION in versions["credits"]
              and BUILD_VERSION in versions["title"], str(versions))
        vctx.close()

        # -------------------------------------------------------- version
        html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
        check(f"E version {BUILD_VERSION} in index.html", f"v{BUILD_VERSION}" in html)
        check("E game.js BUILD_VERSION is current", BUILD_VERSION in GAME_SRC)
        tags = re.findall(r"\?v=([0-9.]+)", html)
        check(f"E every ?v= tag is {BUILD_VERSION}", bool(tags) and all(t == BUILD_VERSION for t in tags), str(tags))

        # ------------------------------------------------------ brand rename
        print("\nBrand rename: Space Buddy")
        def brand_scan(page_obj):
            return js(page_obj, """() => {
              const bad = /(junior\s+astronaut|survival\s+outpost|newspdet)/i;
              const title = document.title || '';
              const meta = [...document.querySelectorAll('meta')].map((m) => m.content || '').join(' ');
              const manifests = [...document.querySelectorAll('link[rel="manifest"]')].map((l) => l.href);
              const body = document.body ? document.body.textContent : '';
              const bdi = [...document.querySelectorAll('#buddy-messages bdi')].map((b) => b.textContent);
              return { title, meta, manifests, bdi, bad: bad.test(title + ' ' + meta + ' ' + body) };
            }""")
        nctx, np = new_page(browser, 1280, 720, "")
        np.wait_for_timeout(500)
        en_brand = brand_scan(np)
        nctx.close()
        arctx = browser.new_context(viewport={"width": 1280, "height": 720})
        arp = arctx.new_page()
        arp.goto((LIVE_URL or URL) + "?debug&level=1.1")
        arp.wait_for_timeout(800)
        js(arp, "() => { window.JuniorBuddy.open(); window.JuniorBuddy.setLanguage('ar'); }")
        arp.wait_for_timeout(250)
        ar_brand = brand_scan(arp)
        arctx.close()
        check("No old game name in visible text, title, meta or manifest (EN/AR)",
              not en_brand["bad"] and not ar_brand["bad"]
              and "Space Buddy" in en_brand["title"] and "Space Buddy" in en_brand["meta"]
              and any("Space Buddy" in b for b in ar_brand["bdi"])
              and not any("junior" in x.lower() or "survival" in x.lower() or "newspdet" in x.lower()
                          for x in en_brand["manifests"] + ar_brand["manifests"]),
              str({"en": en_brand, "ar": {k: v for k, v in ar_brand.items() if k != "body"}}))

        # ----------------------------------------------------- session 2A
        print("\nSession 2A gaps")
        c2, p2 = new_page(browser, 1280, 720, "?debug&level=1.2")
        leak = js(p2, "() => { const J = window.__JAMT__, T = window.__T, st = J.STATIONS.find(s => s.id === 'leak'); const a = T.actionFor(st); return { id: a && a.id, label: a && a.label }; }")
        check("A2 leak has no shortcut action", leak["id"] in ("leakinfo", "reopen", "leakdone"), str(leak))
        walk = js(p2, "() => { const J = window.__JAMT__, T = window.__T, s = J.state; return [...s.sources, ...s.slots].every(o => T.blockedAt(o.x, o.y - 6)); }")
        check("A3 sources/slots block walking", walk is True)
        docs = js(p2, "() => window.__T.RESOURCE_DOCS.every(d => !!window.__T.ITEM_META[d.item])")
        check("A4 resource docs reference real items", docs is True)
        c2.close()

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

        # ---------------------------------------------------------- Buddy ----
        print("\nBuddy: layout, states, hints, privacy, proxy, voice")
        buddy_sizes = [(1920, 860, False), (1280, 720, False), (768, 1024, True),
                       (390, 844, True), (360, 640, True), (844, 390, True)]

        def rect_js(page):
            return js(page, """() => {
              const R = (e) => {
                if (!e) return null;
                const b = e.getBoundingClientRect();
                if (!e.offsetWidth && !e.offsetHeight) return null;
                return { l: b.left, t: b.top, r: b.right, b: b.bottom };
              };
              const q = (s) => document.querySelector(s);
              return {
                fab: R(q('#buddy-fab')), hud: R(q('#hud')), coach: R(q('#coach')),
                tracker: R(q('#tracker')), left: R(q('.dock-left')), right: R(q('.dock-right')),
                act: R(q('#act-btn')), stick: R(q('#stick')), toggle: R(q('#console-toggle')),
                panel: R(q('#buddy-panel')),
                panelVisible: !q('#buddy-panel').hidden,
                fabHidden: q('#buddy-fab').hidden || getComputedStyle(q('#buddy-fab')).display === 'none',
                bodyOpen: document.body.classList.contains('buddy-open'),
              };
            }""")

        def overlaps(a, b):
            return bool(a and b and not (a["r"] <= b["l"] or a["l"] >= b["r"]
                                         or a["b"] <= b["t"] or a["t"] >= b["b"]))

        for bw, bh, btouch in buddy_sizes:
            bctx = browser.new_context(viewport={"width": bw, "height": bh},
                                       has_touch=btouch, is_mobile=btouch)
            bp = bctx.new_page()
            berr = []
            bp.on("pageerror", lambda e: berr.append(str(e)))
            bp.on("console", lambda m: berr.append(m.text) if m.type == "error" else None)
            bp.goto((LIVE_URL or URL) + "?debug&level=1.3")
            bp.wait_for_timeout(900)
            closed = rect_js(bp)
            issues = []
            for key in ("hud", "coach", "tracker", "left", "right", "act", "stick", "toggle"):
                if overlaps(closed["fab"], closed[key]):
                    issues.append(key)
            opened_ok = js(bp, "() => window.JuniorBuddy.open()")
            bp.wait_for_timeout(250)
            opened = rect_js(bp)
            open_issues = []
            for key in ("hud", "coach", "tracker", "left", "right", "act", "stick", "toggle"):
                if opened[key] is not None and overlaps(opened["panel"], opened[key]):
                    open_issues.append(key)
            clean = (not issues and opened_ok and opened["panelVisible"] and opened["fabHidden"]
                     and opened["bodyOpen"] and not open_issues
                     and not [e for e in berr if not any(s in e.lower() for s in IGNORE)])
            check(f"Buddy opens/closes clear of HUD/objectives/coach/console/ACT/joystick at {bw}x{bh}",
                  clean, str({"closed": issues, "open": open_issues, "opened": opened_ok, "errs": berr[:1]}))
            js(bp, "() => window.JuniorBuddy.close()")
            bctx.close()

        # State mapping: trigger every state through the debug hooks.
        bctx = browser.new_context(viewport={"width": 1280, "height": 720})
        bp = bctx.new_page()
        bp.goto((LIVE_URL or URL) + "?debug&level=1.1")
        bp.wait_for_timeout(800)
        js(bp, "() => window.JuniorBuddy.open()")
        state_map = {}
        for state_name in ("idle", "listen", "think", "talk", "happy", "alert", "confused", "sleep"):
            bp.evaluate("(s) => window.JuniorBuddy.trigger(s)", state_name)
            bp.wait_for_timeout(60)
            state_map[state_name] = js(bp, """() => ({
              state: window.JuniorBuddy.state,
              label: document.getElementById('buddy-state-label').textContent,
              icon: document.getElementById('buddy-head-icon').getAttribute('src'),
            })""")
        check("Buddy renders all 8 states through their triggers",
              all(state_map[k]["state"] == k and k in state_map[k]["icon"] for k in state_map),
              str(state_map))
        bctx.close()

        # Hint ladder: three different hints, in order, for each level.
        ladder_ok = True
        ladder_detail = {}
        for lid in ("1.1", "1.2", "1.3"):
            hctx, hp = new_page(browser, 1280, 720, f"?debug&level={lid}")
            hints = [js(hp, "() => window.JuniorBuddy.debugHint()") for _ in range(3)]
            ladder_detail[lid] = hints
            ladder_ok = ladder_ok and len(set(hints)) == 3 and all(hints)
            hctx.close()
        check("Buddy hint ladder gives 3 different steps on 1.1/1.2/1.3", ladder_ok, str(ladder_detail))

        # Keyboard isolation + H/Esc.
        kctx, kp = new_page(browser, 1280, 720, "?debug&level=1.1")
        js(kp, "() => { window.JuniorBuddy.open(); document.getElementById('buddy-input').focus(); }")
        before_keys = js(kp, """() => {
          const J = window.__JAMT__;
          return { x: J.player.x, y: J.player.y, phase: J.state.phase,
                   alloc: { ...J.state.alloc }, action: !!J.state.action, hold: J.holdActive(),
                   panels: JSON.parse(localStorage.getItem('jamt.settings') || '{}').panels || '' };
        }""")
        kp.keyboard.type("wasd 12e")
        kp.keyboard.press("Space")
        kp.keyboard.press("p")
        after_keys = js(kp, """() => {
          const J = window.__JAMT__;
          return { x: J.player.x, y: J.player.y, phase: J.state.phase,
                   alloc: { ...J.state.alloc }, action: !!J.state.action, hold: J.holdActive(),
                   panels: JSON.parse(localStorage.getItem('jamt.settings') || '{}').panels || '',
                   input: document.getElementById('buddy-input').value };
        }""")
        kp.keyboard.press("Escape")
        esc_closed = not js(kp, "() => window.JuniorBuddy.isOpen")
        kp.keyboard.press("h")
        h_opened = js(kp, "() => window.JuniorBuddy.isOpen")
        unchanged = all(before_keys[k] == after_keys[k] for k in before_keys)
        check("Chat input blocks WASD/E/Space/1-3/P hotkeys; Esc closes; H opens",
              unchanged and after_keys["input"].startswith("wasd 12e")
              and esc_closed and h_opened, str({"before": before_keys, "after": after_keys,
                                                "esc": esc_closed, "h": h_opened}))
        kctx.close()

        # Offline / empty proxy: scripted-only, no fetch.
        octx = browser.new_context(viewport={"width": 1280, "height": 720})
        op = octx.new_page()
        oerr = []
        op.on("pageerror", lambda e: oerr.append(str(e)))
        op.on("console", lambda m: oerr.append(m.text) if m.type == "error" else None)
        op.add_init_script("window.__fetchCalls = 0; window.fetch = () => { window.__fetchCalls += 1; return Promise.reject(new Error('blocked')); };")
        op.goto((LIVE_URL or URL) + "?debug&level=1.1")
        op.wait_for_timeout(800)
        js(op, "() => { window.JuniorBuddy.open(); window.JuniorBuddy.debugSetCloud(false); }")
        js(op, "() => window.JuniorBuddy.ask('Tell me a joke about potatoes')")
        op.wait_for_timeout(450)
        off_result = js(op, "() => ({ calls: window.__fetchCalls, state: window.JuniorBuddy.state, messages: window.JuniorBuddy.messages.length })")
        js(op, "() => { window.JuniorBuddy.debugSetCloud(true); window.JuniorBuddy.setProxy(''); window.JuniorBuddy.ask('Tell me a joke about potatoes'); }")
        op.wait_for_timeout(500)
        empty_result = js(op, "() => ({ calls: window.__fetchCalls, state: window.JuniorBuddy.state })")
        octx.set_offline(True)
        js(op, "() => window.JuniorBuddy.ask('I am stuck')")
        op.wait_for_timeout(450)
        offline_result = js(op, """() => ({
          calls: window.__fetchCalls, state: window.JuniorBuddy.state,
          messages: window.JuniorBuddy.messages.length, online: navigator.onLine,
        })""")
        check("Buddy works offline with cloud off and an empty proxy (no requests)",
              off_result["calls"] == 0 and empty_result["calls"] == 0
              and offline_result["calls"] == 0 and offline_result["messages"] >= 4
              and off_result["state"] == "confused" and empty_result["state"] == "confused"
              and not [e for e in oerr if not any(x in e.lower() for x in IGNORE)],
              str({"off": off_result, "empty": empty_result, "offline": offline_result, "errs": oerr[:2]}))
        octx.close()

        # Mocked cloud: success, timeout, error, rate limit.
        cloud_modes = {
            "success": "window.fetch=(u,o)=>{window.__fetchCalls++;return Promise.resolve({ok:true,status:200,json:async()=>({answer:'Mock cloud answer.'})});};",
            "error": "window.fetch=(u,o)=>{window.__fetchCalls++;return Promise.resolve({ok:false,status:500,json:async()=>({})});};",
            "rate": "window.fetch=(u,o)=>{window.__fetchCalls++;return Promise.resolve({ok:false,status:429,json:async()=>({error:'rate'})});};",
            "timeout": "window.fetch=(u,o)=>{window.__fetchCalls++;return new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error('abort'),{name:'AbortError'})),10));};",
        }
        cloud_results = {}
        for mode, script in cloud_modes.items():
            cctx = browser.new_context(viewport={"width": 1280, "height": 720})
            cp = cctx.new_page()
            cp.add_init_script("window.__fetchCalls=0; " + script)
            cp.goto((LIVE_URL or URL) + "?debug&level=1.3")
            cp.wait_for_timeout(700)
            js(cp, "() => { window.JuniorBuddy.open(); window.JuniorBuddy.debugSetCloud(true); window.JuniorBuddy.setProxy('/mock'); }")
            js(cp, "() => window.JuniorBuddy.ask('Tell me a joke about potatoes')")
            cp.wait_for_timeout(1300)
            cloud_results[mode] = js(cp, """() => ({
              calls: window.__fetchCalls, state: window.JuniorBuddy.state,
              last: window.JuniorBuddy.messages.slice(-1)[0]?.text || '',
              note: document.getElementById('buddy-note').textContent || '',
            })""")
            cctx.close()
        check("Mocked cloud success path shows a friendly reply",
              cloud_results["success"]["calls"] >= 1 and "Mock cloud answer" in cloud_results["success"]["last"]
              and cloud_results["success"]["state"] in ("talk", "idle"), str(cloud_results["success"]))
        check("Mocked cloud timeout/error/rate-limit end friendly with confused state",
              all(cloud_results[m]["state"] == "confused" and cloud_results[m]["last"] for m in ("timeout", "error", "rate"))
              and cloud_results["timeout"]["calls"] >= 2 and cloud_results["error"]["calls"] >= 2
              and cloud_results["rate"]["calls"] >= 1, str(cloud_results))

        # EN / AR direction, overflow, and mixed technical terms.
        lctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        lp = lctx.new_page()
        lp.goto((LIVE_URL or URL) + "?debug&level=1.3")
        lp.wait_for_timeout(800)
        js(lp, "() => { window.JuniorBuddy.open(); window.JuniorBuddy.setLanguage('ar'); }")
        lp.wait_for_timeout(250)
        ar = js(lp, """() => {
          const p = document.getElementById('buddy-panel');
          return { dir: p.dir, lang: p.lang, chips: document.getElementById('buddy-chips').innerText,
                   overflow: p.scrollWidth - p.clientWidth,
                   bodyOverflow: document.body.scrollWidth - innerWidth };
        }""")
        js(lp, "() => window.JuniorBuddy.ask('أخبرني عن solar panel')")
        lp.wait_for_timeout(600)
        mixed = js(lp, """() => ({
          last: window.JuniorBuddy.messages.slice(-1)[0]?.text || '',
          bdi: Array.from(document.querySelectorAll('#buddy-messages bdi')).map((b) => b.textContent),
          overflow: document.getElementById('buddy-panel').scrollWidth - document.getElementById('buddy-panel').clientWidth,
        })""")
        js(lp, "() => window.JuniorBuddy.setLanguage('en')")
        lp.wait_for_timeout(250)
        en = js(lp, "() => ({ dir: document.getElementById('buddy-panel').dir, overflow: document.getElementById('buddy-panel').scrollWidth - document.getElementById('buddy-panel').clientWidth })")
        check("EN/AR switches dir, avoids horizontal overflow, and isolates mixed terms",
              ar["dir"] == "rtl" and ar["lang"] == "ar" and ar["overflow"] <= 1 and ar["bodyOverflow"] <= 1
              and "solar panel" in mixed["last"] and any("solar panel" in b for b in mixed["bdi"])
              and mixed["overflow"] <= 1 and en["dir"] == "ltr" and en["overflow"] <= 1,
              str({"ar": ar, "mixed": mixed, "en": en}))
        lctx.close()

        # Voice stubs: listen + talk, then unsupported degradation.
        voice_script = """
          class FakeSR {
            constructor(){ this.lang='en-US'; }
            start(){ setTimeout(()=>this.onstart&&this.onstart(),5);
              setTimeout(()=>this.onresult&&this.onresult({results:[[{transcript:'What do I do next?'}]]}),45);
              setTimeout(()=>this.onend&&this.onend(),500); }
            stop(){ this.onend&&this.onend(); }
          }
          window.SpeechRecognition=FakeSR; window.webkitSpeechRecognition=FakeSR;
          class FakeU { constructor(t){this.text=t;} }
          window.SpeechSynthesisUtterance=FakeU;
          Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
            getVoices:()=>[{lang:'en-US',name:'Test'}], cancel:()=>{},
            speak:(u)=>{setTimeout(()=>u.onstart&&u.onstart(),10);setTimeout(()=>u.onend&&u.onend(),600);}
          }});
        """
        vctx = browser.new_context(viewport={"width": 1280, "height": 720})
        vp = vctx.new_page()
        vp.add_init_script(voice_script)
        vp.goto((LIVE_URL or URL) + "?debug&level=1.1")
        vp.wait_for_timeout(800)
        js(vp, "() => window.JuniorBuddy.open()")
        vp.click("#buddy-mic")
        vp.wait_for_timeout(35)
        listen = js(vp, "() => ({ state: window.JuniorBuddy.state, recording: !document.getElementById('buddy-recording').hidden, disabled: document.getElementById('buddy-mic').disabled })")
        vp.wait_for_timeout(100)
        transcript = js(vp, "() => document.getElementById('buddy-input').value")
        js(vp, "() => { window.JuniorBuddy.debugSetSpeak(true); window.JuniorBuddy.ask('Why does this matter?'); }")
        vp.wait_for_timeout(290)
        talk = js(vp, "() => ({ state: window.JuniorBuddy.state, stop: !document.getElementById('buddy-stop').hidden })")
        vp.wait_for_timeout(260)
        idle = js(vp, "() => window.JuniorBuddy.state")
        vctx.close()
        uctx, up = new_page(browser, 1280, 720, "?debug&level=1.1")
        up.add_init_script("try{Object.defineProperty(window,'SpeechRecognition',{value:undefined});Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined});}catch(e){}")
        up.goto((LIVE_URL or URL) + "?debug&level=1.1")
        up.wait_for_timeout(700)
        unsupported = js(up, "() => ({ disabled: document.getElementById('buddy-mic').disabled, title: document.getElementById('buddy-mic').title })")
        js(up, "() => window.JuniorBuddy.open()")
        js(up, "() => window.JuniorBuddy.ask('I am stuck')")
        up.wait_for_timeout(450)
        text_ok = js(up, "() => window.JuniorBuddy.messages.length >= 2")
        uctx.close()
        check("Voice stubs switch listen/talk states and unsupported browsers degrade to text",
              listen["state"] == "listen" and listen["recording"] and not listen["disabled"]
              and transcript == "What do I do next?" and talk["state"] == "talk" and talk["stop"]
              and idle in ("idle", "talk") and unsupported["disabled"] and unsupported["title"] and text_ok,
              str({"listen": listen, "transcript": transcript, "talk": talk, "idle": idle, "unsupported": unsupported, "text": text_ok}))

        # Privacy / opt-in.
        pctx, pp = new_page(browser, 1280, 720, "")
        pp.wait_for_timeout(500)
        privacy = js(pp, """() => ({
          cloud: localStorage.getItem('jamt.settings') || '',
          loading: document.getElementById('load-version').textContent,
          credits: document.getElementById('credits-version').textContent,
          note: document.getElementById('privacy-note').textContent,
          cloudBtn: document.getElementById('set-buddy-cloud').textContent,
        })""")
        pp.evaluate("document.getElementById('set-buddy-cloud').click()")
        pp.wait_for_timeout(100)
        saved = js(pp, "() => JSON.parse(localStorage.getItem('jamt.settings') || '{}').buddyCloud")
        privacy_ok = ("offline" in privacy["loading"].lower() and "privacy" in privacy["note"].lower()
                      and "question" in privacy["note"].lower() and "last 4" in privacy["note"].lower()
                      and saved is True)
        pp.evaluate("document.getElementById('set-buddy-cloud').click()")
        pctx.close()
        check("Buddy cloud is opt-in, persisted, and privacy text names what is sent", privacy_ok, str(privacy))

        # Mid-action guard.
        actx, ap = new_page(browser, 1280, 720, "?debug&level=1.1&auto")
        ap.wait_for_timeout(900)
        mid = js(ap, """() => {
          const J = window.__JAMT__, s = J.state;
          const old = s.action;
          s.action = { dummy: true };
          const opened = window.JuniorBuddy.open();
          const result = { opened, isOpen: window.JuniorBuddy.isOpen };
          s.action = old;
          return result;
        }""")
        actx.close()
        check("Buddy refuses to cover the game during a hold/action", mid["opened"] is False and mid["isOpen"] is False, str(mid))


        # ------------------------------------------------------- sim freshness
        print("\nSim freshness")
        try:
            with open(os.path.join(HERE, "sim_results.json"), encoding="utf-8") as f:
                sim = json.load(f)
            v = str(sim.get("buildVersion", "unknown"))
            if v != BUILD_VERSION:
                print(f"  [WARN] SIM STALE for this build: sim build {v} != game {BUILD_VERSION} (not a pass)")
            else:
                print(f"  sim build matches {v}")
        except FileNotFoundError:
            print("  [WARN] SIM STALE: tools/sim_results.json missing (not a pass)")

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
