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
    o2: {
      name: 'Oxygen',
      icon: 'O₂',
      svg: '<svg class="px-ico" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect x="2" y="1" width="4" height="6" fill="#5ac8ff"/><rect x="3" y="0" width="2" height="1" fill="#eef2ff"/><rect x="3" y="2" width="1" height="3" fill="#b8ecff"/></svg>',
      color: '#5ac8ff',
    },
    shield: {
      name: 'Shielding',
      icon: 'Shield',
      svg: '<svg class="px-ico" viewBox="0 0 8 8" shape-rendering="crispEdges"><path d="M1 1h6v3L4 7 1 4z" fill="#ffb02e"/><rect x="2" y="2" width="2" height="2" fill="#ffe194"/></svg>',
      color: '#ffb02e',
    },
    food: {
      name: 'Food',
      icon: 'Food',
      svg: '<svg class="px-ico" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect x="3" y="4" width="2" height="4" fill="#7ce38b"/><rect x="1" y="2" width="3" height="2" fill="#7ce38b"/><rect x="4" y="1" width="3" height="2" fill="#a8f5b3"/></svg>',
      color: '#7ce38b',
    },
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
      name: 'Clear Skies', icon: '☀️', tone: 'good',
      hint: 'Clear skies. No hazards expected — a good sol to refill reserves.',
      apply() {
        return [{ t: 'Clear skies over Shackleton. The crew catches its breath.', tone: 'good' }];
      },
    },

    flare: {
      name: 'Solar Flare', icon: '⚡', tone: 'bad',
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
      name: 'Dust Storm', icon: '💨', tone: 'warn',
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
          <span class="sys-icon" aria-hidden="true">${meta.svg}</span>
          <span class="sys-name">${meta.name}</span>
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
          <span class="alloc-num" id="alloc-${key}" aria-hidden="true">0</span>
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
    els.hudHearts.innerHTML = heartsHTML(s.hearts);
    els.hudHearts.setAttribute('aria-label', `Crew hearts: ${s.hearts} of 3`);

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

      document.getElementById(`alloc-${key}`).textContent = String(s.alloc[key]);

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
      : 'Ready — run the sol!';
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
    els.log.prepend(li);
    while (els.log.children.length > 20) els.log.removeChild(els.log.lastChild);
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
      void els.runRow.offsetWidth;
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

    // 1 â€” spend the power cells
    for (const key of RES_KEYS) {
      s.res[key] = clamp(s.res[key] + GAIN[key] * alloc[key]);
    }

    // 2 â€” daily wear (grows as the mission gets longer)
    const wear = {
      o2: BASE_DRAIN.o2 + Math.round(sol * 1.0),
      shield: BASE_DRAIN.shield + Math.round(sol * 0.8),
      food: BASE_DRAIN.food + Math.round(sol * 0.9),
    };
    for (const key of RES_KEYS) s.res[key] = clamp(s.res[key] - wear[key]);

    // 3 â€” the hazard
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

    setFx(s.eventKey);

    // 5 â€” outcome
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

  /* ========================================================== pixel scene === */
  const canvas = $('#scene');
  const ctx = canvas.getContext('2d');
  let W = 384;
  let H = 216;
  let U = 1;
  let baseR = 30;
  let astroScale = 1;

  let stars = [];
  let craters = [];
  let boulders = [];
  let crystals = [];
  let dishes = [];
  let lockers = { x: 0, y: 0 };
  let tower = { x: 0, y: 0 };
  let probe = { x: 0, y: 0 };
  let miniBot = { x: 0, y: 0 };
  let yardLockers = { x: 0, y: 0 };

  let base = { x: 0, y: 0 };
  let cave = { x: 0, y: 0 };
  let astro = { x: 0, y: 0, facing: 1, moving: false, walkTime: 0, target: null };
  let rover = { x: 0, y: 0 };
  let dustPuffs = [];
  let lastFrameTime = 0;
  const keys = { up: false, down: false, left: false, right: false };

  let terrainCanvas = null;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SUIT = {
    k: '#111521', // ink outline
    w: '#f2f6ff', // suit highlight
    s: '#bcc6dc', // suit mid-tone
    d: '#7c87a3', // suit shadow
    b: '#464f66', // boot sole / dark trim
    v: '#1c3b3d', // visor dark teal
    t: '#2d5c58', // visor mid teal
    h: '#98f5eb', // visor cyan shine
    r: '#e6584c', // mission patch red
    u: '#3d7ef0', // mission patch blue
  };

  // 20x23 16-bit astronaut in 3/4 side view (facing right)
  const ASTRONAUT = [
    '......kkkkkk........',
    '....kkwwwwwwkk......',
    '...kwwwwwwwwwwk.....',
    '..ksswwwwwwwwwwk....',
    '..ksswwwwkkkksswk...',
    '.kksswwwkhhvvksswk..',
    '.kdsswwkhvvttvkwwk..',
    '.kdsswwkvvvttvkwwk..',
    '..ksswwwkttttkwwk...',
    '..kksswwwkkkkwwk....',
    '.kkkddsssssssskk....',
    'kbbksswwwwruuwwk....',
    'kbwksswwwrruuwwk....',
    'kbwksswwwwwwwwwwk...',
    'kbskddsswwwwssdwk...',
    'kbskkdddssssddkkk...',
    '.kkk.kwwwwkkwwk.....',
    '.....ksswk..ksswk...',
    '.....ksswk..ksswk...',
    '.....kddwk..kddwk...',
    '.....kbbbk..kbbbk...',
    '.....kkkkk..kkkkk...',
  ];

  const ASTRONAUT_WALK = [
    '......kkkkkk........',
    '....kkwwwwwwkk......',
    '...kwwwwwwwwwwk.....',
    '..ksswwwwwwwwwwk....',
    '..ksswwwwkkkksswk...',
    '.kksswwwkhhvvksswk..',
    '.kdsswwkhvvttvkwwk..',
    '.kdsswwkvvvttvkwwk..',
    '..ksswwwkttttkwwk...',
    '..kksswwwkkkkwwk....',
    '.kkkddsssssssskk....',
    'kbbksswwwwruuwwk....',
    'kbwksswwwrruuwwk....',
    'kbwksswwwwwwwwwwk...',
    'kbskddsswwwwssdwk...',
    'kbskkdddssssddkkk...',
    '.kkk.kwwwwkkwwk.....',
    '....ksswk...ksswk...',
    '...ksswk.....ksswk..',
    '...kddwk.....kddwk..',
    '...kbbbk.....kbbbk..',
    '...kkkkk.....kkkkk..',
  ];

  function drawSprite(rows, palette, x, y, scale, flipX = false) {
    const sx = Math.round(x);
    const sy = Math.round(y);
    const cols = rows[0].length;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < cols; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        const dc = flipX ? cols - 1 - c : c;
        ctx.fillStyle = palette[ch] || '#ff00ff';
        ctx.fillRect(sx + dc * scale, sy + r * scale, scale, scale);
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

  function px(c2d, x, y, w, h, color) {
    c2d.fillStyle = color;
    c2d.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function ellipse(x, y, rx, ry, color, target = ctx) {
    target.fillStyle = color;
    target.beginPath();
    target.ellipse(Math.round(x), Math.round(y), Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    target.fill();
  }

  /* --------------------------------------------------------------- layout --- */
  function resizeScene() {
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(320, window.innerHeight);
    const S = Math.min(5, Math.max(2, Math.round(Math.min(vw, vh) / 200)));

    W = Math.round(vw / S);
    H = Math.round(vh / S);
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;

    U = Math.max(0.75, Math.min(1.5, W / 380));
    baseR = Math.round(30 * U);
    astroScale = U >= 1.25 ? 2 : 1;

    buildLayout();
  }

  function buildLayout() {
    const rnd = mulberry32((W * 73856093) ^ (H * 19349663) ^ 0x9e3779b9);

    stars = Array.from({ length: 75 }, () => ({
      x: Math.floor(rnd() * W),
      y: Math.floor(rnd() * Math.max(24, H * 0.32)),
      s: rnd() < 0.14 ? 2 : 1,
      p: rnd() * Math.PI * 2,
    }));

    craters = [
      { x: W * 0.14, y: H * 0.28, r: 12 * U, dark: false },
      { x: W * 0.44, y: H * 0.19, r: 7 * U, dark: false },
      { x: W * 0.08, y: H * 0.62, r: 11 * U, dark: false },
      { x: W * 0.18, y: H * 0.85, r: 8 * U, dark: false },
      { x: W * 0.93, y: H * 0.56, r: 10 * U, dark: true },
      { x: W * 0.90, y: H * 0.72, r: 10 * U, dark: true },
    ];

    boulders = [
      { x: W * 0.72, y: H * 0.30, r: 7.5 * U },
      { x: W * 0.77, y: H * 0.17, r: 4.5 * U },
      { x: W * 0.58, y: H * 0.12, r: 3.5 * U },
      { x: W * 0.31, y: H * 0.21, r: 3 * U },
      { x: W * 0.35, y: H * 0.60, r: 5.5 * U },
      { x: W * 0.91, y: H * 0.31, r: 3.5 * U },
    ];

    crystals = [
      { x: W * 0.67, y: H * 0.25, s: 6.5 * U, c1: '#5cf0d8', c2: '#b678ff', c3: '#ff9468' },
      { x: W * 0.73, y: H * 0.43, s: 7 * U, c1: '#6ef5d8', c2: '#75b8ff', c3: '#c48bff' },
      { x: W * 0.85, y: H * 0.45, s: 6 * U, c1: '#b87cff', c2: '#63e8d8', c3: '#ff8da1' },
      { x: W * 0.88, y: H * 0.61, s: 6 * U, c1: '#5be6a8', c2: '#c580ff', c3: '#ffd178' },
    ];

    dishes = [
      { x: W * 0.84, y: H * 0.25, r: 9.5 * U, a: -0.45 },
      { x: W * 0.90, y: H * 0.10, r: 6.5 * U, a: -0.55 },
    ];

    lockers = { x: W * 0.03, y: H * 0.44 };
    rover = { x: W * 0.14, y: H * 0.52 };
    cave = { x: W * 0.40, y: H * 0.42 };
    astro.x = W * 0.48;
    astro.y = H * 0.48;
    astro.target = null;
    tower = { x: W * 0.66, y: H * 0.18 };
    probe = { x: W * 0.95, y: H * 0.40 };
    base = { x: W * 0.57, y: H * 0.59 };
    miniBot = { x: base.x + baseR * 1.45, y: base.y + baseR * 0.25 };
    yardLockers = { x: base.x + baseR * 2.15, y: base.y + baseR * 0.12 };

    buildTerrainCache(rnd);
  }

  function buildTerrainCache(rnd) {
    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = W;
    terrainCanvas.height = H;
    const tctx = terrainCanvas.getContext('2d');
    tctx.imageSmoothingEnabled = false;

    // Horizon line (space at top & top-right)
    const horizon = [];
    for (let x = 0; x <= W; x += 4) {
      let y = H * 0.06;
      if (x > W * 0.72) {
        y += ((x - W * 0.72) / (W * 0.28)) * H * 0.10;
      }
      if (x > W * 0.86) {
        y += ((x - W * 0.86) / (W * 0.14)) * H * 0.18;
      }
      y += Math.round((rnd() - 0.5) * 4);
      horizon.push([x, Math.max(4, Math.round(y))]);
    }

    // Cliff boundary separating upper-left pale regolith from lower-right dark basalt
    // Matches the stepped L-shaped ridge + cave wall in the reference
    const cliffPts = [
      [Math.round(W * 0.33), 0],
      [Math.round(W * 0.36), Math.round(H * 0.11)],
      [Math.round(W * 0.58), Math.round(H * 0.13)],
      [Math.round(W * 0.61), Math.round(H * 0.30)],
      [Math.round(W * 0.32), Math.round(H * 0.33)],
      [Math.round(W * 0.29), Math.round(H * 0.62)],
      [Math.round(W * 0.26), Math.round(H * 0.85)],
      [Math.round(W * 0.24), H],
    ];

    // Subdivide cliff points with pixel jitter for organic rock edge
    const ridge = [];
    for (let i = 0; i < cliffPts.length - 1; i++) {
      const [x1, y1] = cliffPts[i];
      const [x2, y2] = cliffPts[i + 1];
      const steps = Math.max(3, Math.round(Math.hypot(x2 - x1, y2 - y1) / 6));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const jx = Math.round((rnd() - 0.5) * 5);
        const jy = Math.round((rnd() - 0.5) * 3);
        ridge.push([Math.round(x1 + (x2 - x1) * t + jx), Math.round(y1 + (y2 - y1) * t + jy)]);
      }
    }
    ridge.push(cliffPts[cliffPts.length - 1]);

    // Clip to lunar surface below horizon
    tctx.save();
    tctx.beginPath();
    tctx.moveTo(0, horizon[0][1]);
    for (const [hx, hy] of horizon) tctx.lineTo(hx, hy);
    tctx.lineTo(W, H);
    tctx.lineTo(0, H);
    tctx.closePath();
    tctx.clip();

    // 1. Dark basalt base (right/lower)
    tctx.fillStyle = '#292e3e';
    tctx.fillRect(0, 0, W, H);

    // Basalt pixel dithering & pebbles
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const n = rnd();
        if (n < 0.22) {
          tctx.fillStyle = '#222634';
          tctx.fillRect(x, y, 2, 2);
        } else if (n < 0.36) {
          tctx.fillStyle = '#33394c';
          tctx.fillRect(x, y, 2, 1);
        } else if (n > 0.985) {
          tctx.fillStyle = '#474f66';
          tctx.fillRect(x, y, 2, 2);
        }
      }
    }

    // 2. Vertical striated cliff wall face under the upper plateau
    const cliffHeight = Math.round(28 * U);
    tctx.fillStyle = '#1b1f2d';
    tctx.beginPath();
    tctx.moveTo(ridge[0][0], ridge[0][1]);
    for (const [rx, ry] of ridge) tctx.lineTo(rx, ry);
    for (let i = ridge.length - 1; i >= 0; i--) {
      tctx.lineTo(ridge[i][0], ridge[i][1] + cliffHeight);
    }
    tctx.closePath();
    tctx.fill();

    // Striated rock cracks on cliff face
    for (let i = 0; i < ridge.length; i++) {
      const [rx, ry] = ridge[i];
      if (ry < H * 0.12 || ry > H * 0.65) continue;
      const col = i % 2 === 0 ? '#2b3145' : '#131622';
      const ch = Math.round(cliffHeight * (0.6 + rnd() * 0.4));
      px(tctx, rx, ry + 2, 2, ch, col);
      if (rnd() < 0.45) px(tctx, rx + 2, ry + 4, 1, ch * 0.6, '#394058');
    }

    // 3. Pale regolith plateau (left/upper-left)
    tctx.save();
    tctx.beginPath();
    tctx.moveTo(0, 0);
    tctx.lineTo(ridge[0][0], 0);
    for (const [rx, ry] of ridge) tctx.lineTo(rx, ry);
    tctx.lineTo(0, H);
    tctx.closePath();
    tctx.clip();

    tctx.fillStyle = '#7c8296';
    tctx.fillRect(0, 0, W, H);

    // Regolith pixel dithering & micro-pebbles
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const n = rnd();
        if (n < 0.24) {
          tctx.fillStyle = '#8b92a6';
          tctx.fillRect(x, y, 2, 2);
        } else if (n < 0.40) {
          tctx.fillStyle = '#6c7285';
          tctx.fillRect(x, y, 2, 1);
        } else if (n > 0.985) {
          tctx.fillStyle = '#a2a9bd';
          tctx.fillRect(x, y, 2, 1);
        }
      }
    }

    // Subtle dark corner outcrop at bottom-left like reference
    tctx.fillStyle = '#252938';
    tctx.beginPath();
    tctx.moveTo(0, H * 0.88);
    tctx.lineTo(W * 0.09, H * 0.90);
    tctx.lineTo(W * 0.13, H);
    tctx.lineTo(0, H);
    tctx.closePath();
    tctx.fill();

    tctx.restore();

    // Dark ink outline along cliff rim
    tctx.strokeStyle = '#101420';
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.moveTo(ridge[0][0], ridge[0][1]);
    for (const [rx, ry] of ridge) tctx.lineTo(rx, ry);
    tctx.stroke();

    // Rim highlight on pale regolith edge
    tctx.strokeStyle = '#9ea5b8';
    tctx.lineWidth = 1;
    tctx.beginPath();
    for (let i = 0; i < ridge.length; i++) {
      const [rx, ry] = ridge[i];
      if (i === 0) tctx.moveTo(rx - 1, ry - 1);
      else tctx.lineTo(rx - 1, ry - 1);
    }
    tctx.stroke();

    // 4. Cave mouth carved into the cliff wall
    drawCaveMouth(tctx, cave.x, cave.y, 18 * U);

    // 5. Craters baked into terrain
    for (const c of craters) drawPixelCrater(tctx, c);

    // 6. Horizon dark ink rim
    tctx.strokeStyle = '#121624';
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.moveTo(horizon[0][0], horizon[0][1]);
    for (const [hx, hy] of horizon) tctx.lineTo(hx, hy);
    tctx.stroke();

    tctx.restore();
  }

  function drawCaveMouth(tctx, x, y, r) {
    // Dark rock arch around cave
    tctx.fillStyle = '#1c202e';
    tctx.beginPath();
    tctx.moveTo(x - r * 1.15, y + r * 0.7);
    tctx.quadraticCurveTo(x - r * 1.05, y - r * 0.95, x, y - r * 0.95);
    tctx.quadraticCurveTo(x + r * 1.05, y - r * 0.95, x + r * 1.15, y + r * 0.7);
    tctx.closePath();
    tctx.fill();

    // Pitch-black cave interior
    tctx.fillStyle = '#07080e';
    tctx.beginPath();
    tctx.moveTo(x - r * 0.72, y + r * 0.72);
    tctx.quadraticCurveTo(x - r * 0.74, y - r * 0.58, x, y - r * 0.58);
    tctx.quadraticCurveTo(x + r * 0.74, y - r * 0.58, x + r * 0.72, y + r * 0.72);
    tctx.closePath();
    tctx.fill();

    // Pixelated rock teeth along arch rim
    tctx.fillStyle = '#2d3347';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      const rx = Math.round(x + Math.cos(a) * r * 0.85);
      const ry = Math.round(y + Math.sin(a) * r * 0.72);
      tctx.fillRect(rx - 1, ry - 1, 3, 2);
    }
  }

  function drawPixelCrater(tctx, c) {
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    const rx = Math.round(c.r);
    const ry = Math.round(c.r * 0.65);

    const outerRim = c.dark ? '#3f465c' : '#9aa1b5';
    const pit = c.dark ? '#1d212e' : '#585e70';
    const deep = c.dark ? '#121520' : '#3a3f4f';
    const ink = '#151926';

    // Outer bottom-right rim highlight
    ellipse(x + 1, y + 1, rx + 1, ry + 1, outerRim, tctx);
    // Dark ink edge
    ellipse(x, y, rx, ry, ink, tctx);
    // Crater floor
    ellipse(x, y + 1, rx - 1, ry - 1, pit, tctx);
    // Deep inner shadow crescent (upper-left)
    ellipse(x - 1, y - ry * 0.18, rx * 0.78, ry * 0.55, deep, tctx);
  }

  /* --------------------------------------------------------------- helpers -- */
  function drawSpace(time, night) {
    px(ctx, 0, 0, W, H, night ? '#03040a' : '#05070e');

    for (const star of stars) {
      const tw = reduceMotion ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(time * 0.9 + star.p));
      ctx.globalAlpha = 0.45 + 0.55 * tw;
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(star.x, star.y, star.s, star.s);
    }
    ctx.globalAlpha = 1;
  }

  function drawEarth(x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2f6fe0';
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#5fd08a';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.2, r * 0.45, r * 0.34, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + r * 0.35, y + r * 0.42, r * 0.32, r * 0.24, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf3ff';
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x - r * 0.6, y - r * 0.55, r * 1.1, r * 0.16);
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0d1430';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawBoulder(b) {
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    const r = Math.round(b.r);

    // Ground shadow
    ellipse(x + 1, y + r * 0.4, r * 1.1, r * 0.55, 'rgba(10,12,20,.55)');
    // Dark outline
    ellipse(x, y, r + 1, r * 0.8 + 1, '#121622');
    // Shadowed rock body
    ellipse(x, y, r, r * 0.8, '#4a5064');
    // Mid-tone facet
    ellipse(x - r * 0.15, y - r * 0.18, r * 0.75, r * 0.56, '#697086');
    // Highlight facet
    ellipse(x - r * 0.25, y - r * 0.3, r * 0.4, r * 0.26, '#8b92a8');
  }

  function drawCrystalShard(x, y, w, h, color) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    // Dark outline
    ctx.fillStyle = '#111521';
    ctx.beginPath();
    ctx.moveTo(ix, iy - h - 1);
    ctx.lineTo(ix + w + 1, iy - h * 0.2);
    ctx.lineTo(ix + 1, iy + 2);
    ctx.lineTo(ix - w - 1, iy - h * 0.2);
    ctx.closePath();
    ctx.fill();

    // Main crystal fill
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ix, iy - h);
    ctx.lineTo(ix + w, iy - h * 0.2);
    ctx.lineTo(ix, iy + 1);
    ctx.lineTo(ix - w, iy - h * 0.2);
    ctx.closePath();
    ctx.fill();

    // Bright left-facet highlight
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(ix - Math.max(1, Math.round(w * 0.4)), Math.round(iy - h * 0.75), 1, Math.max(2, Math.round(h * 0.5)));
  }

  function drawCrystalCluster(c, time, night) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + c.x * 0.08);
    ctx.globalAlpha = (night ? 0.34 : 0.18) + pulse * 0.1;
    ellipse(c.x, c.y, c.s * 1.4, c.s * 0.65, c.c1);
    ctx.globalAlpha = 1;

    ellipse(c.x, c.y + 1, c.s * 0.9, c.s * 0.3, '#111521');

    drawCrystalShard(c.x - c.s * 0.55, c.y, c.s * 0.28, c.s * 0.95, c.c2);
    drawCrystalShard(c.x + c.s * 0.55, c.y, c.s * 0.28, c.s * 0.85, c.c3);
    drawCrystalShard(c.x, c.y + 1, c.s * 0.34, c.s * 1.35, c.c1);
  }

  function drawLockers(x, y, s, amberFirst = true) {
    const w = Math.round(9 * s);
    const h = Math.round(16 * s);
    const gap = Math.round(2 * s);

    for (let i = 0; i < 2; i++) {
      const lx = Math.round(x + i * (w + gap));
      const ly = Math.round(y - h);
      // Shadow
      px(ctx, lx + 1, y - 1, w, 3, 'rgba(10,12,20,.55)');
      // Outline
      px(ctx, lx - 1, ly - 1, w + 2, h + 2, '#111521');
      // Body
      px(ctx, lx, ly, w, h, i === 0 ? '#8c94aa' : '#767f96');
      // Top bevel
      px(ctx, lx, ly, w, 2, '#b4bdd4');
      // Screen / panel
      const screenCol = (i === 0) === amberFirst ? '#e8b448' : '#58c8d8';
      px(ctx, lx + 2, ly + 3, w - 4, Math.round(h * 0.32), '#1a2030');
      px(ctx, lx + 3, ly + 4, w - 6, Math.round(h * 0.25), screenCol);
      // Vent slats
      px(ctx, lx + 2, ly + Math.round(h * 0.6), w - 4, 1, '#394054');
      px(ctx, lx + 2, ly + Math.round(h * 0.72), w - 4, 1, '#394054');
      // Status LED
      px(ctx, lx + 2, ly + Math.round(h * 0.85), 2, 1, i === 0 ? '#7ce38b' : '#ffb02e');
    }
  }

  function drawRover(x, y, s) {
    const ix = Math.round(x);
    const iy = Math.round(y);

    // Shadow
    ellipse(ix, iy + 5 * s, 10 * s, 3 * s, 'rgba(10,12,20,.5)');

    // Chassis outline
    px(ctx, ix - 9 * s, iy - 4 * s, 18 * s, 7 * s, '#111521');
    // Cargo pack (orange/gold on back-left)
    px(ctx, ix - 8 * s, iy - 6 * s, 6 * s, 4 * s, '#111521');
    px(ctx, ix - 7 * s, iy - 5 * s, 4 * s, 3 * s, '#d98834');
    px(ctx, ix - 7 * s, iy - 5 * s, 4 * s, 1 * s, '#ffbc5e');

    // Main body (white/grey)
    px(ctx, ix - 8 * s, iy - 3 * s, 16 * s, 5 * s, '#cfd6e6');
    px(ctx, ix - 8 * s, iy + 1 * s, 16 * s, 1 * s, '#80889e');
    // Red NASA stripe
    px(ctx, ix - 2 * s, iy - 1 * s, 5 * s, 1 * s, '#e6584c');

    // Camera mast (front-right)
    px(ctx, ix + 3 * s, iy - 9 * s, 2 * s, 6 * s, '#111521');
    px(ctx, ix + 3.5 * s, iy - 8 * s, 1 * s, 5 * s, '#b4bdd4');
    px(ctx, ix + 2 * s, iy - 10 * s, 4 * s, 3 * s, '#111521');
    px(ctx, ix + 3 * s, iy - 9 * s, 2 * s, 1.5 * s, '#7ce3ff');

    // Wheels (4 chunky pixel wheels)
    for (const wx of [ix - 6 * s, ix + 3 * s]) {
      px(ctx, wx - 1, iy + 1 * s, 4 * s + 2, 4 * s + 1, '#111521');
      px(ctx, wx, iy + 2 * s, 4 * s, 3 * s, '#363c4f');
      px(ctx, wx + 1 * s, iy + 2.5 * s, 2 * s, 2 * s, '#8c94aa');
    }
  }

  function drawCommsTower(x, y, s, time) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const h = Math.round(28 * s);

    ellipse(ix, iy + 2, 8 * s, 3 * s, 'rgba(10,12,20,.55)');

    // Base & legs
    px(ctx, ix - 5 * s, iy - 6 * s, 10 * s, 6 * s, '#111521');
    px(ctx, ix - 4 * s, iy - 5 * s, 8 * s, 5 * s, '#6d758c');
    px(ctx, ix - 2 * s, iy - 16 * s, 4 * s, 11 * s, '#111521');
    px(ctx, ix - 1 * s, iy - 15 * s, 2 * s, 10 * s, '#9da6bd');

    // Green status lights on base
    px(ctx, ix - 1 * s, iy - 4 * s, 2 * s, 1 * s, '#7ce38b');
    if (Math.sin(time * 4) > 0) {
      px(ctx, ix - 1 * s, iy - 9 * s, 2 * s, 1 * s, '#7ce38b');
    }

    // Curved lattice dish array at top
    ctx.strokeStyle = '#111521';
    ctx.lineWidth = Math.max(2, Math.round(2 * s));
    ctx.beginPath();
    ctx.arc(ix, iy - h + 8 * s, 8 * s, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    ctx.strokeStyle = '#b4bdd4';
    ctx.lineWidth = Math.max(1, Math.round(s));
    ctx.beginPath();
    ctx.arc(ix, iy - h + 8 * s, 8 * s, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    // Central spire
    px(ctx, ix - 1, iy - h - 2 * s, 2, 14 * s, '#cfd6e6');
  }

  function drawDish(d, time) {
    const angle = d.a + (reduceMotion ? 0 : Math.sin(time * 0.5 + d.x * 0.02) * 0.12);
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    const r = d.r;

    ellipse(x, y + r * 1.4, r * 0.8, r * 0.35, 'rgba(10,12,20,.55)');

    // Tripod legs with dark outline
    ctx.strokeStyle = '#111521';
    ctx.lineWidth = Math.max(2, Math.round(2 * U));
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x - r * 0.65, y + r * 1.4);
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x + r * 0.65, y + r * 1.4);
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x, y + r * 1.5);
    ctx.stroke();

    ctx.strokeStyle = '#8b93aa';
    ctx.lineWidth = Math.max(1, Math.round(U));
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x - r * 0.65, y + r * 1.4);
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x + r * 0.65, y + r * 1.4);
    ctx.stroke();

    // Dish head
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ellipse(0, 0, r + 1, r * 0.56 + 1, '#111521');
    ellipse(0, 0, r, r * 0.56, '#b8c0d4');
    ellipse(0, r * 0.08, r * 0.72, r * 0.34, '#70788f');
    px(ctx, -1, -r * 0.1, 2, r * 0.65, '#464d61');
    px(ctx, -1, -r * 0.18, 2, 2, '#6fe3ff');
    ctx.restore();
  }

  function drawProbeBot(x, y, s, time) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    ellipse(ix, iy + 3 * s, 7 * s, 2.5 * s, 'rgba(10,12,20,.55)');
    px(ctx, ix - 5 * s, iy - 6 * s, 10 * s, 8 * s, '#111521');
    px(ctx, ix - 4 * s, iy - 5 * s, 8 * s, 6 * s, '#b8c2d8');
    px(ctx, ix - 4 * s, iy - 1 * s, 8 * s, 2 * s, '#6c758c');
    // Antenna
    px(ctx, ix + 1 * s, iy - 10 * s, 2 * s, 4 * s, '#111521');
    px(ctx, ix + 1.5 * s, iy - 10 * s, 1 * s, 4 * s, '#dce3f2');
    // Green sensor eye
    if (Math.sin(time * 3) > -0.4) {
      px(ctx, ix - 2 * s, iy - 4 * s, 3 * s, 2 * s, '#7ce38b');
    }
  }

  function drawMiniBot(x, y, s) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    ellipse(ix, iy + 3 * s, 6 * s, 2 * s, 'rgba(10,12,20,.55)');
    px(ctx, ix - 5 * s, iy - 4 * s, 10 * s, 6 * s, '#111521');
    px(ctx, ix - 4 * s, iy - 3 * s, 8 * s, 4 * s, '#aeb7cc');
    px(ctx, ix - 5 * s, iy + 1 * s, 10 * s, 2 * s, '#363c4f');
    px(ctx, ix - 2 * s, iy - 7 * s, 2 * s, 4 * s, '#7c859c');
  }

  function drawYard(x, y, w, h) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const iw = Math.round(w);
    const ih = Math.round(h);

    // Fence dark outline + metallic rails
    ctx.strokeStyle = '#111521';
    ctx.lineWidth = Math.max(2, Math.round(2.5 * U));
    ctx.strokeRect(ix, iy, iw, ih);

    ctx.strokeStyle = '#7c859c';
    ctx.lineWidth = Math.max(1, Math.round(U));
    ctx.strokeRect(ix, iy, iw, ih);

    // Fence posts along top & bottom
    const posts = 6;
    for (let i = 0; i < posts; i++) {
      const postX = Math.round(ix + (iw / (posts - 1)) * i);
      px(ctx, postX - 2, iy - 3, 4, 6, '#111521');
      px(ctx, postX - 1, iy - 2, 2, 4, '#b4bdd4');
      px(ctx, postX - 2, iy + ih - 3, 4, 6, '#111521');
      px(ctx, postX - 1, iy + ih - 2, 2, 4, '#b4bdd4');
    }
  }

  function drawBase(time, night) {
    const x = Math.round(base.x);
    const y = Math.round(base.y);
    const r = baseR;

    // Fenced yard extending left & right around the habitat
    drawYard(x - r * 1.45, y - r * 0.48, r * 4.1, r * 1.15);

    // Side airlock module on the left of the dome
    const ax = Math.round(x - r * 1.28);
    const ay = Math.round(y - r * 0.42);
    const aw = Math.round(r * 0.72);
    const ah = Math.round(r * 0.85);
    px(ctx, ax - 1, ay - 1, aw + 2, ah + 2, '#111521');
    px(ctx, ax, ay, aw, ah, '#6b748c');
    px(ctx, ax, ay, aw, Math.round(ah * 0.35), '#8c96b0');
    // Ribbed roof lines & side pipes
    for (let i = 1; i <= 3; i++) {
      px(ctx, ax + Math.round((aw / 4) * i), ay, 1, ah, '#3a4154');
    }
    px(ctx, ax + 3, ay + ah - 2, 3, 6, '#50586e');
    px(ctx, ax + 8, ay + ah - 2, 3, 6, '#50586e');

    // Ground shadow under dome
    ellipse(x + 2, y + r * 0.32, r * 1.15, r * 0.55, 'rgba(10,12,20,.65)');

    // 3/4 Perspective Geodesic Dome
    // Outer ink outline
    ctx.fillStyle = '#111521';
    ctx.beginPath();
    ctx.arc(x, y + r * 0.05, r + 2, Math.PI, 0);
    ctx.lineTo(x + r + 2, y + r * 0.45);
    ctx.lineTo(x - r - 2, y + r * 0.45);
    ctx.closePath();
    ctx.fill();

    // Dome shell
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y + r * 0.05, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r * 0.42);
    ctx.lineTo(x - r, y + r * 0.42);
    ctx.closePath();
    ctx.fillStyle = '#7e88a1';
    ctx.fill();
    ctx.clip();

    // Upper-left lit dome highlight band
    ellipse(x - r * 0.25, y - r * 0.35, r * 0.7, r * 0.55, '#9ea8c2');
    // Lower wall band
    px(ctx, x - r, y + r * 0.06, r * 2, r * 0.4, '#5a637a');

    // Curved geodesic ribs & horizontal seams
    ctx.strokeStyle = '#252b3d';
    ctx.lineWidth = 1;
    for (const frac of [-0.55, -0.25, 0.25, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(x + frac * r * 0.4, y - r);
      ctx.quadraticCurveTo(x + frac * r * 1.1, y - r * 0.2, x + frac * r, y + r * 0.42);
      ctx.stroke();
    }
    px(ctx, x - r, y - r * 0.38, r * 2, 1, '#252b3d');
    px(ctx, x - r, y + r * 0.05, r * 2, 1, '#252b3d');
    ctx.restore();

    // Arched front double-door
    const dw = Math.round(r * 0.46);
    const dh = Math.round(r * 0.44);
    const dx = Math.round(x - dw / 2);
    const dy = Math.round(y + r * 0.42 - dh);
    px(ctx, dx - 1, dy - 1, dw + 2, dh + 1, '#111521');
    px(ctx, dx, dy, dw, dh, '#4a5268');
    px(ctx, dx + Math.floor(dw / 2), dy + 2, 1, dh - 2, '#1d2230');

    // Cyan/teal status strip above door
    px(ctx, dx + 1, dy - 5, dw - 2, 3, '#111521');
    px(ctx, dx + 2, dy - 4, dw - 4, 2, night ? '#7fffe8' : '#52d6c4');

    // Warm amber porthole slits on left & right walls
    const glowCol = night ? '#ffd26a' : '#e69b3a';
    px(ctx, x - r * 0.65, y + r * 0.14, 5, 2, '#111521');
    px(ctx, x - r * 0.65 + 1, y + r * 0.14, 3, 1, glowCol);
    px(ctx, x + r * 0.48, y + r * 0.14, 5, 2, '#111521');
    px(ctx, x + r * 0.48 + 1, y + r * 0.14, 3, 1, glowCol);

    // Blinking beacon LED
    if (Math.sin(time * 3) > 0) {
      px(ctx, x + r * 0.55, y + r * 0.28, 2, 2, '#7ce38b');
    }
  }

  function updateAstronaut(dt) {
    if (state.phase === 'over') return;

    let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      astro.target = null;
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
    } else if (astro.target) {
      const tx = astro.target.x - astro.x;
      const ty = astro.target.y - astro.y;
      const dist = Math.hypot(tx, ty);
      if (dist < 3 * U) {
        astro.target = null;
      } else {
        dx = tx / dist;
        dy = ty / dist;
      }
    }

    astro.moving = dx !== 0 || dy !== 0;
    if (astro.moving) {
      const speed = 48 * U;
      astro.x += dx * speed * dt;
      astro.y += dy * speed * dt;
      if (Math.abs(dx) > 0.08) astro.facing = dx > 0 ? 1 : -1;

      astro.x = clamp(astro.x, 12 * U, W - 12 * U);
      astro.y = clamp(astro.y, H * 0.22, H - 10 * U);

      // Push out of the solid habitat dome
      const ddx = astro.x - base.x;
      const ddy = astro.y - (base.y + baseR * 0.15);
      const minRx = baseR * 1.15;
      const minRy = baseR * 0.65;
      const norm = (ddx * ddx) / (minRx * minRx) + (ddy * ddy) / (minRy * minRy);
      if (norm < 1 && norm > 0.0001) {
        const push = 1 / Math.sqrt(norm);
        astro.x = base.x + ddx * push;
        astro.y = base.y + baseR * 0.15 + ddy * push;
      }

      const prevStep = Math.floor(astro.walkTime / 0.16);
      astro.walkTime += dt;
      const curStep = Math.floor(astro.walkTime / 0.16);
      if (curStep !== prevStep) {
        dustPuffs.push({ x: astro.x - astro.facing * 2 * U, y: astro.y, life: 0.45 });
        if (dustPuffs.length > 16) dustPuffs.shift();
      }
    }

    for (let i = dustPuffs.length - 1; i >= 0; i--) {
      dustPuffs[i].life -= dt;
      if (dustPuffs[i].life <= 0) dustPuffs.splice(i, 1);
    }
  }

  function drawAstronaut(time, night) {
    const scale = astroScale;
    const stride = astro.moving && Math.floor(astro.walkTime / 0.16) % 2 === 1;
    const sprite = stride ? ASTRONAUT_WALK : ASTRONAUT;
    const w = sprite[0].length * scale;
    const h = sprite.length * scale;
    const bob = reduceMotion ? 0 : astro.moving ? (stride ? -1 : 0) : Math.round(Math.sin(time * 2.2));
    const jump = state.phase === 'win' && !reduceMotion ? Math.abs(Math.sin(time * 3)) * 5 * U : 0;

    for (const puff of dustPuffs) {
      ctx.globalAlpha = Math.max(0, puff.life * 1.4);
      px(ctx, puff.x - 1, puff.y - 1, 3, 2, '#9ea5b8');
    }
    ctx.globalAlpha = 1;

    if (astro.target && state.phase !== 'over') {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 6);
      px(ctx, astro.target.x - 2, astro.target.y - 1, 4, 2, '#7ce3ff');
      ctx.globalAlpha = 1;
    }

    const x = Math.round(astro.x - w / 2);
    const y = Math.round(astro.y - h + bob - jump);

    ellipse(astro.x, astro.y + 1, w * 0.36, h * 0.1, 'rgba(10,12,20,.55)');

    if (night) {
      ctx.globalAlpha = 0.16;
      ellipse(astro.x, astro.y - h * 0.6, w * 0.9, h * 0.55, '#ffe9a8');
      ctx.globalAlpha = 1;
    }

    drawSprite(sprite, SUIT, x, y, scale, astro.facing < 0);
  }

  function drawFx(time) {
    const fx = state.fx;
    if (!fx) return;
    const age = time - fx.t0;

    if (fx.type === 'flare' && age < 3.2) {
      ctx.globalAlpha = 0.12 + 0.07 * Math.sin(time * 6);
      ctx.fillStyle = '#ff9a3c';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = 'rgba(255, 200, 110, .75)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = 0.55 - i * 0.09;
        ctx.beginPath();
        ctx.arc(W * 0.95, H * 0.06, (12 + i * 9 + (age * 30) % 18) * U, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (fx.type === 'meteor') {
      const tx = base.x;
      const ty = base.y;
      if (age < 0.7) {
        const p = age / 0.7;
        const sx = W * 0.95;
        const sy = -H * 0.1;
        const x = sx + (tx - sx) * p;
        const y = sy + (ty - sy) * p;
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 14, y - 9);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = '#fff3c4';
        ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      } else if (age < 1.7) {
        const p = (age - 0.7) / 1.0;
        ctx.globalAlpha = 1 - p;
        ellipse(tx, ty, (6 + p * 14) * U, (4 + p * 8) * U, '#d8c48f');
        ctx.globalAlpha = 1;
      }
    }

    if (fx.type === 'dust' && age < 4.5) {
      ctx.fillStyle = 'rgba(216, 196, 143, .6)';
      for (let i = 0; i < 34; i++) {
        const pxX = ((i * 53 + age * 30) % (W + 20)) - 10;
        const pxY = (i * 37) % H;
        ctx.fillRect(Math.round(pxX), Math.round(pxY), 2, 1);
      }
    }

    if (fx.type === 'sparkle' && age < 2.2) {
      const spots = [
        [cave.x, cave.y - 10 * U],
        [cave.x + 8 * U, cave.y + 2 * U],
        [base.x - baseR, base.y - baseR * 0.4],
        [astro.x, astro.y - 18 * U],
        [rover.x, rover.y - 8 * U],
      ];
      ctx.fillStyle = '#bff5ff';
      for (let i = 0; i < spots.length; i++) {
        const a = Math.max(0, 1 - age / 2.2) * (0.4 + 0.6 * Math.abs(Math.sin(time * 5 + i)));
        ctx.globalAlpha = a;
        const [sx, sy] = spots[i];
        ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 3, 2, 7);
        ctx.fillRect(Math.round(sx) - 3, Math.round(sy) - 1, 7, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawFloating(time) {
    const scale = Math.max(2, Math.round(2 * U));
    const x = W * 0.72;
    const y = H * 0.62 + Math.sin(time * 1.4) * 5;

    ctx.globalAlpha = 0.14;
    ellipse(x, y, 34 * U, 22 * U, '#7fbdff');
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(time * 0.8) * 0.22);
    const cols = ASTRONAUT[0].length;
    drawSprite(ASTRONAUT, SUIT, (-cols * scale) / 2, (-ASTRONAUT.length * scale) / 2, scale);
    ctx.restore();
  }

  const confetti = Array.from({ length: 50 }, (_, i) => ({
    x: (i * 97) % 320,
    y: (i * 53) % 200,
    speed: 12 + ((i * 17) % 24),
    color: ['#ffb02e', '#7fbdff', '#7ce38b', '#ff4d6d', '#e6ebfa'][i % 5],
  }));

  function drawConfetti(time) {
    const since = Math.min(8, Math.max(0, time - state.winAt));
    if (since > 8) return;
    for (const p of confetti) {
      const y = (p.y + time * p.speed) % (H + 10);
      const x = (p.x / 320) * W + Math.sin(time * 2 + p.y) * 6;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawMap(time, night) {
    if (terrainCanvas) ctx.drawImage(terrainCanvas, 0, 0);

    for (const b of boulders) drawBoulder(b);
    for (const c of crystals) drawCrystalCluster(c, time, night);

    drawLockers(lockers.x, lockers.y, U, true);
    drawRover(rover.x, rover.y, U);
    drawCommsTower(tower.x, tower.y, U, time);
    for (const d of dishes) drawDish(d, time);
    drawProbeBot(probe.x, probe.y, U, time);

    drawBase(time, night);
    drawMiniBot(miniBot.x, miniBot.y, U);
    drawLockers(yardLockers.x, yardLockers.y, U * 0.85, false);
    drawAstronaut(time, night);

    if (night) {
      ctx.fillStyle = 'rgba(10, 18, 60, .4)';
      ctx.fillRect(0, 0, W, H);

      ctx.globalAlpha = 0.16;
      ellipse(base.x, base.y, baseR * 2.4, baseR * 1.8, '#ffd27a');
      ctx.globalAlpha = 1;
    }
  }

  function drawScene(time) {
    const s = state;
    const night = s.eventKey === 'night';

    drawSpace(time, night);

    if (s.phase === 'over') {
      drawEarth(W * 0.78, H * 0.26, 14 * U);
      drawFloating(time);
      return;
    }

    drawMap(time, night);
    drawFx(time);
    if (s.phase === 'win') drawConfetti(time);
  }

  function frame(now) {
    const t = now / 1000;
    const dt = lastFrameTime ? Math.min(0.05, t - lastFrameTime) : 0.016;
    lastFrameTime = t;
    updateAstronaut(dt);
    drawScene(t);
    requestAnimationFrame(frame);
  }

  function setFx(type) {
    const map = {
      flare: 'flare', meteor: 'meteor', dust: 'dust', night: 'night',
      ice: 'sparkle', supply: 'sparkle',
    };
    state.fx = map[type] ? { type: map[type], t0: performance.now() / 1000 } : null;
  }

  /* ================================================================ inputs == */
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
  $('#science-btn-hud').addEventListener('click', () => openModal('modal-science'));

  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', closeModals);
  }
  for (const modal of document.querySelectorAll('.modal')) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModals();
    });
  }

  canvas.addEventListener('click', (e) => {
    if (state.phase === 'over') return;
    const rect = canvas.getBoundingClientRect();
    const tx = ((e.clientX - rect.left) / rect.width) * W;
    const ty = ((e.clientY - rect.top) / rect.height) * H;
    astro.target = {
      x: clamp(tx, 12 * U, W - 12 * U),
      y: clamp(ty, H * 0.22, H - 10 * U),
    };
  });

  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') keys.up = false;
    if (k === 's' || e.key === 'ArrowDown') keys.down = false;
    if (k === 'a' || e.key === 'ArrowLeft') keys.left = false;
    if (k === 'd' || e.key === 'ArrowRight') keys.right = false;
  });

  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  document.addEventListener('keydown', (e) => {
    const modalOpen = document.querySelector('.modal:not([hidden])');

    if (e.key === 'Escape') {
      if (modalOpen) closeModals();
      return;
    }
    if (modalOpen) return;

    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') { e.preventDefault(); keys.up = true; return; }
    if (k === 's' || e.key === 'ArrowDown') { e.preventDefault(); keys.down = true; return; }
    if (k === 'a' || e.key === 'ArrowLeft') { e.preventDefault(); keys.left = true; return; }
    if (k === 'd' || e.key === 'ArrowRight') { e.preventDefault(); keys.right = true; return; }

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
  resizeScene();
  window.addEventListener('resize', resizeScene);
  window.addEventListener('orientationchange', () => setTimeout(resizeScene, 120));

  buildSystems();
  els.sound.textContent = Sound.muted ? '🔇' : '🔊';
  els.sound.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
  els.hudHearts.innerHTML = heartsHTML(3);
  render();
  requestAnimationFrame(frame);

  // Handy for demos ("?play" jumps straight into the mission)
  if (new URLSearchParams(location.search).has('play')) startRun();
})();
