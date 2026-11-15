# Junior Astronaut Mission Trainer — Level 1: The Moon

A pixel-art mission trainer for ages 7–12, built for the **2026 NASA Space Apps Challenge**
challenge *“Build a Junior Astronaut Mission Trainer.”*

Level 1 is complete: **1.1 Outpost Prep**, **1.2 Water Leak**, **1.3 Solar Storm**. Level 2
(Mars) and beyond appear only as locked nodes on the level map.

- Vanilla JS, no build step, **runs by double-clicking `index.html`** (no `fetch`).
- Fixed hand-authored lunar world + camera, A* click-to-move, colliders, y-sorted sprites.
- **PLAN → EVA → RESOLVE** loop: allocate power, walk the base and do physical tasks, then run the sol.
- Offline: system fonts only, all sprites local (`assets/manifest.js`).

```text
index.html   screens + HUD + console + modals
style.css    pixel UI, responsive to 360 px
game.js      engine, rules, world, rendering
assets/      sliced sprites + manifest (source JPGs are git-ignored)
tools/       slice_assets.py · sim.py · qa.py
```



## v3.0.0 — Session 1: carry / deliver economy

The switchboard no longer produces water. **Ice is the only new water**, and every big resource is
now carried by hand to a physical slot.

| Item | Source (restocks each sol) | Slot | Effect |
| --- | --- | --- | --- |
| Ice chunk | SW shaded crater (mine, 1 EVA min, cap 4) | Water tank intake | +12 water |
| Battery canister | Cargo crates (cap 4) | Battery bank (4 slots) | +1 stored cell |
| Solar panel | Crate (1.1/1.3, cap 3) | Solar field (3 slots) | +1 solar cell per sol, permanent |
| O₂ canister | Crate (1.1, cap 2, game assumption) | O₂ rack (2 slots) | +25 O₂ |
| Regolith bag | Soil near the bunker (dig, 1 min, cap 5) | Bunker wall (5 slots) | +8 shielding; bunker protection 50% + 8%/bag |
| Toolbox / tape / repair parts | Crates (1.2) | Leak site | isolate hatch → tape → patch cure |

- Hands carry **1 item**; `Q` / ACT on open ground drops it (items persist). Carried items show a
  badge above the head and the sprite at the hands. Slots pulse a ghost outline when you carry a
  match; wrong slots give a friendly hint and keep the item.
- The **switchboard** (battery bank station) is the only place the `+/−` cells work; a compact
  read-only **Water** strip is always visible. Unspent cells still charge the battery.
- Crew use is now 11 water + 10 O₂ per sol; O₂ cells cost 1 water each. Doing nothing runs the
  crew out of water around Sol 4 (ice deliveries are required).
- QA: **45/45** checks (economy deliveries, wrong slot, drop persistence, flow, touch), plus the
  v2 regression suite.
- **Note:** the balance sim has **not** been retuned for this economy (that is Session 2). The
  table below is the v2-rules table and the QA balance gate still reads it; treat it as stale for
  the new economy.

## Iteration 2 — v2.0.0 (menu flow, briefing, touch, deploy)

**Live:** <https://ahmed-ads.github.io/Nasa/> · still double-clicks from `file://`.

**Shipped in this iteration**
- **Loading screen** with real preload progress (96 sprites), rotating verified tips, and a
  TAP/PRESS-TO-START gate that unlocks audio.
- **Title menu**: START GAME · SETTINGS (sound, touch controls, reduced motion, judge unlock) ·
  CREDITS (NASA sources, AI art, privacy) · QUIT. Settings and stars persist.
- **Quit / pause**: QUIT → YES/NO → goodbye screen; in-level ⏸ / Esc / browser Back opens
  PAUSED (CONTINUE · RESTART · LEVEL MAP · MAIN MENU) with confirmations; auto-pause on tab blur.
  Hash-only routing (`#/title`, `#/map`, `#/brief`, `#/level`, `#/debrief`, `#/goodbye`).
