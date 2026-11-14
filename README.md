# Junior Astronaut Mission Trainer — Level 1: The Moon

A pixel-art mission trainer for ages 7–12, built for the **2026 NASA Space Apps Challenge**
challenge *“Build a Junior Astronaut Mission Trainer.”*

You run **Shackleton Outpost** at the lunar south pole. Each sol you spend a small budget of
power cells across life-support systems, then a hazard hits and every meter moves. Level 1 is
complete: **1.1 Lunar Outpost Prep**, **1.2 Water Leak**, **1.3 Solar Storm**. Level 2 (Mars)
and beyond are locked placeholders on the level-select map.

- No framework, no backend, no login, no build step.
- Opens by **double-clicking `index.html`** (all local assets are plain `<script>`/`<img>`; no `fetch`).
- Works at **360 px** and on desktop, keyboard and mouse/touch.

---

## 1. Run it

```text
Double-click index.html
```

Optional local server (nicer for some browsers):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Deep links used for demos and QA:

| URL | What it does |
| --- | --- |
| `index.html` | Title screen |
| `index.html?select` | Jump to the level select |
| `index.html?play` | Start 1.1 immediately |
| `index.html?level=1.2` | Start a specific sublevel |
| `index.html?level=1.1&auto=6` | Auto-play N sols (QA screenshots) |
| `index.html?level=1.3&auto=3&nochoice=1` | Stop on the storm decision (QA) |

### Controls

| Input | Action |
| --- | --- |
| Click / tap `+` `−` | Add or remove a power cell for that system |
| `1` `2` `3` | Add a cell to row 1 / 2 / 3 |
| `Shift` + `1` `2` `3` | Remove a cell from that row |
| `Space` | Run the sol |
| `B` | Draw one cell from the battery |
| `R` | Toggle water rationing (1.2) |
| `W A S D` / arrows, or click the map | Walk the astronaut around the outpost |
| `Esc` | Close a modal |
| `Enter` | Start / next mission / retry |

---

## 2. Level 1 missions

| | 1.1 Lunar Outpost Prep | 1.2 Water Leak | 1.3 Solar Storm |
| --- | --- | --- | --- |
| Rows | O₂, Water, Battery | O₂, Water, Repair | O₂, Shielding, Surface work |
| Length | 5 sols (extendable to 7) | 6 sols | 6 sols |
| Win | O₂ ≥ 70, Water ≥ 60, Battery ≥ 3 on Sol 5 | Leak sealed **and** Water ≥ 40 at end of Sol 6 | Dose ≤ 60 **and** O₂ ≥ 30 after Sol 6 |
| Fail | any critical meter at 0, or 0 hearts; still not ready on Sol 7 | | |
| Twist | Long Shadow / dust cost solar cells; unspent cells charge the battery | Pipe rupture: −12 water/sol. Tape (−60%) then a 3-repair-cell patch. Rationing saves 40% but costs a heart after 3 sols | CME warning on Sol 2, storm on Sol 4–5: **shelter** (safe dose, no work) or **keep working** (2× research, dose up) |
| Teaches | power vs. battery storage, electrolysis water cost | two-stage leak repair, rationing trade-offs | radiation dose, sheltering, research vs. risk |

Every mission ends on a **debrief**: stars, score breakdown, what went well, what hurt, one
**Real NASA** card with a source, and one clearly labelled **Game assumption** card.

### Shared rules (all sublevels)

- **Power budget** = 6 cells, minus solar penalties (dust / long shadow). You must spend the
  whole budget to run a sol.
- **Battery** stores unspent cells (cap 6). `Draw +1` converts a stored cell into one more cell
  this sol (max 2 draws), so a shadowed sol can be covered.
- **Daily wear** grows slowly with the sol number. Meters are clamped to 0–100.
- **Couplings** (visible in the forecast, tooltips and log):
  - every **O₂ cell** costs 3 water (electrolysis);
  - **water recycling** needs power — with no water cells, water only drains;
  - **shielding cells** reduce radiation dose;
  - **repair drones** need power, so they compete with life support.
- **Hearts**: start with 3. Any critical meter under 20% at the end of a sol costs 1 heart.
  A meter at 0 or 0 hearts ends the mission. **One free Revive** per mission restores every
  meter to at least 45% and gives 1 heart back.
- **Stars** = hearts left (1–3), capped at 2 if the 1.1 landing is delayed, and capped at 2 if
  the final score is under 260 (“survived, but barely”). **Score** = end resources + research +
  hearts × 25 + mission bonuses. Stars are saved per sublevel in `localStorage`
  (`jamt.progress`, always inside `try/catch`).
- 1.2 unlocks after any 1.1 win; 1.3 after any 1.2 win.

