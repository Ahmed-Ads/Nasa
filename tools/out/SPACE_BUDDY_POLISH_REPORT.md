# Space Buddy 3.3.0 polish report

- Branch: `feature/space-buddy-polish`
- Base: `origin/main` `cf2bb8a` (includes Buddy PR #6 and rename PR #8)
- Release version: **3.3.0**
- Date: 2026-11-16
- Status: commits are local; the branch had not been pushed when this report was written.

## Commit series

| Commit | Purpose |
| --- | --- |
| `b94a927` | `feat(ui): add Full/Focus panels with persistent P toggle` |
| `9a4dec4` | `feat(ice): slice outcrop sprite and move ice source closer` |
| `59b0b61` | `feat(rover): use sliced seated riding sprite with mirror and roll dust` |
| `4cccbfe` | `feat(loading): add img14 parallax scene and live runner` |
| `b72f5c3` | `feat(icons): add transparent pixel moon favicon set` |
| `e4c8c6c` | `fix(ui): finish HUD, thumb panels and coach controls` |
| `8b41f4b` | `fix(loading): remove background plates from img14 cutouts` |
| `85421d8` | `test(qa): cover panel polish, loading runner and icons` |
| `705c737` | `fix(ui): reset dock toggle labels on a new level` |

The documentation/screenshot commit adds this report; `705c737` is the last small
UI-reset fix. Each feature above is independently revertable with `git revert <hash>`.

## Panels

- Desktop `1.1` Day 1 starts **Full**; desktop `1.2`, `1.3`, later starts and all
  compact/phone starts use **Focus**. An explicit `P` choice is stored in the existing
  `jamt.settings` record under `panels`.
- The HUD keeps the four persistent facts in both modes on phones: **hearts, day,
  air and a one-line goal**. Full mode on a phone uses a two-row HUD and moves the
  coach and tracker below it so nothing is covered.
- The phone thumb button is 46x46 px, stays in the lower-left safe-area zone, clears
  the thumbstick, ACT button and Buddy, and opens the bottom drawer in one tap. Plan
  power is visible immediately; the landscape drawer remains capped at `22vh`.
- Dock headers collapse independently (`#dock-left-collapse`, `#dock-right-collapse`).
- Panels auto-hide during a station hold or Buddy chat. The coach becomes one faded,
  non-wrapping line after the first action. `P` is ignored while typing in Buddy chat.
- QA overlap checks use the real `.dock-left` / `.dock-right` columns, not the
  full-screen `#panel` container.

## Ice

- Committed `assets/ice/deposit.png` (128x58) and `assets/ice/chunk.png` (40x33),
  registered in `assets/manifest.js` and `tools/check_assets.py`.
- The source is `148,552`; the legacy overlapping `{id:'ice', …}` station was removed,
  so mining starts at the outcrop and the deposit is rendered.
- Base → ice → tank → base is **1824 px → 1312 px**. The four-chunk air trip is
  **48.9% → 35.2%** of a full suit. Ice remains the farthest source and still triggers
  “That is far. Use the rover!”.
- The old ice-patch draw was removed; the digging animation and rules are unchanged.

## Rover

- `assets/rover/ride.png` (128x122) is the mounted rider, drawn at 92x88, facing right
  and mirrored when driving left.
- Roll bob and optional dust are used while moving. The source sheet has **no distinct
  wheel-spin frames**, so wheels stay static; the old rover + walker remain the fallback
  when the rider slice is missing.
- Hitbox, speed, capacity and battery behavior are unchanged and covered by the
  existing rover regression checks.

## Loading

- Nine transparent `img14` cutouts in `assets/loading` plus the procedural starfield.
  Total committed loading art: **52,230 bytes** (< 300 KB).
- The latest slicer uses a parent-pixel flood for the gradient background so
  satellites, asteroids and the ringed planet no longer leave rectangular plates.
  Planet/astronaut cutouts use a tighter local flood; all nine resolve from the manifest.
- The astronaut follows the real `Loading... N/M` count, stops and celebrates at 100%,
  and the START gate stays disabled until loading completes. Reduced motion is handled.
- Art swaps are manifest-only; no gameplay code paths were changed.
- The loader counted **191/191** assets in the final checks.

## Favicon

- Transparent pixel-art moon in `assets/icons/`:
  `favicon.svg`, `favicon.ico`, and PNGs at 16, 32, 48, 180, 192 and 512 px.
- The 16x16 icon is readable and has no black/magenta fringe in the checker preview.
- Head links use `?v=3.3.0`; the old favicon links are gone. QA checks dimensions,
  corner alpha and file/HTTP 404s.
- Preview: `tools/out/favicon_preview.png`.

## QA evidence

Commands run from `C:\Projects\Nasa`:

```text
python tools/check_assets.py
  checked 221 references
  all asset paths exist with exact case

node --check <every .js file>
  all JS syntax ok

python tools/qa.py
  166/166 checks passed

python tools/qa.py --url http://127.0.0.1:8765
  166/166 checks passed

python tools/sim.py --runs 600
  build 3.3.0; 22/22 targets pass
```

HTTP console/404 pass: `tools/out/http_404_check.txt` records, for `1.1`, `1.2` and
`1.3`, **0 console/page errors, 0 4xx/5xx responses, 0 failed requests**, and
**191/191 assets** loaded.

The polish QA section covers Full/Focus default and persistence, typing-safe `P`,
hold/chat auto-hide, faded coach, dock collapse, the phone thumb button/drawer, six
sizes in both modes, loading runner/gate/budget/reduced motion, favicon alpha/size/404,
and sliced-art registration. `tools/sim_results.json` now records the current build
version so the sim freshness warning is gone.

## Screenshots (`tools/out`)

- Panels: `panel_full_1280x720_en.png`, `panel_focus_1280x720_en.png`,
  `panel_full_390x844_en.png`, `panel_focus_390x844_en.png`.
  Extra full-mode checks: 360x640, 768x1024 and 844x390.
- Buddy Arabic: `buddy_ar_1280x720.png`, `buddy_ar_390x844.png`.
- Loading at 0/50/100%: `loading_000_*`, `loading_050_*`, `loading_100_*` at
  1280x720 and 390x844.
- Ice: `ice_deposit_1280x720.png`, `ice_deposit_390x844.png`.
- Rover rider: `rover_ride_1280x720.png`, `rover_ride_390x844.png`.
- Favicon: `favicon_preview.png`.
- Regression captures refreshed by QA: `action_check.png`, `coach_check.png`,
  `layout_desktop.png`, `layout_phone.png`, `walk_check.png`.

## Not verified / caveats

- **Real devices**: no physical iOS Safari or Android Chrome pass was run. Safe-area
  env() and touch behavior were tested in Chromium emulation only. Screen-reader and
  OS-level reduced-motion behavior were not device-tested.
- **Arabic UI matrix**: the shipped game chrome and HUD are English-only; only Buddy
  has an existing EN/AR translator. The report includes Arabic Buddy screenshots and
  the existing RTL/brand `<bdi>` QA, but not Arabic Full/Focus chrome screenshots.
- **Favicon at OS scale**: dimensions, alpha and 16x16 readability were checked; actual
  browser-tab/OS icon rendering and cache behavior were not tested on real devices.
- **Rover wheel spin**: source art has no wheel-spin frame; static wheels with roll bob
  and dust are intentional. The fallback path is covered by QA.
- **Landscape drawer**: Full is intentionally capped at `22vh`; it is usable but tight.
  Portrait phone layouts are the primary Full experience.
- No PWA manifest exists, so installability/apple-touch startup behavior was not added
  or tested.
- No localStorage keys, repository name, URL, filenames, levels, balance rules or the
  digging animation were renamed or changed. The sim was re-run on the same rules; only
  its recorded build version and sampled results were refreshed.