- **Mission briefing** before every sublevel: one-sentence goal, “why this matters for real
  astronauts”, resource table (icon/what/where/goes/does), keyboard + touch controls, START/BACK.
- **Objective tracker** in-level (collapsible, live counts) and an ⓘ button that reopens the briefing.
- **Touch controls**: virtual joystick + large round ACT (hold to act, 2.2 s), tap-to-move kept;
  enabled automatically on coarse pointers and switchable in Settings.
- **GitHub Pages essentials**: relative paths, `.nojekyll`, `BUILD_VERSION` 2.0.0 on
  `style.css`/`game.js`/`manifest.js` (shown in Credits and the title), save schema v2 migration
  that keeps stars and survives corrupt data, `tools/check_assets.py` exact-case asset check,
  system fonts only (no network requests).
- **QA**: 40 Playwright checks at 1280×720 and 390×844 with touch emulation, including loading →
  title → map → briefing → level → pause → confirm → map.

**Deferred (not in this build)**
- Phase C carry/deliver economy (ice, regolith bags, battery/solar/O2 canisters, repair parts,
  physical slots, restocking, switchboard relocation). The v1 switchboard allocation and station
  actions remain the active economy.
- Phase D suit air and rover riding / walk-back ring.
- Phase F new animation strips: the img6 walk/action frames are composited on opaque terrain
  patches and cannot be keyed cleanly (halos/background remain), so the brief says to keep the
  current sprites rather than ship artifacts. The img9 logo (“SURVIVAL OUTPOST”) and buttons are
  not used; UI is CSS.
- Phase G rebalance for the physical economy; the rules and 600-run balance table below still apply.

**Deploy files (commit and push):** `index.html`, `style.css`, `game.js`, `README.md`,
`assets/manifest.js`, `assets/sprites/**`, `tools/qa.py`, `tools/sim.py`,
`tools/sim_results.json`, `tools/slice_assets.py`, `tools/check_assets.py`, `.nojekyll`,
`.gitignore`. Never commit `assets/img*.jpg` (13 MB sources, already ignored).

---

## 1. Run it

Double-click `index.html`. Optional server: `python -m http.server 8000`.

### Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Walk |
| Click / tap the ground | A* pathfind and walk there |
| `E` (hold 2.2 s) / hold the prompt | Do the station task |
| `1` `2` `3` | Add a power cell to row 1/2/3 |
| `Shift` + number | Remove a cell from that row |
| `B` | Draw a cell from the battery |
| `Space` | Start EVA / End EVA |
| `Esc` | Close a modal |
| `⌄` button, bottom right | Collapse / show the console |

The interaction prompt appears whenever you stand in a station radius.

---

## 2. The loop

1. **PLAN** — spend the solar budget across the level's rows. Leftover cells are stored in the
   battery (cap 6). If a dust storm or long shadow cuts the budget, draw from the battery
   (max 2 per sol).
2. **EVA** — you have **3 EVA minutes** per sol. Walk to a station and hold `E` (or hold the
   on-screen prompt). Tasks cost 1–2 minutes. There are no fail screens — you can always end
   the EVA early.
3. **RESOLVE** — production, crew use, wear, the leak, the event, dose, then hearts and the
   win/fail check. The mission log explains every change.

### Stations

| Station | Action |
| --- | --- |
| Solar field (W) | Sweep dust (restores the lost cells), install the spare panel from the crates (+1 cell for the mission, 1.1) |
| Battery bank | Shows stored cells; draw cells in the console |
| O₂ generator / CO₂ scrubber / water recycler | Opens that system's mini-panel: production vs crew use vs wear, with `+/−` cells |
| Comms dish (N) | Space-weather uplink: reveals the CME arrival sol (1.3) |
| Rover + ice patch (SW) | Haul ice: +14 water (1.2) or +8 O₂ (1.3), 2 minutes, +dose in a storm |
| Recycler (1.2) | Close hatch → fetch tape from crates → tape → cure patch → reopen |
| Regolith bunker (NW) | Shelter order (also available as a console button once the CME alert arrives) |
| Crates (S) | Spare solar panel / toolbox + Kapton tape |