---

## 3. Architecture

```text
index.html            screens: title, level select, game HUD + console, debrief, modals
style.css             pixel “mission control” UI, responsive down to 360 px
game.js               engine + level data + canvas scene + sprites
assets/manifest.js    generated map: sprite name → path + size
assets/sprites/...    generated PNGs (keyed or opaque)
assets/img1..5.jpg    source sprite sheets (catalog art)
tools/slice_assets.py Pillow cropping/keying script (run to regenerate sprites)
tools/preview_sprites.png  optional contact sheet (python tools/slice_assets.py --preview)
```

### Level config format

`LEVELS` in `game.js` is the only place mission rules live. Example (abridged):

```js
'1.2': {
  id: '1.2', index: 2, title: 'Water Leak', kicker: 'Repair · 6 sols',
  location: 'Recycler deck · Shackleton Outpost',
  brief: 'A recycler pipe ruptured…',
  art: 'select/moon_base',                 // sprite key for the level card

  rows: ['o2', 'water', 'repair'],         // which allocation rows appear
  start: { o2: 65, water: 78, repair: 40 },
  budget: 6,
  gains: { o2: 10, water: 9, repair: 12 }, // per power cell
  wear: { o2: 5, water: 3 },               // per sol
  wearGrowth: { o2: 0.7, water: 0.5 },     // extra wear × sol number
  coupling: { waterPerO2: 3 },             // electrolysis cost

  leak: { rate: 12, taped: 4.5 },          // level-specific rule
  repairNeeded: 3, tapeCost: 1, rationFactor: 0.4,
  maxSols: 6,
  schedule: ['leak', 'calm', 'dust', 'cold', 'calm', 'calm'],

  debrief: { real: '…', source: 'Source: …', assume: 'Game assumption: …' },
}
```

The generic resolver does: **gains → couplings → research → wear → event → level rules →
hearts → win/fail**, then logs every change. Nothing in the UI is hard-coded to a mission.

### Add a sublevel

1. Add an object to `LEVELS` (copy 1.2 and edit the numbers).
2. Add its id to `LEVEL_ORDER` (unlock order).
3. Give it an `art` sprite key from `assets/manifest.js` (or a `★` fallback is used).
4. Wire any new special rule in `resolveSol` under `if (L.yourRule)`, and its win check in
   `checkWin`.
5. Add the debrief text (real NASA + game assumption).
6. Open `index.html?level=YOUR.ID` to test, then run the QA pass below.

### Sprite integration and fallbacks

- `assets/manifest.js` is loaded before `game.js`; every sprite is preloaded with
  `new Image()`. `SPR[key].ok` flips on load.
- Drawing uses `drawAsset()` (bottom-centre anchor, aspect-fit, optional flip). If a sprite is
  missing or failed, the procedural pixel art is used instead — the game never breaks.
- The HUD icons are `<img>` with an `onerror` that swaps to a text glyph.
- The canvas is logical **~360–640 px wide** (depends on viewport) and CSS-scaled with
  `image-rendering: pixelated`. Sprite PNGs are pre-downscaled to ≤ 160 px with LANCZOS so
  they stay crisp at 1:1/2× without shimmer.

---

## 4. Sprite pipeline

`tools/slice_assets.py` crops the five catalog sheets into `assets/sprites/<group>/<name>.png`
and writes `assets/manifest.js`.

```bash
python -m pip install pillow numpy scipy
python tools/slice_assets.py --preview
```

What it does:

1. Crops each measured box (boxes were found with a connected-component pass over each sheet,
   then curated by eye).
2. **`img5.jpg` only:** keys the flat gray background to transparency (border flood-fill +
   distance feather to remove JPG fringe).
3. **`img1–4`:** left opaque on their dark navy background, per the challenge guidance — they
   are used on dark panels (level select, debrief art, forecast art).
4. Re-tints the Mars tunnel entrance to cool gray for the Moon (`TINT_GRAY`).
5. Trims, downscales to a per-sprite max size, and writes the JS manifest.

Source sheets and what was taken from them:

| Sheet | Used for |
| --- | --- |
| `img5.jpg` (gray, keyed) | domes, tunnel, radiation module, solar arrays, battery, cable, relay, tanks, recycler, pipes, monitors, HUD icons, repair items, water leak, dust, astronaut poses, rover, dishes, antenna, drills, terrain tiles |
| `img4.jpg` (opaque) | micrometeoroid rocks, explosion, broken pipe, radiation sign, crew poses (crate/tablet/welding/rover) — UI/debrief and hazard art |
| `img3.jpg` (opaque) | lunar terrain tiles (plain, ridge, slope, cave, cracks, ice), door, ladder |
| `img2.jpg` (opaque) | moon level nodes, star, level number badges, “MISSION CONFIRMED”, “COMPLETED” badge, sun, meteor streaks, shuttle |
| `img1.jpg` (opaque) | Cislunar/Mars/Ocean sector maps, Moon/Mars/Europa planets, capsule, lander, launch-window plate |

