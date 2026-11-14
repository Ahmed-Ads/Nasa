/* ==========================================================================
   Junior Astronaut Mission Trainer — Level 1 (The Moon)
   1.1 Outpost Prep · 1.2 Water Leak · 1.3 Solar Storm

   Vanilla JS. No build step. Runs from file:// (no fetch).
   Fixed world + camera, A* click-to-move, colliders, y-sorted sprites,
   PLAN -> EVA -> RESOLVE loop, EVA minutes, station interactions.

   Every tunable lives in RULES / LEVELS with { value, kind, source } so the
   debrief, Mission Science and README can label real NASA data vs game maths.
   ========================================================================== */
(() => {
  'use strict';

  /* ====================================================== asset preloading == */
  const SPR = {};
  const manifest = window.JAMT_ASSETS || {};
  for (const [key, info] of Object.entries(manifest)) {
    const img = new Image();
    SPR[key] = { img, ok: false, w: info.w, h: info.h };
    img.onload = () => { SPR[key].ok = true; if (window.__jamtOnAsset) window.__jamtOnAsset(); };
    img.onerror = () => { SPR[key].ok = false; };
    img.src = info.src;
  }

  /* ================================================================ rules == */
  // kind:'real' = verified on a NASA source (named); kind:'game' = tuned for play.
  const RULES = {
    budget:            { value: 6,  kind: 'game', source: 'balance' },
    maxDrawPerSol:     { value: 2,  kind: 'game', source: 'balance' },
    batteryCap:        { value: 6,  kind: 'game', source: 'balance' },
    crewO2:            { value: 10,  kind: 'game', source: 'scaled from NASA life-support baselines' },
    crewWater:         { value: 6,  kind: 'game', source: 'scaled from NASA life-support baselines' },
    o2PerCell:         { value: 10,  kind: 'game', source: 'balance; ISS O2 from water electrolysis (NASA ECLSS)' },
    waterPerCell:      { value: 9, kind: 'game', source: 'balance; ISS recovers ~98% water (NASA ECLSS 2023)' },
    waterRecovery:     { value: 0.98, kind: 'real', source: 'NASA ECLSS 2023 update' },
    electrolysisWater: { value: 2,  kind: 'game', source: 'balance' },
    shieldPerCell:     { value: 4, kind: 'game', source: 'balance; regolith shielding (NASA radiation research)' },
    surfacePerCell:    { value: 8,  kind: 'game', source: 'balance' },
    researchPerCell:   { value: 3,  kind: 'game', source: 'balance (<=10% of score)' },
    leakRate:          { value: 30, kind: 'game', source: 'balance' },
    leakIsolated:      { value: 0.40, kind: 'game', source: 'balance' },
    leakTaped:         { value: 0.15, kind: 'game', source: 'balance' },
    patchNeeded:       { value: 2,  kind: 'game', source: 'balance (2 sols of repair cells)' },
    rationCut:         { value: 0.40, kind: 'game', source: 'balance' },
    rationHeartAfter:  { value: 3,  kind: 'game', source: 'balance' },
    stormPower:        { value: 70, kind: 'game', source: 'balance' },
    stormShieldCut:    { value: 0.65, kind: 'real', source: 'regolith/PE shielding reduces SPE dose (NASA)' },
    bunkerCut:         { value: 0.90, kind: 'real', source: 'SPE sheltering in place (NASA)' },
    backgroundDose:    { value: 2.5,  kind: 'game', source: 'balance; GCR barely shielded (NASA)' },
    doseLimit:         { value: 60, kind: 'game', source: 'balance' },
    iceWater:          { value: 14, kind: 'game', source: 'Lunar ice (LRO/LCROSS); amount is a game value' },
    iceO2:             { value: 8,  kind: 'game', source: 'balance' },
    iceDose:           { value: 6,  kind: 'game', source: 'balance' },
    evaMinutes:        { value: 3,  kind: 'game', source: 'inspired by EVA planning near shelter' },
    holdSeconds:       { value: 2.2, kind: 'game', source: 'input feel' },
  };

  const MAX_HEARTS = 3;
  const CRITICAL = 20;

  const ROWS = {
    o2:        { name: 'Oxygen', short: 'O₂', glyph: 'O₂', color: '#5ac8ff', sprite: 'icons/o2' },
    water:     { name: 'Water', short: 'Water', glyph: 'H₂O', color: '#56c8ff', sprite: 'icons/water' },
    repair:    { name: 'Repair', short: 'Repair', glyph: '🛠', color: '#ffb02e', sprite: 'icons/shield' },
    shielding: { name: 'Shielding', short: 'Shield', glyph: '🛡', color: '#ffb02e', sprite: 'icons/shield' },
    surface:   { name: 'Surface', short: 'Work', glyph: '⛏', color: '#c48bff', sprite: 'external/drill' },
    battery:   { name: 'Battery', short: 'Battery', glyph: '🔋', color: '#7ce38b', sprite: 'icons/battery', kind: 'cells' },
  };

  const LEVELS = {
    '1.1': {
      id: '1.1', index: 1, title: 'Lunar Outpost Prep', kicker: 'Tutorial · 5 sols',
      location: 'Shackleton Rim', brief: 'Get the outpost ready before the crew lands. Balance oxygen, water and battery charge.',
      art: 'select/moon_satellite',
      rows: ['o2', 'water', 'battery'],
      start: { o2: 38, water: 48, battery: 0 },
      goals: { o2: 70, water: 60, battery: 3 },
      goalsSol: 5, maxSlip: 2,
      schedule: ['calm', 'calm', 'longshadow', 'calm', 'calm', 'dust', 'calm'],
      hints: { 1: 'Sweep the solar field, then start the EVA. Leftover cells charge the battery.', 2: 'Long shadow next sol: top up the battery today.' },
      debrief: {
        real: 'On the ISS, oxygen is made by electrolysing water with electricity. Power, water and oxygen are one linked system. South-pole crater rims also get near-constant sunlight, so arrays are shadowed by terrain rather than a 14-day night.',
        source: 'Sources: NASA ECLSS (Oxygen Generation Assembly); NASA Moon / LRO.',
        assume: 'Game assumption: 1 power cell = +10 O₂ and costs 2 water; crew of 3 uses 10 O₂ and 6 water per sol; the battery goal of 3/6 is tuned for play.',
        choice: 'Real crews would charge the batteries and test life support before the crew arrives — solar power alone is not enough at the pole.',
      },
    },
    '1.2': {
      id: '1.2', index: 2, title: 'Water Leak', kicker: 'Repair · 6 sols',
      location: 'Recycler deck', brief: 'A recycler pipe ruptured. Isolate it, tape it, patch it, and keep enough water for the crew.',
      art: 'select/moon_base',
      rows: ['o2', 'water', 'repair'],
      start: { o2: 65, water: 68 },
      maxSols: 6,
      schedule: ['calm', 'calm', 'dust', 'cold', 'calm', 'calm'],
      hints: { 1: 'Walk to the recycler: close the hatch, fetch tape from the crates, then tape the leak.' },
      debrief: {
        real: 'ISS leak response: close hatches, locate the leak, seal it with Kapton tape, then cure epoxy over it. The 2018 Soyuz leak was a drilled hole — not a micrometeoroid.',
        source: 'Sources: NASA / Roscosmos ISS leak reports, 2018–2020.',
        assume: 'Game assumption: the burst drains 30 water/sol; isolation cuts it to 40% but takes the recycler offline; 2 repair-cell sols cure the patch; rationing saves 40% of crew water.',
        choice: 'Real crews isolate the module first, then find and tape the leak before running the system again.',
      },
    },
    '1.3': {
      id: '1.3', index: 3, title: 'Solar Storm', kicker: 'Space weather · 6 sols',
      location: 'South pole surface', brief: 'A CME is on the way. Check the dish, shelter the crew, and watch the radiation dose.',
      art: 'select/planet_moon',
      rows: ['o2', 'shielding', 'surface'],
      start: { o2: 75, shielding: 30 },
      dose: true,
      maxSols: 6,
      schedule: ['calm', 'cme', 'calm', 'calm', 'calm', 'calm'],
      hints: { 2: 'Space weather alert — walk to the comms dish to learn when the storm arrives.' },
      debrief: {
        real: 'For solar particle events, crews shelter in place. About 4 g/cm² of regolith is enough to get below 30-day exposure limits, and CMEs take roughly 1–4 days to arrive (NASA DONKI). Extra shielding barely reduces galactic cosmic rays.',
        source: 'Sources: NASA space radiation research / Artemis; NASA DONKI; NASA Space Weather.',
        assume: 'Game assumption: dose 0–100, danger at 60; CME arrival Sol 3–5; early bunker shelter cuts 90% of the storm dose (late shelter only 15%); research is capped at ~10% of score.',
        choice: 'Real crews would shelter during the particle event and schedule surface work around shelter access.',
      },
    },
  };
  const LEVEL_ORDER = ['1.1', '1.2', '1.3'];
  const FUTURE = [
    { title: 'Level 2 · Mars', note: 'Dust storms, long nights', art: 'select/planet_mars', tag: 'NEXT' },
    { title: 'Level 3 · Ocean Worlds', note: 'Europa · Enceladus · Titan', art: 'select/planet_europa', tag: 'LOCKED' },
    { title: 'Level 4 · Deep Space', note: 'Icy moons and stations', art: 'select/moon_base', tag: 'LOCKED' },
  ];

  /* ================================================================ state == */
  const state = {
    screen: 'title',
    phase: 'plan',            // plan | eva | resolve
    levelId: null, level: null,
    sol: 1,
    hearts: MAX_HEARTS,
    res: {},
    alloc: {},
    budget: 6,
    draws: 0,
    battery: 0,
    dose: 0,
    research: 0,
    schedule: [],
    eventKey: 'calm',
    nextPenalty: 0,
    penalty: 0,
    eva: RULES.evaMinutes.value,
    evaUsed: 0,
    sweepSol: 0,
    panelDeployed: false,
    carryingPanel: false,
    carryingTape: false,
    isolated: false,
    taped: false,
    patched: false,
    reopened: false,
    patch: 0,
    leakActive: false,
    leakStart: 0,
    ration: false,
    rationSols: 0,
    stormArrival: 0,
    stormDuration: 1,
    stormKnown: false,
    stormStarted: false,
    sheltered: false,
    shelterSol: 0,
    exposedCrew: 0,
    iceUsedSol: 0,
    slip: 0,
    delayed: false,
    revived: false,
    runId: 0,
    fx: null,
    winAt: 0,
    stats: null,
    lastDoseCause: '',
  };

  const player = {
    x: 512, y: 430, tx: 512, ty: 430,
    path: [], facing: 1, moving: false, walk: 0, radius: 7,
  };
  const npcs = [
    { id: 'npc1', x: 470, y: 400, tx: 470, ty: 400, sprite: 'crew/welding', timer: 2, atBunker: false, facing: 1, walk: 0, moving: false },
    { id: 'npc2', x: 620, y: 420, tx: 620, ty: 420, sprite: 'crew/tablet', timer: 1, atBunker: false, facing: 1, walk: 0, moving: false },
  ];

  /* ================================================================ utils == */
  const $ = (s) => document.querySelector(s);
  // NOTE: resource values default to 0..100; world/camera clamps always pass bounds.
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function safeGet(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
    catch { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }
  const progress = safeGet('jamt.progress', {});
  const starsFor = (id) => Number(progress[id] || 0);
  const totalStars = () => LEVEL_ORDER.reduce((n, id) => n + starsFor(id), 0);
  const isUnlocked = (id) => {
    const i = LEVEL_ORDER.indexOf(id);
    return i <= 0 || starsFor(LEVEL_ORDER[i - 1]) > 0;
  };
  function saveStars(id, stars) {
    if (stars > starsFor(id)) { progress[id] = stars; safeSet('jamt.progress', progress); }
  }

  const heartSVG = (on) => `<svg class="heart${on ? ' is-on' : ''}" viewBox="0 0 8 7" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="0" width="2" height="1"/><rect x="5" y="0" width="2" height="1"/><rect x="0" y="1" width="8" height="4"/><rect x="1" y="5" width="6" height="1"/><rect x="2" y="6" width="4" height="1"/></svg>`;
  const heartsHTML = (n, total = MAX_HEARTS) => Array.from({ length: total }, (_, i) => heartSVG(i < n)).join('');
  const assetPath = (key) => (manifest[key] ? manifest[key].src : '');
  function imgTag(key, cls = '', alt = '') {
    const src = assetPath(key);
    return src ? `<img class="${cls}" src="${src}" alt="${alt}" loading="lazy" onerror="this.style.display='none'">` : '';
  }
  function starMarkup(n) {
    let out = '';
    for (let i = 0; i < 3; i++) {
      const on = i < n;
      out += assetPath('select/star')
        ? `<img class="star-img${on ? '' : ' dim'}" src="${assetPath('select/star')}" alt="" onerror="this.style.display='none'">`
        : `<span class="star${on ? ' is-on' : ''}">★</span>`;
    }
    return out;
  }

  /* ================================================================ sound == */
  const Sound = (() => {
    let actx = null;
    let muted = safeGet('jamt.muted', false);
    const ensure = () => {
      if (muted) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    };
    function tone(freq, dur = 0.12, type = 'square', vol = 0.03, delay = 0) {
      const a = ensure(); if (!a) return;
      const t0 = a.currentTime + delay;
      const osc = a.createOscillator(); const gain = a.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(a.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    return {
      init: ensure,
      add: () => tone(660, 0.06, 'square', 0.025),
      remove: () => tone(330, 0.06, 'square', 0.02),
      click: () => tone(440, 0.05, 'square', 0.02),
      run: () => { tone(392, 0.09, 'square', 0.03); tone(523, 0.09, 'square', 0.03, 0.08); },
      warn: () => tone(196, 0.2, 'sawtooth', 0.03),
      ok: () => { tone(523, 0.08, 'triangle', 0.03); tone(784, 0.1, 'triangle', 0.03, 0.07); },
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'square', 0.035, i * 0.12)),
      lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, 'triangle', 0.04, i * 0.14)),
      revive: () => [523, 784, 1046].forEach((f, i) => tone(f, 0.14, 'triangle', 0.035, i * 0.1)),
      toggle() { muted = !muted; safeSet('jamt.muted', muted); return muted; },
      get muted() { return muted; },
    };
  })();

  /* ==================================================================== dom == */
  const els = {
    app: $('#app'), scene: $('#scene'), minimap: $('#minimap'),
    hud: $('#hud'), hudHearts: $('#hud-hearts'), hudSol: $('#hud-sol'), hudLevel: $('#hud-level'),
    hudDose: $('#hud-dose'), hudPhase: $('#hud-phase'), hudEva: $('#hud-eva'),
    sound: $('#sound-btn'),
    title: $('#screen-title'), select: $('#screen-select'), debrief: $('#screen-debrief'),
    panel: $('#panel'), toggle: $('#console-toggle'),
    phaseChip: $('#panel-phase'), phaseHint: $('#phase-hint'),
    cellsLeft: $('#cells-left'),
    batteryLine: $('#battery-line'), batteryVal: $('#battery-val'), drawBtn: $('#draw-btn'),
    systems: $('#systems'),
    patchBox: $('#patch-box'), patchVal: $('#patch-val'), patchFill: $('#patch-fill'), patchSteps: $('#patch-steps'),
    doseBox: $('#dose-box'), doseVal: $('#dose-val'), doseBar: $('#dose-bar'), doseNote: $('#dose-note'),
    evaBox: $('#eva-box'), evaVal: $('#eva-val'), evaPips: $('#eva-pips'), evaHint: $('#eva-hint'), shelterBtn: $('#shelter-btn'),
    forecast: $('#forecast'), forecastImg: $('#forecast-img'), forecastIcon: $('#forecast-icon'),
    forecastLabel: $('#forecast-label'), forecastText: $('#forecast-text'),
    run: $('#run-btn'), runRow: $('#run-row'), hint: $('#run-hint'), log: $('#log'),
    interact: $('#interact'), interactKey: $('#interact-key'), interactLabel: $('#interact-label'),
    interactCost: $('#interact-cost'), interactProgress: $('#interact-progress'),
    missionCards: $('#mission-cards'), lockedCards: $('#locked-cards'), totalStars: $('#total-stars'),
    sectorArt: $('#sector-art'),
    debriefStars: $('#debrief-stars'), debriefTitle: $('#debrief-title'), debriefSub: $('#debrief-sub'),
    debriefScore: $('#debrief-score'), debriefGood: $('#debrief-good'), debriefBad: $('#debrief-bad'),
    learnReal: $('#learn-real'), learnRealSrc: $('#learn-real-src'), learnAssume: $('#learn-assume'),
    realChoice: $('#real-choice'), retry: $('#retry-btn'), revive: $('#revive-btn'), next: $('#next-btn'), map: $('#map-btn'),
    stationModal: $('#modal-station'), stationTitle: $('#station-title'), stationDesc: $('#station-desc'),
    stationBars: $('#station-bars'), stationCells: $('#station-cells'), stationMinus: $('#station-minus'),
    stationPlus: $('#station-plus'), stationNote: $('#station-note'), stationDone: $('#station-done'),
  };

  /* =============================================================== screens == */
  function showScreen(name) {
    state.screen = name;
    els.title.hidden = name !== 'title';
    els.select.hidden = name !== 'select';
    els.debrief.hidden = name !== 'debrief';
    els.hud.hidden = name !== 'game';
    els.panel.hidden = name !== 'game';
    els.interact.hidden = name !== 'game';
  }
  function goTitle() {
    state.runId += 1; state.phase = 'plan'; showScreen('title'); state.fx = null;
  }
  function goSelect() {
    state.runId += 1; state.phase = 'plan'; state.fx = null;
    showScreen('select'); renderSelect();
  }

  function renderSelect() {
    const art = assetPath('select/sector_cislunar');
    if (art) { els.sectorArt.src = art; els.sectorArt.style.display = ''; }
    else els.sectorArt.style.display = 'none';
    els.totalStars.textContent = `★ ${totalStars()} / 9`;

    els.missionCards.innerHTML = LEVEL_ORDER.map((id, i) => {
      const L = LEVELS[id];
      const unlocked = isUnlocked(id);
      const stars = starsFor(id);
      const badge = stars > 0 ? '<span class="mission-badge done">COMPLETED</span>'
        : unlocked ? '<span class="mission-badge open">READY</span>'
        : '<span class="mission-badge lock">LOCKED</span>';
      return `<button class="mission-card${unlocked ? '' : ' is-locked'}" data-level="${id}" type="button" ${unlocked ? '' : 'disabled aria-disabled="true"'}>
        <div class="mission-top">${imgTag(`select/level_0${i + 1}`, 'mission-num')}
          <div><div class="mission-kicker">Mission ${id} · Moon</div><div class="mission-name">${L.title}</div></div>
        </div>
        ${imgTag(L.art, 'mission-art')}
        <p class="mission-brief">${L.brief}</p>
        <div class="mission-foot"><span class="mission-stars" aria-label="${stars} of 3 stars">${starMarkup(stars)}</span>${badge}</div>
      </button>`;
    }).join('');

    els.lockedCards.innerHTML = FUTURE.map((f) => `<div class="node-card">${imgTag(f.art, 'node-art')}
      <div class="node-text"><b>${f.title}</b><span>${f.note} · ${f.tag}</span></div></div>`).join('');

    for (const card of els.missionCards.querySelectorAll('.mission-card')) {
      card.addEventListener('click', () => {
        if (card.classList.contains('is-locked')) return;
        Sound.init(); Sound.click(); startLevel(card.dataset.level);
      });
    }
  }

  /* ================================================================ world == */
  const WORLD = { w: 1024, h: 760 };
  const PIXEL = 2;                       // integer world px -> CSS px
  const GRID = 16;

  // visual props; foot y drives depth sorting, cx/cy/cw/ch are colliders
  const PROPS = [
    { id: 'dome', sprite: 'habitat/dome', x: 512, y: 368, w: 176, h: 172, cx: 458, cy: 268, cw: 108, ch: 70 },
    { id: 'battery', sprite: 'power/unit', x: 358, y: 356, w: 74, h: 84, cx: 332, cy: 306, cw: 56, ch: 32 },
    { id: 'battery2', sprite: 'power/battery_green', x: 400, y: 350, w: 30, h: 52, cx: 390, cy: 318, cw: 18, ch: 20 },
    { id: 'o2', sprite: 'life/air_unit', x: 700, y: 336, w: 86, h: 94, cx: 670, cy: 286, cw: 58, ch: 34 },
    { id: 'co2', sprite: 'life/co2_tank', x: 762, y: 336, w: 46, h: 84, cx: 750, cy: 300, cw: 26, ch: 22 },
    { id: 'water', sprite: 'life/water_tank', x: 730, y: 430, w: 62, h: 70, cx: 708, cy: 396, cw: 42, ch: 26 },
    { id: 'recycler', sprite: 'life/water_recycler', x: 806, y: 432, w: 62, h: 68, cx: 784, cy: 398, cw: 42, ch: 26 },
    { id: 'dish', sprite: 'external/dish_a', x: 660, y: 216, w: 58, h: 86, cx: 646, cy: 190, cw: 26, ch: 18 },
    { id: 'antenna', sprite: 'external/antenna', x: 722, y: 200, w: 40, h: 76, cx: 714, cy: 178, cw: 14, ch: 12 },
    { id: 'rover', sprite: 'external/rover', x: 566, y: 536, w: 84, h: 66, cx: 526, cy: 508, cw: 72, ch: 30 },
    { id: 'crates', sprite: 'habitat/crates', x: 650, y: 532, w: 54, h: 56, cx: 630, cy: 508, cw: 36, ch: 24 },
    { id: 'bunker', sprite: 'habitat/tunnel', x: 262, y: 246, w: 96, h: 86, cx: 224, cy: 208, cw: 76, ch: 36 },
    { id: 'solar1', sprite: 'power/solar_a', x: 112, y: 352, w: 58, h: 52, cx: 90, cy: 330, cw: 46, ch: 18 },
    { id: 'solar2', sprite: 'power/solar_a', x: 180, y: 344, w: 58, h: 52, cx: 158, cy: 322, cw: 46, ch: 18 },
    { id: 'solar3', sprite: 'power/solar_b', x: 248, y: 352, w: 58, h: 52, cx: 226, cy: 330, cw: 46, ch: 18 },
    { id: 'solar4', sprite: 'power/solar_b', x: 316, y: 344, w: 58, h: 52, cx: 294, cy: 322, cw: 46, ch: 18 },
    { id: 'boulder1', sprite: null, x: 430, y: 486, w: 34, h: 26, cx: 414, cy: 466, cw: 30, ch: 16 },
    { id: 'boulder2', sprite: null, x: 880, y: 492, w: 40, h: 30, cx: 862, cy: 470, cw: 34, ch: 18 },
    { id: 'boulder3', sprite: null, x: 912, y: 268, w: 30, h: 24, cx: 900, cy: 252, cw: 24, ch: 14 },
    { id: 'boulder4', sprite: null, x: 340, y: 462, w: 26, h: 20, cx: 328, cy: 448, cw: 20, ch: 12 },
    { id: 'boulder5', sprite: null, x: 470, y: 168, w: 30, h: 24, cx: 456, cy: 152, cw: 24, ch: 14 },
  ];

  const STATIONS = [
    { id: 'solar', x: 216, y: 386, r: 62, label: 'Solar field' },
    { id: 'battery', x: 376, y: 378, r: 40, label: 'Battery bank' },
    { id: 'o2', x: 700, y: 356, r: 42, label: 'O₂ generator' },
    { id: 'co2', x: 762, y: 356, r: 36, label: 'CO₂ scrubber' },
    { id: 'water', x: 730, y: 452, r: 44, label: 'Water recycler' },
    { id: 'leak', x: 808, y: 452, r: 38, label: 'Leak' },
    { id: 'comms', x: 664, y: 240, r: 44, label: 'Comms dish' },
    { id: 'ice', x: 150, y: 556, r: 52, label: 'Ice patch' },
    { id: 'bunker', x: 262, y: 286, r: 52, label: 'Bunker' },
    { id: 'rover', x: 566, y: 566, r: 38, label: 'Rover' },
    { id: 'crates', x: 650, y: 564, r: 42, label: 'Crates' },
  ];

  const colliders = PROPS.map((p) => ({ x: p.cx, y: p.cy, w: p.cw, h: p.ch, id: p.id }));

  /* ============================================================== rendering == */
  const canvas = els.scene;
  const ctx = canvas.getContext('2d');
  const mapCanvas = els.minimap;
  const mctx = mapCanvas.getContext('2d');
  let VW = 640, VH = 360;
  let terrain = null;
  const camera = { x: 256, y: 220, w: 640, h: 360 };
  let consolePx = 0;

  function buildTerrain() {
    terrain = document.createElement('canvas');
    terrain.width = WORLD.w; terrain.height = WORLD.h;
    const t = terrain.getContext('2d');
    const rnd = mulberry32(20260214);

    t.fillStyle = '#3d4356';
    t.fillRect(0, 0, WORLD.w, WORLD.h);

    // pale regolith plateau (north-west) + basalt (south-east)
    t.fillStyle = '#7c8296';
    t.beginPath();
    t.moveTo(0, 0); t.lineTo(WORLD.w * 0.72, 0); t.lineTo(WORLD.w * 0.55, WORLD.h * 0.55);
    t.lineTo(WORLD.w * 0.62, WORLD.h); t.lineTo(0, WORLD.h); t.closePath(); t.fill();

    // speckle
    for (let i = 0; i < 5200; i++) {
      const x = Math.floor(rnd() * WORLD.w), y = Math.floor(rnd() * WORLD.h);
      t.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.09)';
      t.fillRect(x, y, rnd() < 0.2 ? 2 : 1, 1);
    }

    // craters
    const craters = [
      [130, 120, 54], [420, 96, 34], [890, 150, 46], [940, 470, 60],
      [260, 560, 44], [600, 210, 26], [80, 420, 36], [760, 560, 40],
    ];
    for (const [x, y, r] of craters) {
      t.fillStyle = '#9aa1b5';
      t.beginPath(); t.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); t.fill();
      t.fillStyle = '#585e70';
      t.beginPath(); t.ellipse(x, y + 1, r - 3, r * 0.58 - 2, 0, 0, Math.PI * 2); t.fill();
      t.strokeStyle = 'rgba(255,255,255,.16)';
      t.beginPath(); t.ellipse(x, y, r, r * 0.6, 0, Math.PI * 0.9, Math.PI * 1.9); t.stroke();
    }

    // shaded ice patch (SW)
    const ice = SPR['terrain/ice'];
    if (ice && ice.ok) {
      t.globalAlpha = 0.9;
      t.drawImage(ice.img, 100, 505, 96, 96);
      t.globalAlpha = 1;
    } else {
      t.fillStyle = '#bfe9ff';
      t.beginPath(); t.ellipse(148, 552, 48, 26, 0, 0, Math.PI * 2); t.fill();
    }

    // dusty paths between stations
    t.strokeStyle = 'rgba(210,216,235,.16)';
    t.lineWidth = 16;
    t.lineCap = 'round';
    const path = (pts) => { t.beginPath(); t.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) t.lineTo(p[0], p[1]); t.stroke(); };
    path([[512, 430], [512, 380], [420, 366], [376, 372]]);
    path([[512, 380], [660, 340], [700, 356]]);
    path([[700, 356], [730, 452], [808, 452]]);
    path([[512, 380], [560, 300], [664, 240]]);
    path([[512, 430], [566, 566], [650, 564]]);
    path([[512, 430], [300, 400], [262, 286]]);
    path([[376, 372], [262, 386], [216, 386]]);
    path([[512, 430], [300, 520], [150, 556]]);
  }

  function resize() {
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(320, window.innerHeight);
    VW = Math.max(180, Math.floor(vw / PIXEL));
    VH = Math.max(160, Math.floor(vh / PIXEL));
    canvas.width = VW; canvas.height = VH;
    canvas.style.width = `${VW * PIXEL}px`;
    canvas.style.height = `${VH * PIXEL}px`;
    ctx.imageSmoothingEnabled = false;
    camera.w = VW; camera.h = VH;
    measureConsole();
    snapCamera();
  }

  function measureConsole() {
    const rect = els.panel.getBoundingClientRect();
    const bottomDocked = window.innerWidth <= 820;
    consolePx = bottomDocked && !els.panel.classList.contains('is-collapsed') ? Math.min(rect.height, window.innerHeight * 0.6) : 0;
    document.documentElement.style.setProperty('--console-h', `${consolePx}px`);
  }

  function clampCamera() {
    camera.x = clamp(camera.x, 0, Math.max(0, WORLD.w - camera.w));
    camera.y = clamp(camera.y, 0, Math.max(0, WORLD.h - camera.h));
  }
  function snapCamera() {
    const visibleH = Math.max(80, camera.h - consolePx / PIXEL);
    camera.x = clamp(player.x - camera.w / 2, 0, Math.max(0, WORLD.w - camera.w));
    camera.y = clamp(player.y - visibleH * 0.58, 0, Math.max(0, WORLD.h - camera.h));
    clampCamera();
  }
  function updateCamera(dt) {
    const visibleH = Math.max(80, camera.h - consolePx / PIXEL);
    const tx = player.x - camera.w / 2;
    const ty = player.y - visibleH * 0.58;
    camera.x += (tx - camera.x) * Math.min(1, dt * 7);
    camera.y += (ty - camera.y) * Math.min(1, dt * 7);
    clampCamera();
  }

  /* ------------------------------------------------------------- collision -- */
  function blockedAt(x, y) {
    const r = player.radius;
    for (const c of colliders) {
      if (x + r > c.x && x - r < c.x + c.w && y + r > c.y && y - r < c.y + c.h) return true;
    }
    return false;
  }
  function movePlayer(dx, dy) {
    if (!dx && !dy) return;
    const nx = player.x + dx;
    if (!blockedAt(nx, player.y)) player.x = nx;
    const ny = player.y + dy;
    if (!blockedAt(player.x, ny)) player.y = ny;
    player.x = clamp(player.x, 8, WORLD.w - 8);
    player.y = clamp(player.y, 24, WORLD.h - 8);
  }

  // A* on a 16px grid
  function nearestWalkable(gx, gy) {
    const cols = Math.floor(WORLD.w / GRID), rows = Math.floor(WORLD.h / GRID);
    gx = clamp(gx, 0, cols - 1); gy = clamp(gy, 0, rows - 1);
    if (!blockedAt(gx * GRID + 8, gy * GRID + 8)) return [gx, gy];
    for (let r = 1; r < 8; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          const x = gx + ox, y = gy + oy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          if (!blockedAt(x * GRID + 8, y * GRID + 8)) return [x, y];
        }
      }
    }
    return null;
  }

  function findPath(tx, ty) {
    const cols = Math.floor(WORLD.w / GRID), rows = Math.floor(WORLD.h / GRID);
    const start = nearestWalkable(Math.floor(player.x / GRID), Math.floor(player.y / GRID));
    const goal = nearestWalkable(Math.floor(tx / GRID), Math.floor(ty / GRID));
    if (!start || !goal) return [];
    const key = (x, y) => y * cols + x;
    const open = [{ x: start[0], y: start[1], g: 0, f: 0 }];
    const came = new Map();
    const gScore = new Map([[key(start[0], start[1]), 0]]);
    const closed = new Set();
    const h = (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]);

    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      const ck = key(cur.x, cur.y);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (cur.x === goal[0] && cur.y === goal[1]) {
        const out = [];
        let node = ck;
        while (node != null) {
          const x = node % cols, y = Math.floor(node / cols);
          out.push({ x: x * GRID + 8, y: y * GRID + 8 });
          node = came.get(node);
        }
        out.reverse();
        return out;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (blockedAt(nx * GRID + 8, ny * GRID + 8)) continue;
        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const g = cur.g + 1;
        if (g < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, g);
          came.set(nk, ck);
          open.push({ x: nx, y: ny, g, f: g + h(nx, ny) });
        }
      }
    }
    return [];
  }

  /* ------------------------------------------------------------- movement --- */
  const keys = { up: false, down: false, left: false, right: false };
  let dustPuffs = [];

  function updatePlayer(dt) {
    let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);

    if (dx || dy) {
      player.path = [];
      const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    } else if (player.path.length) {
      const node = player.path[0];
      const d = dist(player.x, player.y, node.x, node.y);
      if (d < 4) player.path.shift();
      else { dx = (node.x - player.x) / d; dy = (node.y - player.y) / d; }
    }

    player.moving = !!(dx || dy);
    if (player.moving) {
      const speed = 82;
      movePlayer(dx * speed * dt, dy * speed * dt);
      if (Math.abs(dx) > 0.1) player.facing = dx > 0 ? 1 : -1;
      const prev = Math.floor(player.walk / 0.16);
      player.walk += dt;
      if (Math.floor(player.walk / 0.16) !== prev) {
        dustPuffs.push({ x: player.x - player.facing * 3, y: player.y, life: 0.4 });
        if (dustPuffs.length > 16) dustPuffs.shift();
      }
    }
    for (let i = dustPuffs.length - 1; i >= 0; i--) {
      dustPuffs[i].life -= dt;
      if (dustPuffs[i].life <= 0) dustPuffs.splice(i, 1);
    }
    updateCamera(dt);
  }

  function updateNPCs(dt) {
    for (const npc of npcs) {
      if (state.sheltered) {
        npc.tx = 250 + (npc.id === 'npc1' ? -10 : 12);
        npc.ty = 300;
      } else if (state.levelId === '1.3') {
        npc.timer -= dt;
        if (npc.timer <= 0) {
          npc.timer = 6 + Math.random() * 6;
          npc.tx = 620 + Math.random() * 180;
          npc.ty = 300 + Math.random() * 150;
        }
      } else {
        npc.timer -= dt;
        if (npc.timer <= 0) {
          npc.timer = 7 + Math.random() * 6;
          const spots = [[470, 380], [700, 420], [770, 400], [560, 470], [300, 380]];
          const s = spots[Math.floor(Math.random() * spots.length)];
          npc.tx = s[0]; npc.ty = s[1];
        }
      }
      const d = dist(npc.x, npc.y, npc.tx, npc.ty);
      npc.moving = d > 4;
      if (npc.moving) {
        const sp = 34;
        npc.x += (npc.tx - npc.x) / d * sp * dt;
        npc.y += (npc.ty - npc.y) / d * sp * dt;
        npc.facing = npc.tx > npc.x ? 1 : -1;
        npc.walk += dt;
      }
      npc.atBunker = dist(npc.x, npc.y, 250, 300) < 70;
    }
  }

  /* ------------------------------------------------------------ draw scene -- */
  function ready(key) { return SPR[key] && SPR[key].ok; }
  function drawAsset(key, cx, by, maxW, maxH, opts = {}) {
    const a = SPR[key];
    if (!a || !a.ok) return false;
    const ratio = a.img.width / a.img.height;
    let w = Math.round(maxW), h = Math.round(maxW / ratio);
    if (h > maxH) { h = Math.round(maxH); w = Math.round(maxH * ratio); }
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (opts.flip) { ctx.translate(Math.round(cx), 0); ctx.scale(-1, 1); ctx.translate(-Math.round(cx), 0); }
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.drawImage(a.img, Math.round(cx - w / 2), Math.round(by - h), w, h);
    ctx.restore();
    return true;
  }
  function px(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function ellipse(x, y, rx, ry, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); ctx.fill();
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sunStretch() {
    const sol = state.sol || 1;
    const long = state.eventKey === 'longshadow';
    return { dx: 4 + (sol % 3) * 3 + (long ? 12 : 0), sx: 1.1 + (long ? 0.6 : 0) + sol * 0.02 };
  }

  function drawShadow(x, y, rx, ry) {
    const { dx, sx } = sunStretch();
    ctx.fillStyle = 'rgba(8,10,18,.34)';
    ctx.beginPath();
    ctx.ellipse(Math.round(x + dx), Math.round(y), Math.round(rx * sx), Math.round(ry * 0.55), 0.06 * dx, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawProp(p) {
    if (p.sprite) {
      drawShadow(p.x, p.y + 2, p.w * 0.42, p.w * 0.16);
      if (!drawAsset(p.sprite, p.x, p.y, p.w, p.h)) {
        ellipse(p.x, p.y - p.h * 0.4, p.w * 0.35, p.h * 0.35, '#7e88a1');
      }
    } else {
      // boulders
      drawShadow(p.x, p.y + 2, p.w * 0.5, p.w * 0.2);
      ellipse(p.x, p.y - p.h * 0.4, p.w * 0.5, p.h * 0.5, '#4a5064');
      ellipse(p.x - p.w * 0.1, p.y - p.h * 0.55, p.w * 0.3, p.h * 0.28, '#697086');
    }
    // dust on solar panels
    if (p.id.startsWith('solar') && state.penalty === 0) {
      ctx.globalAlpha = 0.16 + 0.06 * Math.sin(performance.now() / 400 + p.x);
      ellipse(p.x, p.y - p.h * 0.6, p.w * 0.34, 5, '#ffe9a8');
      ctx.globalAlpha = 1;
    }
    if (p.id.startsWith('solar') && state.penalty > 0 && state.level && state.level.rows.includes('water')) {
      ctx.globalAlpha = 0.35;
      ellipse(p.x, p.y - p.h * 0.55, p.w * 0.34, 4, '#c9b98a');
      ctx.globalAlpha = 1;
    }
    if (p.id === 'recycler' && state.levelId === '1.2' && state.leakActive && !state.patched) {
      // drips
      ctx.fillStyle = 'rgba(110,220,255,.85)';
      for (let i = 0; i < 4; i++) {
        const t = (performance.now() / 1000 + i * 0.3) % 1;
        ctx.fillRect(Math.round(p.x + 8 + i * 3), Math.round(p.y - 18 + t * 16), 2, 3);
      }
    }
    // attention marker
    if (stationNeedsAttention(p.id)) {
      const bob = Math.round(Math.sin(performance.now() / 300) * 2);
      px(p.x - 4, p.y - p.h - 22 + bob, 9, 11, '#ffcf3a');
      px(p.x - 2, p.y - p.h - 20 + bob, 5, 6, '#2a1d00');
      px(p.x - 1, p.y - p.h - 13 + bob, 2, 2, '#2a1d00');
    }
  }

  function drawNPC(npc) {
    ellipse(npc.x, npc.y + 1, 10, 3, 'rgba(8,10,18,.35)');
    const bob = npc.moving ? Math.round(Math.sin(npc.walk * 12)) : 0;
    const drew = drawAsset(npc.sprite, npc.x, npc.y + bob, 30, 62, { flip: npc.facing < 0 });
    if (!drew) { ellipse(npc.x, npc.y - 18, 9, 18, '#dfe6ff'); }
  }

  function drawPlayer() {
    for (const puff of dustPuffs) {
      ctx.globalAlpha = Math.max(0, puff.life * 1.4);
      px(puff.x - 1, puff.y - 1, 3, 2, '#b9c0d6');
    }
    ctx.globalAlpha = 1;

    ellipse(player.x, player.y + 1, 11, 4, 'rgba(8,10,18,.4)');
    const bob = player.moving ? Math.round(Math.sin(player.walk * 13)) : Math.round(Math.sin(performance.now() / 500));
    const key = state.levelId === '1.2' ? 'crew/wrench' : 'crew/walk';
    const drew = drawAsset(key, player.x, player.y + bob, 37, 66, { flip: player.facing < 0 });
    if (!drew) {
      px(player.x - 6, player.y - 26, 12, 22, '#eef2ff');
      px(player.x - 5, player.y - 34, 10, 10, '#eef2ff');
      px(player.x - 4, player.y - 32, 8, 5, '#1c3b3d');
    }
    if (state.carryingPanel) {
      drawAsset('power/solar_b', player.x + player.facing * 10, player.y - 18, 20, 14);
    }
    if (state.carryingTape) {
      drawAsset('repair/tape', player.x - player.facing * 12, player.y - 14, 14, 12);
    }
  }

  function drawWorldFX(time) {
    const fx = state.fx;
    if (!fx) return null;
    const age = time - fx.t0;
    if (fx.type === 'capsule' && age < 3.2) {
      const p = Math.min(1, age / 1.8);
      const by = 40 + (330 - 40) * p;
      drawAsset('fx/lander', 512, by, 110, 62);
      ctx.globalAlpha = Math.max(0, 0.6 * (1 - p));
      px(500, by + 8, 10, 30, '#ffd27a');
      ctx.globalAlpha = 1;
    }
    if (fx.type === 'sparkle' && age < 1.6) {
      ctx.fillStyle = 'rgba(180,245,255,.8)';
      for (let i = 0; i < 6; i++) {
        const a = age * 4 + i;
        px(fx.x + Math.cos(a) * 18, fx.y + Math.sin(a) * 12, 2, 2, 'rgba(180,245,255,.8)');
      }
    }
    return null;
  }

  function drawScene(time) {
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, VW, VH);

    ctx.save();
    ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

    if (terrain) ctx.drawImage(terrain, 0, 0);

    // storm: sun + warm tint
    if (state.stormStarted || state.eventKey === 'storm') {
      ctx.globalAlpha = 0.12 + 0.04 * Math.sin(time * 4);
      ctx.fillStyle = '#ff9a3c'; ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      ctx.globalAlpha = 1;
      drawAsset('fx/sun', 690, 96, 58, 58, { alpha: 0.95 });
    }
    if (state.levelId === '1.3' && !state.stormStarted) {
      drawAsset('fx/sun', 862, 84, 30, 30, { alpha: 0.22 });
    }

    // dust event drift
    if (state.eventKey === 'dust' || state.penalty > 0) {
      for (let i = 0; i < 26; i++) {
        const x = (i * 97 + time * 26) % WORLD.w;
        const y = (i * 53) % WORLD.h;
        ctx.fillStyle = 'rgba(216,196,143,.28)';
        ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
      }
    }

    // y-sorted drawables
    const drawables = [];
    for (const p of PROPS) drawables.push({ id: p.id, y: p.y, draw: () => drawProp(p) });
    for (const n of npcs) drawables.push({ id: n.id, y: n.y, draw: () => drawNPC(n) });
    drawables.push({ id: 'player', y: player.y, draw: drawPlayer });
    drawables.sort((a, b) => a.y - b.y);
    window.__jamtDrawOrder = drawables.map((d) => d.id);
    for (const d of drawables) d.draw();

    drawWorldFX(time);
    ctx.restore();

    // station prompt ring
    const st = nearestStation();
    if (st && state.screen === 'game' && state.phase === 'eva') {
      const sx = st.x - camera.x, sy = st.y - camera.y;
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time * 5);
      ctx.strokeStyle = '#7fbdff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawMinimap() {
    if (!mapCanvas) return;
    const w = mapCanvas.width, h = mapCanvas.height;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = '#0b0f1c'; mctx.fillRect(0, 0, w, h);
    mctx.fillStyle = '#5d6478';
    mctx.fillRect(4, 4, w - 8, h - 8);
    mctx.fillStyle = '#2c3142';
    mctx.fillRect(4, 4, (w - 8) * 0.55, h - 8);
    const sx = (w - 8) / WORLD.w, sy = (h - 8) / WORLD.h;
    for (const st of STATIONS) {
      mctx.fillStyle = stationNeedsAttention(st.id) ? '#ffcf3a' : '#7fbdff';
      mctx.fillRect(4 + st.x * sx - 1, 4 + st.y * sy - 1, 3, 3);
    }
    mctx.fillStyle = '#ff5d73';
    mctx.fillRect(4 + player.x * sx - 2, 4 + player.y * sy - 2, 4, 4);
    mctx.strokeStyle = 'rgba(255,255,255,.35)';
    mctx.lineWidth = 1;
    mctx.strokeRect(4 + camera.x * sx, 4 + camera.y * sy, camera.w * sx, camera.h * sy);
  }

  /* ============================================================== stations == */
  function nearestStation() {
    let best = null, bd = Infinity;
    for (const st of STATIONS) {
      if (st.id === 'leak' && state.levelId !== '1.2') continue;
      const d = dist(player.x, player.y, st.x, st.y);
      if (d < st.r && d < bd) { bd = d; best = st; }
    }
    return best;
  }

  function stationNeedsAttention(id) {
    const s = state;
    if (!s.level) return false;
    if (id === 'solar' && s.penalty > 0) return true;
    if (id === 'solar' && s.levelId === '1.1' && !s.panelDeployed && s.carryingPanel) return true;
    if (id === 'crates' && s.levelId === '1.1' && !s.panelDeployed && !s.carryingPanel) return true;
    if (id === 'crates' && s.levelId === '1.2' && s.isolated && !s.taped && !s.carryingTape) return true;
    if (id === 'leak' && s.levelId === '1.2' && !s.reopened) return true;
    if (id === 'comms' && s.levelId === '1.3' && !s.stormKnown) return true;
    if (id === 'bunker' && s.levelId === '1.3' && s.stormArrival && !s.sheltered) return true;
    if (id === 'ice' && s.levelId === '1.2' && s.res.water < 55) return true;
    return false;
  }

  // returns the EVA action available at a station (or a panel action with 0 min)
  function actionFor(st) {
    const s = state;
    const L = s.level;
    if (!L) return null;
    const noMinutes = s.eva <= 0;

    if (st.id === 'o2' || st.id === 'co2' || st.id === 'water') {
      const row = st.id === 'water' || st.id === 'co2' ? 'water' : 'o2';
      return { id: 'panel', label: `Check ${ROWS[row].name}`, minutes: 0, row, run: () => openStationPanel(row) };
    }
    if (st.id === 'battery') {
      return { id: 'battery', label: `Battery: ${Math.round(s.battery)}/6 cells`, minutes: 0, run: () => addLog(`🔋 Battery bank holds <b>${Math.round(s.battery)}/6</b> cells.`, 'muted') };
    }
    if (st.id === 'rover') {
      return { id: 'rover', label: 'Inspect rover', minutes: 0, run: () => addLog('🚙 Rover is parked and charged. Ice hauls start at the ice patch.', 'muted') };
    }

    if (st.id === 'solar') {
      if (s.penalty > 0) return { id: 'sweep', label: 'Sweep dust off panels', minutes: 1, disabled: noMinutes, run: () => doSweep() };
      if (L.id === '1.1' && !s.panelDeployed && s.carryingPanel) return { id: 'panel', label: 'Install spare panel', minutes: 1, disabled: noMinutes, run: () => doInstallPanel() };
      return { id: 'solarinfo', label: 'Panels clean — full output', minutes: 0, run: () => addLog('☀️ Solar arrays are clean and making full power.', 'muted') };
    }
    if (st.id === 'crates') {
      if (L.id === '1.1' && !s.panelDeployed && !s.carryingPanel) {
        return { id: 'fetchpanel', label: 'Take spare solar panel', minutes: 1, disabled: noMinutes, run: () => doFetchPanel() };
      }
      if (L.id === '1.2' && s.isolated && !s.taped && !s.carryingTape) {
        return { id: 'fetchtape', label: 'Fetch toolbox + tape', minutes: 1, disabled: noMinutes, run: () => doFetchTape() };
      }
      return { id: 'cratesinfo', label: 'Spare parts crate', minutes: 0, run: () => addLog('📦 Spare parts: seals, tape, a solar panel.', 'muted') };
    }
    if (st.id === 'comms') {
      if (L.id === '1.3' && !s.stormKnown) {
        return { id: 'dish', label: 'Read space weather', minutes: 1, disabled: noMinutes, run: () => doReadDish() };
      }
      return { id: 'commsinfo', label: 'Comms dish online', minutes: 0, run: () => addLog('📡 Comms dish is tracking the Sun.', 'muted') };
    }
    if (st.id === 'ice') {
      const used = s.iceUsedSol === s.sol;
      const what = L.id === '1.3' ? `+${RULES.iceO2.value} O₂` : `+${RULES.iceWater.value} water`;
      return {
        id: 'ice', label: used ? 'Ice already hauled this sol' : `Haul ice ${what}`,
        minutes: 2, disabled: noMinutes || used, run: () => doHaulIce(),
      };
    }
    if (st.id === 'bunker') {
      if (L.id === '1.3' && s.stormArrival && !s.sheltered) {
        return { id: 'shelter', label: 'Order crew to shelter', minutes: 1, disabled: noMinutes, run: () => orderShelter(true) };
      }
      if (s.sheltered) return { id: 'bunker', label: 'Crew is sheltering here', minutes: 0, run: () => addLog('🛖 The crew is inside the regolith bunker.', 'muted') };
      return { id: 'bunkerinfo', label: 'Regolith bunker', minutes: 0, run: () => addLog('🛖 A tunnel dug into the crater rim — good radiation shelter.', 'muted') };
    }
    if (st.id === 'leak') {
      if (L.id !== '1.2') return null;
      if (!s.isolated) return { id: 'isolate', label: 'Close hatch (isolate leak)', minutes: 2, disabled: noMinutes, run: () => doIsolate() };
      if (s.isolated && !s.taped) {
        if (s.carryingTape) return { id: 'tape', label: 'Apply Kapton tape', minutes: 1, disabled: noMinutes, run: () => doTape() };
        return { id: 'needtape', label: 'Need toolbox + tape (crates)', minutes: 0, run: () => addLog('🧰 The toolbox and tape are in the crates south of the habitat.', 'warn') };
      }
      if (s.taped && !s.patched) return { id: 'patchwait', label: `Patch curing (${s.patch}/2 repair cells)`, minutes: 0, run: () => addLog('🔧 Allocate repair cells to cure the permanent patch.', 'muted') };
      if (s.patched && !s.reopened) return { id: 'reopen', label: 'Reopen hatch', minutes: 1, disabled: noMinutes, run: () => doReopen() };
      return { id: 'leakdone', label: 'Leak sealed', minutes: 0, run: () => addLog('✅ The recycler is sealed and running.', 'good') };
    }
    return null;
  }

  /* ------------------------------------------------------------- EVA tasks -- */
  function spend(minutes) {
    state.eva = Math.max(0, state.eva - minutes);
    state.evaUsed += minutes;
    render();
  }

  function doSweep() {
    spend(1);
    const restored = state.penalty;
    state.penalty = 0;
    state.budget += restored;
    addLog(`🧹 Dust swept off the solar arrays — <b>+${restored} cell${restored === 1 ? '' : 's'}</b> restored.`, 'good');
    Sound.ok();
  }
  function doFetchPanel() {
    spend(1);
    state.carryingPanel = true;
    addLog('🔧 Took a spare solar panel from the crates. Install it at the solar field.', 'good');
    Sound.ok();
  }
  function doInstallPanel() {
    spend(1);
    state.carryingPanel = false;
    state.panelDeployed = true;
    state.budget += 1;
    addLog('☀️ Spare panel installed: <b>+1 power cell</b> for the rest of the mission.', 'good');
    Sound.ok();
  }
  function doFetchTape() {
    spend(1);
    state.carryingTape = true;
    addLog('🧰 Fetched the toolbox and Kapton tape. Apply it at the recycler.', 'good');
    Sound.ok();
  }
  function doIsolate() {
    spend(2);
    state.isolated = true;
    addLog('🚪 Hatch closed: leak cut to 40%, but the recycler is offline (no water from cells).', 'warn');
    Sound.ok();
  }
  function doTape() {
    spend(1);
    state.taped = true;
    addLog('🩹 Kapton tape applied: leak down to 16%. Now cure the permanent patch.', 'good');
    Sound.ok();
  }
  function doReopen() {
    spend(1);
    state.reopened = true;
    addLog('✅ Hatch reopened: recycler is back online and the leak is sealed.', 'good');
    Sound.ok();
  }
  function doReadDish() {
    spend(1);
    state.stormKnown = true;
    addLog(`📡 Space weather: storm arrives on <b>Sol ${state.stormArrival}</b> and lasts ${state.stormDuration} sol${state.stormDuration > 1 ? 's' : ''}.`, 'good');
    Sound.ok();
  }
  function doHaulIce() {
    const s = state;
    s.iceUsedSol = s.sol;
    spend(2);
    if (s.levelId === '1.3') {
      s.res.o2 = clamp(s.res.o2 + RULES.iceO2.value);
      addLog(`🧊 Hauled ice: <b>+${RULES.iceO2.value} O₂</b> from electrolysis.`, 'good');
      if (s.stormStarted) {
        s.dose = clamp(s.dose + RULES.iceDose.value, 0, 100);
        addLog(`☢ Exposed during the storm: <b>+${RULES.iceDose.value} dose</b>.`, 'warn');
      }
    } else {
      s.res.water = clamp(s.res.water + RULES.iceWater.value);
      addLog(`🧊 Hauled ice to the tank: <b>+${RULES.iceWater.value} water</b>.`, 'good');
    }
    Sound.ok();
  }
  function orderShelter(fromStation) {
    const s = state;
    if (s.sheltered) return;
    if (fromStation) spend(1);
    s.sheltered = true;
    s.shelterSol = s.sol;
    addLog('🛖 Shelter order given: the crew is moving to the regolith bunker.', 'good');
    Sound.ok();
    render();
  }

  /* --------------------------------------------------------- hold-to-do UI -- */
  const hold = { active: false, t: 0, action: null, station: null };

  function startHold() {
    if (state.screen !== 'game' || state.phase !== 'eva') return;
    const st = nearestStation();
    if (!st) return;
    const action = actionFor(st);
    if (!action || action.disabled) { Sound.warn(); return; }
    if (action.minutes > 0 && state.eva < action.minutes) { Sound.warn(); addLog('No EVA minutes left for that task.', 'warn'); return; }
    if (action.minutes === 0) { action.run(); render(); return; }
    hold.active = true; hold.t = 0; hold.action = action; hold.station = st;
    els.interact.classList.add('is-holding');
  }
  function cancelHold() {
    hold.active = false; hold.t = 0; hold.action = null; hold.station = null;
    els.interact.classList.remove('is-holding');
    if (els.interactProgress) els.interactProgress.style.width = '0%';
  }
  function updateHold(dt) {
    if (!hold.active || !hold.action) return;
    hold.t += dt;
    const pct = Math.min(1, hold.t / RULES.holdSeconds.value) * 100;
    if (els.interactProgress) els.interactProgress.style.width = `${pct}%`;
    if (hold.t >= RULES.holdSeconds.value) {
      const action = hold.action;
      cancelHold();
      action.run();
      render();
    }
  }

  /* ================================================================ console == */
  function totalAlloc() {
    const s = state;
    return (s.level ? s.level.rows : []).reduce((n, row) => n + (s.alloc[row] || 0), 0);
  }
  function leftCells() { return state.budget - totalAlloc(); }
  function getBattery() { return state.res.battery != null ? state.res.battery : (state.battery || 0); }
  function setBattery(v) {
    const b = clamp(v, 0, RULES.batteryCap.value);
    state.battery = b;
    state.res.battery = b;
    return b;
  }

  function buildSystems() {
    const L = state.level;
    els.systems.innerHTML = '';
    for (const row of L.rows) {
      const meta = ROWS[row];
      const isCells = meta.kind === 'cells';
      const iconSrc = assetPath(meta.sprite);
      const icon = iconSrc ? `<img class="spr-ico" src="${iconSrc}" alt="" onerror="this.parentNode.classList.add('no-img')">` : '';
      const card = document.createElement('div');
      card.className = 'system';
      card.dataset.key = row;
      card.innerHTML = `
        <div class="sys-head">
          <span class="sys-icon${iconSrc ? '' : ' no-img'}">${icon}<span class="glyph" aria-hidden="true">${meta.glyph}</span></span>
          <span class="sys-name">${meta.name}</span>
          <span class="sys-value" id="val-${row}">${isCells ? '0/6' : '0%'}</span>
        </div>
        <div class="meter" id="meter-${row}" role="progressbar" aria-label="${meta.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="meter-fill" id="bar-${row}"></div><div class="meter-risk" aria-hidden="true"></div>
        </div>
        <div class="alloc">
          <button class="step" type="button" data-act="minus" data-key="${row}" aria-label="One less cell for ${meta.name}">−</button>
          <div class="cells" id="cells-${row}" aria-hidden="true"></div>
          <span class="alloc-num" id="alloc-${row}" aria-hidden="true">0</span>
          <button class="step" type="button" data-act="plus" data-key="${row}" aria-label="One more cell for ${meta.name}">+</button>
        </div>`;
      els.systems.appendChild(card);
    }
  }

  function render() {
    const s = state;
    if (!s.level) return;
    const L = s.level;
    const sol = s.sol;
    const totalSols = L.id === '1.1' ? L.goalsSol : L.maxSols;

    els.hudLevel.textContent = `${L.id} · Moon`;
    els.hudSol.textContent = `Sol ${sol} / ${totalSols}${s.slip ? ` · slip ${s.slip}` : ''}`;
    els.hudHearts.innerHTML = heartsHTML(s.hearts);
    els.hudHearts.setAttribute('aria-label', `Crew hearts: ${s.hearts} of 3`);
    els.hudPhase.textContent = s.phase.toUpperCase();
    els.hudPhase.dataset.phase = s.phase;
    els.hudEva.textContent = `EVA ${s.eva}`;
    els.phaseChip.textContent = s.phase.toUpperCase();
    els.phaseChip.dataset.phase = s.phase;
    els.phaseHint.textContent = s.phase === 'plan' ? 'Spend power cells' : s.phase === 'eva' ? 'Walk + do tasks' : 'Resolving…';

    els.cellsLeft.textContent = String(Math.max(0, leftCells()));
    els.cellsLeft.classList.toggle('is-empty', leftCells() === 0);

    for (const row of L.rows) {
      const meta = ROWS[row];
      const v = ROWS[row].kind === 'cells' ? clamp(s.res[row] || 0, 0, RULES.batteryCap.value)
        : row === 'repair' ? 0 : clamp(s.res[row] || 0, 0, 100);
      const value = document.getElementById(`val-${row}`);
      if (value) {
        if (row === 'repair') value.textContent = `${s.patch}/${RULES.patchNeeded.value}`;
        else value.textContent = meta.kind === 'cells' ? `${Math.round(v)}/6` : `${Math.round(v)}%`;
        value.classList.toggle('is-low', meta.kind !== 'cells' && row !== 'repair' && v < CRITICAL);
      }
      const meter = document.getElementById(`meter-${row}`);
      const bar = document.getElementById(`bar-${row}`);
      if (row === 'repair') {
        const pct = (s.patch / RULES.patchNeeded.value) * 100;
        if (meter) meter.setAttribute('aria-valuenow', String(Math.round(pct)));
        if (bar) { bar.style.width = `${pct}%`; bar.style.backgroundColor = s.patched ? '#7ce38b' : '#ffb02e'; }
      } else {
        const pct = meta.kind === 'cells' ? (v / RULES.batteryCap.value) * 100 : v;
        if (meter) meter.setAttribute('aria-valuenow', String(Math.round(pct)));
        if (bar) {
          bar.style.width = `${pct}%`;
          bar.style.backgroundColor = meta.kind !== 'cells' && v < CRITICAL ? '#ff4d6d' : meta.color;
        }
      }
      const allocEl = document.getElementById(`alloc-${row}`);
      if (allocEl) allocEl.textContent = String(s.alloc[row] || 0);
      const cells = document.getElementById(`cells-${row}`);
      if (cells) {
        cells.innerHTML = '';
        for (let i = 0; i < s.budget; i++) {
          const cell = document.createElement('span');
          cell.className = 'cell' + (i < (s.alloc[row] || 0) ? ' is-on' : '');
          cells.appendChild(cell);
        }
      }
      const enabled = s.phase === 'plan' || s.phase === 'eva';
      for (const btn of els.systems.querySelectorAll(`[data-key="${row}"]`)) {
        if (btn.dataset.act === 'plus') btn.disabled = !enabled || leftCells() <= 0 || (s.alloc[row] || 0) >= s.budget;
        else btn.disabled = !enabled || (s.alloc[row] || 0) <= 0;
      }
    }

    // battery / draw
    els.batteryVal.textContent = `${Math.round(s.battery)}/${RULES.batteryCap.value}`;
    els.drawBtn.disabled = !((s.phase === 'plan' || s.phase === 'eva') && s.battery > 0 && s.draws < RULES.maxDrawPerSol.value);
    els.drawBtn.textContent = `Draw +1${s.draws ? ` (${s.draws}/2)` : ''}`;

    // patch steps
    if (L.id === '1.2') {
      els.patchBox.hidden = false;
      els.patchVal.textContent = `${s.patch}/${RULES.patchNeeded.value}`;
      els.patchFill.style.width = `${(s.patch / RULES.patchNeeded.value) * 100}%`;
      const steps = [
        { t: 'Close hatch (isolate)', done: s.isolated },
        { t: 'Fetch toolbox + tape', done: s.carryingTape || s.taped },
        { t: 'Apply Kapton tape', done: s.taped },
        { t: 'Cure patch (2 repair cells)', done: s.patched },
        { t: 'Reopen hatch', done: s.reopened },
      ];
      els.patchSteps.innerHTML = steps.map((st) => `<li class="${st.done ? 'done' : ''}">${st.t}</li>`).join('');
    } else {
      els.patchBox.hidden = true;
    }

    // dose
    if (L.dose) {
      els.doseBox.hidden = false;
      els.hudDose.hidden = false;
      els.hudDose.textContent = `☢ ${Math.round(s.dose)}`;
      els.hudDose.classList.toggle('is-high', s.dose > RULES.doseLimit.value);
      els.doseVal.textContent = `${Math.round(s.dose)} / ${RULES.doseLimit.value}`;
      els.doseBar.style.width = `${clamp(s.dose, 0, 100)}%`;
      els.doseBar.style.backgroundColor = s.dose > RULES.doseLimit.value ? '#ff4d6d' : '#ff8da1';
      els.doseNote.textContent = s.sheltered
        ? 'Crew sheltered — storm dose cut by 90%.'
        : s.dose > RULES.doseLimit.value ? 'Over the limit — the crew is losing hearts!' : `Safe under ${RULES.doseLimit.value}. Shielding slows it down.`;
    } else {
      els.doseBox.hidden = true;
      els.hudDose.hidden = true;
    }

    // EVA
    els.evaVal.textContent = String(s.eva);
    els.evaPips.innerHTML = Array.from({ length: RULES.evaMinutes.value }, (_, i) =>
      `<span class="eva-pip${i < s.eva ? ' is-on' : ''}"></span>`).join('');
    els.evaHint.innerHTML = s.phase === 'eva'
      ? 'Hold <kbd>E</kbd> at a station (or hold the prompt). Use all minutes or end early.'
      : s.phase === 'plan' ? 'Start the EVA to walk the base and fix things.' : 'Resolving the sol…';

    // shelter order (1.3)
    const showShelter = L.id === '1.3' && s.sol >= 2 && s.stormArrival > 0 && !s.sheltered;
    els.shelterBtn.hidden = !showShelter;
    if (showShelter) {
      els.shelterBtn.disabled = s.phase === 'resolve';
      els.shelterBtn.textContent = s.stormKnown ? `Order shelter (storm Sol ${s.stormArrival})` : 'Order shelter';
    }

    // run button
    const isPlan = s.phase === 'plan';
    els.run.textContent = isPlan ? 'Start EVA ▶' : s.phase === 'eva' ? 'End EVA ▶' : 'Resolving…';
    els.run.disabled = s.phase === 'resolve';
    els.hint.textContent = isPlan
      ? (leftCells() > 0 ? `${leftCells()} cell${leftCells() === 1 ? '' : 's'} will charge the battery.` : 'Battery charged — start the EVA.')
      : s.phase === 'eva' ? 'Walk the base, fix what the forecast warns about.' : '';

    // forecast
    const f = forecastFor(s);
    if (f.sprite && ready(f.sprite)) {
      els.forecastImg.hidden = false;
      els.forecastImg.src = assetPath(f.sprite);
      els.forecastIcon.hidden = true;
    } else {
      els.forecastImg.hidden = true;
      els.forecastIcon.hidden = false;
      els.forecastIcon.textContent = f.icon || '🌤️';
    }
    els.forecastLabel.textContent = f.label;
    els.forecastText.innerHTML = f.text;
    els.forecast.dataset.tone = f.tone;

    // console height for the prompt
    requestAnimationFrame(measureConsole);
  }

  function forecastFor(s) {
    const L = s.level;
    const ev = { calm: { label: 'Clear skies', icon: '🌤️', tone: 'neutral', text: 'No hazards expected — a good sol to refill reserves.' },
      dust: { label: 'Dust on panels', icon: '🌪️', tone: 'warn', text: 'Dust coats the arrays: <strong>1 fewer cell</strong> next sol. Sweep them during EVA.' },
      longshadow: { label: 'Long shadow', icon: '🌗', tone: 'warn', text: 'The Sun is low behind the rim: <strong>2 fewer cells</strong> next sol.' },
      cme: { label: 'Space weather alert', icon: '☀️', tone: 'bad', text: 'A CME is on the way. Check the comms dish for the arrival sol.' },
      cold: { label: 'Cold snap', icon: '🥶', tone: 'warn', text: 'Heaters need <strong>8 extra O₂</strong> this sol.' },
      storm: { label: 'Solar storm', icon: '☀️', tone: 'bad', text: 'Solar particle event! Shelter the crew or take the dose.' },
    }[s.eventKey] || { label: 'Clear skies', icon: '🌤️', tone: 'neutral', text: 'No hazards expected.' };

    if (L.id === '1.3') {
      if (s.stormStarted) {
        return { label: `Storm · Sol ${s.sol}`, tone: 'bad', sprite: 'fx/sun', icon: '☀️',
          text: s.sheltered ? 'Crew is in the bunker — dose cut by 90%.' : 'Crew is outside — full storm dose this sol!' };
      }
      if (s.stormArrival) {
        const when = s.stormKnown ? `Sol ${s.stormArrival}` : 'soon';
        return { label: s.stormKnown ? 'Space weather · confirmed' : 'Space weather · vague', tone: 'bad', sprite: 'fx/sun', icon: '☀️',
          text: s.stormKnown
            ? `Storm arrives on <strong>Sol ${s.stormArrival}</strong> (lasts ${s.stormDuration}). Order shelter before then.`
            : `A CME is on the way — arrival <strong>${when}</strong>. Visit the comms dish for the exact sol.` };
      }
    }
    if (L.id === '1.2') {
      return { label: `Forecast · Sol ${s.sol}`, tone: 'warn', sprite: 'hazard/water_leak', icon: '💧',
        text: s.reopened ? 'Leak sealed. Keep water above 40%.' : s.isolated ? 'Hatch closed. Tape and patch the leak, then reopen.' : 'Water is leaking. Close the hatch at the recycler.' };
    }
    if (L.id === '1.1' && s.sol === L.goalsSol) {
      return { label: 'Crew landing · Sol 5', tone: 'good', sprite: 'fx/capsule', icon: '🚀',
        text: `Targets: O₂ ≥ ${L.goals.o2}%, water ≥ ${L.goals.water}%, battery ≥ ${L.goals.battery}.` };
    }
    return { label: ev.label + ` · Sol ${s.sol}`, tone: ev.tone, icon: ev.icon, text: ev.text };
  }

  function addLog(text, tone = 'info') {
    const li = document.createElement('li');
    li.className = `log-item log-${tone}`;
    li.innerHTML = text;
    els.log.prepend(li);
    while (els.log.children.length > 24) els.log.removeChild(els.log.lastChild);
  }

  /* ------------------------------------------------------------ station UI -- */
  let stationRow = null;
  function openStationPanel(row) {
    stationRow = row;
    els.stationModal.hidden = false;
    const meta = ROWS[row];
    const L = state.level;
    const cells = state.alloc[row] || 0;
    const gain = row === 'o2' ? cells * RULES.o2PerCell.value
      : row === 'water' ? cells * RULES.waterPerCell.value
      : cells * RULES.shieldPerCell.value;
    const use = row === 'o2' ? RULES.crewO2.value
      : row === 'water' ? RULES.crewWater.value * (state.ration ? 0.6 : 1)
      : 0;
    const wear = row === 'o2' ? 5 + Math.round(state.sol * 0.5) : row === 'water' ? 3 + Math.round(state.sol * 0.4) : 0;

    els.stationTitle.textContent = meta.name;
    els.stationDesc.textContent = row === 'o2'
      ? 'Oxygen generator (electrolysis). More cells make more O₂.'
      : row === 'water' ? 'Water recycler. More cells recover more water for the crew.'
      : 'Shielding is passive — cells restore the meter.';
    els.stationBars.innerHTML = `
      <div class="station-row pos"><span>Production (${cells} cells)</span><b>+${gain}</b></div>
      <div class="station-row neg"><span>Crew use</span><b>−${Math.round(use)}</b></div>
      <div class="station-row neg"><span>Wear</span><b>−${wear}</b></div>`;
    els.stationNote.textContent = L.id === '1.2' && state.isolated && row === 'water'
      ? 'Recycler is isolated: water cells make nothing until the hatch is reopened.'
      : `Leftover power cells: ${leftCells()}.`;
    els.stationCells.textContent = String(cells);
    els.stationMinus.disabled = cells <= 0 || state.phase === 'resolve';
    els.stationPlus.disabled = leftCells() <= 0 || state.phase === 'resolve';
    Sound.click();
  }
  function closeStationPanel() { els.stationModal.hidden = true; stationRow = null; }

  /* ================================================================ levels == */
  function startLevel(id) {
    const L = LEVELS[id];
    if (!L) return;
    const s = state;
    s.runId += 1;
    s.levelId = id; s.level = L;
    s.phase = 'plan';
    s.sol = 1;
    s.hearts = MAX_HEARTS;
    s.res = {};
    for (const row of L.rows) s.res[row] = L.start[row] != null ? L.start[row] : 0;
    s.alloc = splitBudget(L.rows, RULES.budget.value);
    s.budget = RULES.budget.value;
    s.draws = 0;
    s.battery = L.id === '1.1' ? L.start.battery : 0;
    if (L.rows.includes('battery')) s.res.battery = s.battery;
    s.dose = 0; s.dosePeak = 0; s.heartsLost = 0; s.research = 0;
    s.penalty = 0; s.nextPenalty = 0;
    s.eva = RULES.evaMinutes.value; s.evaUsed = 0;
    s.sweepSol = 0;
    s.panelDeployed = false; s.carryingPanel = false; s.carryingTape = false;
    s.isolated = false; s.taped = false; s.patched = false; s.reopened = false;
    s.patch = 0; s.leakActive = L.id === '1.2'; s.leakStart = 0; s.spareDelivered = false;
    s.ration = false; s.rationSols = 0;
    s.stormArrival = 0; s.stormDuration = 1; s.stormKnown = false; s.stormStarted = false;
    s.sheltered = false; s.shelterSol = 0; s.exposedCrew = 0;
    s.iceUsedSol = 0;
    s.slip = 0; s.delayed = false; s.revived = false;
    s.schedule = L.schedule.slice();
    s.fx = null; s.winAt = 0;
    s.stats = { lowest: {}, startRes: { ...s.res }, evaTasks: 0 };
    s.lastDoseCause = '';

    if (L.id === '1.2') s.leakStart = Math.random() < 0.5 ? 1 : 2;
    if (L.id === '1.3') {
      s.stormArrival = 3 + Math.floor(Math.random() * 3); // 3..5
      s.stormDuration = Math.random() < 0.8 ? 2 : 1; // 1..2 sols
    }

    player.x = 512; player.y = 430; player.path = []; player.facing = 1;
    for (const n of npcs) { n.x = n.id === 'npc1' ? 470 : 620; n.y = n.id === 'npc1' ? 400 : 420; n.tx = n.x; n.ty = n.y; n.atBunker = false; }
    snapCamera();

    buildSystems();
    els.log.innerHTML = '';
    showScreen('game');
    els.panel.classList.remove('is-collapsed');
    resize();
    addLog(`<b>Mission ${L.id} · ${L.title}</b> — ${L.location}`, 'head');
    startSol(true);
    render();
  }

  function splitBudget(rows, budget) {
    const out = {};
    const base = Math.floor(budget / rows.length);
    let extra = budget - base * rows.length;
    for (const row of rows) { out[row] = base + (extra > 0 ? 1 : 0); if (extra > 0) extra -= 1; }
    return out;
  }

  function startSol(first = false) {
    const s = state;
    const L = s.level;
    s.phase = 'plan';
    s.penalty = s.nextPenalty;
    s.nextPenalty = 0;
    s.draws = 0;
    s.eva = RULES.evaMinutes.value;
    s.evaUsed = 0;
    s.eventKey = s.schedule[s.sol - 1] || 'calm';
    s.fx = null;

    // storm lifecycle
    if (L.id === '1.3') {
      s.stormStarted = s.stormArrival > 0 && s.sol >= s.stormArrival && s.sol < s.stormArrival + s.stormDuration;
      if (s.sol === s.stormArrival) {
        addLog(`☀️ <b>Storm arriving!</b> ${s.sheltered ? 'Crew is in the bunker.' : 'Crew is still outside.'}`, s.sheltered ? 'good' : 'bad');
        s.fx = { type: 'storm', t0: performance.now() / 1000 };
      }
    }

    s.budget = Math.max(2, RULES.budget.value - s.penalty + (s.panelDeployed ? 1 : 0));
    fitAlloc();
    if (!first) addLog(`<b>Sol ${s.sol}</b> · ${s.budget} cells${s.penalty ? ` (−${s.penalty} penalty)` : ''} · ${s.eva} EVA minutes.`, 'muted');
    if (L.hints && L.hints[s.sol]) addLog(`💡 ${L.hints[s.sol]}`, 'muted');
    if (L.id === '1.2' && s.sol === s.leakStart) {
      s.leakActive = true;
      addLog('🚨 <b>Water leak!</b> A recycler pipe burst. Get to the recycler deck.', 'bad');
      Sound.warn();
    }
    render();
    startEVAPhaseIfDebug();
  }

  // QA helper: ?debug&auto starts the EVA automatically
  function startEVAPhaseIfDebug() {
    if (window.__JAMT_AUTO_EVA) setTimeout(() => { if (state.phase === 'plan') startEVA(); }, 80);
  }

  function fitAlloc() {
    const s = state;
    for (const row of s.level.rows) s.alloc[row] = Math.min(s.alloc[row] || 0, s.budget);
    while (totalAlloc() > s.budget) {
      let biggest = s.level.rows[0];
      for (const row of s.level.rows) if (s.alloc[row] > s.alloc[biggest]) biggest = row;
      s.alloc[biggest] -= 1;
    }
  }

  function addCell(row) {
    if (state.phase === 'resolve') return;
    if (leftCells() <= 0) { Sound.warn(); return; }
    state.alloc[row] = (state.alloc[row] || 0) + 1;
    Sound.add(); render();
    if (stationRow === row) openStationPanel(row);
  }
  function removeCell(row) {
    if (state.phase === 'resolve' || !state.alloc[row]) return;
    state.alloc[row] -= 1;
    Sound.remove(); render();
    if (stationRow === row) openStationPanel(row);
  }
  function drawBattery() {
    const s = state;
    if (!(s.phase !== 'resolve' && getBattery() > 0 && s.draws < RULES.maxDrawPerSol.value)) return;
    setBattery(getBattery() - 1);
    s.draws += 1; s.budget += 1;
    addLog('🔋 Drew <b>1 cell</b> from the battery.', 'good');
    Sound.add(); render();
  }

  function startEVA() {
    const s = state;
    if (s.phase !== 'plan') return;
    s.phase = 'eva';
    const leftover = Math.max(0, leftCells());
    addLog(`🚀 EVA started with ${s.eva} minutes.${leftover ? ` ${leftover} leftover cell${leftover === 1 ? '' : 's'} will charge the battery.` : ''}`, 'good');
    Sound.run();
    render();
  }

  function endEVA() {
    const s = state;
    if (s.phase !== 'eva') return;
    resolveSol();
  }

  /* =============================================================== resolve == */
  function resolveSol() {
    const s = state;
    const L = s.level;
    s.phase = 'resolve';
    cancelHold();
    const runId = s.runId;
    const sol = s.sol;
    const alloc = { ...s.alloc };
    const lines = [];

    // 1 — power gains
    for (const row of L.rows) {
      const cells = alloc[row] || 0;
      if (row === 'battery') setBattery((getBattery()) + cells);
      else if (row === 'repair') { /* patch handled below */ }
      else if (row === 'surface') {
        if (!s.sheltered) s.res.surface = clamp((s.res.surface || 0) + cells * RULES.surfacePerCell.value);
      } else if (row === 'shielding') {
        s.res.shielding = clamp((s.res.shielding || 0) + cells * RULES.shieldPerCell.value);
      } else if (row === 'water') {
        if (!(L.id === '1.2' && s.isolated)) s.res.water = clamp((s.res.water || 0) + cells * RULES.waterPerCell.value);
        else lines.push({ t: 'Recycler is isolated — water cells made nothing this sol.', tone: 'warn' });
      } else if (row === 'o2') {
        if (!s.sheltered || cells >= 1) s.res.o2 = clamp((s.res.o2 || 0) + cells * RULES.o2PerCell.value);
        else {
          s.res.o2 = clamp((s.res.o2 || 0) - 6);
          lines.push({ t: 'Sheltered with no O₂ cell: upkeep drains <b>6 extra O₂</b>.', tone: 'warn' });
        }
      }
    }

    // 2 — electrolysis + crew
    const o2Cells = alloc.o2 || 0;
    if (o2Cells > 0 && s.res.water != null) {
      const cost = o2Cells * RULES.electrolysisWater.value;
      s.res.water = clamp(s.res.water - cost);
      lines.push({ t: `Electrolysis used <b>${cost} water</b> for oxygen.`, tone: 'muted' });
    }
    if (s.res.o2 != null) {
      s.res.o2 = clamp(s.res.o2 - RULES.crewO2.value);
      lines.push({ t: `Crew breathing: <b>−${RULES.crewO2.value} O₂</b>.`, tone: 'muted' });
    }
    if (s.res.water != null) {
      const rationed = s.ration;
      const use = RULES.crewWater.value * (rationed ? 1 - RULES.rationCut.value : 1);
      s.res.water = clamp(s.res.water - use);
      lines.push({ t: `Crew water use: <b>−${use.toFixed(1)}</b>${rationed ? ' (rationed)' : ''}.`, tone: 'muted' });
    }

    // 3 — wear
    const wear = {};
    for (const row of L.rows) {
      if (row === 'battery' || row === 'surface' || row === 'repair') continue;
      wear[row] = row === 'o2' ? 5 + Math.round(sol * 0.5) : row === 'water' ? 3 + Math.round(sol * 0.4) : 4;
      s.res[row] = clamp(s.res[row] - wear[row]);
      s.stats.lowest[row] = Math.min(s.stats.lowest[row] ?? 100, Math.round(s.res[row]));
    }
    if (Object.keys(wear).length) {
      lines.push({ t: `Wear: ${Object.keys(wear).map((r) => `−${wear[r]} ${ROWS[r].short}`).join(' · ')}.`, tone: 'muted' });
    }

    // 4 — leak + patch
    if (L.id === '1.2') {
      if (s.leakActive && !s.reopened) {
        const rate = RULES.leakRate.value * (s.taped ? RULES.leakTaped.value : s.isolated ? RULES.leakIsolated.value : 1);
        s.res.water = clamp(s.res.water - rate);
        lines.push({ t: `Leak loses <b>${rate.toFixed(1)} water</b>${s.taped ? ' (taped)' : s.isolated ? ' (isolated)' : ''}.`, tone: 'bad' });
      }
      // random spare-parts delivery (design brief: optional cargo drop)
      if (!s.spareDelivered && s.sol >= 2 && Math.random() < 0.3) {
        s.spareDelivered = true;
        if (s.isolated && s.taped && !s.patched) {
          s.patch = Math.min(RULES.patchNeeded.value, s.patch + 1);
          lines.push({ t: '📦 Spare-parts delivery: sealant accelerates the patch (+1).', tone: 'good' });
        } else {
          lines.push({ t: '📦 A cargo lander drops spare seals and tape.', tone: 'good' });
        }
      }
      if (s.isolated && s.taped && !s.patched) {
        s.patch = Math.min(RULES.patchNeeded.value, s.patch + (alloc.repair || 0));
        if (s.patch >= RULES.patchNeeded.value) {
          s.patched = true;
          lines.push({ t: '🔧 <b>Permanent patch cured!</b> Reopen the hatch to restart the recycler.', tone: 'good' });
        } else {
          lines.push({ t: `Patch curing: <b>${s.patch}/${RULES.patchNeeded.value}</b> repair cells.`, tone: 'muted' });
        }
      }
      if (s.ration) {
        if (s.reopened) {
          s.ration = false;
          lines.push({ t: 'Rationing switched off: the leak is sealed.', tone: 'muted' });
        } else {
          const active = s.res.water < 50;
          if (active) {
            s.rationSols += 1;
            if (s.rationSols >= RULES.rationHeartAfter.value) {
              s.rationSols = 0;
              s.hearts -= 1; s.heartsLost += 1;
              lines.push({ t: '⚠️ Rationing for 3 sols with water under 50%: <b>−1 heart</b>.', tone: 'bad' });
              Sound.warn();
            }
          }
        }
      }
    }

    // 5 — events
    if (s.eventKey === 'dust') { s.nextPenalty = Math.max(s.nextPenalty, 1); lines.push({ t: 'Dust: <b>1 fewer cell</b> next sol — sweep the panels during EVA.', tone: 'warn' }); }
    if (s.eventKey === 'longshadow') { s.nextPenalty = Math.max(s.nextPenalty, 2); lines.push({ t: 'Long shadow: <b>2 fewer cells</b> next sol.', tone: 'warn' }); }
    if (s.eventKey === 'cold') { s.res.o2 = clamp(s.res.o2 - 8); lines.push({ t: 'Cold snap: heaters burn <b>8 extra O₂</b>.', tone: 'warn' }); }

    // 6 — dose
    if (L.dose) {
      const shield = clamp(s.res.shielding || 0, 0, 100);
      const stormActive = s.sol >= s.stormArrival && s.sol < s.stormArrival + s.stormDuration;
      s.stormStarted = stormActive;
      let dose = RULES.backgroundDose.value * (1 - 0.3 * shield / 100);
      if (stormActive) {
        const power = RULES.stormPower.value * (1 - RULES.stormShieldCut.value * shield / 100);
        if (s.sheltered) {
          const early = s.shelterSol < s.stormArrival;
          dose += power * (early ? 1 - RULES.bunkerCut.value : 0.85);
          lines.push({ t: early
            ? `🛖 Sheltered before arrival: storm dose mostly blocked (<b>+${dose.toFixed(1)}</b>).`
            : `🛖 Sheltered late — crew was still walking when the storm hit (<b>+${dose.toFixed(1)}</b>).`, tone: early ? 'good' : 'warn' });
        } else {
          dose += power;
          const outside = npcs.filter((n) => !n.atBunker).length;
          if (outside) dose += power * 0.1 * outside;
          lines.push({ t: `☀️ Storm exposure at shielding ${Math.round(shield)}%: <b>+${dose.toFixed(1)} dose</b>${outside ? ` · ${outside} crew outside` : ''}.`, tone: 'bad' });
        }
      }
      s.dose = clamp(s.dose + dose, 0, 100);
      s.dosePeak = Math.max(s.dosePeak || 0, s.dose);
      if (s.dose > RULES.doseLimit.value) {
        s.hearts -= 1;
        lines.push({ t: `⚠️ Dose over ${RULES.doseLimit.value}: <b>−1 heart</b>.`, tone: 'bad' });
        Sound.warn();
      }
      // research
      const research = (!s.sheltered && L.rows.includes('surface')) ? (alloc.surface || 0) * RULES.researchPerCell.value : 0;
      if (research) { s.research += research; lines.push({ t: `Surface work earned <b>${research} research</b>.`, tone: 'good' }); }
    }

    // 7 — leftover cells -> battery
    const leftover = Math.max(0, s.budget - totalAlloc());
    if (leftover > 0) {
      const before = getBattery();
      setBattery(before + leftover);
      lines.push({ t: `Stored <b>${Math.min(leftover, RULES.batteryCap.value - before)}</b> leftover cell(s) in the battery.`, tone: 'good' });
    }
    if (s.res.battery != null) s.res.battery = clamp(s.res.battery, 0, RULES.batteryCap.value);

    // 8 — clamp + hearts
    for (const row of L.rows) {
      if (ROWS[row].kind === 'cells') continue;
      if (s.res[row] == null) continue;
      if (row !== 'repair') s.res[row] = clamp(s.res[row]);
    }
    const dangerRows = L.rows.filter((r) => ROWS[r].kind !== 'cells' && r !== 'repair' && r !== 'surface');
    const lows = dangerRows.filter((r) => (s.res[r] ?? 100) < CRITICAL);
    if (lows.length && s.hearts > 0) {
      s.hearts -= 1; s.heartsLost += 1;
      lines.push({ t: `⚠️ Critical: ${lows.map((r) => ROWS[r].short).join(' & ')} under ${CRITICAL}% — <b>−1 heart</b>.`, tone: 'bad' });
      Sound.warn();
    }

    addLog(`<b>Sol ${sol} · ${s.eventKey}</b> — cells ${L.rows.map((r) => alloc[r] || 0).join('/')}`, 'head');
    for (const line of lines) addLog(line.t, line.tone);

    render();

    // 9 — outcome
    const stillCurrent = () => s.runId === runId;
    const empty = dangerRows.filter((r) => (s.res[r] ?? 100) <= 0);
    if (empty.length) {
      setTimeout(() => { if (stillCurrent()) endLevel(false, `The outpost ran out of ${empty.map((r) => ROWS[r].short).join(' and ')}.`); }, 900);
      return;
    }
    if (s.hearts <= 0) {
      setTimeout(() => { if (stillCurrent()) endLevel(false, 'The crew is too exhausted to keep going.'); }, 900);
      return;
    }

    const win = checkWin(s, sol);
    if (win === 'win') {
      const delay = L.id === '1.1' ? 2400 : 900;
      if (L.id === '1.1') s.fx = { type: 'capsule', t0: performance.now() / 1000 };
      setTimeout(() => { if (stillCurrent()) endLevel(true); }, delay);
      return;
    }
    if (win === 'fail') {
      setTimeout(() => { if (stillCurrent()) endLevel(false, failReason(s)); }, 900);
      return;
    }

    setTimeout(() => {
      if (!stillCurrent()) return;
      s.sol = sol + 1;
      startSol();
    }, 900);
  }

  function checkWin(s, sol) {
    const L = s.level;
    if (L.id === '1.1') {
      const ready = s.res.o2 >= L.goals.o2 && s.res.water >= L.goals.water && s.res.battery >= L.goals.battery;
      if (sol >= L.goalsSol) {
        if (ready) return 'win';
        if (s.slip < L.maxSlip) {
          s.slip += 1;
          s.delayed = true;
          addLog(`📡 Crew landing slips to <b>Sol ${sol + 1}</b> — the outpost is not ready.`, 'warn');
          return null;
        }
        return 'fail';
      }
      return null;
    }
    if (L.id === '1.2') return sol >= L.maxSols ? (s.reopened && s.res.water >= 40 ? 'win' : 'fail') : null;
    if (L.id === '1.3') return sol >= L.maxSols ? (s.dose <= RULES.doseLimit.value && s.res.o2 >= 30 ? 'win' : 'fail') : null;
    return null;
  }

  function failReason(s) {
    const L = s.level;
    if (L.id === '1.1') return 'The outpost was still not ready after two landing slips.';
    if (L.id === '1.2') return s.reopened ? `Water fell to ${Math.round(s.res.water)}% — the crew needs at least 40%.` : 'The leak was never sealed.';
    if (L.id === '1.3') return s.dose > RULES.doseLimit.value ? `Radiation dose reached ${Math.round(s.dose)} — over the limit.` : `Oxygen fell to ${Math.round(s.res.o2)}%.`;
    return 'The outpost could not hold on.';
  }

  function computeScore() {
    const s = state;
    const L = s.level;
    let score = 0;
    for (const row of L.rows) {
      if (ROWS[row].kind === 'cells') score += Math.round(s.res[row] || 0) * 10;
      else if (row !== 'repair') score += Math.round(s.res[row] || 0);
    }
    score += s.research;
    score += s.hearts * 25;
    if (L.id === '1.1' && !s.delayed) score += 40;
    if (L.id === '1.2' && s.reopened) score += 30;
    if (L.id === '1.3' && s.sheltered) score += 20;
    return score;
  }

  function computeStars() {
    const s = state;
    if (s.phase !== 'win') return 0;
    let stars = clamp(s.hearts, 1, 3);
    const worst = Math.min(...Object.values(s.stats.lowest || { 0: 100 }));
    const par = { '1.1': 340, '1.2': 205, '1.3': 250 }[s.level.id] || 260;
    if (s.delayed) stars = Math.min(stars, 2);
    if (computeScore() < par) stars = Math.min(stars, 2);
    if (worst < 30) stars = Math.min(stars, 2);
    if ((s.dosePeak || 0) > 40) stars = Math.min(stars, 2);
    if ((s.heartsLost || 0) > 0) stars = Math.min(stars, 2);
    return stars;
  }

  function endLevel(won, reason = '') {
    const s = state;
    const L = s.level;
    s.phase = won ? 'win' : 'over';
    s.winAt = performance.now() / 1000;
    if (won) saveStars(L.id, computeStars());
    const stars = computeStars();
    const score = computeScore();

    showScreen('debrief');
    els.debriefStars.innerHTML = starMarkup(stars);
    els.debriefTitle.textContent = won
      ? (L.id === '1.1' ? 'Crew Landed!' : L.id === '1.2' ? 'Leak Sealed!' : 'Storm Survived!')
      : 'Mission Failed';
    els.debriefSub.textContent = won
      ? (L.id === '1.1'
        ? (s.delayed ? `The capsule landed on Sol ${s.sol} — after ${s.slip} slip${s.slip > 1 ? 's' : ''}.` : 'The capsule landed right on schedule, Sol 5.')
        : L.id === '1.2' ? `The patch cured and the hatch was reopened ${s.reopened ? 'in time' : ''}.`
        : 'The crew stayed inside safe radiation limits.')
      : (reason || 'Retry is free — try a different plan.');

    const chips = [
      `Hearts <b>${s.hearts}/3</b>`, `Score <b>${score}</b>`,
      ...(L.rows.includes('surface') ? [`Research <b>${s.research}</b>`] : []),
      ...(L.rows.includes('battery') ? [`Battery <b>${Math.round(s.res.battery || 0)}/6</b>`] : []),
      ...(s.delayed ? ['Landing <b>slipped</b>'] : []),
      ...(s.slip >= 2 ? ['Slips <b>2</b>'] : []),
    ];
    els.debriefScore.innerHTML = chips.map((c) => `<span class="score-chip">${c}</span>`).join('');

    const good = []; const bad = [];
    if (won) good.push(L.id === '1.1' ? 'Outpost ready for the crew.' : L.id === '1.2' ? 'Leak isolated, taped and patched.' : 'Crew sheltered from the particle event.');
    if (s.hearts === 3) good.push('All 3 hearts kept.');
    if (s.evaUsed) good.push(`Used ${s.evaUsed} EVA minutes for physical fixes.`);
    if (s.research > 0) good.push(`Earned ${s.research} research points.`);
    if (s.reopened) good.push('Recycler back online after the patch.');
    if (s.hearts < 3) bad.push(`Lost ${3 - s.hearts} crew heart${3 - s.hearts === 1 ? '' : 's'}.`);
    for (const [row, low] of Object.entries(s.stats.lowest)) if (low < 45) bad.push(`${ROWS[row].short} dipped to ${low}%.`);
    if (s.delayed) bad.push('Crew landing slipped one or more sols.');
    if (L.id === '1.2' && !s.reopened) bad.push('The recycler was never reopened.');
    if (L.id === '1.3' && s.dose > RULES.doseLimit.value) bad.push(`Dose peaked over ${RULES.doseLimit.value}.`);
    if (!bad.length) bad.push('Nothing serious — a clean mission.');
    els.debriefGood.innerHTML = good.slice(0, 3).map((t) => `<li>${t}</li>`).join('');
    els.debriefBad.innerHTML = bad.slice(0, 3).map((t) => `<li>${t}</li>`).join('');

    els.learnReal.textContent = L.debrief.real;
    els.learnRealSrc.textContent = L.debrief.source;
    els.learnAssume.textContent = L.debrief.assume;
    els.realChoice.textContent = `What would real astronauts do? ${L.debrief.choice}`;

    const idx = LEVEL_ORDER.indexOf(L.id);
    const nextId = LEVEL_ORDER[idx + 1];
    els.next.hidden = !won;
    els.next.disabled = won && !nextId;
    els.next.textContent = nextId ? `Next: ${LEVELS[nextId].title} ▶` : 'Next: Mars 🔒';
    els.retry.textContent = won ? 'Replay' : 'Retry';
    els.revive.hidden = won || s.revived;
    els.revive.disabled = s.revived;

    if (won) Sound.win(); else Sound.lose();
  }

  /* ================================================================ revive == */
  function reviveMission() {
    const s = state;
    const L = s.level;
    if (s.revived || !L) return;
    s.revived = true;
    s.hearts = 1;
    for (const row of L.rows) {
      if (ROWS[row].kind === 'cells') s.res[row] = Math.max(s.res[row] || 0, 3);
      else if (row === 'repair') s.patch = Math.max(s.patch, 1);
      else s.res[row] = Math.max(s.res[row] || 0, 45);
    }
    setBattery(Math.max(getBattery(), 3));
    // B9: remove the cause of the death
    if (L.dose) {
      s.dose = Math.min(s.dose, RULES.doseLimit.value * 0.7);
      s.stormStarted = false;
      s.stormArrival = Math.max(s.stormArrival, s.sol + 1);
      s.sheltered = false;
    }
    s.leakActive = L.id === '1.2' ? s.leakActive : false;
    if (L.id === '1.2' && !s.reopened) { s.isolated = false; s.taped = false; }
    s.phase = 'plan';
    showScreen('game');
    s.eva = RULES.evaMinutes.value;
    addLog('🚑 <b>Revive!</b> A supply lander restores every meter to at least 45%. The emergency cause is cleared.', 'good');
    Sound.revive();
    startSol(true);
  }

  /* ================================================================ inputs == */
  els.systems.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === 'plus') addCell(btn.dataset.key); else removeCell(btn.dataset.key);
  });

  els.run.addEventListener('click', () => {
    if (state.phase === 'plan') startEVA();
    else if (state.phase === 'eva') endEVA();
  });
  els.drawBtn.addEventListener('click', drawBattery);
  els.shelterBtn.addEventListener('click', () => orderShelter(false));
  els.toggle.addEventListener('click', () => {
    els.panel.classList.toggle('is-collapsed');
    measureConsole();
    setTimeout(snapCamera, 60);
  });

  els.interact.addEventListener('pointerdown', (e) => { e.preventDefault(); startHold(); });
  els.interact.addEventListener('pointerup', cancelHold);
  els.interact.addEventListener('pointercancel', cancelHold);
  els.interact.addEventListener('pointerleave', cancelHold);

  document.addEventListener('keydown', (e) => {
    const modalOpen = document.querySelector('.modal:not([hidden])');
    if (e.key === 'Escape') {
      if (modalOpen) { closeModals(); closeStationPanel(); }
      return;
    }
    if (modalOpen) return;
    if (state.screen === 'title') { if (e.key === 'Enter') { e.preventDefault(); goSelect(); } return; }
    if (state.screen === 'select') { if (e.key === 'Enter') { const id = LEVEL_ORDER.find(isUnlocked); if (id) startLevel(id); } return; }
    if (state.screen === 'debrief') { if (e.key === 'Enter') { e.preventDefault(); if (!els.next.hidden) els.next.click(); else els.retry.click(); } return; }
    if (state.screen !== 'game') return;

    const k = e.key.toLowerCase();
    if (e.code === 'KeyW' || e.key === 'ArrowUp') { e.preventDefault(); keys.up = true; return; }
    if (e.code === 'KeyS' || e.key === 'ArrowDown') { e.preventDefault(); keys.down = true; return; }
    if (e.code === 'KeyA' || e.key === 'ArrowLeft') { e.preventDefault(); keys.left = true; return; }
    if (e.code === 'KeyD' || e.key === 'ArrowRight') { e.preventDefault(); keys.right = true; return; }
    if (e.code === 'KeyE') { if (!e.repeat) startHold(); return; }
    if (e.code === 'KeyB') { drawBattery(); return; }

    // B14: use e.code so Shift+1/2/3 works on every layout
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code) && state.level) {
      const row = state.level.rows[Number(e.code.slice(-1)) - 1];
      if (!row) return;
      if (e.shiftKey) removeCell(row); else addCell(row);
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); if (state.phase === 'plan') startEVA(); else if (state.phase === 'eva') endEVA(); }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.key === 'ArrowUp') keys.up = false;
    if (e.code === 'KeyS' || e.key === 'ArrowDown') keys.down = false;
    if (e.code === 'KeyA' || e.key === 'ArrowLeft') keys.left = false;
    if (e.code === 'KeyD' || e.key === 'ArrowRight') keys.right = false;
    if (e.code === 'KeyE') cancelHold();
  });
  window.addEventListener('blur', () => { keys.up = keys.down = keys.left = keys.right = false; cancelHold(); });

  canvas.addEventListener('pointerdown', (e) => {
    if (state.screen !== 'game') return;
    const rect = canvas.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width) * VW + camera.x;
    const wy = ((e.clientY - rect.top) / rect.height) * VH + camera.y;
    player.path = findPath(wx, wy);
  });

  // station panel buttons
  els.stationMinus.addEventListener('click', () => { if (stationRow) removeCell(stationRow); });
  els.stationPlus.addEventListener('click', () => { if (stationRow) addCell(stationRow); });
  els.stationDone.addEventListener('click', closeStationPanel);

  $('#play-btn').addEventListener('click', () => { Sound.init(); Sound.click(); goSelect(); });
  $('#select-back').addEventListener('click', () => { Sound.click(); goTitle(); });
  els.retry.addEventListener('click', () => { Sound.click(); startLevel(state.levelId); });
  els.revive.addEventListener('click', () => { if (!els.revive.disabled) reviveMission(); });
  els.next.addEventListener('click', () => {
    const idx = LEVEL_ORDER.indexOf(state.levelId);
    const nextId = LEVEL_ORDER[idx + 1];
    Sound.click();
    if (nextId) startLevel(nextId); else goSelect();
  });
  els.map.addEventListener('click', () => { Sound.click(); goSelect(); });
  els.sound.addEventListener('click', () => {
    const muted = Sound.toggle();
    els.sound.textContent = muted ? '🔇' : '🔊';
    els.sound.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    if (!muted) Sound.click();
  });
  $('#map-btn-hud').addEventListener('click', () => document.body.classList.toggle('no-minimap'));

  function closeModals() { for (const m of document.querySelectorAll('.modal')) m.hidden = true; }
  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.hidden = false; Sound.click();
    const c = m.querySelector('[data-close]'); if (c) c.focus();
  }
  $('#how-btn').addEventListener('click', () => openModal('modal-how'));
  $('#science-btn').addEventListener('click', () => openModal('modal-science'));
  $('#science-btn-hud').addEventListener('click', () => openModal('modal-science'));
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { closeModals(); closeStationPanel(); });
  for (const m of document.querySelectorAll('.modal')) m.addEventListener('click', (e) => { if (e.target === m) { closeModals(); closeStationPanel(); } });

  /* ================================================================ update == */
  function updateInteractPrompt() {
    if (state.screen !== 'game' || state.phase !== 'eva') { els.interact.hidden = true; return; }
    const st = nearestStation();
    if (!st) { els.interact.hidden = true; return; }
    const action = actionFor(st);
    if (!action) { els.interact.hidden = true; return; }
    els.interact.hidden = false;
    els.interactKey.textContent = 'E';
    els.interactLabel.textContent = action.label;
    els.interactCost.textContent = action.minutes > 0 ? `${action.minutes} min` : 'info';
    const blocked = action.disabled || (action.minutes > 0 && state.eva < action.minutes);
    els.interact.disabled = blocked;
    els.interact.style.opacity = blocked ? '.55' : '1';
  }

  let lastT = 0;
  function frame(now) {
    const t = now / 1000;
    const dt = lastT ? Math.min(0.05, t - lastT) : 0.016;
    lastT = t;
    if (state.screen === 'game') {
      updatePlayer(dt);
      updateNPCs(dt);
      updateHold(dt);
      updateInteractPrompt();
    }
    drawScene(t);
    drawMinimap();
    requestAnimationFrame(frame);
  }

  /* ================================================================ debug === */
  const q = new URLSearchParams(location.search);
  const DEBUG = q.has('debug');
  window.__JAMT_AUTO_EVA = false;

  window.__JAMT__ = {
    get state() { return state; },
    get player() { return player; },
    get camera() { return camera; },
    get npcs() { return npcs; },
    get consolePx() { return consolePx; },
    WORLD, PROPS, STATIONS, colliders, RULES, LEVELS, LEVEL_ORDER,
    playerDrawHeight: 66,
    startLevel, startEVA, endEVA, addCell, removeCell, drawBattery,
    nearestStation, actionFor, findPath, blockedAt,
    holdAction: (seconds = 1.6) => { startHold(); hold.t = seconds; updateHold(0.001); },
    snapCamera, resolveSol, checkWin, render, endLevel, reviveMission, orderShelter,
    get ctx() { return ctx; },
    get drawOrder() { return window.__jamtDrawOrder || []; },
    get consolePx() { return consolePx; },
    walkTo(tx, ty) {
      player.path = findPath(tx, ty);
      let guard = 0;
      while (player.path.length && guard++ < 6000) {
        const node = player.path[0];
        const d = dist(player.x, player.y, node.x, node.y);
        if (d < 4) { player.path.shift(); continue; }
        const step = 82 * 0.05;
        movePlayer(((node.x - player.x) / d) * step, ((node.y - player.y) / d) * step);
      }
      snapCamera();
      return { x: player.x, y: player.y };
    },
    insideCollider() {
      return colliders.some((c) => player.x > c.x && player.x < c.x + c.w && player.y > c.y && player.y < c.y + c.h);
    },
  };

  if (DEBUG) {
    if (q.has('level')) { const id = q.get('level'); if (LEVELS[id]) startLevel(id); }
    else if (q.has('select')) goSelect();
    else if (q.has('play')) startLevel('1.1');
    if (q.has('fail') && state.level) setTimeout(() => endLevel(false, 'QA: forced failure.'), 300);
    if (q.has('auto')) {
      window.__JAMT_AUTO_EVA = true;
      let done = 0;
      const maxSols = Math.max(1, Number(q.get('auto')) || 1);
      const tick = () => {
        if (state.screen !== 'game') return;
        if (done++ >= maxSols) return;
        if (state.phase === 'plan') {
          // spend any leftovers evenly
          let guard = 0;
          while (leftCells() > 0 && guard++ < 20) addCell(state.level.rows[guard % state.level.rows.length]);
          startEVA();
        } else if (state.phase === 'eva') {
          if (state.levelId === '1.3' && state.stormArrival && !state.sheltered) orderShelter(false);
          endEVA();
        }
        setTimeout(tick, 1500);
      };
      setTimeout(tick, 500);
    }
  } else {
    // public demo links still work without exposing debug hooks
    if (q.has('select')) goSelect();
    else if (q.has('play')) startLevel('1.1');
  }

  /* =================================================================== init == */
  buildTerrain();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  els.sound.textContent = Sound.muted ? '🔇' : '🔊';
  els.hudHearts.innerHTML = heartsHTML(MAX_HEARTS);
  els.forecastImg.addEventListener('error', () => { els.forecastImg.hidden = true; els.forecastIcon.hidden = false; });
  requestAnimationFrame(frame);
})();