The mini-map (bottom right on desktop, top right on mobile) shows stations and `!` markers for
stations that need attention. NPC crew walk between jobs; during a shelter order they head for
the bunker.

---

## 3. Final level rules

All tunables live in `RULES` in `game.js` as `{ value, kind, source }`:
`kind: 'real'` only where the value is grounded in a named NASA source; everything else is
`'game'`. Level goals/starts live in `LEVELS` and each has a plain-language "Game assumption"
string used by the debrief.

| Rule | Value | Kind |
| --- | --- | --- |
| Power budget / battery cap / draws per sol | 6 / 6 / 2 | game |
| Crew use | 10 O₂ + 6 water per sol | game (scaled from NASA life-support baselines) |
| O₂ cell | +10 O₂, uses 2 water | game (ISS O₂ is made by electrolysis — real) |
| Water cell | +9 water | game (ISS recovers ~98% water — real) |
| Shielding cell | +4 shielding | game (regolith shielding — real) |
| Wear per sol | O₂ 5+0.5·sol · water 3+0.4·sol · shielding 4 | game |
| Leak (1.2) | 30 water/sol → isolate 40% → tape 15%; patch = 2 repair-cell sols | game |
| Rationing | −40% crew water; −1 heart after 3 sols **while water < 50**; auto-off when sealed | game |
| Storm dose (1.3) | `70 × (1 − 0.65 × shield/100)` + 2.5 background | shield cut is real (regolith); numbers are game |
| Early vs late shelter | 90% cut if ordered before arrival, 15% if ordered on the arrival sol | game (SPE sheltering is real) |
| CME arrival | Sol 3–5, 1–2 sols long (2 sols 80% of the time) | game (CMEs take ~1–4 days — real) |
| Research | 3 points per surface cell, paused while sheltered | game (≤10% of score) |

**Levels**

| | 1.1 Outpost Prep | 1.2 Water Leak | 1.3 Solar Storm |
| --- | --- | --- | --- |
| Rows | O₂ / water / battery | O₂ / water / repair | O₂ / shielding / surface |
| Start | 38 / 48 / 0 | 65 / 68 | 75 / 30 |
| Win | O₂ ≥ 70, water ≥ 60, battery ≥ 3 on Sol 5 (up to 2 one-sol slips) | hatch reopened **and** water ≥ 40 at end of Sol 6 | dose ≤ 60 **and** O₂ ≥ 30 after Sol 6 |
| Fail | any critical meter 0, 0 hearts, or not ready after 2 slips | | |
| Lesson | battery vs solar, deploy a panel, sweep dust | isolate first, tape, patch, reopen | check the dish, shelter early, dose vs research |

**Stars**: 3 = 3 hearts, no heart lost, landing on time, meters never below 30, dose peak ≤ 40
and score ≥ par (1.1: 340, 1.2: 205, 1.3: 250). Otherwise 2 or 1. Stars persist per sublevel in
`localStorage` (`jamt.progress`, wrapped in `try/catch`).

**Revive** (once per mission) restores every meter to ≥45%, gives 1 heart back and removes the
cause of death — in 1.3 it also drops the dose to 70% of the limit and pushes the storm window
forward, so a revived crew never dies instantly on the next sol.

---

## 4. Bug fixes in this build (all verified by `tools/qa.py`)