The sheets themselves (`assets/img1..5.jpg`, ~13 MB) are inputs, not runtime needs; they can be
git-ignored once `assets/sprites/` is committed.

---

## 5. Science and sources

Every rule starts from real NASA work. Numbers invented for play are labelled **Game
assumption** in the debrief and in the in-game *Mission Science* modal.

| In-game rule | Real NASA science | Simplification |
| --- | --- | --- |
| O₂ cells consume water | ISS oxygen comes from **electrolysis of water** (Oxygen Generation Assembly, ECLSS) | 1 cell = +10 O₂, costs 3 water *(game assumption)* |
| Water recycling | ISS ECLSS recovers about **98% of water** (2023 NASA ECLSS update; older material says ~90%) | 1 cell = +9 water; no cell = water drains *(game assumption)* |
| Leak repair | ISS procedure: close hatches, locate the leak, **Kapton tape**, then epoxy. The 2018 Soyuz leak was a **drilled hole**, not a micrometeoroid | Tape −60%, permanent patch = 3 repair cells |
| Solar storm | Solar particle events: crews **shelter in place**; ~**4 g/cm²** of regolith gets below 30-day exposure limits | Bunker = safe dose; shielding cells trim the rest |
| Cosmic rays | Extra shielding barely reduces galactic cosmic rays (very high energy) | Shielding never reduces dose to zero |
| Solar power at the pole | South-pole crater **rims get near-constant sunlight**; terrain still shadows arrays | “Long Shadow” removes 2 solar cells for a sol — *not* a 14-day night |
| Water ice | **Shackleton crater** holds water ice in permanently shadowed regions (LRO, LCROSS) | Ice find = +12 water |
| Micrometeoroids | Lunar dust and micrometeoroid research | Meteor events wear shielding |
| Radiation dose | NASA career exposure limits are complex, model-dependent | 0–100 meter, danger at 60 *(game assumption)* |

Sources (NASA top-level pages; search within for the cited item):

- NASA ECLSS / ISS life support — <https://www.nasa.gov/international-space-station/>
- NASA Space Weather — <https://science.nasa.gov/earth/space-weather/>
- NASA Moon / LRO / Diviner — <https://science.nasa.gov/moon/> and <https://science.nasa.gov/mission/lro/>
- NASA radiation research (Artemis, SPE sheltering) — <https://www.nasa.gov/humans-in-space/>
- NASA Space Apps Challenge — <https://www.spaceappschallenge.org/>

**Corrections baked into this build**

- Water recycling is **~98%**, not 90%.
- The ISS leak response is **tape + epoxy**; the 2018 leak was a **drilled hole**, not a
  micrometeoroid — the debrief says so explicitly.
- Level 1 uses **Long Shadow**, not a 14-day lunar night.
- The welcome text no longer mentions “fed” (Level 1 has no food row).

---

## 6. QA checklist (verified in this build)

- [x] 1.1, 1.2, 1.3 play start-to-finish with **win** paths (auto-shelter for 1.3).
- [x] **Fail** path verified (1.2 without sealing) plus hearts/zero-resource ends.
- [x] Debrief shows stars, score, went-well / hurt lists, Real NASA + Game assumption cards.
- [x] Retry and Mission Map reset state including timers (`runId`) and fx.
- [x] No uncaught JS errors in headless Edge; only expected AudioContext autoplay notices.
- [x] 360 px layout: stacked console, icon-only rows, full-width Run button.
- [x] Desktop 1440×900 and 1280×800 layouts.
- [x] Locked levels cannot be opened; stars persist via `jamt.progress`.
- [x] Missing sprite → procedural fallback (dome, astronaut, rover, icons).
- [x] Level 2+ appear only as locked nodes (Mars, Ocean Worlds, Deep Space).

---

## 7. Roadmap

- Level 2 · Mars — dust storms, long nights, ISRU oxygen.
- Level 3 · Ocean Worlds — Europa / Enceladus / Titan nodes (art already sliced).
- Reuse the level format: each new sublevel is a config object plus a debrief.

---

## 8. Credits

Code, level design and science copy: Junior Astronaut team.
Sprite art: AI-generated catalog sheets (`assets/img1..5.jpg`) sliced by
`tools/slice_assets.py`. Fonts: Press Start 2P + Nunito (Google Fonts, with system fallbacks).
Built for the NASA Space Apps Challenge 2026 — educational model, not engineering-grade.
