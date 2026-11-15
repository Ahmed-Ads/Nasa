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
  const animDefs = window.ANIMS || {};
  const ANIMS = {};
  const loadList = [];
  let animWarned = false;

  function animSettled(name) {
    const a = ANIMS[name];
    if (!a || a.settled) return;
    if (a.done + a.failed < a.imgs.length) return;
    a.settled = true;
    a.loaded = a.failed === 0 && a.imgs.length > 0;
    if (!a.loaded && !animWarned) {
      animWarned = true;
      console.warn(`[anim] "${name}" has a missing frame; using the original astronaut sprite.`);
    }
  }

  for (const [key, info] of Object.entries(manifest)) {
    const rec = { img: new Image(), ok: false, src: info.src, w: info.w, h: info.h };
    SPR[key] = rec;
    loadList.push({ key, src: info.src, rec, anim: null });
  }
  for (const [name, def] of Object.entries(animDefs)) {
    const frames = Array.isArray(def.frames) ? def.frames : [];
    const imgs = frames.map((src, i) => {
      const key = `anim/${name}/${i}`;
      const rec = { img: null, ok: false, src, key };
      if (/\.png$/i.test(src)) {
        rec.img = new Image();
        SPR[key] = rec;
        loadList.push({ key, src, rec, anim: name });
      }
      return rec;
    });
    const failed = imgs.filter((r) => !r.img).length;
    ANIMS[name] = Object.assign({}, def, { imgs, done: 0, failed, settled: false, loaded: false });
    if (!imgs.some((r) => r.img)) animSettled(name);
  }

  window.__jamtLoad = { total: loadList.length || 1, done: 0 };
  const bumpLoad = () => { window.__jamtLoad.done += 1; };
  for (const item of loadList) {
    const { rec, src, anim } = item;
    rec.img.onload = () => {
      rec.ok = true;
      if (anim) { const a = ANIMS[anim]; if (a) { a.done += 1; animSettled(anim); } }
      bumpLoad();
      if (window.__jamtOnAsset) window.__jamtOnAsset();
    };
    rec.img.onerror = () => {
      rec.ok = false;
      if (anim) { const a = ANIMS[anim]; if (a) { a.failed += 1; animSettled(anim); } }
      bumpLoad();
    };
    rec.img.src = src;
  }

  // One scale for the whole sheet, from the standing idle frame. The target is
  // the height drawAsset() gives the current crew/walk sprite (37x64 in a 37x66 box).
  const PLAYER_DRAW_BOX = { maxW: 37, maxH: 66 };
  function currentPlayerDrawHeight() {
    const info = manifest['crew/walk'];
    if (!info || !info.w || !info.h) return 64;
    let h = Math.round(PLAYER_DRAW_BOX.maxW / (info.w / info.h));
    if (h > PLAYER_DRAW_BOX.maxH) h = PLAYER_DRAW_BOX.maxH;
    return h;
  }
  const ANIM_TARGET_HEIGHT = currentPlayerDrawHeight();
  const ANIM_IDLE_H = (ANIMS.idle && ANIMS.idle.h && ANIMS.idle.h[0]) || 283;
  const ANIM_SCALE = ANIM_TARGET_HEIGHT / ANIM_IDLE_H;
  // img12 is drawn on a slightly larger source grid; match helmet widths.
  const IMG12_SCALE = ((ANIMS.idle && ANIMS.idle.helmetWidth) || 140) * ANIM_SCALE
    / ((ANIMS.ice_mine && ANIMS.ice_mine.helmetWidth) || 152);

  /* ================================================================ rules == */
  // kind:'real' = verified on a NASA source (named); kind:'game' = tuned for play.
  const RULES = {
    budget: { value: 6, kind: 'game', source: 'balance' },
    maxDrawPerSol: { value: 2, kind: 'game', source: 'balance' },
    batteryCap: { value: 6, kind: 'game', source: 'balance' },
    crewO2: { value: 10, kind: 'game', source: 'scaled from NASA life-support baselines' },
    crewWater: { value: 11, kind: 'game', source: 'scaled from NASA life-support baselines' },
    o2PerCell: { value: 10, kind: 'game', source: 'balance; ISS O2 from water electrolysis (NASA ECLSS)' },
    waterPerCell: { value: 9, kind: 'game', source: 'balance; ISS recovers ~98% water (NASA ECLSS 2023)' },
    waterRecovery: { value: 0.98, kind: 'real', source: 'NASA ECLSS 2023 update' },
    electrolysisWater: { value: 1, kind: 'game', source: 'balance' },
    shieldPerCell: { value: 4, kind: 'game', source: 'balance; regolith shielding (NASA radiation research)' },
    surfacePerCell: { value: 8, kind: 'game', source: 'balance' },
    researchPerCell: { value: 3, kind: 'game', source: 'balance (<=10% of score)' },
    leakRate: { value: 30, kind: 'game', source: 'balance' },
    leakIsolated: { value: 0.40, kind: 'game', source: 'balance' },
    leakTaped: { value: 0.15, kind: 'game', source: 'balance' },
    patchNeeded: { value: 2, kind: 'game', source: 'balance (2 days of repair cells)' },
    rationCut: { value: 0.40, kind: 'game', source: 'balance' },
    rationHeartAfter: { value: 3, kind: 'game', source: 'balance' },
    stormPower: { value: 70, kind: 'game', source: 'balance' },
    stormShieldCut: { value: 0.65, kind: 'real', source: 'regolith/PE shielding reduces SPE dose (NASA)' },
    bunkerCut: { value: 0.90, kind: 'real', source: 'SPE sheltering in place (NASA)' },
    backgroundDose: { value: 2.5, kind: 'game', source: 'balance; GCR barely shielded (NASA)' },
    doseLimit: { value: 60, kind: 'game', source: 'balance' },
    iceWater: { value: 12, kind: 'game', source: 'Lunar ice (LRO/LCROSS); amount is a game value' },
    iceO2: { value: 8, kind: 'game', source: 'balance' },
    iceDose: { value: 6, kind: 'game', source: 'balance' },
    holdSeconds: { value: 2.2, kind: 'game', source: 'input feel' },
  };

  const MAX_HEARTS = 3;
  const CRITICAL = 20;

  const ROWS = {
    o2: { name: 'Oxygen', short: 'O₂', glyph: 'O₂', color: '#5ac8ff', sprite: 'icons/o2' },
    water: { name: 'Water', short: 'Water', glyph: 'H₂O', color: '#56c8ff', sprite: 'icons/water' },
    repair: { name: 'Repair', short: 'Repair', glyph: '🛠', color: '#ffb02e', sprite: 'icons/shield' },
    shielding: { name: 'Shielding', short: 'Shield', glyph: '🛡', color: '#ffb02e', sprite: 'icons/shield' },
    surface: { name: 'Surface', short: 'Work', glyph: '⛏', color: '#c48bff', sprite: 'external/drill' },
    battery: { name: 'Battery', short: 'Battery', glyph: '🔋', color: '#7ce38b', sprite: 'icons/battery', kind: 'cells' },
  };

  const LEVELS = {
    '1.1': {
      id: '1.1', index: 1, title: 'Lunar Outpost Prep', kicker: 'Tutorial - 5 days',
      location: 'Shackleton Rim', brief: 'Get the Moon base ready before the crew lands.',
      art: 'select/moon_satellite',
      rows: ['o2', 'battery'],
      start: { o2: 38, water: 48, battery: 0 },
      goals: { o2: 70, water: 60, battery: 3 },
      goalsSol: 5, maxSlip: 2,
      schedule: ['calm', 'calm', 'longshadow', 'calm', 'calm', 'dust', 'calm'],
      hints: { 1: 'Sweep the solar field. Then go outside.', 2: 'The Sun will be low. Save battery power today.' },
      debrief: {
        real: 'On the ISS, power and water make oxygen. The Moon south pole gets sunlight almost all day.',
        source: 'Sources: NASA ECLSS (Oxygen Generation Assembly); NASA Moon / LRO.',
        assume: 'Game: power, water and oxygen are linked. The battery goal is tuned for play.',
        choice: 'Real crews test power and air before the crew lands.',
      },
    },
    '1.2': {
      id: '1.2', index: 2, title: 'Water Leak', kicker: 'Repair - 6 days',
      location: 'Recycler deck', brief: 'A pipe is leaking water. Fix it!',
      art: 'select/moon_base',
      rows: ['o2', 'repair'],
      start: { o2: 65, water: 68 },
      maxSols: 6,
      schedule: ['calm', 'calm', 'dust', 'cold', 'calm', 'calm'],
      hints: { 1: 'Go to the leak. Close the hatch first.' },
      debrief: {
        real: 'ISS crews close hatches. They find the leak, tape it, then seal it.',
        source: 'Sources: NASA / Roscosmos ISS leak reports, 2018–2020.',
        assume: 'Game: a burst drains water each day. Tape slows it. Two repair days fix it.',
        choice: 'Real crews isolate the module first. Then they tape the leak.',
      },
    },
    '1.3': {
      id: '1.3', index: 3, title: 'Solar Storm', kicker: 'Space weather - 6 days',
      location: 'South pole surface', brief: 'A solar storm is coming. Keep the crew safe.',
      art: 'select/planet_moon',
      rows: ['o2', 'shielding', 'surface'],
      start: { o2: 75, shielding: 30, water: 60 },
      dose: true,
      maxSols: 6,
      schedule: ['calm', 'cme', 'calm', 'calm', 'calm', 'calm'],
      hints: { 2: 'Go to the dish. Learn when the storm comes.' },
      debrief: {
        real: 'In a solar storm, crews shelter inside. Regolith blocks radiation.',
        source: 'Sources: NASA space radiation research / Artemis; NASA DONKI; NASA Space Weather.',
        assume: 'Game: the storm comes on Day 3-5. Early shelter cuts dose by 90%.',
        choice: 'Real crews shelter during the storm.',
      },
    },
  };
  const LEVEL_ORDER = ['1.1', '1.2', '1.3'];
  const PHASE_LABEL = { plan: '1. Plan power', eva: '2. Go outside', resolve: '3. End the day' };
  const COACH_GOALS = {
    '1.1': 'Day 1: Get the Moon base ready before the crew lands!',
    '1.2': 'A pipe is leaking water! Fix it.',
    '1.3': 'A solar storm is coming! Keep the crew safe.',
  };
  // One kid-sized step at a time. done() runs against the live state.
  const COACH_PLANS = {
    '1.1': [
      {
        item: 'panel', slot: 'solar-slot', text: 'Pick up a solar panel from the crate.',
        carry: 'Put the panel in the solar field.',
        done: (s) => s.panelDeployed || slotFilled('solar-slot') > 0
      },
      {
        item: 'ice', slot: 'water-slot', text: 'Mine ice from the ice patch.',
        carry: 'Put the ice in the water tank.',
        done: (s) => (s.res.water || 0) >= 60
      },
      {
        item: 'o2', slot: 'o2-slot', text: 'Pick up oxygen from the crates.',
        carry: 'Put the oxygen in the O2 rack.',
        done: (s) => (s.res.o2 || 0) >= 70
      },
    ],
    '1.2': [
      {
        item: 'toolbox', slot: 'leak-slot', text: 'Pick up the toolbox from the crates.',
        carry: 'Take the toolbox to the leak.',
        done: (s) => s.isolated
      },
      {
        item: 'tape', slot: 'leak-slot', text: 'Pick up the tape from the crates.',
        carry: 'Take the tape to the leak.',
        done: (s) => s.taped
      },
      {
        item: 'repair', slot: 'leak-slot', text: 'Pick up repair parts from the crates.',
        carry: 'Take the parts to the leak.',
        done: (s) => s.patched
      },
      {
        station: 'leak', text: 'Go to the leak and reopen the hatch.',
        done: (s) => s.reopened
      },
    ],
    '1.3': [
      {
        station: 'comms', text: 'Go to the dish and read the weather.',
        done: (s) => s.stormKnown
      },
      {
        item: 'bag', slot: 'bunker-slot', text: 'Dig a regolith bag near the bunker.',
        carry: 'Put the bag on the bunker wall.',
        done: (s) => s.bags >= 1
      },
      {
        station: 'bunker', text: 'Go to the bunker and shelter the crew.',
        done: (s) => s.sheltered
      },
    ],
  };
  const COACH_ICON = { source: '▲', slot: '▼', switch: '⚡', air: '!', station: '✦', end: '▶' };
  const SWITCHBOARD_TARGET = { x: 376, y: 360 };

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
    air: 100,
    airWarned: false,
    rover: { mounted: false, cargo: [], usedThisSol: false, dead: false, x: 566, y: 536, turn: { x: 0, y: 1 } },
    sweepSol: 0,
    panelDeployed: false,
    panelBonus: 0, bags: 0, carry: null, groundItems: [], sources: [], slots: [], snap: null, atSwitchboard: false,
    action: null,
    tutorialStep: 0, tutorialMoved: false, tutorialSkipped: false, tutorialDelivered: false, tutorialDone: false,
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
    animDist: 0, animFrame: 0, animMode: 'idle',
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
  // Save schema v2: keep stars, drop anything corrupt, never crash on old data.
  const SAVE_VERSION = 2;
  const progress = (() => {
    let p = safeGet('jamt.progress', {});
    if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
    const clean = {};
    for (const id of ['1.1', '1.2', '1.3']) {
      const n = Number(p[id]);
      if (Number.isFinite(n)) clean[id] = Math.max(0, Math.min(3, Math.round(n)));
    }
    if (safeGet('jamt.save', {}).v !== SAVE_VERSION) safeSet('jamt.save', { v: SAVE_VERSION });
    return clean;
  })();
  const settings = (() => {
    // Hints start on for a brand-new player and off after the first star.
    const d = {
      sound: true, touch: 'auto', motion: false, unlock: false,
      hints: !Object.values(progress).some((n) => n > 0)
    };
    const raw = safeGet('jamt.settings', {});
    if (!raw || typeof raw !== 'object') return d;
    if (typeof raw.sound === 'boolean') d.sound = raw.sound;
    if (['auto', 'on', 'off'].includes(raw.touch)) d.touch = raw.touch;
    if (typeof raw.motion === 'boolean') d.motion = raw.motion;
    if (typeof raw.unlock === 'boolean') d.unlock = raw.unlock;
    if (typeof raw.hints === 'boolean') d.hints = raw.hints;
    return d;
  })();
  function saveSettings() { safeSet('jamt.settings', settings); }
  const starsFor = (id) => Number(progress[id] || 0);
  const totalStars = () => LEVEL_ORDER.reduce((n, id) => n + starsFor(id), 0);
  const isUnlocked = (id) => {
    if (settings.unlock) return true;
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
    coach: $('#coach'), coachText: $('#coach-text'), coachIcon: $('#coach-icon'), coachSkip: $('#coach-skip'),
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
    const brief = document.getElementById('screen-brief');
    if (brief) brief.hidden = name !== 'brief';
    const goodbye = document.getElementById('screen-goodbye');
    if (goodbye) goodbye.hidden = name !== 'goodbye';
    els.hud.hidden = name !== 'game';
    els.panel.hidden = name !== 'game';
    if (els.coach) els.coach.hidden = name !== 'game';
    els.interact.hidden = name !== 'game';
    const tracker = document.getElementById('tracker');
    if (tracker) tracker.hidden = name !== 'game';
    updateHash();
  }
  function goTitle() {
    state.runId += 1; state.phase = 'plan'; showScreen('title'); state.fx = null;
  }
  function updateHash() {
    const map = { title: '#/title', select: '#/map', brief: '#/brief', game: '#/level', debrief: '#/debrief', goodbye: '#/goodbye' };
    const h = map[state.screen];
    if (!h) return;
    try { if (location.hash !== h) history.pushState({ screen: state.screen }, '', h); } catch { /* file:// */ }
  }
  function goSelect() {
    state.runId += 1; state.phase = 'plan'; state.fx = null;
    showScreen('select'); renderSelect();
  }

  function renderSelect() {
    if (els.sectorArt) {
      const art = assetPath('select/sector_cislunar');
      if (art) { els.sectorArt.src = art; els.sectorArt.style.display = ''; }
      else els.sectorArt.style.display = 'none';
    }
    if (els.totalStars) {
      els.totalStars.textContent = `★ ${totalStars()} / 9`;
    }

    const moonNodes = [
      { id: '1.1', lv: 'LV.1', num: 1 },
      { id: '1.2', lv: 'LV.2', num: 2 },
      { id: '1.3', lv: 'LV.3', num: 3 },
      { id: '1.4', lv: 'LV.4', num: 4, future: true, title: 'Deep Crater Survey' },
      { id: '1.5', lv: 'LV.5', num: 5, future: true, title: 'Lunar Milestone', large: true }
    ];

    els.missionCards.innerHTML = moonNodes.map((node) => {
      if (node.future) {
        return `<button class="mission-node${node.large ? ' mission-node--large' : ''} is-locked" id="node-lv${node.num}" type="button" disabled aria-label="${node.lv}">
          <span class="node-text">${node.lv}</span>
          <div class="node-tooltip">
            <span class="node-tooltip-kicker">Moon Outpost</span>
            <span class="node-tooltip-title">${node.title}</span>
            <span class="node-tooltip-status">COMING SOON</span>
          </div>
        </button>`;
      }
      const L = LEVELS[node.id];
      const unlocked = isUnlocked(node.id);
      const stars = starsFor(node.id);
      const statusClass = stars > 0 ? 'done' : unlocked ? 'ready' : 'lock';
      const statusText = stars > 0 ? `★ ${stars}/3 COMPLETED` : unlocked ? 'READY' : 'LOCKED';
      return `<button class="mission-node mission-card${unlocked ? '' : ' is-locked'}${stars > 0 ? ' is-completed' : ''}" id="node-lv${node.num}" data-level="${node.id}" type="button" ${unlocked ? '' : 'disabled aria-disabled="true"'} aria-label="${node.lv}: ${L.title}">
        <span class="node-text">${node.lv}</span>
        ${stars > 0 ? `<span class="node-star-badge">★${stars}</span>` : ''}
        <div class="node-tooltip">
          <span class="node-tooltip-kicker">Mission ${node.id} · Moon</span>
          <span class="node-tooltip-title">${L.title}</span>
          <span class="node-tooltip-status ${statusClass}">${statusText}</span>
        </div>
      </button>`;
    }).join('');

    if (els.lockedCards) {
      els.lockedCards.innerHTML = [
        { lv: 'LV.6', num: 6 },
        { lv: 'LV.7', num: 7 },
        { lv: 'LV.8', num: 8 },
        { lv: 'LV.9', num: 9 },
        { lv: 'LV.10', num: 10, large: true }
      ].map((n) => `<button class="mission-node${n.large ? ' mission-node--large' : ''} is-locked" id="node-lv${n.num}" type="button" disabled aria-label="${n.lv}">
        <span class="node-text">${n.lv}</span>
        <div class="node-tooltip">
          <span class="node-tooltip-kicker">Level 2 · Mars</span>
          <span class="node-tooltip-title">Mars Mission</span>
          <span class="node-tooltip-status lock">LOCKED 🔒</span>
        </div>
      </button>`).join('');
    }

    for (const card of els.missionCards.querySelectorAll('.mission-card')) {
      card.addEventListener('click', () => {
        if (card.classList.contains('is-locked')) return;
        Sound.init(); Sound.click(); openBriefing(card.dataset.level);
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

  // ---------------- carry / deliver economy (v3 session 1) ----------------
  const ITEM_META = {
    ice: { name: 'Ice chunk', sprite: 'terrain/ice' },
    bag: { name: 'Regolith bag', sprite: 'icons/shield' },
    battery: { name: 'Battery canister', sprite: 'power/battery_green' },
    panel: { name: 'Solar panel', sprite: 'power/solar_b' },
    o2: { name: 'O2 canister', sprite: 'life/o2_tank' },
    toolbox: { name: 'Toolbox', sprite: 'repair/toolbox' },
    tape: { name: 'Kapton tape', sprite: 'repair/tape' },
    repair: { name: 'Repair parts', sprite: 'repair/gears' },
  };
  const SOURCES = [
    { id: 'ice-src', item: 'ice', x: 70, y: 700, cap: 4, stock: 4, hold: 1.4, minutes: 1, label: 'Mine ice chunk' },
    { id: 'panel-src', item: 'panel', x: 644, y: 548, cap: 3, stock: 3, minutes: 0, label: 'Take solar panel', levels: ['1.1', '1.3'] },
    { id: 'battery-src', item: 'battery', x: 692, y: 548, cap: 4, stock: 4, minutes: 0, label: 'Take battery canister' },
    { id: 'o2-src', item: 'o2', x: 596, y: 548, cap: 2, stock: 2, minutes: 0, label: 'Take O2 canister (game assumption)', levels: ['1.1'] },
    { id: 'soil-src', item: 'bag', x: 330, y: 330, cap: 5, stock: 5, hold: 1.4, minutes: 1, label: 'Dig regolith bag', levels: ['1.3'] },
    { id: 'toolbox-src', item: 'toolbox', x: 604, y: 566, cap: 1, stock: 1, minutes: 0, label: 'Take toolbox', levels: ['1.2'] },
    { id: 'tape-src', item: 'tape', x: 664, y: 566, cap: 1, stock: 1, minutes: 0, label: 'Take Kapton tape', levels: ['1.2'] },
    { id: 'repair-src', item: 'repair', x: 724, y: 566, cap: 2, stock: 2, minutes: 0, label: 'Take repair parts', levels: ['1.2'] },
  ];
  const SLOTS = [
    { id: 'water-slot', item: 'ice', x: 730, y: 452, cap: 99, label: 'Water tank intake', levels: ['1.1', '1.2', '1.3'] },
    { id: 'battery-slot', item: 'battery', x: 376, y: 378, cap: 4, label: 'Battery bank slot' },
    { id: 'solar-slot', item: 'panel', x: 216, y: 386, cap: 3, label: 'Solar field slot', levels: ['1.1', '1.3'] },
    { id: 'o2-slot', item: 'o2', x: 700, y: 356, cap: 2, label: 'O2 rack slot', levels: ['1.1'] },
    { id: 'bunker-slot', item: 'bag', x: 262, y: 286, cap: 5, label: 'Bunker wall slot', levels: ['1.3'] },
    { id: 'leak-slot', item: 'repair', x: 808, y: 452, cap: 3, label: 'Leak site', levels: ['1.2'] },
  ];
  const RESOURCE_DOCS = [
    { item: 'ice', source: 'Shaded crater (SW)', slot: 'water-slot', effect: '+12 water', need: 'mine' },
    { item: 'panel', source: 'Cargo crates (lander pad)', slot: 'solar-slot', effect: '+1 solar cell each day', need: 'take' },
    { item: 'battery', source: 'Cargo crates', slot: 'battery-slot', effect: '+1 stored cell', need: 'take' },
    { item: 'o2', source: 'Cargo crates (1.1, max 2)', slot: 'o2-slot', effect: '+25 O₂ (game assumption)', need: 'take' },
    { item: 'bag', source: 'Soil near the bunker (1.3)', slot: 'bunker-slot', effect: '+8 shielding, bunker protection +8%', need: 'dig' },
    { item: 'toolbox', source: 'Crates (1.2)', slot: 'leak-slot', effect: 'isolate the hatch', need: 'take' },
    { item: 'tape', source: 'Crates (1.2)', slot: 'leak-slot', effect: 'tape the leak (Stage A)', need: 'take' },
    { item: 'repair', source: 'Crates (1.2)', slot: 'leak-slot', effect: 'cure the permanent patch (2 deliveries)', need: 'take' },
  ];
  function slotById(id) { return state.slots.find((s) => s.id === id); }

  function buildInteractions() {
    const id = state.levelId;
    state.sources = SOURCES.filter((s) => !s.levels || s.levels.includes(id)).map((s) => ({ ...s, stock: s.cap }));
    state.slots = SLOTS.filter((s) => !s.levels || s.levels.includes(id)).map((s) => ({ ...s, filled: 0 }));
    state.groundItems = [];
    state.carry = null;
    extraColliders = [];
    state.panelBonus = 0;
    state.bags = 0;
    // foot-boxes: sources and slots block walking through them
    extraColliders = [...state.sources, ...state.slots].map((o) => ({ x: o.x - 12, y: o.y - 12, w: 24, h: 12 }));
  }
  function restock() {
    for (const s of state.sources) s.stock = s.cap;
  }
  function nearestInteractable() {
    const s = state;
    let best = null, bd = Infinity;
    const consider = (obj, r) => {
      const d = dist(player.x, player.y, obj.x, obj.y);
      if (d < r && d < bd) { bd = d; best = obj; }
    };
    for (const src of s.sources) consider(src, 40);
    for (const slot of s.slots) consider(slot, 40);
    for (const it of s.groundItems) consider(it, 30);
    for (const st of STATIONS) { if (st.id === 'leak' && s.levelId !== '1.2') continue; consider(st, st.r); }
    return best;
  }
  function isSlot(obj) { return obj && obj.id && obj.id.endsWith('-slot'); }
  function slotAccepts(slot, item) {
    if (slot.id === 'leak-slot') {
      if (item === 'toolbox') return !state.isolated;
      if (item === 'tape') return state.isolated && !state.taped;
      if (item === 'repair') return state.taped && !state.patched;
      return false;
    }
    return slot.item === item;
  }
  function pickupSource(src) {
    if (state.rover.mounted) {
      if (state.rover.cargo.length >= 4) { addLog('Rover cargo is full (4/4).', 'warn'); return; }
      if (src.stock <= 0) { addLog('Nothing left here today.', 'warn'); return; }
      if (src.hold) { if (state.air < 8) { addLog('Not enough air. Go back inside.', 'warn'); return; } state.air = Math.max(0, state.air - 8); }
      src.stock -= 1;
      state.rover.cargo.push(src.item);
      addLog(`Loaded ${ITEM_META[src.item].name} onto the rover (${state.rover.cargo.length}/4).`, 'good');
      Sound.ok(); return;
    }
    if (state.carry) { addLog('Your hands are full. Press Q to drop.', 'warn'); return; }
    if (src.stock <= 0) { addLog('Nothing left here today. It refills tomorrow.', 'warn'); return; }
    if (src.hold) {
      if (state.air < 8) { addLog('Not enough air. Go back inside.', 'warn'); return; }
      state.air = Math.max(0, state.air - 8);
    }
    src.stock -= 1;
    state.carry = src.item;
    addLog(`Carrying <b>${ITEM_META[src.item].name}</b>. Take it to the glowing slot.`, 'good');
    Sound.ok();
  }
  function pickupGround(it) {
    if (state.carry) { addLog('Your hands are full. Press Q to drop.', 'warn'); return; }
    state.groundItems = state.groundItems.filter((g) => g !== it);
    state.carry = it.type;
    addLog(`Picked up <b>${ITEM_META[it.type].name}</b>.`, 'good');
    Sound.ok();
  }
  function dropItem() {
    if (!state.carry) return false;
    state.groundItems.push({ type: state.carry, x: player.x + player.facing * 12, y: player.y });
    addLog(`Dropped <b>${ITEM_META[state.carry].name}</b>.`, 'muted');
    state.carry = null;
    Sound.remove();
    return true;
  }
  function deliverSlot(slot) {
    let item = state.carry;
    let cargoIdx = -1;
    if (!item && state.rover.mounted) {
      cargoIdx = state.rover.cargo.findIndex((t) => slotAccepts(slot, t));
      if (cargoIdx >= 0) item = state.rover.cargo[cargoIdx];
    }
    if (!item) return;
    if (!slotAccepts(slot, item)) {
      const want = slot.id === 'leak-slot'
        ? (state.isolated ? (state.taped ? 'repair parts' : 'Kapton tape') : 'the toolbox')
        : ITEM_META[slot.item].name.toLowerCase();
      addLog(`That does not fit. This slot needs <b>${want}</b>.`, 'warn');
      return;
    }
    if (cargoIdx >= 0) state.rover.cargo.splice(cargoIdx, 1); else state.carry = null;
    slot.filled = Math.min(slot.cap, (slot.filled || 0) + 1);
    state.snap = { x: slot.x, y: slot.y, t: performance.now() / 1000 };
    if (slot.id === 'water-slot') {
      state.res.water = clamp((state.res.water || 0) + RULES.iceWater.value);
      addLog(`🧊 Ice delivered: <b>+${RULES.iceWater.value} water</b> (${slot.filled} chunks melted).`, 'good');
    } else if (slot.id === 'battery-slot') {
      setBattery(getBattery() + 1);
      addLog(`🔋 Battery canister installed: <b>+1 stored cell</b> (${slot.filled}/${slot.cap}).`, 'good');
    } else if (slot.id === 'solar-slot') {
      state.panelBonus += 1;
      addLog(`Solar panel on. <b>+1 solar cell each day.</b>`, 'good');
    } else if (slot.id === 'o2-slot') {
      state.res.o2 = clamp((state.res.o2 || 0) + 25);
      addLog(`🫁 O2 canister installed: <b>+25 O₂</b> (game assumption) (${slot.filled}/${slot.cap}).`, 'good');
    } else if (slot.id === 'bunker-slot') {
      state.bags += 1;
      state.res.shielding = clamp((state.res.shielding || 0) + 8);
      addLog(`🛡 Regolith bag placed: <b>+8 shielding</b>, bunker protection ${Math.round((0.5 + 0.08 * state.bags) * 100)}% (${slot.filled}/5).`, 'good');
    } else if (slot.id === 'leak-slot') {
      if (state.carry === null) { /* noop */ }
      if (!state.isolated) { state.isolated = true; addLog('🚪 Hatch closed. The recycler is off.', 'warn'); }
      else if (!state.taped) { state.taped = true; addLog('🩹 Tape on. The leak is smaller.', 'good'); }
      else if (!state.patched) {
        state.patch = Math.min(RULES.patchNeeded.value, state.patch + 1);
        if (state.patch >= RULES.patchNeeded.value) {
          state.patched = true;
          addLog('🔧 Patch done. Reopen the hatch.', 'good');
        } else addLog(`Patch curing: <b>${state.patch}/${RULES.patchNeeded.value}</b>.`, 'muted');
      }
    }
    if (state.tutorialStep === 2) { state.tutorialDelivered = true; state.tutorialStep = 3; }
    Sound.ok();
  }


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
  let extraColliders = [];
  function blockedAt(x, y) {
    const r = player.radius;
    if (state.rover && state.rover.mounted) {
      for (const id of ['dome', 'bunker']) {
        const c = colliders.find((cc) => cc.id === id);
        if (c && x + 14 > c.x - 10 && x - 14 < c.x + c.w + 10 && y + 14 > c.y - 10 && y - 14 < c.y + c.h + 10) return true;
      }
    }
    for (const c of colliders.concat(extraColliders)) {
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

  function mountRover() {
    const r = state.rover;
    if (r.mounted) return;
    if (r.dead || getBattery() <= 0) { r.dead = true; addLog('🔋 Rover battery is empty — charge a cell at the switchboard.', 'warn'); Sound.warn(); return; }
    r.mounted = true; r.usedThisSol = true;
    addLog('🚙 Rover powered: speed x2.5, cargo 4, lower air drain. ACT again on open ground to park.', 'good');
    Sound.ok(); render();
  }
  function dismountRover() {
    const r = state.rover;
    if (!r.mounted) return;
    r.mounted = false;
    r.x = player.x; r.y = player.y + 14;
    const prop = PROPS.find((p) => p.id === 'rover');
    if (prop) { prop.x = r.x; prop.y = r.y; const col = colliders.find((c) => c.id === 'rover'); if (col) { col.x = r.x - 36; col.y = r.y - 26; } }
    const st = STATIONS.find((s2) => s2.id === 'rover'); if (st) { st.x = r.x; st.y = r.y + 30; }
    addLog('🚙 Rover parked. Cargo stays on it.', 'muted'); Sound.click(); render();
  }
  function walkBackRadius() { return (state.air / 0.55) * 82; }

  function collapseFromAir() {
    const s = state;
    if (s.air > 0) return;
    if (s.carry) { dropItem(); addLog('You dropped what you were carrying.', 'muted'); }
    if (s.rover.mounted) { s.rover.mounted = false; addLog('The rover stops — cargo stays on it.', 'warn'); }
    const storm = s.levelId === '1.3' && s.sol >= s.stormArrival && s.sol < s.stormArrival + s.stormDuration;
    if (storm) { s.hearts -= 1; s.heartsLost = (s.heartsLost || 0) + 1; addLog('⚠️ Out of air in a storm — <b>−1 heart</b>.', 'bad'); }
    if (s.phase === 'eva') {
      addLog('🫁 Suit air empty. The day ends. It refills tomorrow.', 'warn');
      endEVA();
    } else {
      addLog('🫁 Suit air empty. Go outside, then end the day.', 'warn');
    }
  }

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
    if (player.moving && state.rover.mounted) {
      const k = Math.min(1, dt * 3);
      const t = state.rover.turn;
      t.x += (dx - t.x) * k; t.y += (dy - t.y) * k;
      const tl = Math.hypot(t.x, t.y) || 1;
      dx = t.x / tl; dy = t.y / tl;
      if (getBattery() <= 0) { dismountRover(); addLog('Rover battery empty — walking from here.', 'warn'); }
    }
    if (player.moving) {
      const speed = state.rover.mounted ? 205 : 82;
      const fromX = player.x, fromY = player.y;
      movePlayer(dx * speed * dt, dy * speed * dt);
      const moved = Math.hypot(player.x - fromX, player.y - fromY);
      if (!state.rover.mounted && moved > 0.01) {
        if (state.levelId === '1.1' && state.sol === 1 && state.phase === 'eva' && state.tutorialStep === 0) state.tutorialMoved = true;
        player.animDist += moved;
        const stride = (ANIMS.walk && ANIMS.walk.strideDistance) || 8;
        const count = (ANIMS.walk && ANIMS.walk.frameCount) || 6;
        player.animFrame = Math.floor(player.animDist / stride) % count;
        player.animMode = 'walk';
      } else if (!state.rover.mounted) {
        player.animMode = 'idle';
      }
      if (Math.abs(dx) > 0.1) player.facing = dx > 0 ? 1 : -1;
      state.air = Math.max(0, state.air - dt * (state.rover.mounted ? 0.18 : 0.55));
      const prev = Math.floor(player.walk / 0.16);
      player.walk += dt;
      if (Math.floor(player.walk / 0.16) !== prev) {
        dustPuffs.push({ x: player.x - player.facing * 3, y: player.y, life: 0.4 });
        if (dustPuffs.length > 16) dustPuffs.shift();
      }
    } else {
      player.animMode = 'idle';
    }
    if (state.air <= 25 && !state.airWarned) {
      state.airWarned = true;
      addLog('🫁 Suit air at 25% — head back or use the rover.', 'warn');
      Sound.warn();
    }
    if (state.air <= 0) collapseFromAir();
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
  function animLoaded(name) {
    const a = ANIMS[name];
    return !!(a && a.loaded);
  }
  function drawAnimFrameTo(g, name, idx, x, footY, flip, scale = ANIM_SCALE) {
    const a = ANIMS[name];
    if (!a || !a.loaded) return false;
    const i = Math.max(0, Math.min(a.imgs.length - 1, idx | 0));
    const rec = a.imgs[i];
    if (!rec || !rec.ok || !rec.img) return false;
    const fx = (a.footX[i] || a.w[i] / 2) * scale;
    const fy = (a.footY[i] || a.h[i]) * scale;
    const w = a.w[i] * scale;
    const h = a.h[i] * scale;
    g.save();
    g.imageSmoothingEnabled = false;
    g.translate(Math.round(x), Math.round(footY));
    if (flip) g.scale(-1, 1);
    g.drawImage(rec.img, -fx, -fy, w, h);
    g.restore();
    return true;
  }
  function drawAnimFrame(name, idx, x, footY, flip) {
    return drawAnimFrameTo(ctx, name, idx, x, footY, flip);
  }
  function drawSoftShadow(x, y, rx = 13, ry = 4.6) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.12, 0, 0, rx);
    g.addColorStop(0, 'rgba(8,10,18,.42)');
    g.addColorStop(0.62, 'rgba(8,10,18,.20)');
    g.addColorStop(1, 'rgba(8,10,18,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    if (p.id === 'rover' && state.rover && state.rover.mounted) return;
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

  function drawSource(src) {
    // the ice_mine frames contain the ice block; hide the world icon only while mining
    if (state.action && state.action.hiddenSourceId === src.id) return;
    const m = ITEM_META[src.item];
    const bob = Math.sin(performance.now() / 500 + src.x) * 1.5;
    drawAsset(m.sprite, src.x, src.y - 4 + bob, 20, 20);
    ctx.fillStyle = '#0b0f1c';
    ctx.fillRect(src.x - 13, src.y - 30, 26, 10);
    ctx.fillStyle = '#eaf1ff';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${src.stock}/${src.cap}`, src.x, src.y - 22);
    ctx.textAlign = 'left';
  }
  function drawGroundItem(it) {
    drawAsset(ITEM_META[it.type].sprite, it.x, it.y, 18, 18);
    ctx.strokeStyle = 'rgba(255,207,58,.6)';
    ctx.strokeRect(Math.round(it.x) - 9, Math.round(it.y) - 16, 18, 16);
  }
  function drawSwitchboard() {
    ctx.fillStyle = '#0b0f1c';
    ctx.fillRect(346, 344, 60, 12);
    ctx.fillStyle = '#9fd0ff';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SWITCHBOARD', 376, 353);
    ctx.textAlign = 'left';
    if (leftCells() > 0) {
      const bob = Math.round(Math.sin(performance.now() / 300) * 2);
      ctx.fillStyle = '#ffcf3a';
      ctx.fillRect(370, 326 + bob, 9, 11);
      ctx.fillStyle = '#2a1d00';
      ctx.fillRect(373, 329 + bob, 3, 5);
      ctx.fillRect(374, 336 + bob, 1, 2);
    }
  }
  function drawSlot(slot) {
    const matching = state.carry && slotAccepts(slot, state.carry);
    const pulse = 0.35 + 0.35 * Math.sin(performance.now() / 240);
    if (matching) {
      ctx.strokeStyle = `rgba(255,207,58,${pulse.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(slot.x) - 18, Math.round(slot.y) - 38, 36, 24);
    }
    ctx.fillStyle = '#0b0f1c';
    ctx.fillRect(slot.x - 15, Math.round(slot.y) - 54, 30, 10);
    ctx.fillStyle = slot.filled >= slot.cap ? '#9dffb3' : '#eaf1ff';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(slot.cap > 90 ? `${slot.filled}` : `${slot.filled}/${slot.cap}`, slot.x, Math.round(slot.y) - 46);
    ctx.textAlign = 'left';
    if (state.snap && performance.now() / 1000 - state.snap.t < 0.4) {
      const k = (performance.now() / 1000 - state.snap.t) / 0.4;
      ctx.strokeStyle = `rgba(157,255,179,${1 - k})`;
      ctx.beginPath();
      ctx.arc(state.snap.x, state.snap.y - 20, 6 + k * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPlayer() {
    window.__jamtActionDraw = null;
    if (state.rover && state.rover.mounted) {
      const ring = walkBackRadius();
      const baseX = 512, baseY = 420;
      const outside = dist(player.x, player.y, baseX, baseY) > ring;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = outside ? 'rgba(255,77,109,.85)' : 'rgba(127,189,255,.55)';
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.arc(baseX, baseY, Math.min(ring, 2400), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      drawAsset('external/rover', player.x, player.y + 4, 84, 66);
      drawAsset('crew/walk', player.x, player.y - 16, 30, 56, { flip: player.facing < 0 });
      ellipse(player.x, player.y + 2, 16, 4, 'rgba(8,10,18,.35)');
      return;
    }
    if (state.action) {
      const info = actionFrameInfo(state.action);
      if (info) {
        const mirror = state.action.site.x < player.x;
        drawSoftShadow(player.x, player.y + 2,
          info.anim === 'ice_mine' ? 16 : 13, info.anim === 'ice_mine' ? 5.4 : 4.6);
        const drew = drawAnimFrameTo(ctx, info.anim, info.frame, player.x, player.y, mirror, info.scale);
        if (drew) {
          window.__jamtAnimDraw = {
            name: info.anim, frame: info.frame, x: player.x, y: player.y,
            footX: player.x, footY: player.y, flipped: mirror, scale: info.scale,
            screenX: player.x - Math.round(camera.x),
            screenY: player.y - Math.round(camera.y),
          };
          window.__jamtActionDraw = {
            anim: info.anim, frame: info.frame, phase: state.action.phase,
            progress: state.action.progress, x: player.x, y: player.y,
            footX: player.x, footY: player.y, mirror, scale: info.scale,
            site: { ...state.action.site }, hiddenSourceId: state.action.hiddenSourceId,
            screenX: player.x - Math.round(camera.x),
            screenY: player.y - Math.round(camera.y),
          };
          return;
        }
      }
    }
    if (state.carry) {
      drawAsset(ITEM_META[state.carry].sprite, player.x, player.y - 74, 18, 18);
      drawAsset(ITEM_META[state.carry].sprite, player.x + player.facing * 10, player.y - 16, 12, 12);
    }
    for (const puff of dustPuffs) {
      ctx.globalAlpha = Math.max(0, puff.life * 1.4);
      px(puff.x - 1, puff.y - 1, 3, 2, '#b9c0d6');
    }
    ctx.globalAlpha = 1;

    drawSoftShadow(player.x, player.y + 2, 13, 4.6);
    const animName = player.animMode === 'walk' ? 'walk' : 'idle';
    const animIdx = animName === 'walk' ? player.animFrame : 0;
    // If either player animation has a missing frame, use the old sprite for both.
    let usedAnim = false;
    if (animLoaded('walk') && animLoaded('idle')) {
      usedAnim = drawAnimFrame(animName, animIdx, player.x, player.y, player.facing < 0);
    }
    if (!usedAnim) {
      // load failure path: keep the pre-animation astronaut, never blank
      const key = state.levelId === '1.2' ? 'crew/wrench' : 'crew/walk';
      const drew = drawAsset(key, player.x, player.y, 37, 66, { flip: player.facing < 0 });
      if (!drew) {
        px(player.x - 6, player.y - 26, 12, 22, '#eef2ff');
        px(player.x - 5, player.y - 34, 10, 10, '#eef2ff');
        px(player.x - 4, player.y - 32, 8, 5, '#1c3b3d');
      }
    }
    window.__jamtAnimDraw = {
      name: usedAnim ? animName : 'fallback', frame: usedAnim ? animIdx : -1,
      x: player.x, y: player.y, footX: player.x, footY: player.y,
      flipped: player.facing < 0, scale: ANIM_SCALE,
      screenX: player.x - Math.round(camera.x),
      screenY: player.y - Math.round(camera.y),
    };
    if (state.carry) {
      drawAsset(ITEM_META[state.carry].sprite, player.x + player.facing * 10, player.y - 16, 14, 14);
      drawAsset(ITEM_META[state.carry].sprite, player.x, player.y - 74, 18, 18);
    }
    if (false) {
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
    for (const src of state.sources) drawables.push({ id: 'src-' + src.id, y: src.y, draw: () => drawSource(src) });
    for (const slot of state.slots) drawables.push({ id: 'slot-' + slot.id, y: slot.y, draw: () => drawSlot(slot) });
    state.groundItems.forEach((it, i) => drawables.push({ id: 'item' + i, y: it.y, draw: () => drawGroundItem(it) }));
    drawables.push({ id: 'switchboard', y: 378, draw: drawSwitchboard });
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
    drawCoachFx(time);
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
    if (!st) {
      if (s.rover.mounted) return { id: 'dismount', label: 'Park rover', minutes: 0, run: () => dismountRover() };
      if (s.carry) return { id: 'drop', label: `Drop ${ITEM_META[s.carry].name}`, minutes: 0, run: () => dropItem() };
      return null;
    }
    if (st.id && st.id.endsWith('-src')) {
      const src = st;
      return {
        id: 'pickup', label: src.label, minutes: src.minutes || 0,
        disabled: (src.hold ? s.air < 8 : false) || src.stock <= 0,
        run: () => pickupSource(src),
      };
    }
    if (st.id && st.id.endsWith('-slot')) {
      if (!s.carry && s.rover.mounted) {
        const ci = s.rover.cargo.findIndex((t) => slotAccepts(st, t));
        if (ci >= 0) return { id: 'unload', label: `Unload ${ITEM_META[s.rover.cargo[ci]].name} → ${st.label}`, minutes: 0, run: () => deliverSlot(st) };
      }
      if (!s.carry) return { id: 'slotinfo', label: st.label, minutes: 0, run: () => addLog(`${st.label}: needs ${st.id === 'leak-slot' ? (s.isolated ? (s.taped ? 'repair parts' : 'Kapton tape') : 'the toolbox') : ITEM_META[st.item].name.toLowerCase()}.`, 'muted') };
      const ok = slotAccepts(st, s.carry);
      return { id: 'deliver', label: ok ? `Deliver ${ITEM_META[s.carry].name} → ${st.label}` : `${st.label} doesn't take that`, minutes: 0, run: () => deliverSlot(st) };
    }
    if (st.type) {
      return { id: 'pickup-ground', label: `Pick up ${ITEM_META[st.type].name}`, minutes: 0, run: () => pickupGround(st) };
    }
    const noMinutes = s.air <= 0;

    if (st.id === 'o2' || st.id === 'co2' || st.id === 'water') {
      const row = st.id === 'water' || st.id === 'co2' ? 'water' : 'o2';
      return { id: 'panel', label: `Check ${ROWS[row].name}`, minutes: 0, row, run: () => openStationPanel(row) };
    }
    if (st.id === 'battery') {
      return { id: 'battery', label: `Battery: ${Math.round(s.battery)}/6 cells`, minutes: 0, run: () => addLog(`🔋 Battery bank holds <b>${Math.round(s.battery)}/6</b> cells.`, 'muted') };
    }
    if (st.id === 'rover') {
      return { id: 'mount', label: 'Ride rover', minutes: 0, run: () => mountRover() };
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
    if (st.id === 'ice') { return null; }
    if (false) {
      const used = s.iceUsedSol === s.sol;
      const what = L.id === '1.3' ? `+${RULES.iceO2.value} O₂` : `+${RULES.iceWater.value} water`;
      return {
        id: 'ice', label: used ? 'Ice already hauled today' : `Mine ice ${what}`,
        minutes: 2, disabled: noMinutes || used, run: () => doHaulIce(),
      };
    }
    if (st.id === 'bunker') {
      if (L.id === '1.3' && s.stormArrival && !s.sheltered) {
        return { id: 'shelter', label: 'Order crew to shelter', minutes: 1, disabled: noMinutes, run: () => orderShelter(true) };
      }
      if (s.sheltered) return { id: 'bunker', label: 'Crew is sheltering here', minutes: 0, run: () => addLog('🛖 The crew is safe in the bunker.', 'muted') };
      return { id: 'bunkerinfo', label: 'Regolith bunker', minutes: 0, run: () => addLog('🛖 A safe bunker in the crater rim.', 'muted') };
    }
    if (st.id === 'leak') {
      if (L.id !== '1.2') return null;
      if (s.reopened) return { id: 'leakdone', label: 'Leak sealed', minutes: 0, run: () => addLog('✅ The recycler is sealed and running.', 'good') };
      if (s.patched) return { id: 'reopen', label: 'Reopen hatch', minutes: 0, run: () => doReopen() };
      const need = !s.isolated ? 'the toolbox' : (!s.taped ? 'Kapton tape' : `${RULES.patchNeeded.value - s.patch} repair deliveries`);
      return { id: 'leakinfo', label: `Leak site — needs ${need}`, minutes: 0, run: () => addLog(`Carry <b>${need}</b> to the leak site.`, 'warn') };
    }
    return null;
  }

  /* ------------------------------------------------------------- EVA tasks -- */
  function doReopen() {
    state.reopened = true;
    addLog('✅ Hatch reopened: the recycler is back online and the leak is sealed.', 'good');
    Sound.ok();
  }
  function doReadDish() {
    state.stormKnown = true;
    addLog(`📡 Space weather: storm arrives on <b>Day ${state.stormArrival}</b>. It lasts ${state.stormDuration} day(s).`, 'good');
    Sound.ok();
  }
  function doHaulIce() {
    const s = state;
    s.iceUsedSol = s.sol;
    if (s.levelId === '1.3') {
      s.res.o2 = clamp(s.res.o2 + RULES.iceO2.value);
      addLog(`🧊 Hauled ice: <b>+${RULES.iceO2.value} O2</b> from electrolysis.`, 'good');
      if (s.stormStarted) { s.dose = clamp(s.dose + RULES.iceDose.value, 0, 100); addLog(`☢ Exposed during the storm: <b>+${RULES.iceDose.value} dose</b>.`, 'warn'); }
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

  function doSweep() {
    const restored = state.penalty;
    state.penalty = 0;
    state.budget += restored;
    addLog(`🧹 Dust swept off the solar arrays — <b>+${restored} cell${restored === 1 ? '' : 's'}</b> restored.`, 'good');
    Sound.ok();
  }
  function doFetchPanel() {
    state.carryingPanel = true;
    addLog('🔧 Took a spare solar panel from the crates. Install it at the solar field.', 'good');
    Sound.ok();
  }
  function doInstallPanel() {
    state.carryingPanel = false;
    state.panelDeployed = true;
    state.budget += 1;
    addLog('☀️ Spare panel installed: <b>+1 power cell</b> for the rest of the mission.', 'good');
    Sound.ok();
  }
  /* --------------------------------------------------------- hold-to-do UI -- */
  const hold = { active: false, t: 0, action: null, station: null };

  function resetLevelState() {
    cancelHold();
    state.action = null;
  }

  function startHold() {
    if (state.screen !== 'game' || state.phase !== 'eva') return;
    if (state.action) return; // finish the current action first
    const st = nearestInteractable();
    const action = actionFor(st);
    if (!action || action.disabled) { Sound.warn(); return; }

    if (action.minutes === 0) { action.run(); render(); return; }
    hold.active = true; hold.t = 0; hold.action = action; hold.station = st;
    els.interact.classList.add('is-holding');
    const src = st && st.id && st.id.endsWith('-src') ? st : null;
    if (!state.rover.mounted && src && src.hold && (src.item === 'ice' || src.item === 'bag')) {
      startMiningAction(src, action);
    }
  }
  const ACTION_FRAME_DT = 0.12;
  let actionWarned = false;

  function warnActionFallback(kind) {
    if (actionWarned) return;
    actionWarned = true;
    console.warn(`[anim] ${kind} frames unavailable; the hold still completes without the action animation.`);
  }

  function actionAssetsReady(kind) {
    if (kind === 'ice') return animLoaded('ice_mine');
    return animLoaded('dig') && animLoaded('bag');
  }

  function startMiningAction(src, action) {
    const kind = src.item === 'ice' ? 'ice' : 'bag';
    if (!actionAssetsReady(kind)) {
      warnActionFallback(kind === 'ice' ? 'ice mining' : 'regolith digging');
      return false;
    }
    state.action = {
      anim: kind === 'ice' ? 'ice_mine' : 'dig',
      startedAt: performance.now() / 1000,
      progress: 0,
      site: { id: src.id, item: src.item, x: src.x, y: src.y },
      src,
      run: action.run,
      phase: 'loop',
      elapsed: 0,
      finishElapsed: 0,
      bagElapsed: 0,
      mirror: src.x < player.x,
      hiddenSourceId: kind === 'ice' ? src.id : null,
      currentAnim: kind === 'ice' ? 'ice_mine' : 'dig',
      frame: 0,
    };
    return true;
  }

  function cancelAction() {
    if (state.action) state.action = null;
  }

  function actionFrameInfo(a = state.action) {
    if (!a) return null;
    if (a.anim === 'ice_mine') {
      const frame = a.phase === 'finish'
        ? 6 + Math.min(1, Math.floor(a.finishElapsed / ACTION_FRAME_DT))
        : Math.floor(a.elapsed / ACTION_FRAME_DT) % 6;
      return { anim: 'ice_mine', frame, scale: IMG12_SCALE };
    }
    if (a.phase === 'bag' || a.phase === 'finish') {
      const frame = Math.max(0, Math.min(4, Math.floor(a.bagElapsed / ACTION_FRAME_DT)));
      return { anim: 'bag', frame, scale: ANIM_SCALE };
    }
    return { anim: 'dig', frame: Math.floor(a.elapsed / ACTION_FRAME_DT) % 3, scale: ANIM_SCALE };
  }

  function updateAction(dt) {
    const a = state.action;
    if (!a) return;
    a.elapsed += dt;
    if (a.phase === 'bag' || a.phase === 'finish') a.bagElapsed += dt;
    if (a.phase === 'finish') a.finishElapsed += dt;
    const info = actionFrameInfo(a);
    if (info) { a.currentAnim = info.anim; a.frame = info.frame; }
    if (a.phase === 'finish') {
      // strictly greater so the last finish frame gets at least one drawn frame
      if (a.anim === 'ice_mine' && a.finishElapsed > ACTION_FRAME_DT * 2) completeAction();
      else if (a.anim === 'dig' && a.frame >= 4 && a.finishElapsed > 0.15) completeAction();
    }
  }

  function completeAction() {
    const a = state.action;
    state.action = null;
    hold.active = false; hold.t = 0; hold.action = null; hold.station = null;
    els.interact.classList.remove('is-holding');
    if (els.interactProgress) els.interactProgress.style.width = '0%';
    if (a && a.run) a.run();
    render();
  }

  function cancelHold() {
    const early = hold.active;
    hold.active = false; hold.t = 0; hold.action = null; hold.station = null;
    els.interact.classList.remove('is-holding');
    if (els.interactProgress) els.interactProgress.style.width = '0%';
    if (early) cancelAction();
  }
  function updateHold(dt) {
    if (!hold.active || !hold.action) return;
    hold.t += dt;
    const progress = Math.min(1, hold.t / RULES.holdSeconds.value);
    if (state.action) {
      state.action.progress = progress;
      if (state.action.anim === 'dig' && progress >= 0.7 && state.action.phase === 'loop') {
        state.action.phase = 'bag';
        state.action.bagElapsed = 0;
      }
    }
    const pct = progress * 100;
    if (els.interactProgress) els.interactProgress.style.width = `${pct}%`;
    if (hold.t >= RULES.holdSeconds.value) {
      if (state.action) {
        // hold complete: the finish frames play before the effect fires
        state.action.progress = 1;
        state.action.phase = 'finish';
        state.action.finishElapsed = 0;
        hold.active = false; hold.t = 0; hold.action = null; hold.station = null;
        els.interact.classList.remove('is-holding');
        if (els.interactProgress) els.interactProgress.style.width = '100%';
        return;
      }
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
    if (!document.getElementById('water-line')) {
      const w = document.createElement('div');
      w.id = 'water-line';
      w.className = 'water-line';
      els.systems.parentNode.insertBefore(w, els.systems);
    }
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

  /* ============================================================== coach == */
  let coachState = null;

  function slotFilled(id) {
    const slot = state.slots.find((s) => s.id === id);
    return slot ? slot.filled : 0;
  }
  function coachSource(item) {
    const list = state.sources.filter((s) => s.item === item);
    if (!list.length) return null;
    return list.reduce((best, s) =>
      !best || dist(player.x, player.y, s.x, s.y) < dist(player.x, player.y, best.x, best.y) ? s : best, null);
  }
  function coachSlot(id) { return state.slots.find((s) => s.id === id) || null; }
  function coachStation(id) { return STATIONS.find((s) => s.id === id) || null; }
  function coachTargetFor(step) {
    if (!step) return null;
    if (step.item) {
      const src = coachSource(step.item);
      return src ? { x: src.x, y: src.y, id: src.id } : null;
    }
    if (step.station) {
      const st = coachStation(step.station);
      return st ? { x: st.x, y: st.y, id: st.id } : null;
    }
    return null;
  }
  function tutorialOn() {
    const s = state;
    return settings.hints && s.screen === 'game' && s.levelId === '1.1' && s.sol === 1
      && s.phase === 'eva' && !s.tutorialSkipped && !s.tutorialDone
      && starsFor('1.1') === 0;
  }
  function advanceTutorial() {
    const s = state;
    if (!settings.hints || s.levelId !== '1.1' || s.sol !== 1) return;
    if (s.phase === 'resolve') { s.tutorialDone = true; return; }
    if (s.tutorialStep === 0 && s.tutorialMoved) s.tutorialStep = 1;
    if (s.tutorialStep === 1 && s.carry) s.tutorialStep = 2;
    if (s.tutorialStep === 2 && s.tutorialDelivered) s.tutorialStep = 3;
    if (s.tutorialStep === 3 && s.atSwitchboard) s.tutorialStep = 4;
  }
  function tutorialCoach() {
    const s = state;
    const src = coachSource('panel');
    if (s.tutorialStep === 0) {
      return {
        text: 'Move with WASD or the joystick.', target: src, targetId: src ? src.id : null,
        mode: 'source', icon: COACH_ICON.source
      };
    }
    if (s.tutorialStep === 1) {
      return {
        text: 'Hold E or ACT to pick up.', target: src, targetId: src ? src.id : null,
        mode: 'source', icon: COACH_ICON.source
      };
    }
    if (s.tutorialStep === 2) {
      const slot = s.carry ? s.slots.find((sl) => slotAccepts(sl, s.carry)) : null;
      if (slot) {
        return {
          text: 'Take it to the glowing slot.', target: slot, targetId: slot.id,
          mode: 'slot', icon: COACH_ICON.slot
        };
      }
      return genericCoach();
    }
    if (s.tutorialStep === 3) {
      return {
        text: 'Go to the switchboard.', target: SWITCHBOARD_TARGET, targetId: 'switchboard',
        mode: 'switch', icon: COACH_ICON.switch
      };
    }
    return {
      text: 'Press End the day.', target: SWITCHBOARD_TARGET, targetId: 'switchboard',
      mode: 'end', icon: COACH_ICON.end
    };
  }
  function genericCoach() {
    const s = state;
    if (s.phase === 'plan') {
      return {
        text: 'Press Go outside when you are ready.', target: SWITCHBOARD_TARGET,
        targetId: 'switchboard', mode: 'end', icon: COACH_ICON.end
      };
    }
    if (s.air < 25) {
      return {
        text: 'Your suit air is low. Go back inside!', target: { x: 512, y: 430 },
        targetId: 'dome', mode: 'air', icon: COACH_ICON.air
      };
    }
    const plan = COACH_PLANS[s.levelId] || [];
    if (s.carry) {
      const match = plan.find((st) => st.item === s.carry && !st.done(s));
      if (match) {
        const slot = coachSlot(match.slot);
        if (slot) {
          return {
            text: match.carry, target: slot, targetId: slot.id,
            mode: 'slot', icon: COACH_ICON.slot
          };
        }
      }
      const anySlot = s.slots.find((sl) => slotAccepts(sl, s.carry));
      if (anySlot) {
        return {
          text: `Put the ${ITEM_META[s.carry].name.toLowerCase()} in ${anySlot.label.toLowerCase()}.`,
          target: anySlot, targetId: anySlot.id, mode: 'slot', icon: COACH_ICON.slot
        };
      }
      const next = plan.find((st) => !st.done(s));
      const target = coachTargetFor(next) || SWITCHBOARD_TARGET;
      return {
        text: `Drop the ${ITEM_META[s.carry].name.toLowerCase()} and follow the arrow.`,
        target, targetId: target ? target.id : null, mode: 'wrong', icon: COACH_ICON.source
      };
    }
    const next = plan.find((st) => !st.done(s));
    if (next) {
      const target = coachTargetFor(next);
      if (target) {
        return {
          text: next.text, target, targetId: target.id,
          mode: next.item ? 'source' : 'station', icon: next.item ? COACH_ICON.source : COACH_ICON.station
        };
      }
    }
    if (!s.atSwitchboard) {
      return {
        text: 'Go to the switchboard and set the power.', target: SWITCHBOARD_TARGET,
        targetId: 'switchboard', mode: 'switch', icon: COACH_ICON.switch
      };
    }
    return {
      text: 'Press End the day.', target: SWITCHBOARD_TARGET, targetId: 'switchboard',
      mode: 'end', icon: COACH_ICON.end
    };
  }
  function coachArrow(target) {
    if (!target) return null;
    const tx = target.x - camera.x, ty = target.y - camera.y;
    const off = tx < 12 || tx > VW - 12 || ty < 12 || ty > VH - 12;
    const x = clamp(tx, 18, VW - 18), y = clamp(ty, 18, VH - 18);
    return { x, y, angle: off ? Math.atan2(ty - y, tx - x) : Math.PI / 2, off };
  }
  function updateCoach() {
    if (!els.coach) return;
    advanceTutorial();
    const s = state;
    if (!settings.hints || s.screen !== 'game' || !s.level || s.phase === 'resolve') {
      els.coach.hidden = true;
      coachState = null;
      return;
    }
    const on = tutorialOn();
    let info = on ? tutorialCoach() : genericCoach();
    if (!info || !info.target) {
      els.coach.hidden = true;
      coachState = null;
      return;
    }
    if (info.mode !== 'air' && dist(player.x, player.y, info.target.x, info.target.y) > camera.h * 1.35) {
      info = { ...info, text: 'That is far. Use the rover!', mode: 'far' };
    }
    const arrow = coachArrow(info.target);
    coachState = { ...info, arrow, offscreen: !!(arrow && arrow.off) };
    els.coach.hidden = false;
    els.coachText.textContent = info.text;
    els.coachIcon.textContent = info.icon || '▲';
    els.coachSkip.hidden = !on;
  }
  function drawCoachFx(time) {
    if (!coachState || !coachState.target) return;
    const target = coachState.target;
    const arrow = coachState.arrow;
    if (!arrow) return;
    const pulse = 1 + 0.14 * Math.sin(time * 5);
    ctx.save();
    if (!arrow.off) {
      const tx = target.x - camera.x, ty = target.y - camera.y;
      ctx.strokeStyle = 'rgba(255,207,58,.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tx, ty, 18 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time * 5);
      ctx.beginPath(); ctx.arc(tx, ty, 24 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      drawCoachArrow(tx, ty - 34 + Math.sin(time * 5) * 2, Math.PI / 2);
    } else {
      ctx.strokeStyle = 'rgba(255,207,58,.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(arrow.x, arrow.y, 10 * pulse, 0, Math.PI * 2); ctx.stroke();
      drawCoachArrow(arrow.x, arrow.y, arrow.angle);
    }
    ctx.restore();
  }
  function drawCoachArrow(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffcf3a';
    ctx.strokeStyle = '#5a3c00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-9, -8); ctx.lineTo(-9, 8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function render() {
    const s = state;
    if (!s.level) return;
    const L = s.level;
    const sol = s.sol;
    const totalSols = L.id === '1.1' ? L.goalsSol : L.maxSols;

    els.hudLevel.textContent = `${L.id} · Moon`;
    els.hudSol.textContent = `Day ${sol} / ${totalSols}${s.slip ? ` · slip ${s.slip}` : ''}`;
    els.hudHearts.innerHTML = heartsHTML(s.hearts);
    els.hudHearts.setAttribute('aria-label', `Crew hearts: ${s.hearts} of 3`);
    els.hudPhase.textContent = PHASE_LABEL[s.phase] || s.phase;
    els.hudPhase.dataset.phase = s.phase;
    els.hudEva.textContent = `Air ${Math.round(s.air)}%`;
    els.hudEva.classList.toggle('is-low', s.air < 25);
    els.phaseChip.textContent = PHASE_LABEL[s.phase] || s.phase;
    els.phaseChip.dataset.phase = s.phase;
    els.phaseHint.textContent = s.phase === 'plan' ? 'Set power' : s.phase === 'eva' ? 'Do jobs outside' : 'Ending the day';

    const nearSwitch = dist(player.x, player.y, 376, 378) < 56;
    s.atSwitchboard = nearSwitch;
    els.panel.classList.toggle('at-switchboard', nearSwitch);
    const wl = document.getElementById('water-line');
    if (wl) wl.innerHTML = `💧 Water <b>${Math.round(s.res.water || 0)}%</b><span>${nearSwitch ? 'switchboard: allocate cells' : 'walk to the switchboard to change cells'} · ice → water tank</span>`;
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
      const enabled = (s.phase === 'plan' || s.phase === 'eva') && s.atSwitchboard;
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

    // suit air
    els.evaVal.textContent = `${Math.round(s.air)}%`;
    const airBar = document.getElementById('air-bar');
    if (airBar) {
      airBar.style.width = `${Math.max(0, Math.min(100, s.air))}%`;
      airBar.style.backgroundColor = s.air < 25 ? '#ff4d6d' : s.air < 50 ? '#ffb02e' : '#7ce38b';
    }
    els.evaHint.innerHTML = s.air < 25
      ? 'Low air! Go back inside.'
      : 'Air drains as you walk. It refills each day.';

    // shelter order (1.3)
    const showShelter = L.id === '1.3' && s.sol >= 2 && s.stormArrival > 0 && !s.sheltered;
    els.shelterBtn.hidden = !showShelter;
    if (showShelter) {
      els.shelterBtn.disabled = s.phase === 'resolve';
      els.shelterBtn.textContent = s.stormKnown ? `Shelter before Day ${s.stormArrival}` : 'Order shelter';
    }

    // run button
    const isPlan = s.phase === 'plan';
    els.run.textContent = isPlan ? 'Go outside ▶' : s.phase === 'eva' ? 'End the day ▶' : 'Ending the day…';
    els.run.disabled = s.phase === 'resolve';
    els.hint.textContent = isPlan
      ? (leftCells() > 0 ? `${leftCells()} cell${leftCells() === 1 ? '' : 's'} will charge the battery.` : 'Battery charged. Go outside.')
      : s.phase === 'eva' ? 'Do the jobs outside. Then end the day.' : '';

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
    renderTracker();
    updateCoach();
  }

  function forecastFor(s) {
    const L = s.level;
    const ev = {
      calm: { label: 'Clear skies', icon: '☀️', tone: 'neutral', text: 'No hazards today. A good day to refill.' },
      dust: { label: 'Dust on panels', icon: '🌫️', tone: 'warn', text: 'Dust covers the panels. You lose <strong>1 solar cell</strong> tomorrow. Sweep them outside.' },
      longshadow: { label: 'Long shadow', icon: '🌥', tone: 'warn', text: 'The Sun is low. You lose <strong>2 solar cells</strong> tomorrow.' },
      cme: { label: 'Space weather alert', icon: '☀️', tone: 'bad', text: 'A solar storm is coming. Check the dish for the day.' },
      cold: { label: 'Cold snap', icon: '🥶', tone: 'warn', text: 'Heaters need <strong>8 extra O2</strong> today.' },
      storm: { label: 'Solar storm', icon: '☀️', tone: 'bad', text: 'Solar storm! Shelter the crew or take the dose.' },
    }[s.eventKey] || { label: 'Clear skies', icon: '☀️', tone: 'neutral', text: 'No hazards today.' };

    if (L.id === '1.3') {
      if (s.stormStarted) {
        return {
          label: `Solar storm - Day ${s.sol}`, tone: 'bad', sprite: 'fx/sun', icon: '☀️',
          text: s.sheltered ? 'Crew is in the bunker. Dose cut by 90%.' : 'Crew is outside. Full storm dose today!'
        };
      }
      if (s.stormArrival) {
        const when = s.stormKnown ? `Day ${s.stormArrival}` : 'soon';
        return {
          label: s.stormKnown ? 'Space weather - confirmed' : 'Space weather - vague',
          tone: 'bad', sprite: 'fx/sun', icon: '☀️',
          text: s.stormKnown
            ? `Storm arrives on <strong>Day ${s.stormArrival}</strong>. Shelter before then.`
            : `A storm is coming. Visit the dish for the exact day.`
        };
      }
    }
    if (L.id === '1.2') {
      return {
        label: `Forecast - Day ${s.sol}`, tone: 'warn', sprite: 'hazard/water_leak', icon: '💧',
        text: s.reopened ? 'Leak sealed. Keep water above 40%.'
          : s.isolated ? 'Hatch closed. Tape and patch the leak, then reopen.'
            : 'Water is leaking. Close the hatch at the recycler.'
      };
    }
    if (L.id === '1.1' && s.sol === L.goalsSol) {
      return {
        label: 'Crew landing - Day 5', tone: 'good', sprite: 'fx/capsule', icon: '🚀',
        text: `Targets: O2 at least ${L.goals.o2}%, water at least ${L.goals.water}%, battery at least ${L.goals.battery}.`
      };
    }
    return { label: ev.label + ` - Day ${s.sol}`, tone: ev.tone, icon: ev.icon, text: ev.text };
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
      ? 'Recycler is off. Water cells made nothing today.'
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
    const loadEl = document.getElementById('screen-loading');
    if (loadEl) loadEl.hidden = true;
    const s = state;
    resetLevelState();
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
    s.air = 100; s.airWarned = false;
    s.sweepSol = 0;
    s.panelDeployed = false; s.panelBonus = 0; s.bags = 0; s.carry = null; s.groundItems = [];
    s.snap = null; s.atSwitchboard = false; s.carryingPanel = false; s.carryingTape = false;
    s.res.water = L.start.water != null ? L.start.water : (s.res.water || 48);
    s.isolated = false; s.taped = false; s.patched = false; s.reopened = false;
    s.patch = 0; s.leakActive = L.id === '1.2'; s.leakStart = 0; s.spareDelivered = false;
    s.ration = false; s.rationSols = 0;
    s.stormArrival = 0; s.stormDuration = 1; s.stormKnown = false; s.stormStarted = false;
    s.sheltered = false; s.shelterSol = 0; s.exposedCrew = 0;
    s.iceUsedSol = 0;
    s.slip = 0; s.delayed = false; s.revived = false;
    s.schedule = L.schedule.slice();
    s.fx = null; s.winAt = 0;
    s.stats = { lowest: {}, startRes: { ...s.res } };
    s.lastDoseCause = '';

    if (L.id === '1.2') s.leakStart = Math.random() < 0.5 ? 1 : 2;
    if (L.id === '1.3') {
      s.stormArrival = 3 + Math.floor(Math.random() * 3); // 3..5
      s.stormDuration = Math.random() < 0.8 ? 2 : 1; // 1..2 sols
    }

    buildInteractions();
    player.x = 512; player.y = 430; player.path = []; player.facing = 1;
    player.animDist = 0; player.animFrame = 0; player.animMode = 'idle';
    s.action = null;
    s.tutorialStep = 0; s.tutorialMoved = false; s.tutorialSkipped = false; s.tutorialDelivered = false; s.tutorialDone = false;
    for (const n of npcs) { n.x = n.id === 'npc1' ? 470 : 620; n.y = n.id === 'npc1' ? 400 : 420; n.tx = n.x; n.ty = n.y; n.atBunker = false; }
    snapCamera();

    buildSystems();
    els.log.innerHTML = '';
    showScreen('game');
    els.panel.classList.remove('is-collapsed');
    resize();
    renderTracker();
    addLog(`<b>${COACH_GOALS[L.id]}</b>`, 'head');
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
    s.air = 100; s.airWarned = false;
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

    s.budget = Math.max(2, RULES.budget.value - s.penalty + (s.panelBonus || 0));
    fitAlloc();
    restock();
    if (s.rover.usedThisSol) {
      const rb = getBattery();
      if (rb > 0) setBattery(rb - 1);
      s.rover.dead = getBattery() <= 0;
    } else s.rover.dead = getBattery() <= 0;
    s.rover.usedThisSol = false;
    if (s.rover.dead) addLog('🔋 Rover battery empty. Walk or charge a cell today.', 'warn');
    if (!first) addLog(`<b>Day ${s.sol}</b> - ${s.budget} solar cells. Air ${s.air}%.`, 'muted');
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
    addLog(`You are outside. Suit air 100%.${leftover ? ` ${leftover} spare cell${leftover === 1 ? '' : 's'} charge the battery.` : ''}`, 'good');
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
    cancelAction();
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
        else lines.push({ t: 'Recycler is off. Water cells made nothing today.', tone: 'warn' });
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
    if (s.eventKey === 'dust') { s.nextPenalty = Math.max(s.nextPenalty, 1); lines.push({ t: 'Dust: <b>1 fewer cell</b> tomorrow. Sweep the panels outside.', tone: 'warn' }); }
    if (s.eventKey === 'longshadow') { s.nextPenalty = Math.max(s.nextPenalty, 2); lines.push({ t: 'Long shadow: <b>2 fewer cells</b> tomorrow.', tone: 'warn' }); }
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
          const protection = 0.5 + 0.08 * (s.bags || 0);
          dose += power * (early ? 1 - protection : 0.85);
          lines.push({
            t: early
              ? `🛖 Sheltered before arrival: storm dose mostly blocked (<b>+${dose.toFixed(1)}</b>).`
              : `🛖 Sheltered late — crew was still walking when the storm hit (<b>+${dose.toFixed(1)}</b>).`, tone: early ? 'good' : 'warn'
          });
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
      s.res.water = clamp(s.res.water || 0);
    }
    const dangerRows = L.rows.filter((r) => ROWS[r].kind !== 'cells' && r !== 'repair' && r !== 'surface');
    if (!dangerRows.includes('water')) dangerRows.push('water');
    const lows = dangerRows.filter((r) => (s.res[r] ?? 100) < CRITICAL);
    if (lows.length && s.hearts > 0) {
      s.hearts -= 1; s.heartsLost += 1;
      lines.push({ t: `⚠️ Critical: ${lows.map((r) => ROWS[r].short).join(' & ')} under ${CRITICAL}% — <b>−1 heart</b>.`, tone: 'bad' });
      Sound.warn();
    }

    addLog(`<b>Day ${sol} - ${s.eventKey}</b> - cells ${L.rows.map((r) => alloc[r] || 0).join('/')}`, 'head');
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
          addLog(`Crew landing slips to <b>Day ${sol + 1}</b>. The base is not ready.`, 'warn');
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
        ? (s.delayed ? `The capsule landed on Day ${s.sol} — after ${s.slip} slip${s.slip > 1 ? 's' : ''}.` : 'The capsule landed on Day 5. Right on time!')
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
    if (s.research > 0) good.push(`Earned ${s.research} research points.`);
    if (s.reopened) good.push('Recycler back online after the patch.');
    if (s.hearts < 3) bad.push(`Lost ${3 - s.hearts} crew heart${3 - s.hearts === 1 ? '' : 's'}.`);
    for (const [row, low] of Object.entries(s.stats.lowest)) if (low < 45) bad.push(`${ROWS[row].short} dipped to ${low}%.`);
    if (s.delayed) bad.push('Crew landing slipped by one or more days.');
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
    s.air = 100; s.airWarned = false;
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
    if (e.code === 'KeyQ') { if (dropItem()) render(); return; }

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

  $('#play-btn')?.addEventListener('click', () => { Sound.init(); Sound.click(); goSelect(); });
  $('#continue-btn')?.addEventListener('click', () => { Sound.init(); Sound.click(); goSelect(); });
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
  $('#map-btn-hud')?.addEventListener('click', () => document.body.classList.toggle('no-minimap'));

  function closeModals() { for (const m of document.querySelectorAll('.modal')) m.hidden = true; }
  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.hidden = false; Sound.click();
    const c = m.querySelector('[data-close]'); if (c) c.focus();
  }
  $('#how-btn')?.addEventListener('click', () => openModal('modal-how'));
  $('#science-btn')?.addEventListener('click', () => openModal('modal-science'));
  $('#science-btn-hud')?.addEventListener('click', () => openModal('modal-science'));
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { closeModals(); closeStationPanel(); });
  for (const m of document.querySelectorAll('.modal')) m.addEventListener('click', (e) => { if (e.target === m) { closeModals(); closeStationPanel(); } });

  /* ================================================================ update == */
  function updateInteractPrompt() {
    if (state.screen !== 'game' || state.phase !== 'eva') { els.interact.hidden = true; return; }
    const st = nearestInteractable();
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
      if (!window.__JAMT_FREEZE) {
        updateHold(dt);
        updateAction(dt);
      }
      updateInteractPrompt();
      updateCoach();
    }
    drawScene(t);
    drawMinimap();
    requestAnimationFrame(frame);
  }

  /* ================================================================ debug === */
  const q = new URLSearchParams(location.search);
  const DEBUG = q.has('debug');
  window.__JAMT_AUTO_EVA = false;
  window.__JAMT_FREEZE = false;

  window.__T = {
    teleport(x, y) { player.x = x; player.y = y; snapCamera(); },
    pick(type) {
      const src = state.sources.find((s) => s.item === type && s.stock > 0);
      if (src) { pickupSource(src); return true; }
      return false;
    },
    deliver(slotId) {
      const slot = state.slots.find((s) => s.id === slotId);
      if (!slot) return false;
      deliverSlot(slot);
      return true;
    },
    give(type) { state.carry = type; },
    drop() { return dropItem(); },
    carry() { return state.carry; },
    slots() { return state.slots.map((s) => ({ id: s.id, filled: s.filled, cap: s.cap })); },
    sources() { return state.sources.map((s) => ({ id: s.id, item: s.item, stock: s.stock, cap: s.cap })); },
    nearest() { return nearestInteractable(); },
    state, RESOURCE_DOCS, ITEM_META, SLOTS, actionFor, blockedAt, startSol, collapseFromAir, mountRover, dismountRover, walkBackRadius,
    setKey(k, v) { keys[k] = v; },
    step(dt) { updatePlayer(dt); },
  };
  window.__JAMT__ = {
    get state() { return state; },
    get player() { return player; },
    get anim() {
      const w = ANIMS.walk, idle = ANIMS.idle;
      const stride = (w && w.strideDistance) || 8;
      const count = (w && w.frameCount) || 6;
      const cycle = stride * count;
      return {
        ready: !!(w && w.loaded && idle && idle.loaded),
        fallback: !!((w && w.settled && !w.loaded) || (idle && idle.settled && !idle.loaded)),
        scale: ANIM_SCALE,
        targetHeight: ANIM_TARGET_HEIGHT,
        idleHeight: (idle && idle.h && idle.h[0] ? idle.h[0] : 0) * ANIM_SCALE,
        stride, frameCount: count, cycleDistance: cycle,
        mode: player.animMode,
        frame: player.animMode === 'walk' ? player.animFrame : 0,
        walkFrame: player.animFrame,
        distance: player.animDist,
        cycles: Math.floor(player.animDist / cycle),
        facing: player.facing,
        draw: window.__jamtAnimDraw || null,
      };
    },
    resetAnim() { player.animDist = 0; player.animFrame = 0; player.animMode = 'idle'; },
    resetLevelState,
    get action() {
      const a = state.action;
      if (!a) return null;
      return {
        anim: a.currentAnim, baseAnim: a.anim, frame: a.frame, phase: a.phase,
        progress: a.progress, mirror: a.mirror, hiddenSourceId: a.hiddenSourceId,
        site: { ...a.site }, elapsed: a.elapsed,
      };
    },
    get actionDraw() { return window.__jamtActionDraw || null; },
    get coach() {
      if (!coachState) return null;
      return {
        text: coachState.text, mode: coachState.mode, target: coachState.target,
        targetId: coachState.targetId, offscreen: !!coachState.offscreen,
        arrow: coachState.arrow, icon: coachState.icon
      };
    },
    setHints(on) { settings.hints = !!on; saveSettings(); applySettings(); updateCoach(); },
    updateCoach,
    get tutorial() {
      return {
        step: state.tutorialStep, skipped: state.tutorialSkipped,
        delivered: state.tutorialDelivered, done: state.tutorialDone
      };
    },
    img12Scale: IMG12_SCALE,
    startHold, cancelHold,
    stepHold(dt) { updateHold(dt); updateAction(dt); },
    holdActive() { return hold.active; },
    sourceHidden(id) { return !!(state.action && state.action.hiddenSourceId === id); },
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


  /* ============ iteration 2: loading, menus, briefing, pause, touch ====== */
  const BUILD_VERSION = '3.1.5';
  const TIPS = [
    'Did you know? ISS life support recovers about 98% of the crew’s water (NASA ECLSS).',
    'Did you know? Water ice hides in permanently shadowed craters at the lunar south pole (LRO/LCROSS).',
    'Did you know? Crews shelter in place during solar particle events (NASA space weather).',
    'Did you know? About 4 g/cm² of regolith is enough to get below 30-day radiation limits.',
    'Did you know? Coronal mass ejections take about 1–4 days to reach Earth (NASA DONKI).',
  ];
  const BRIEFS = {
    '1.1': {
      goal: 'Get the Moon base ready before the crew lands. Reach O2 70%, water 60%, battery 3 by Day 5.',
      why: 'ISS power and water make oxygen. The Moon south pole gets sunlight almost all day.',
      rows: [
        ['icons/o2', 'O₂ cells', 'Switchboard (battery bank)', 'O₂ generator', 'Breathing air; uses water'],
        ['icons/water', 'Ice', 'Shaded crater (SW)', 'Water tank', 'Only source of new water'],
        ['icons/battery', 'Battery canisters', 'Cargo crates', 'Battery bank', 'Stored power for shadows'],
        ['power/solar_a', 'Spare panel', 'Crates', 'Solar field', '+1 solar cell each day'],
      ],
    },
    '1.2': {
      goal: 'Fix the leaking pipe. Keep water at 40% or more by Day 6.',
      why: 'Crews close hatches and tape leaks. The 2018 Soyuz leak was a drill hole.',
      rows: [
        ['icons/water', 'Water', 'Recycler + ice', 'Crew', 'Drinking and food; rationing cuts use'],
        ['repair/toolbox', 'Toolbox + tape', 'Crates', 'Leak site', 'Stage A: cut the leak to 15%'],
        ['repair/gears', 'Repair cells', 'Switchboard', 'Patch', 'Stage B: 2 days to cure'],
      ],
    },
    '1.3': {
      goal: 'Keep dose at 60 or less and O2 at 30% or more by Day 6.',
      why: 'Crews shelter from solar particle events; ~4 g/cm² of regolith gets below 30-day limits, but extra thickness barely stops cosmic rays.',
      rows: [
        ['icons/shield', 'Regolith bags', 'Bunker wall (NW)', 'Bunker', '+shielding, lowers storm dose'],
        ['icons/o2', 'O₂ canisters', 'Cargo crates', 'O₂ rack', '+25 O₂ (game assumption)'],
        ['icons/battery', 'Battery canisters', 'Crates', 'Battery bank', 'Power through a long shadow'],
        ['fx/sun', 'Space weather', 'Comms dish (N)', 'Forecast', 'Shows the storm day'],
      ],
    },
  };

  const flowEls = {
    loading: $('#screen-loading'), gate: $('#start-gate'), bar: $('#load-bar'),
    count: $('#load-count'), tip: $('#load-tip'),
    brief: $('#screen-brief'), briefTitle: $('#brief-title'), briefKicker: $('#brief-kicker'),
    briefGoal: $('#brief-goal'), briefWhy: $('#brief-why'), briefTable: $('#brief-table'),
    briefControls: $('#brief-controls'),
    pause: $('#modal-pause'), confirm: $('#modal-confirm'), confirmText: $('#confirm-text'),
    settings: $('#modal-settings'), credits: $('#modal-credits'),
    tracker: $('#tracker'), trackerList: $('#tracker-list'), trackerCount: $('#tracker-count'),
    touch: $('#touch-controls'), stick: $('#stick'), knob: $('#stick-knob'), act: $('#act-btn'),
  };
  let confirmYes = null;

  function applySettings() {
    document.body.classList.toggle('reduce-motion', !!settings.motion);
    if (settings.sound === false && !Sound.muted) Sound.toggle();
    if (settings.sound === true && Sound.muted) Sound.toggle();
    const touchOn = settings.touch === 'on' || (settings.touch === 'auto' && window.matchMedia('(pointer: coarse)').matches);
    document.body.classList.toggle('touch-on', touchOn);
    if (flowEls.touch) flowEls.touch.hidden = !touchOn;
    const set = (id, label) => { const b = document.getElementById(id); if (b) b.textContent = label; };
    set('set-sound', settings.sound ? 'ON' : 'OFF');
    set('set-touch', settings.touch.toUpperCase());
    set('set-motion', settings.motion ? 'ON' : 'OFF');
    set('set-hints', settings.hints ? 'ON' : 'OFF');
    set('set-unlock', settings.unlock ? 'ON' : 'OFF');
    document.body.classList.toggle('hints-off', !settings.hints);
  }

  function openPause() {
    if (state.screen !== 'game') return;
    if (document.querySelector('.modal:not([hidden])')) return;
    flowEls.pause.hidden = false;
    Sound.click();
    state.paused = true;
  }
  function closePause() { flowEls.pause.hidden = true; state.paused = false; }

  function askConfirm(text, onYes) {
    flowEls.confirmText.textContent = text;
    confirmYes = onYes;
    flowEls.confirm.hidden = false;
  }
  function closeConfirm() { flowEls.confirm.hidden = true; confirmYes = null; }

  function quitToGoodbye() {
    closeConfirm(); closePause();
    state.runId += 1;
    showScreen('goodbye');
    Sound.click();
  }

  function renderBrief(id) {
    const L = LEVELS[id];
    const B = BRIEFS[id];
    if (!L || !B) { goSelect(); return; }
    state.briefId = id;
    flowEls.briefKicker.textContent = `Mission ${id} · The Moon`;
    flowEls.briefTitle.textContent = L.title;
    flowEls.briefGoal.textContent = B.goal;
    flowEls.briefWhy.textContent = B.why;
    flowEls.briefTable.innerHTML = '<thead><tr><th></th><th>What</th><th>Where</th><th>Goes to</th><th>What it does</th></tr></thead><tbody>'
      + B.rows.map((r) => `<tr><td>${imgTag(r[0], '', r[1])}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')
      + '</tbody>';
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    flowEls.briefControls.innerHTML = coarse
      ? '<span>Joystick: walk</span><span>ACT: pick up / use</span><span>Tap a highlighted object</span><span>⏸ Pause</span>'
      : '<span>WASD / arrows: walk</span><span>Click: move</span><span>Hold E: use</span><span>1–3 / Shift: cells</span><span>Space: Go outside</span><span>Esc: pause</span>';
  }
  function openBriefing(id) { renderBrief(id); showScreen('brief'); }

  function renderTracker() {
    const listEl = document.getElementById('tracker-list');
    const countEl = document.getElementById('tracker-count');
    if (!listEl || !countEl || !state.level) return;
    const s = state, L = s.level;
    let items = [];
    if (L.id === '1.1') {
      items = [
        { label: 'O₂ reserve', value: `${Math.round(s.res.o2 || 0)}/70`, done: (s.res.o2 || 0) >= 70 },
        { label: 'Water reserve', value: `${Math.round(s.res.water || 0)}/60`, done: (s.res.water || 0) >= 60 },
        { label: 'Battery charge', value: `${Math.round(getBattery())}/3`, done: getBattery() >= 3 },
        { label: 'Crew landing', value: s.slip ? `slip ${s.slip}` : 'Day 5', done: false },
      ];
    } else if (L.id === '1.2') {
      items = [
        { label: 'Isolate hatch', value: s.isolated ? 'done' : '—', done: s.isolated },
        { label: 'Kapton tape', value: s.taped ? 'done' : '—', done: s.taped },
        { label: 'Cure patch', value: `${s.patch}/2`, done: s.patched },
        { label: 'Reopen hatch', value: s.reopened ? 'done' : '—', done: s.reopened },
        { label: 'Water ≥ 40%', value: `${Math.round(s.res.water || 0)}%`, done: (s.res.water || 0) >= 40 },
      ];
    } else {
      items = [
        { label: 'Check the dish', value: s.stormKnown ? 'done' : '—', done: !!s.stormKnown },
        { label: 'Shelter crew', value: s.sheltered ? 'done' : '—', done: !!s.sheltered },
        { label: 'Dose ≤ 60', value: `${Math.round(s.dose || 0)}`, done: (s.dose || 0) <= RULES.doseLimit.value },
        { label: 'O₂ ≥ 30%', value: `${Math.round(s.res.o2 || 0)}%`, done: (s.res.o2 || 0) >= 30 },
      ];
    }
    listEl.innerHTML = items.map((i) =>
      `<li class="${i.done ? 'done' : ''}"><span>${i.label}</span><b>${i.value}</b></li>`).join('');
    countEl.textContent = `${items.filter((i) => i.done).length}/${items.length}`;
  }

  function wireHelpDots() {
    const pop = document.createElement('div');
    pop.className = 'help-pop';
    pop.hidden = true;
    document.body.appendChild(pop);
    let pinned = null;
    const place = (dot, pin = false) => {
      const r = dot.getBoundingClientRect();
      pop.textContent = dot.dataset.help || '';
      pop.hidden = false;
      pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 268, r.left - 8))}px`;
      pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 8)}px`;
      if (pin) pinned = dot;
    };
    const hide = (dot) => {
      if (pinned === dot) return;
      pop.hidden = true;
    };
    for (const dot of document.querySelectorAll('.help-dot')) {
      dot.title = dot.dataset.help || '';
      dot.addEventListener('mouseenter', () => place(dot));
      dot.addEventListener('focus', () => place(dot));
      dot.addEventListener('mouseleave', () => hide(dot));
      dot.addEventListener('blur', () => hide(dot));
      dot.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        place(dot, true);
      });
    }
    document.addEventListener('click', () => { pinned = null; pop.hidden = true; });
  }

  function wireFlow() {
    els.coachSkip.addEventListener('click', () => { state.tutorialSkipped = true; updateCoach(); });
    document.getElementById('menu-settings').addEventListener('click', () => { flowEls.settings.hidden = false; Sound.click(); });
    document.getElementById('menu-credits').addEventListener('click', () => { flowEls.credits.hidden = false; Sound.click(); });
    document.getElementById('menu-quit').addEventListener('click', () => askConfirm('Quit the game? Your saved stars will stay on this device.', () => { closeConfirm(); showScreen('goodbye'); }));
    document.getElementById('goodbye-back').addEventListener('click', () => { Sound.click(); showScreen('title'); });
    document.getElementById('credits-version').textContent = `Version ${BUILD_VERSION}`;
    const tv = document.getElementById('title-version');
    if (tv) tv.textContent = `v${BUILD_VERSION}`;

    document.getElementById('brief-start').addEventListener('click', () => { Sound.init(); Sound.click(); startLevel(state.briefId || '1.1'); });
    document.getElementById('brief-back').addEventListener('click', () => { Sound.click(); goSelect(); });
    document.getElementById('brief-back2').addEventListener('click', () => { Sound.click(); goSelect(); });
    document.getElementById('tracker-info').addEventListener('click', () => renderBrief(state.levelId) || showScreen('brief'));
    document.getElementById('tracker-toggle').addEventListener('click', () => flowEls.tracker.classList.toggle('is-collapsed'));

    document.getElementById('pause-btn').addEventListener('click', openPause);
    document.getElementById('pause-continue').addEventListener('click', () => { closePause(); Sound.click(); });
    document.getElementById('pause-restart').addEventListener('click', () => askConfirm('Restart this mission? Progress in the current day will be lost.', () => {
      closeConfirm(); closePause(); startLevel(state.levelId);
    }));
    document.getElementById('pause-map').addEventListener('click', () => askConfirm('Leave to the level map? This mission will not be saved.', () => {
      closeConfirm(); closePause(); goSelect();
    }));
    document.getElementById('pause-menu').addEventListener('click', () => askConfirm('Return to the main menu? This mission will not be saved.', () => {
      closeConfirm(); closePause(); goTitle();
    }));
    document.getElementById('confirm-yes').addEventListener('click', () => { const fn = confirmYes; closeConfirm(); if (fn) fn(); });
    document.getElementById('confirm-no').addEventListener('click', () => { closeConfirm(); Sound.click(); });

    document.getElementById('set-sound').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); applySettings(); if (settings.sound) Sound.click(); });
    document.getElementById('set-touch').addEventListener('click', () => {
      settings.touch = settings.touch === 'auto' ? 'on' : settings.touch === 'on' ? 'off' : 'auto';
      saveSettings(); applySettings();
    });
    document.getElementById('set-motion').addEventListener('click', () => { settings.motion = !settings.motion; saveSettings(); applySettings(); updateCoach(); });
    document.getElementById('set-hints').addEventListener('click', () => { settings.hints = !settings.hints; saveSettings(); applySettings(); updateCoach(); });
    document.getElementById('set-unlock').addEventListener('click', () => { settings.unlock = !settings.unlock; saveSettings(); applySettings(); if (state.screen === 'select') renderSelect(); });

    // Esc / browser back / pause
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      if (!flowEls.confirm.hidden) { closeConfirm(); return; }
      if (!flowEls.pause.hidden) { closePause(); return; }
      if (!flowEls.settings.hidden) { flowEls.settings.hidden = true; return; }
      if (!flowEls.credits.hidden) { flowEls.credits.hidden = true; return; }
      if (state.screen === 'game') { e.preventDefault(); openPause(); }
      else if (state.screen === 'brief') goSelect();
      else if (state.screen === 'debrief') goSelect();
    }, true);
    window.addEventListener('popstate', () => {
      if (state.screen === 'game') openPause();
      else if (state.screen === 'brief') goSelect();
    });
    window.addEventListener('blur', () => { if (state.screen === 'game' && flowEls.pause.hidden) openPause(); });

    // touch joystick + ACT
    let stickId = null;
    const setStick = (dx, dy) => {
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      keys.left = nx < -0.35; keys.right = nx > 0.35;
      keys.up = ny < -0.35; keys.down = ny > 0.35;
      flowEls.knob.style.transform = `translate(${Math.max(-26, Math.min(26, dx))}px, ${Math.max(-26, Math.min(26, dy))}px)`;
    };
    const resetStick = () => {
      keys.left = keys.right = keys.up = keys.down = false;
      flowEls.knob.style.transform = '';
      stickId = null;
    };
    flowEls.stick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      flowEls.stick.setPointerCapture(e.pointerId);
      const r = flowEls.stick.getBoundingClientRect();
      setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      e.preventDefault();
    });
    flowEls.stick.addEventListener('pointermove', (e) => {
      if (stickId !== e.pointerId) return;
      const r = flowEls.stick.getBoundingClientRect();
      setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    });
    flowEls.stick.addEventListener('pointerup', resetStick);
    flowEls.stick.addEventListener('pointercancel', resetStick);
    flowEls.act.addEventListener('pointerdown', (e) => { e.preventDefault(); startHold(); flowEls.act.classList.add('is-holding'); });
    const actUp = () => { cancelHold(); flowEls.act.classList.remove('is-holding'); };
    flowEls.act.addEventListener('pointerup', actUp);
    flowEls.act.addEventListener('pointercancel', actUp);
    flowEls.act.addEventListener('pointerleave', actUp);
    setInterval(() => {
      if (state.screen !== 'game' || state.phase !== 'eva') return;
      const lbl = els.interact.hidden ? 'ACT' : els.interactLabel.textContent;
      const txt = document.getElementById('act-label');
      if (txt) txt.textContent = lbl.length > 12 ? lbl.slice(0, 12) : lbl;
    }, 250);
  }

  function initAnimDebugPage() {
    if (!DEBUG || location.hash !== '#anim') return;
    const root = document.getElementById('anim-debug');
    if (!root) return;
    const loading = document.getElementById('screen-loading');
    if (loading) loading.hidden = true;
    document.querySelectorAll('.overlay').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('.modal').forEach((el) => { el.hidden = true; });
    root.hidden = false;
    const grid = document.getElementById('anim-debug-grid');
    const meta = document.getElementById('anim-debug-meta');
    if (meta) {
      meta.textContent = `scale ${ANIM_SCALE.toFixed(5)} · idle ${ANIM_TARGET_HEIGHT}px · `
        + `stride 8px · cycle 48px · foot-anchored`;
    }
    const speeds = [{ v: 40, label: 'SLOW' }, { v: 82, label: 'WALK' }, { v: 164, label: 'FAST' }];
    const panels = [];
    for (const theme of ['dark', 'light']) {
      const row = document.createElement('section');
      row.className = `anim-row ${theme}`;
      const head = document.createElement('h2');
      head.textContent = `${theme.toUpperCase()} BACKGROUND`;
      row.append(head);
      const cells = document.createElement('div');
      cells.className = 'anim-cells';
      for (const sp of speeds) {
        const stage = document.createElement('div');
        stage.className = 'anim-stage';
        const canvas = document.createElement('canvas');
        canvas.width = 220; canvas.height = 180;
        const cap = document.createElement('span');
        stage.append(canvas, cap);
        cells.append(stage);
        panels.push({ canvas, g: canvas.getContext('2d'), speed: sp.v, label: sp.label, dist: 0, theme, cap });
      }
      row.append(cells);
      grid.append(row);
    }
    let last = 0;
    const loop = (now) => {
      if (root.hidden) { last = 0; requestAnimationFrame(loop); return; }
      const t = now / 1000;
      const dt = last ? Math.min(0.05, t - last) : 0.016;
      last = t;
      for (const p of panels) {
        p.dist = (p.dist + p.speed * dt) % 48;
        const frame = Math.floor(p.dist / 8) % 6;
        p.g.clearRect(0, 0, 220, 180);
        p.g.fillStyle = p.theme === 'dark' ? 'rgba(255,255,255,.16)' : 'rgba(10,14,25,.16)';
        p.g.fillRect(24, 158, 172, 1);
        p.g.save();
        p.g.translate(110, 160);
        p.g.scale(1, 0.26);
        const grad = p.g.createRadialGradient(0, 0, 2, 0, 0, 30);
        grad.addColorStop(0, 'rgba(0,0,0,.4)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        p.g.fillStyle = grad;
        p.g.beginPath(); p.g.arc(0, 0, 30, 0, Math.PI * 2); p.g.fill();
        p.g.restore();
        if (!drawAnimFrameTo(p.g, 'walk', frame, 110, 158, false)) {
          p.g.fillStyle = p.theme === 'dark' ? '#e8edff' : '#141a28';
          p.g.font = '12px monospace';
          p.g.fillText('loading frames...', 62, 88);
        }
        p.cap.textContent = `${p.label} ${p.speed}px/s · frame ${frame + 1}/6`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // action strips + scrub slider
    const actionGrid = document.getElementById('anim-action-grid');
    const scrub = document.getElementById('anim-scrub');
    const scrubVal = document.getElementById('anim-scrub-val');
    const actionPanels = [];
    for (const theme of ['dark', 'light']) {
      const row = document.createElement('section');
      row.className = `anim-row ${theme}`;
      const head = document.createElement('h2');
      head.textContent = `${theme.toUpperCase()} BACKGROUND`;
      row.append(head);
      const cells = document.createElement('div');
      cells.className = 'anim-cells anim-cells--two';
      for (const kind of ['ice', 'dig']) {
        const stage = document.createElement('div');
        stage.className = 'anim-stage';
        const canvas = document.createElement('canvas');
        canvas.width = 220; canvas.height = 180;
        const cap = document.createElement('span');
        stage.append(canvas, cap);
        cells.append(stage);
        actionPanels.push({ canvas, g: canvas.getContext('2d'), kind, theme, cap });
      }
      row.append(cells);
      actionGrid.append(row);
    }
    const previewInfo = (kind, p) => {
      if (kind === 'ice') {
        const frame = p >= 1 ? 7 : Math.min(5, Math.floor(p * 6));
        return { anim: 'ice_mine', frame, scale: IMG12_SCALE, label: 'ICE MINE', count: 8 };
      }
      if (p < 0.7) {
        return {
          anim: 'dig', frame: Math.min(2, Math.floor((p / 0.7) * 3)),
          scale: ANIM_SCALE, label: 'DIG', count: 3
        };
      }
      return {
        anim: 'bag', frame: Math.min(4, Math.floor(((p - 0.7) / 0.3) * 5)),
        scale: ANIM_SCALE, label: 'BAG', count: 5
      };
    };
    const renderActions = () => {
      const p = scrub ? Number(scrub.value) / 100 : 0.5;
      if (scrubVal) scrubVal.textContent = `${Math.round(p * 100)}%`;
      for (const a of actionPanels) {
        const info = previewInfo(a.kind, p);
        a.g.clearRect(0, 0, 220, 180);
        a.g.fillStyle = a.theme === 'dark' ? 'rgba(255,255,255,.16)' : 'rgba(10,14,25,.16)';
        a.g.fillRect(24, 158, 172, 1);
        a.g.save();
        a.g.translate(110, 160);
        a.g.scale(1, 0.26);
        const grad = a.g.createRadialGradient(0, 0, 2, 0, 0, 30);
        grad.addColorStop(0, 'rgba(0,0,0,.4)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        a.g.fillStyle = grad;
        a.g.beginPath(); a.g.arc(0, 0, 30, 0, Math.PI * 2); a.g.fill();
        a.g.restore();
        if (!drawAnimFrameTo(a.g, info.anim, info.frame, 110, 158, false, info.scale)) {
          a.g.fillStyle = a.theme === 'dark' ? '#e8edff' : '#141a28';
          a.g.font = '12px monospace';
          a.g.fillText('loading frames...', 62, 88);
        }
        a.cap.textContent = `${info.label} ${info.frame + 1}/${info.count} · ${Math.round(p * 100)}%`;
      }
    };
    if (scrub) scrub.addEventListener('input', renderActions);
    renderActions();
    setInterval(renderActions, 250);

    window.__animDebug = {
      speeds: speeds.map((s) => s.v), panels: panels.length,
      actionPanels: actionPanels.length, img12Scale: IMG12_SCALE,
      scale: ANIM_SCALE, targetHeight: ANIM_TARGET_HEIGHT,
    };
  }

  function initLoading() {
    const started = performance.now();
    let tipIdx = 0;
    flowEls.tip.textContent = TIPS[0];
    const tipTimer = setInterval(() => { tipIdx = (tipIdx + 1) % TIPS.length; flowEls.tip.textContent = TIPS[tipIdx]; }, 2600);
    const timer = setInterval(() => {
      const L = window.__jamtLoad || { done: 1, total: 1 };
      const pct = Math.max(4, Math.min(100, Math.round((L.done / L.total) * 100)));
      flowEls.bar.style.width = `${pct}%`;
      flowEls.count.textContent = `Loading outpost… ${L.done}/${L.total}`;
      if (L.done >= L.total || performance.now() - started > 7000) {
        clearInterval(timer); clearInterval(tipTimer);
        flowEls.count.textContent = 'Ready, Commander.';
        flowEls.bar.style.width = '100%';
        flowEls.gate.disabled = false;
        flowEls.gate.textContent = 'TAP / PRESS TO START';
      }
    }, 120);
    flowEls.gate.addEventListener('click', () => {
      Sound.init(); Sound.click();
      flowEls.loading.hidden = true;
      showScreen('title');
    });
  }

  (function renderScienceResources() {
    const box = document.getElementById('science-resources');
    if (!box) return;
    box.innerHTML = RESOURCE_DOCS.filter((d) => d.slot !== 'leak-slot').map((d) =>
      `<div class="station-row"><span>${ITEM_META[d.item].name} → ${(SLOTS.find((s) => s.id === d.slot) || {}).label || d.slot}</span><b>${d.effect}</b></div>`).join('');
  })();
  applySettings();
  wireHelpDots();
  wireFlow();
  initLoading();
  initAnimDebugPage();

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