| Bug | Fix |
| --- | --- |
| B1 `clamp()` capped pixel coords at 100 | one clamp with 0..100 defaults for resources; world/camera clamps pass explicit bounds |
| B2 resize reset the astronaut and map | fixed 1024×760 world; resize only re-measures the camera |
| B3 player walked under the mobile console | camera targets the visible area; a taller world plus a bottom-edge clamp keep the player above the console |
| B4 no depth sorting | every prop/NPC/player is y-sorted by foot position each frame |
| B5 only the dome collided | 21 colliders (dome, solar, rover, tanks, dish, antenna, crates, bunker, boulders) + A* |
| B6 astronaut was half the dome | astronaut is 66 px vs the 172 px dome (≈38%) |
| B7 1.1 only re-checked at Sol 7 | ready is checked every sol; each slip is one sol |
| B8 “Sol 6 / 5” | HUD shows `Sol n / 5 · slip k` |
| B9 revive kept a lethal dose | revive caps dose at 70% of the limit and moves the storm window |
| B10 ration only cut the leak | ration now cuts crew water use, only costs a heart after 3 sols while water < 50, and auto-stops when sealed |
| B11 hidden patch prerequisite | the repair meter is replaced by a patch bar + a visible 5-step checklist |
| B12 dose ignored the shielding meter | dose is driven by the meter; shelter pauses surface work and O₂ (unless 1 cell goes to O₂); research is ≤10% of score |
| B13 “unspent cells” was impossible | Start EVA is always available; leftover cells charge the battery, and the battery can be drawn on |
| B14 Shift+number broke on real keyboards | `e.code` (`Digit1/2/3`) is used |
| B15 sprites had navy boxes | `slice_assets.py` keys every sprite background (corner-median + flood fill + 1 px erode); terrain tiles stay opaque |
| B16 blurry sprites | integer render scale (2×) and nearest-neighbour `drawImage` |
| B17 Google Fonts failed offline | fonts removed; system monospace/sans stack |
| B18 debug hooks public | `?level`, `?auto`, `?fail`, `?select` only work with `?debug` |

---

## 5. Balance sim (tools/sim.py)

`python tools/sim.py --runs 600` mirrors the engine rules and plays each level with
six policies. Final results:

| Level | Policy | Win % | 3★ % | Avg score |
| --- | --- | --- | --- | --- |
| 1.1 | random | 20.5 | 0.3 | 300 |
| 1.1 | even split | 0.0 | 0.0 | — |
| 1.1 | always shelter / work / never EVA | 0.0 | 0.0 | — |
| 1.1 | good | **100.0** | **100.0** | 341 |
| 1.2 | random | 12.2 | 4.0 | 201 |
| 1.2 | even split | 0.0 | 0.0 | — |
| 1.2 | good | **100.0** | **100.0** | 267 |
| 1.3 | random | 5.2 | 0.0 | 293 |
| 1.3 | even split | 0.0 | 0.0 | — |
| 1.3 | always shelter | 100.0 | 100.0 | 253 |
| 1.3 | always work | 0.0 | 0.0 | — |
| 1.3 | never EVA | 100.0 | 100.0 | 253 |
| 1.3 | good (mixed) | **100.0** | **100.0** | 285 |

Targets: random ≤30% win and ≤5% three-star; even split fails at least one sublevel; always
shelter / always work / never EVA are each out-scored by the mixed strategy; good ≥85% with
≥40% three-star; every sublevel has ≥3 distinct winning strategies.

Three winning strategies per level (sim): 1.1 balanced / O₂-first / water-first; 1.2 fast
isolation / water stockpile / repair heavy; 1.3 balanced shelter / shield wall / research focus.

The sim does not model the optional random spare-parts delivery in 1.2 (it is a small bonus),
so its 1.2 numbers are slightly conservative.

---

## 6. NASA accuracy and sources

Facts used (verified on NASA/NASA-partner material):

- ISS oxygen comes from **electrolysis of water** (Oxygen Generation Assembly, ECLSS).
- ISS ECLSS recovers **about 98% of water** (2023 NASA update — the older “90%” figure is fixed).
- ISS leak procedure: **close hatches, locate the leak, Kapton tape, then epoxy**. The 2018
  Soyuz leak was a **drilled hole**, not a micrometeoroid.
- Solar particle events: crews **shelter in place**; about **4 g/cm² of regolith** is enough to
  get below 30-day exposure limits.
- **CMEs take about 1–4 days to arrive** (NASA DONKI / space weather).
- **Galactic cosmic rays** are very high energy; extra thickness barely reduces them.
- **South-pole crater rims get near-constant sunlight** — hence “Long Shadow”, never a 14-day night.
- **Lunar dust is abrasive** and degrades panels and seals.
- **Shackleton crater** holds water ice in permanently shadowed regions (LRO, LCROSS).

