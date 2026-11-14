/* ==========================================================================
   Junior Astronaut Mission Trainer
   Level 1-1 · Shackleton Outpost (lunar south pole)

   Zero dependencies, zero build step. Open index.html and play.

   Design rules (2026 NASA Space Apps "Build a Junior Astronaut Mission
   Trainer" challenge):
     · 2–3 coupled resources, one shared budget
     · browser-only, no login, big readable UI for ages 7–12
     · dynamic hazards with a kid-friendly forecast
     · non-punitive failure (one free revive, explanations, instant retry)
     · every rule traceable to real NASA data (see "Mission Science")
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ config */
  const MAX_SOLS = 10;
  const BASE_BUDGET = 6;
  const START_RES = 100;
  const CRITICAL = 20;

  // What one power cell buys you each sol
  const GAIN = { o2: 8, shield: 11, food: 9 };

  // Baseline wear per sol (grows with mission length, see resolveSol)
  const BASE_DRAIN = { o2: 14, shield: 10, food: 12 };

  const RES_KEYS = ['o2', 'shield', 'food'];

  const RES = {
    o2: { name: 'Oxygen', icon: '🫁', hint: 'Life support', color: '#5ac8ff' },
    shield: { name: 'Shielding', icon: '🛡️', hint: 'Radiation armor', color: '#ffb02e' },
    food: { name: 'Food', icon: '🌱', hint: 'Greenhouse', color: '#7ce38b' },
  };

  /* ------------------------------------------------------------------- state */
  const state = {
    phase: 'title',            // title | alloc | resolving | over | win
    sol: 1,
    maxSols: MAX_SOLS,
    hearts: 3,
    res: { o2: START_RES, shield: START_RES, food: START_RES },
    alloc: { o2: 2, shield: 2, food: 2 },
    budget: BASE_BUDGET,
    schedule: [],
    eventKey: 'calm',
    penalty: 0,
    revived: false,
    fx: null,                  // { type, t0 }
    winAt: 0,
    lastEvent: null,
    runId: 0,
  };

  /* ------------------------------------------------------------------- utils */
  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function heartSVG(on) {
    return `<svg class="heart${on ? ' is-on' : ''}" viewBox="0 0 8 7" shape-rendering="crispEdges" aria-hidden="true">` +
      `<rect x="1" y="0" width="2" height="1"/><rect x="5" y="0" width="2" height="1"/>` +
      `<rect x="0" y="1" width="8" height="4"/>` +
      `<rect x="1" y="5" width="6" height="1"/><rect x="2" y="6" width="4" height="1"/></svg>`;
  }

  function heartsHTML(n, total = 3) {
    let out = '';
    for (let i = 0; i < total; i++) out += heartSVG(i < n);
    return out;
  }

  function starsHTML(n) {
    let out = '';
    for (let i = 0; i < 3; i++) out += `<span class="star${i < n ? ' is-on' : ''}" aria-hidden="true">★</span>`;
    return out;
  }

  /* ------------------------------------------------------------------- sound */
  const Sound = (() => {
    let actx = null;
    let muted = false;
    try { muted = localStorage.getItem('jamt.muted') === '1'; } catch { /* private mode */ }

    function ensure() {
      if (muted) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    }

    function tone(freq, dur = 0.12, type = 'square', vol = 0.04, delay = 0) {
      const a = ensure();
      if (!a) return;
      const t0 = a.currentTime + delay;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(a.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    return {
      init: ensure,
      add: () => tone(660, 0.06, 'square', 0.03),
      remove: () => tone(330, 0.06, 'square', 0.025),
      click: () => tone(440, 0.05, 'square', 0.025),
      run: () => { tone(392, 0.09, 'square', 0.035); tone(523, 0.09, 'square', 0.035, 0.08); },
      warn: () => tone(196, 0.22, 'sawtooth', 0.035),
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'square', 0.04, i * 0.12)),
      lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, 'triangle', 0.045, i * 0.14)),
      revive: () => [523, 784, 1046].forEach((f, i) => tone(f, 0.14, 'triangle', 0.04, i * 0.1)),
      toggle() {
        muted = !muted;
        try { localStorage.setItem('jamt.muted', muted ? '1' : '0'); } catch { /* ignore */ }
        return muted;
      },
      get muted() { return muted; },
    };
  })();

  /* ------------------------------------------------------------------ events */
  const EVENTS = {
    calm: {
      name: 'Clear Skies', icon: '🌤️', tone: 'good',
      hint: 'Clear skies. No hazards expected — a good sol to refill reserves.',
      apply() {
        return [{ t: 'Clear skies over Shackleton. The crew catches its breath.', tone: 'good' }];
      },
    },

    flare: {
      name: 'Solar Flare', icon: '☀️', tone: 'bad',
      hint: 'Solar flare detected! Radiation is spiking — <strong>shielding cells</strong> soak up the damage.',
      apply(st) {
        const dmg = Math.max(0, 50 - st.alloc.shield * 12);
        st.res.o2 = clamp(st.res.o2 - dmg);
        st.res.shield = clamp(st.res.shield - dmg);
        return dmg > 0
          ? [{ t: `A solar storm hit while shields ran on ${st.alloc.shield} cells — radiation cost <b>${dmg} O₂</b> and <b>${dmg} shielding</b>.`, tone: 'bad' }]
          : [{ t: 'A solar storm hit, but your shields soaked it all up. Crew safe!', tone: 'good' }];
      },
    },

    night: {
      name: 'Lunar Night', icon: '🌑', tone: 'warn',
      hint: 'The Sun is setting for days. Grow-lights fade and heaters need extra oxygen.',
      apply(st) {
        const heat = 10;
        st.res.o2 = clamp(st.res.o2 - heat);
        const lost = Math.round(GAIN.food * st.alloc.food * 0.5);
        st.res.food = clamp(st.res.food - lost);
        return [{ t: `Lunar night falls: greenhouse output halves (−${lost} food) and heaters burn <b>${heat} extra O₂</b>.`, tone: 'warn' }];
      },
    },

    dust: {
      name: 'Dust Storm', icon: '🌪️', tone: 'warn',
      hint: 'Moon dust coats the solar panels — next sol you get <strong>1 fewer power cell</strong>.',
      apply(st) {
        st.penalty = 1;
        return [{ t: 'Dust coats the solar panels — tomorrow you get <b>1 fewer power cell</b>.', tone: 'warn' }];
      },
    },

    meteor: {
      name: 'Micrometeoroids', icon: '☄️', tone: 'warn',
      hint: 'Tiny space rocks incoming — shielding takes the hits. With no shielding, the hull does.',
      apply(st) {
        const hit = 24;
        st.res.shield = clamp(st.res.shield - hit);
        let msg = `Micrometeoroids sandblast the outpost: <b>−${hit} shielding</b>.`;
        if (st.alloc.shield === 0) {
          st.res.o2 = clamp(st.res.o2 - 14);
          msg += ' With no shield power, the hull leaked <b>14 O₂</b>.';
        }
        return [{ t: msg, tone: 'warn' }];
      },
    },

    ice: {
      name: 'Ice Vein Found', icon: '🧊', tone: 'good',
      hint: 'Ground radar found water ice in a shadowed crater! Split it for oxygen.',
      apply(st) {
        st.res.o2 = clamp(st.res.o2 + 16);
        return [{ t: 'Water ice found in a shadowed crater — electrolysis adds <b>+16 O₂</b>.', tone: 'good' }];
      },
    },

    supply: {
      name: 'NASA Resupply', icon: '🛰️', tone: 'good',
      hint: 'A cargo lander is on the way with spare shielding panels.',
      apply(st) {
        st.res.shield = clamp(st.res.shield + 20);
        return [{ t: 'A NASA cargo lander delivers spare panels: <b>+20 shielding</b>.', tone: 'good' }];
      },
    },
  };

  function buildSchedule() {
    return [
      'calm',                                // 1  learn the loop
      pick(['calm', 'supply']),              // 2
      'flare',                               // 3  teach shields
      pick(['calm', 'ice']),                 // 4
      pick(['dust', 'meteor']),              // 5
      'night',                               // 6  teach greenhouse
      pick(['calm', 'supply', 'ice']),       // 7
      'meteor',                              // 8
      pick(['dust', 'meteor']),              // 9
      'flare',                               // 10 finale
    ];
  }

  /* --------------------------------------------------------------------- dom */
  const els = {
    stage: $('#stage'),
    hud: $('#hud'),
    hudHearts: $('#hud-hearts'),
    hudSol: $('#hud-sol'),
    sound: $('#sound-btn'),
    welcome: $('#overlay-welcome'),
    end: $('#overlay-end'),
    endHearts: $('#end-hearts'),
    endTitle: $('#end-title'),
    endSub: $('#end-sub'),
    endNote: $('#end-note'),
    restart: $('#restart-btn'),
    revive: $('#revive-btn'),
    next: $('#next-btn'),
    home: $('#home-btn'),
    panel: $('#panel'),
    panelSol: $('#panel-sol'),
    cellsLeft: $('#cells-left'),
    forecast: $('#forecast'),
    forecastIcon: $('#forecast-icon'),
    forecastLabel: $('#forecast-label'),
    forecastText: $('#forecast-text'),
    systems: $('#systems'),
    run: $('#run-btn'),
    runRow: $('#run-row'),
    hint: $('#run-hint'),
    log: $('#log'),
  };

  function buildSystems() {
    els.systems.innerHTML = '';
    for (const key of RES_KEYS) {
      const meta = RES[key];
      const card = document.createElement('div');
      card.className = 'system';
      card.dataset.key = key;
      card.innerHTML = `
        <div class="sys-head">
          <span class="sys-icon" aria-hidden="true">${meta.icon}</span>
          <span class="sys-name">${meta.name}</span>
          <span class="sys-hint">${meta.hint}</span>
          <span class="sys-value" id="val-${key}">100%</span>
        </div>
        <div class="meter" id="meter-${key}" role="progressbar"
             aria-label="${meta.name} level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
          <div class="meter-fill" id="bar-${key}"></div>
          <div class="meter-risk" aria-hidden="true"></div>
        </div>
        <div class="alloc">
          <button class="step" type="button" data-act="minus" data-key="${key}"
                  aria-label="Remove a power cell from ${meta.name}">−</button>
          <div class="cells" id="cells-${key}" aria-hidden="true"></div>
          <button class="step" type="button" data-act="plus" data-key="${key}"
                  aria-label="Add a power cell to ${meta.name}">+</button>
        </div>`;
      els.systems.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------ render */
  function totalAlloc() {
    return RES_KEYS.reduce((sum, k) => sum + state.alloc[k], 0);
  }

  function render() {
    const s = state;
    const sol = Math.min(s.sol, s.maxSols);
    const left = s.budget - totalAlloc();

    els.hudSol.textContent = `Sol ${sol} / ${s.maxSols}`;
    els.panelSol.textContent = `Sol ${sol} of ${s.maxSols}`;
    els.hudHearts.innerHTML = heartsHTML(s.hearts);
    els.hudHearts.setAttribute('aria-label', `Crew hearts: ${s.hearts} of 3`);
    els.hudHearts.setAttribute('role', 'img');

    els.cellsLeft.textContent = String(left);
    els.cellsLeft.classList.toggle('is-empty', left === 0);

    for (const key of RES_KEYS) {
      const v = Math.round(s.res[key]);
      const value = document.getElementById(`val-${key}`);
      value.textContent = `${v}%`;
      value.classList.toggle('is-low', v < CRITICAL);

      const meter = document.getElementById(`meter-${key}`);
      meter.setAttribute('aria-valuenow', String(v));

      const bar = document.getElementById(`bar-${key}`);
      bar.style.width = `${v}%`;
      bar.style.backgroundColor = v < CRITICAL ? '#ff4d6d' : RES[key].color;

      const cells = document.getElementById(`cells-${key}`);
      cells.innerHTML = '';
      for (let i = 0; i < s.budget; i++) {
        const cell = document.createElement('span');
        cell.className = 'cell' + (i < s.alloc[key] ? ' is-on' : '');
        cells.appendChild(cell);
      }

      const enabled = s.phase === 'alloc';
      for (const btn of els.systems.querySelectorAll(`[data-key="${key}"]`)) {
        if (btn.dataset.act === 'plus') {
          btn.disabled = !enabled || left <= 0 || s.alloc[key] >= s.budget;
        } else {
          btn.disabled = !enabled || s.alloc[key] <= 0;
        }
      }
    }

    const ready = left === 0 && s.phase === 'alloc';
    els.run.disabled = !ready;
    els.hint.textContent = left > 0
      ? `Spend ${left} more cell${left === 1 ? '' : 's'} to power the outpost.`
      : 'All cells spent — run the sol when you are ready.';
    els.hint.classList.toggle('is-ready', ready);

    const ev = EVENTS[s.eventKey];
    els.forecastIcon.textContent = ev.icon;
    els.forecastLabel.textContent = `Forecast · Sol ${sol}`;
    els.forecastText.innerHTML = ev.hint;
    els.forecast.dataset.tone = ev.tone || 'neutral';
  }

  function addLog(text, tone = 'info') {
    const li = document.createElement('li');
    li.className = `log-item log-${tone}`;
    li.innerHTML = text;
    els.log.appendChild(li);
    while (els.log.children.length > 40) els.log.removeChild(els.log.firstChild);
    els.log.scrollTop = els.log.scrollHeight;
  }

  /* ------------------------------------------------------------------- flow */
  function fitAlloc() {
    const s = state;
    for (const key of RES_KEYS) s.alloc[key] = Math.min(s.alloc[key], s.budget);
    while (totalAlloc() > s.budget) {
      let biggest = RES_KEYS[0];
      for (const key of RES_KEYS) if (s.alloc[key] > s.alloc[biggest]) biggest = key;
      s.alloc[biggest] -= 1;
    }
  }

  function beginSol(isFirst = false) {
    const s = state;
    s.budget = Math.max(2, BASE_BUDGET - s.penalty);
    s.penalty = 0;
    s.eventKey = s.schedule[s.sol - 1] || 'calm';
    s.fx = null;
    s.phase = 'alloc';
    fitAlloc();
    if (!isFirst) {
      addLog(`<b>Sol ${s.sol} begins.</b> ${s.budget} power cells available.`, 'muted');
    }
    render();
  }

  function startRun() {
    const s = state;
    s.runId += 1;
    s.phase = 'alloc';
    s.sol = 1;
    s.hearts = 3;
    s.res = { o2: START_RES, shield: START_RES, food: START_RES };
    s.alloc = { o2: 2, shield: 2, food: 2 };
    s.budget = BASE_BUDGET;
    s.penalty = 0;
    s.revived = false;
    s.fx = null;
    s.winAt = 0;
    s.schedule = buildSchedule();

    els.log.innerHTML = '';
    els.welcome.hidden = true;
    els.end.hidden = true;
    els.hud.hidden = false;
    els.panel.hidden = false;
    els.next.hidden = true;

    addLog('Mission start: <b>Shackleton Outpost</b>, lunar south pole. Survive 10 sols.', 'good');
    Sound.init();
    Sound.run();
    beginSol(true);
  }

  function tryRun() {
    if (state.phase !== 'alloc' || totalAlloc() !== state.budget) {
      els.runRow.classList.remove('shake');
      void els.runRow.offsetWidth; // restart the animation
      els.runRow.classList.add('shake');
      Sound.warn();
      return;
    }
    resolveSol();
  }

  function resolveSol() {
    const s = state;
    s.phase = 'resolving';
    const runId = s.runId;
    render();
    Sound.run();

    const sol = s.sol;
    const alloc = { ...s.alloc };

    // 1 — spend the power cells
    for (const key of RES_KEYS) {
      s.res[key] = clamp(s.res[key] + GAIN[key] * alloc[key]);
    }

    // 2 — daily wear (grows as the mission gets longer)
    const wear = {
      o2: BASE_DRAIN.o2 + Math.round(sol * 1.0),
      shield: BASE_DRAIN.shield + Math.round(sol * 0.8),
      food: BASE_DRAIN.food + Math.round(sol * 0.9),
    };
    for (const key of RES_KEYS) s.res[key] = clamp(s.res[key] - wear[key]);

    // 3 — the hazard
    const ev = EVENTS[s.eventKey];
    const lines = ev.apply(s) || [];
    for (const key of RES_KEYS) s.res[key] = clamp(s.res[key]);

    addLog(`<b>Sol ${sol} · ${ev.name}</b> — cells ${alloc.o2}/${alloc.shield}/${alloc.food}`, 'head');
    addLog(`Wear and tear: −${wear.o2} O₂ · −${wear.shield} shield · −${wear.food} food.`, 'muted');
    for (const line of lines) addLog(line.t, line.tone);

    // 4 — hearts
    const lows = RES_KEYS.filter((key) => s.res[key] < CRITICAL);
    if (lows.length && s.hearts > 0) {
      s.hearts -= 1;
      const names = lows.map((key) => `${RES[key].icon} ${RES[key].name}`).join(' and ');
      addLog(`⚠️ Critical: ${names} under ${CRITICAL}%. The crew loses a heart.`, 'bad');
      Sound.warn();
    }
    addLog(`Status → ${RES_KEYS.map((key) => `${RES[key].icon} ${Math.round(s.res[key])}%`).join(' · ')}`, 'muted');

    s.lastEvent = s.eventKey;
    setFx(s.eventKey);

    // 5 — outcome
    const stillCurrent = () => s.runId === runId;
    const empty = RES_KEYS.filter((key) => s.res[key] <= 0);
    if (empty.length) {
      const names = empty.map((key) => RES[key].name.toLowerCase()).join(' and ');
      setTimeout(() => { if (stillCurrent()) endMission('over', `The outpost ran out of ${names}.`); }, 950);
      return;
    }
    if (s.hearts <= 0) {
      setTimeout(() => { if (stillCurrent()) endMission('over', 'The crew is too exhausted to keep going.'); }, 950);
      return;
    }
    if (sol >= s.maxSols) {
      setTimeout(() => { if (stillCurrent()) endMission('win'); }, 950);
      return;
    }
    setTimeout(() => {
      if (!stillCurrent()) return;
      s.sol = sol + 1;
      beginSol();
    }, 950);
  }

  function endMission(kind, reason = '') {
    const s = state;
    s.phase = kind;
    els.hud.hidden = true;
    els.panel.hidden = true;
    els.end.hidden = false;

    if (kind === 'win') {
      s.winAt = performance.now() / 1000;
      els.endHearts.innerHTML = starsHTML(s.hearts);
      els.endHearts.setAttribute('aria-label', `Mission rating: ${s.hearts} of 3 stars`);
      els.endTitle.textContent = 'Level 1-1 Complete!';
      els.endSub.textContent = 'Shackleton Outpost survived all 10 sols.';
      els.endNote.textContent = `Crew hearts left: ${s.hearts} · Mars is next on the mission map.`;
      els.restart.textContent = 'Replay Level';
      els.revive.hidden = true;
      els.next.hidden = false;
      Sound.win();
    } else {
      els.endHearts.innerHTML = heartsHTML(0);
      els.endHearts.setAttribute('aria-label', 'Crew hearts: 0 of 3');
      els.endTitle.textContent = 'Game Over';
      els.endSub.textContent = 'You are lost in space...';
      els.endNote.textContent = reason || 'The outpost could not hold on.';
      els.restart.textContent = 'Restart';
      els.revive.hidden = s.revived;
      els.revive.disabled = s.revived;
      els.next.hidden = true;
      Sound.lose();
    }
  }

  function revive() {
    const s = state;
    if (s.revived || s.phase !== 'over') return;
    s.revived = true;
    s.hearts = 1;
    for (const key of RES_KEYS) s.res[key] = Math.max(s.res[key], 55);
    s.phase = 'alloc';

    els.end.hidden = true;
    els.hud.hidden = false;
    els.panel.hidden = false;

    addLog('🚑 <b>Revive!</b> NASA air-drops emergency supplies — every meter is back to at least 55%.', 'good');
    Sound.revive();
    render();
  }

  function goTitle() {
    const s = state;
    s.runId += 1;
    s.phase = 'title';
    s.sol = 1;
    s.hearts = 3;
    s.res = { o2: START_RES, shield: START_RES, food: START_RES };
    s.alloc = { o2: 2, shield: 2, food: 2 };
    s.budget = BASE_BUDGET;
    s.penalty = 0;
    s.fx = null;
    s.eventKey = 'calm';

    els.end.hidden = true;
    els.hud.hidden = true;
    els.panel.hidden = true;
    els.welcome.hidden = false;
    render();
  }

  /* ----------------------------------------------------------- canvas scene */
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.imageSmoothingEnabled = false;

  const COL = {
    star: '#dfe6ff',
    ground: '#98a1c4',
    groundTop: '#c9d0e9',
    groundDark: '#7b85ab',
    crater: '#6b7599',
    dome: '#e6ebfa',
    domeShade: '#b9c2df',
    domeLine: '#7f8ab0',
    glass: '#ffcf6b',
    metal: '#586187',
    panel: '#2b4f9c',
    panelLight: '#7fb2ff',
    accent: '#ffb02e',
    red: '#ff5d73',
  };

  // chibi astronaut, 16 × 19 pixels
  const ASTRONAUT = [
    '.....BBBBBB.....',
    '....BBwwwwBB....',
    '...BBwwwwwwBB...',
    '..BBwwwwwwwwBB..',
    '..BwwwwwwwwwwB..',
    '..BwBBBBBBBBwB..',
    '..BwBvvhhvvBwB..',
    '..BwBvvhvvvBwB..',
    '..BwBBBBBBBBwB..',
    '..BwwwwwwwwwwB..',
    '..BBwwwwwwwwBB..',
    '...BBwwwwwwBB...',
    '..BwwwwwwwwwwB..',
    '..BwBwwwwwwBwB..',
    '..BwBwwoowwBwB..',
    '..BbBwwwwwwBbB..',
    '..BBwwwwwwwwBB..',
    '...BBwwBBwwBB...',
    '....bbb..bbb....',
    '....ooo..ooo....',
  ];
  const SUIT = {
    B: '#0d1430', // outline
    w: '#f4f7ff', // suit
    v: '#101a3d', // visor
    h: '#7ad9ff', // visor shine
    b: '#2f6fe0', // blue accents
    o: '#ffb02e', // orange accents
    d: '#c3cbe8',
  };

  function drawSprite(rows, x, y, scale) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = SUIT[ch] || '#ff00ff';
        ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
      }
    }
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(20260214);
  const stars = Array.from({ length: 96 }, () => ({
    x: Math.floor(rand() * W),
    y: Math.floor(rand() * 124),
    s: rand() < 0.14 ? 2 : 1,
    p: rand() * Math.PI * 2,
  }));
  const rocks = [
    { x: 148, y: 140, w: 4, h: 2 },
    { x: 232, y: 150, w: 5, h: 3 },
    { x: 40, y: 156, w: 3, h: 2 },
    { x: 286, y: 142, w: 3, h: 2 },
    { x: 175, y: 166, w: 6, h: 3 },
  ];
  const craters = [
    { x: 62, y: 152, rx: 13, ry: 4 },
    { x: 252, y: 162, rx: 17, ry: 5 },
    { x: 160, y: 146, rx: 9, ry: 3 },
    { x: 118, y: 170, rx: 11, ry: 4 },
  ];
  const speckles = Array.from({ length: 70 }, () => ({
    x: Math.floor(rand() * W),
    y: 133 + Math.floor(rand() * 44),
    s: rand() < 0.18 ? 2 : 1,
  }));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setFx(type) {
    const map = {
      flare: 'flare', meteor: 'meteor', dust: 'dust', night: 'night',
      ice: 'sparkle', supply: 'sparkle',
    };
    state.fx = map[type] ? { type: map[type], t0: performance.now() / 1000 } : null;
  }

  function ellipse(x, y, rx, ry, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStars(time, night) {
    for (const star of stars) {
      const twinkle = reduceMotion ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(time * 0.9 + star.p));
      ctx.globalAlpha = (night ? 0.95 : 0.75) * twinkle;
      ctx.fillStyle = COL.star;
      ctx.fillRect(star.x, star.y, star.s, star.s);
    }
    ctx.globalAlpha = 1;
  }

  function drawSun(time) {
    const cx = 48;
    const cy = 30;

    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
    glow.addColorStop(0, 'rgba(255, 236, 170, .45)');
    glow.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();

    ellipse(cx, cy, 8, 8, '#ffe07a');
    ellipse(cx - 2, cy - 2, 3.5, 3.5, '#fff6cf');

    if (!reduceMotion) {
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(time * 2);
      ctx.fillStyle = '#ffe9a8';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + time * 0.4;
        ctx.fillRect(Math.round(cx + Math.cos(a) * 14), Math.round(cy + Math.sin(a) * 14), 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawEarth() {
    const cx = 258;
    const cy = 38;
    const r = 12;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#2f6fe0';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#5fd08a';
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - 2, 5, 4, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 5, cy + 5, 4, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf3ff';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy - 7, 6, 2, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0d1430';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawGround() {
    ctx.fillStyle = '#79839f';
    ellipse(42, 130, 72, 12);
    ellipse(202, 132, 92, 14);
    ellipse(298, 130, 62, 10);

    ctx.fillStyle = COL.ground;
    ctx.fillRect(0, 126, W, H - 126);
    ctx.fillStyle = COL.groundTop;
    ctx.fillRect(0, 126, W, 3);
    ctx.fillStyle = COL.groundDark;
    ctx.fillRect(0, 129, W, 2);

    for (const crater of craters) {
      ellipse(crater.x, crater.y, crater.rx, crater.ry, COL.crater);
      ctx.globalAlpha = 0.35;
      ellipse(crater.x, crater.y - 1, crater.rx * 0.7, crater.ry * 0.6, '#8b93b6');
      ctx.globalAlpha = 1;
    }

    for (const speck of speckles) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = speck.x % 2 ? '#a7b0cd' : '#8790b1';
      ctx.fillRect(speck.x, speck.y, speck.s, speck.s);
    }
    ctx.globalAlpha = 1;

    for (const rock of rocks) {
      ctx.fillStyle = COL.crater;
      ctx.fillRect(rock.x, rock.y, rock.w, rock.h);
      ctx.fillStyle = '#aab2cf';
      ctx.fillRect(rock.x, rock.y, rock.w, 1);
    }
  }

  function drawBase(time, night) {
    const cx = 96;
    const baseY = 130;

    // --- solar panels
    for (const panel of [{ x: 16, y: 112, w: 26, h: 11 }, { x: 46, y: 114, w: 22, h: 9 }]) {
      ctx.fillStyle = COL.metal;
      ctx.fillRect(panel.x + 2, panel.y + panel.h, 2, baseY - panel.y - panel.h);
      ctx.fillRect(panel.x + panel.w - 4, panel.y + panel.h, 2, baseY - panel.y - panel.h);
      ctx.fillStyle = COL.panel;
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
      ctx.strokeStyle = COL.panelLight;
      ctx.lineWidth = 1;
      ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);
      ctx.fillStyle = COL.panelLight;
      for (let i = 1; i < 3; i++) ctx.fillRect(panel.x, panel.y + (panel.h / 3) * i, panel.w, 1);
      for (let i = 1; i < 4; i++) ctx.fillRect(panel.x + (panel.w / 4) * i, panel.y, 1, panel.h);
    }

    // --- antenna
    ctx.strokeStyle = '#c3cbe8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + 26, baseY - 26);
    ctx.lineTo(cx + 30, baseY - 48);
    ctx.stroke();
    const blink = Math.sin(time * 3) > 0;
    ctx.fillStyle = blink ? COL.red : '#5a2a3a';
    ctx.fillRect(cx + 29, baseY - 51, 3, 3);

    // --- dome shell
    ctx.beginPath();
    ctx.moveTo(cx - 34, baseY);
    ctx.arc(cx, baseY, 34, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = COL.dome;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.fillStyle = COL.domeShade;
    ctx.fillRect(cx + 12, baseY - 40, 30, 40);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(cx - 24, baseY - 30, 9, 3);
    ctx.restore();

    ctx.lineWidth = 3;
    ctx.strokeStyle = COL.domeLine;
    ctx.beginPath();
    ctx.arc(cx, baseY, 34, Math.PI, 0);
    ctx.stroke();

    // --- windows
    const glow = night ? 0.55 : 0.22;
    ctx.globalAlpha = glow;
    ellipse(cx - 12, baseY - 17, 11, 9, COL.accent);
    ellipse(cx + 15, baseY - 13, 8, 7, COL.accent);
    ctx.globalAlpha = 1;
    ellipse(cx - 12, baseY - 17, 5, 5, night ? '#ffe6a5' : COL.glass);
    ellipse(cx + 15, baseY - 13, 3.5, 3.5, night ? '#ffe6a5' : COL.glass);

    // --- door
    ctx.beginPath();
    ctx.moveTo(cx - 7, baseY);
    ctx.lineTo(cx - 7, baseY - 9);
    ctx.arc(cx, baseY - 9, 7, Math.PI, 0);
    ctx.lineTo(cx + 7, baseY);
    ctx.closePath();
    ctx.fillStyle = '#2b3a6b';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4a5891';
    ctx.stroke();

    // --- foundation
    ctx.fillStyle = COL.metal;
    ctx.fillRect(cx - 40, baseY - 2, 80, 7);
    ctx.fillStyle = '#6c7599';
    ctx.fillRect(cx - 40, baseY - 2, 80, 2);
  }

  function drawAstronaut(time, night) {
    const scale = 3;
    const spriteW = ASTRONAUT[0].length * scale;
    const spriteH = ASTRONAUT.length * scale;
    const x = state.phase === 'title' ? 252 : state.phase === 'win' ? 246 : 182;
    const feetY = 132;
    const bob = reduceMotion ? 0 : Math.round(Math.sin(time * 2.2) * 1);
    const jump = state.phase === 'win' && !reduceMotion
      ? Math.abs(Math.sin(time * 3)) * 5
      : 0;

    ctx.globalAlpha = 0.28;
    ellipse(x + spriteW / 2, feetY + 1, 13, 3.5, '#2a3055');
    ctx.globalAlpha = 1;

    // little headlamp beam at night
    if (night) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.moveTo(x + spriteW, feetY - spriteH + 14);
      ctx.lineTo(x + spriteW + 30, feetY - spriteH + 4);
      ctx.lineTo(x + spriteW + 30, feetY - spriteH + 26);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawSprite(ASTRONAUT, x, feetY - spriteH + bob - jump, scale);
  }

  function drawFx(time, night) {
    const fx = state.fx;
    if (!fx) {
      if (night) dimNight();
      return;
    }
    const age = time - fx.t0;

    if (fx.type === 'flare' && age < 3.2) {
      ctx.globalAlpha = 0.1 + 0.06 * Math.sin(time * 6);
      ctx.fillStyle = '#ff9a3c';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,190,90,.7)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = 0.5 - i * 0.08;
        ctx.beginPath();
        ctx.arc(48, 30, 14 + i * 6 + (age * 6) % 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (fx.type === 'meteor') {
      if (age < 0.7) {
        const p = age / 0.7;
        const x0 = 66, y0 = 10, x1 = 178, y1 = 128;
        const x = x0 + (x1 - x0) * p;
        const y = y0 + (y1 - y0) * p;
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 12, y - 7);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = '#fff3c4';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      } else if (age < 1.6) {
        const p = (age - 0.7) / 0.9;
        ctx.globalAlpha = 1 - p;
        ellipse(178, 128, 4 + p * 10, 2 + p * 4, '#d8c48f');
        ctx.globalAlpha = 1;
      }
    }

    if (fx.type === 'dust' && age < 4) {
      ctx.fillStyle = 'rgba(216, 196, 143, .55)';
      for (let i = 0; i < 26; i++) {
        const px = ((i * 47 + age * 26) % (W + 20)) - 10;
        const py = 118 + ((i * 13) % 34) + Math.sin(time * 2 + i) * 2;
        ctx.fillRect(Math.round(px), Math.round(py), 2, 1);
      }
    }

    if (fx.type === 'sparkle' && age < 2.2) {
      const spots = [
        [96, 100], [80, 118], [114, 122], [210, 108], [228, 124],
      ];
      ctx.fillStyle = '#bff5ff';
      for (let i = 0; i < spots.length; i++) {
        const a = Math.max(0, 1 - age / 2.2) * (0.4 + 0.6 * Math.abs(Math.sin(time * 5 + i)));
        ctx.globalAlpha = a;
        const [sx, sy] = spots[i];
        ctx.fillRect(sx - 1, sy - 3, 2, 7);
        ctx.fillRect(sx - 3, sy - 1, 7, 2);
      }
      ctx.globalAlpha = 1;
    }

    if (night) dimNight();
  }

  function dimNight() {
    ctx.fillStyle = 'rgba(8, 12, 38, .3)';
    ctx.fillRect(0, 0, W, H);
    // dome light spill
    ctx.globalAlpha = 0.14;
    ellipse(96, 124, 46, 20, '#ffd27a');
    ctx.globalAlpha = 1;
  }

  function drawFloating(time) {
    const scale = 3;
    const x = W / 2;
    const y = 142 + Math.sin(time * 1.4) * 4;

    ctx.globalAlpha = 0.16;
    ellipse(x, y + 4, 30, 20, '#7fbdff');
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(time * 0.8) * 0.22);
    const cols = ASTRONAUT[0].length;
    drawSprite(ASTRONAUT, (-cols * scale) / 2, (-ASTRONAUT.length * scale) / 2, scale);
    ctx.restore();

    // tether drifting away
    ctx.strokeStyle = 'rgba(200, 214, 255, .35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 10);
    ctx.quadraticCurveTo(x + 40, y + 26 + Math.sin(time) * 4, x + 58, y + 12);
    ctx.stroke();
  }

  const confetti = Array.from({ length: 46 }, () => ({
    x: rand() * W,
    y: rand() * H,
    speed: 12 + rand() * 22,
    color: ['#ffb02e', '#7fbdff', '#7ce38b', '#ff4d6d', '#e6ebfa'][Math.floor(rand() * 5)],
  }));

  function drawConfetti(time) {
    const since = Math.min(6, Math.max(0, time - state.winAt));
    if (since > 6) return;
    for (const p of confetti) {
      const y = (p.y + time * p.speed) % (H + 10);
      const x = p.x + Math.sin(time * 2 + p.y) * 6;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawScene(time) {
    const s = state;
    const night = s.eventKey === 'night';

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, night ? '#03040f' : '#080b23');
    sky.addColorStop(0.6, night ? '#0a0f2c' : '#161a44');
    sky.addColorStop(1, night ? '#131838' : '#2a2456');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawStars(time, night);

    if (s.phase === 'over') {
      drawEarth();
      drawFloating(time);
      return;
    }

    if (!night) drawSun(time);
    drawEarth();
    drawGround();
    drawBase(time, night);
    drawAstronaut(time, night);
    drawFx(time, night);

    if (s.phase === 'win') drawConfetti(time);
  }

  function frame(now) {
    drawScene(now / 1000);
    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------------- inputs */
  els.systems.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled || state.phase !== 'alloc') return;

    const key = btn.dataset.key;
    if (btn.dataset.act === 'plus') {
      if (totalAlloc() < state.budget && state.alloc[key] < state.budget) {
        state.alloc[key] += 1;
        Sound.add();
      }
    } else if (state.alloc[key] > 0) {
      state.alloc[key] -= 1;
      Sound.remove();
    }
    render();
  });

  els.run.addEventListener('click', tryRun);

  $('#start-btn').addEventListener('click', () => {
    Sound.init();
    Sound.click();
    startRun();
  });

  els.restart.addEventListener('click', () => {
    Sound.click();
    startRun();
  });

  els.revive.addEventListener('click', () => {
    if (!els.revive.disabled) revive();
  });

  els.home.addEventListener('click', () => {
    Sound.click();
    goTitle();
  });

  els.sound.addEventListener('click', () => {
    const muted = Sound.toggle();
    els.sound.textContent = muted ? '🔇' : '🔊';
    els.sound.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    els.sound.title = muted ? 'Unmute sound' : 'Mute sound';
    if (!muted) Sound.click();
  });

  /* ----------------------------------------------------------------- modals */
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    Sound.click();
    const close = modal.querySelector('[data-close]');
    if (close) close.focus();
  }

  function closeModals() {
    for (const modal of document.querySelectorAll('.modal')) modal.hidden = true;
  }

  $('#how-btn').addEventListener('click', () => openModal('modal-how'));
  $('#science-btn').addEventListener('click', () => openModal('modal-science'));
  $('#science-btn-2').addEventListener('click', () => openModal('modal-science'));

  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', closeModals);
  }
  for (const modal of document.querySelectorAll('.modal')) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModals();
    });
  }

  document.addEventListener('keydown', (e) => {
    const modalOpen = document.querySelector('.modal:not([hidden])');

    if (e.key === 'Escape') {
      if (modalOpen) closeModals();
      return;
    }
    if (modalOpen) return;

    if (state.phase === 'title') {
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); startRun(); }
      return;
    }
    if (state.phase === 'over') {
      if (e.key === 'Enter' && !els.revive.hidden) revive();
      return;
    }
    if (state.phase === 'win') {
      if (e.key === 'Enter') startRun();
      return;
    }

    if (state.phase !== 'alloc') return;

    if (['1', '2', '3'].includes(e.key)) {
      const key = RES_KEYS[Number(e.key) - 1];
      if (e.shiftKey) {
        if (state.alloc[key] > 0) {
          state.alloc[key] -= 1;
          Sound.remove();
          render();
        }
      } else if (totalAlloc() < state.budget) {
        state.alloc[key] += 1;
        Sound.add();
        render();
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      tryRun();
    }
  });

  /* ------------------------------------------------------------------- init */
  buildSystems();
  els.sound.textContent = Sound.muted ? '🔇' : '🔊';
  els.sound.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
  els.hudHearts.innerHTML = heartsHTML(3);
  render();
  requestAnimationFrame(frame);

  // Handy for demos ("?play" jumps straight into the mission)
  const q = new URLSearchParams(location.search);
  if (q.has('play')) startRun();
  if (q.has('over')) { startRun(); setTimeout(() => endMission('over', 'The outpost ran out of oxygen.'), 60); }
  if (q.has('win')) { startRun(); state.hearts = 2; endMission('win'); }
  if (q.has('modal')) openModal(`modal-${q.get('modal')}`);
  if (q.has('debug')) {
    setTimeout(() => {
      const out = document.createElement('pre');
      out.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:999;margin:0;background:#000;color:#0f0;font:11px monospace;padding:6px;white-space:pre-wrap';
      const cw = document.documentElement.clientWidth;
      const bad = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > cw + 1)
        .map((el) => `${el.tagName}.${el.className} r=${Math.round(el.getBoundingClientRect().right)}`);
      out.textContent = `scrollW=${document.documentElement.scrollWidth} clientW=${cw}\n` + bad.slice(0, 14).join('\n');
      document.body.appendChild(out);
    }, 400);
  }
})();