Sources: NASA ECLSS / ISS, NASA Space Weather & DONKI, NASA Moon (LRO, Diviner, LCROSS),
NASA radiation research (Artemis), NASA lunar dust research. See the in-game **Mission Science**
modal for the rule → source → simplification table.

Everything numeric that is not directly from a source is labelled **Game assumption** in the
debrief (one card per mission) and in `RULES`.

---

## 7. QA

```bash
python -m pip install playwright pillow
python -m playwright install chromium
python tools/sim.py --runs 600   # balance table + tools/sim_results.json
python tools/qa.py               # 31 Playwright checks at 1280x720 and 390x844
```

`tools/qa.py` checks: no console errors, the four world corners, collider blocking, y-sort,
position survives resize, the player is above the mobile console, one regression assert per bug
B1–B18, keyed sprites/opaque tiles, nearest-neighbour drawing, offline fonts, debug gating, and
the balance targets. Screenshots are written to `tools/qa_shots/`.

---

## 8. Asset pipeline

`python tools/slice_assets.py` slices the five catalog sheets into
`assets/sprites/<group>/<name>.png` and writes `assets/manifest.js`.

- Boxes were measured with a connected-component pass over each sheet, then curated by eye.
- Every sprite background is keyed with a **corner-median colour + edge flood fill + 1 px erode**
  (works for the gray main sheet, navy panels and black FX panels).
- **Terrain tiles stay opaque** (they are full-bleed ground art).
- Sprites are downscaled to ≤160 px with LANCZOS; the game draws them at integer scale with
  nearest-neighbour sampling.
- The Mars tunnel entrance is re-tinted cool gray for the Moon.

The source JPGs (~13 MB) and `tools/preview_sprites.png` are git-ignored; the sliced PNGs and
manifest are committed.

---

## 9. Debug / QA hooks and guesses

Hooks (only with `?debug`): `?debug&level=1.2`, `?debug&level=1.1&auto=6`,
`?debug&select`, `?debug&level=1.2&fail=1`. `window.__JAMT__` exposes read-only state and QA
helpers (`walkTo`, `checkWin`, `resolveSol`, `drawOrder`, `consolePx`).

Decisions I had to guess:

1. **World size** — 1024×760 (≈2.7× a 640×360 viewport area), enough for the asked layout while
   still readable on a 360 px phone.
2. **Map labels** — “solar field west / utility yard east / comms north / rover south / bunker
   NW / ice SW” were turned into concrete world coordinates; the dome is centre.
3. **EVA minutes are a budget, not a real-time clock** — tasks consume minutes; there is no
   fail screen and no timer pressure.
4. **“Hold-to-do” = 2.2 s**, inside the requested 2–4 s band.
5. **Shelter timing** — “anyone outside at particle arrival takes the full dose” is modelled as
   90% protection if the order is given before the arrival sol, 15% if given on the arrival sol.
6. **The bunker is a station + a console button** (the brief only said the order makes the crew
   walk); both set the same flag.
7. **1.1 panel** gives a permanent +1 cell; the crate fetch and the install each cost 1 minute.
8. **Research** is 3 points/cell (≈10% of score) and 0 while sheltered.
9. **Stars**: 3 requires a clean run (no heart lost, no meter below 30, dose peak ≤40, score par)
   on top of hearts — this is what keeps random play at ≤5% three-star.
10. **1.2 spare parts** are a 30% random delivery that adds one patch step (the sim omits it).
11. **Screenshot/QA hooks** and `window.__JAMT__` are always present for tests but the URL hooks
    are gated behind `?debug` as requested.

---

## 10. Credits

Code, level design and science copy: Junior Astronaut team. Sprite art: AI-generated catalog
sheets sliced by `tools/slice_assets.py`. Built for the NASA Space Apps Challenge 2026 —
educational model, not engineering-grade.
