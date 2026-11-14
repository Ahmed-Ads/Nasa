/* ==========================================================================
   Junior Astronaut Mission Trainer
   Level 1-1 آ· Shackleton Outpost (lunar south pole)

   Zero dependencies, zero build step. Open index.html and play.

   Design rules (2026 NASA Space Apps "Build a Junior Astronaut Mission
   Trainer" challenge):
     آ· 2â€“3 coupled resources, one shared budget
     آ· browser-only, no login, big readable UI for ages 7â€“12
     آ· dynamic hazards with a kid-friendly forecast
     آ· non-punitive failure (one free revive, explanations, instant retry)
     آ· every rule traceable to real NASA data (see "Mission Science")
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
    o2: { name: 'Oxygen', icon: 'ًں«پ', hint: 'Life support', color: '#5ac8ff' },
    shield: { name: 'Shielding', icon: 'ًں›،ï¸ڈ', hint: 'Radiation armor', color: '#ffb02e' },
    food: { name: 'Food', icon: 'ًںŒ±', hint: 'Greenhouse', color: '#7ce38b' },
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
    for (let i = 0; i < 3; i++) out += `<span class="star${i < n ? ' is-on' : ''}" aria-hidden="true">âک…</span>`;
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
      name: 'Clear Skies', icon: 'ًںŒ¤ï¸ڈ', tone: 'good',
      hint: 'Clear skies. No hazards expected â€” a good sol to refill reserves.',
      apply() {
        return [{ t: 'Clear skies over Shackleton. The crew catches its breath.', tone: 'good' }];
      },
    },

    flare: {
      name: 'Solar Flare', icon: 'âک€ï¸ڈ', tone: 'bad',
      hint: 'Solar flare detected! Radiation is spiking â€” <strong>shielding cells</strong> soak up the damage.',
      apply(st) {
        const dmg = Math.max(0, 50 - st.alloc.shield * 12);
        st.res.o2 = clamp(st.res.o2 - dmg);
        st.res.shield = clamp(st.res.shield - dmg);
        return dmg > 0
          ? [{ t: `A solar storm hit while shields ran on ${st.alloc.shield} cells â€” radiation cost <b>${dmg} Oâ‚‚</b> and <b>${dmg} shielding</b>.`, tone: 'bad' }]
          : [{ t: 'A solar storm hit, but your shields soaked it all up. Crew safe!', tone: 'good' }];
      },
    },

    night: {
      name: 'Lunar Night', icon: 'ًںŒ‘', tone: 'warn',
      hint: 'The Sun is setting for days. Grow-lights fade and heaters need extra oxygen.',
      apply(st) {
        const heat = 10;
        st.res.o2 = clamp(st.res.o2 - heat);
        const lost = Math.round(GAIN.food * st.alloc.food * 0.5);
        st.res.food = clamp(st.res.food - lost);
        return [{ t: `Lunar night falls: greenhouse output halves (âˆ’${lost} food) and heaters burn <b>${heat} extra Oâ‚‚</b>.`, tone: 'warn' }];
      },
    },

    dust: {
      name: 'Dust Storm', icon: 'ًںŒھï¸ڈ', tone: 'warn',
      hint: 'Moon dust coats the solar panels â€” next sol you get <strong>1 fewer power cell</strong>.',
      apply(st) {
        st.penalty = 1;
        return [{ t: 'Dust coats the solar panels â€” tomorrow you get <b>1 fewer power cell</b>.', tone: 'warn' }];
      },
    },

    meteor: {
      name: 'Micrometeoroids', icon: 'âک„ï¸ڈ', tone: 'warn',
      hint: 'Tiny space rocks incoming â€” shielding takes the hits. With no shielding, the hull does.',
      apply(st) {
        const hit = 24;
        st.res.shield = clamp(st.res.shield - hit);
        let msg = `Micrometeoroids sandblast the outpost: <b>âˆ’${hit} shielding</b>.`;
        if (st.alloc.shield === 0) {
          st.res.o2 = clamp(st.res.o2 - 14);
          msg += ' With no shield power, the hull leaked <b>14 Oâ‚‚</b>.';
        }
        return [{ t: msg, tone: 'warn' }];
      },
    },

    ice: {
      name: 'Ice Vein Found', icon: 'ًں§ٹ', tone: 'good',
      hint: 'Ground radar found water ice in a shadowed crater! Split it for oxygen.',
      apply(st) {
        st.res.o2 = clamp(st.res.o2 + 16);
        return [{ t: 'Water ice found in a shadowed crater â€” electrolysis adds <b>+16 Oâ‚‚</b>.', tone: 'good' }];
      },
    },

    supply: {
      name: 'NASA Resupply', icon: 'ًں›°ï¸ڈ', tone: 'good',
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
                  aria-label="Remove a power cell from ${meta.name}">âˆ’</button>
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
      : 'All cells spent â€” run the sol when you are ready.';
    els.hint.classList.toggle('is-ready', ready);

    const ev = EVENTS[s.eventKey];
    els.forecastIcon.textContent = ev.icon;
    els.forecastLabel.textContent = `Forecast آ· Sol ${sol}`;
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

    addLog(`<b>Sol ${sol} آ· ${ev.name}</b> â€” cells ${alloc.o2}/${alloc.shield}/${alloc.food}`, 'head');
    addLog(`Wear and tear: âˆ’${wear.o2} Oâ‚‚ آ· âˆ’${wear.shield} shield آ· âˆ’${wear.food} food.`, 'muted');
    for (const line of lines) addLog(line.t, line.tone);

    // 4 â€” hearts
    const lows = RES_KEYS.filter((key) => s.res[key] < CRITICAL);
    if (lows.length && s.hearts > 0) {
      s.hearts -= 1;
      const names = lows.map((key) => `${RES[key].icon} ${RES[key].name}`).join(' and ');
      addLog(`âڑ ï¸ڈ Critical: ${names} under ${CRITICAL}%. The crew loses a heart.`, 'bad');
      Sound.warn();
    }
    addLog(`Status â†’ ${RES_KEYS.map((key) => `${RES[key].icon} ${Math.round(s.res[key])}%`).join(' آ· ')}`, 'muted');

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
      els.endNote.textContent = `Crew hearts left: ${s.hearts} آ· Mars is next on the mission map.`;
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

    addLog('ًںڑ‘ <b>Revive!</b> NASA air-drops emergency supplies â€” every meter is back to at least 55%.', 'good');
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
  let W = 320;
  let H = 200;
  let U = 1;
  let baseR = 30;
  let astroScale = 2;

  let stars = [];
  let speckles = [];
  let craters = [];
  let boulders = [];
  let crystals = [];
  let dishes = [];
  let rocks = [];

  let terrainPath = null;
  let basaltPath = null;
  let basinPath = null;
  let patches = [];
  let base = { x: 0, y: 0 };
  let cave = { x: 0, y: 0 };
  let astro = { x: 0, y: 0 };
  let rocket = { x: 0, y: 0 };
  let rover = { x: 0, y: 0 };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SUIT = {
    B: '#0d1430', // outline
    w: '#f4f7ff', // suit
    v: '#101a3d', // visor
    h: '#7ad9ff', // visor shine
    b: '#2f6fe0', // blue accents
    o: '#ffb02e', // orange accents
  };

  // chibi astronaut, 16 أ— 20 pixels
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

  function ellipse(x, y, rx, ry, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* --------------------------------------------------------------- layout --- */
  function resizeScene() {
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(320, window.innerHeight);
    const S = Math.min(6, Math.max(2, Math.min(vw, vh) / 190));

    W = Math.round(vw / S);
    H = Math.round(vh / S);
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;

    U = Math.max(0.72, Math.min(1.8, W / 330));
    baseR = Math.round(30 * U);
    astroScale = U > 1.5 ? 2 : 1;

    buildLayout();
  }

  function buildLayout() {
    const rnd = mulberry32((W * 73856093) ^ (H * 19349663) ^ 0x9e3779b9);

    stars = Array.from({ length: 110 }, () => ({
      x: Math.floor(rnd() * W),
      y: Math.floor(rnd() * H),
      s: rnd() < 0.16 ? 2 : 1,
      p: rnd() * Math.PI * 2,
    }));

    speckles = Array.from({ length: Math.round(W * H / 620) }, () => ({
      x: Math.floor(rnd() * W),
      y: Math.floor(rnd() * H),
      s: rnd() < 0.14 ? 2 : 1,
      light: rnd() < 0.5,
    }));

    craters = [
      { x: W * 0.09, y: H * 0.16, r: 10 * U },
      { x: W * 0.19, y: H * 0.68, r: 13 * U },
      { x: W * 0.5, y: H * 0.09, r: 7 * U },
      { x: W * 0.71, y: H * 0.7, r: 9 * U },
      { x: W * 0.87, y: H * 0.55, r: 12 * U },
      { x: W * 0.33, y: H * 0.87, r: 10 * U },
      { x: W * 0.94, y: H * 0.82, r: 8 * U },
    ];

    boulders = [
      { x: W * 0.12, y: H * 0.42, r: 5 * U },
      { x: W * 0.3, y: H * 0.74, r: 4 * U },
      { x: W * 0.66, y: H * 0.33, r: 6 * U },
      { x: W * 0.9, y: H * 0.7, r: 4.5 * U },
      { x: W * 0.47, y: H * 0.26, r: 3.5 * U },
      { x: W * 0.24, y: H * 0.22, r: 3 * U },
      { x: W * 0.56, y: H * 0.78, r: 3.5 * U },
      { x: W * 0.4, y: H * 0.62, r: 2.6 * U },
    ];

    crystals = [
      { x: W * 0.73, y: H * 0.4, s: 6.5 * U, c: '#6fe3ff' },
      { x: W * 0.79, y: H * 0.32, s: 4.5 * U, c: '#b06cff' },
      { x: W * 0.67, y: H * 0.23, s: 5 * U, c: '#5be0a0' },
      { x: W * 0.9, y: H * 0.46, s: 5.5 * U, c: '#b06cff' },
      { x: W * 0.63, y: H * 0.72, s: 4.5 * U, c: '#6fe3ff' },
    ];

    patches = Array.from({ length: 10 }, () => ({
      x: rnd() * W,
      y: rnd() * H,
      rx: (14 + rnd() * 42) * U,
      ry: (8 + rnd() * 24) * U,
      light: rnd() < 0.5,
    }));

    dishes = [
      { x: W * 0.85, y: H * 0.28, r: 9 * U, a: -0.5 },
      { x: W * 0.94, y: H * 0.12, r: 6 * U, a: 0.4 },
    ];

    base = { x: W * 0.6, y: H * 0.55 };
    cave = { x: W * 0.27, y: H * 0.35 };
    astro = { x: W * 0.42, y: H * 0.5 };
    rocket = { x: W * 0.55, y: H * 0.17 };
    rover = { x: W * 0.13, y: H * 0.59 };

    rocks = [
      { x: W * 0.05, y: H * 0.9, s: 1.2 },
      { x: W * 0.36, y: H * 0.3, s: 0.8 },
      { x: W * 0.58, y: H * 0.44, s: 0.7 },
      { x: W * 0.79, y: H * 0.62, s: 0.9 },
      { x: W * 0.22, y: H * 0.86, s: 0.8 },
    ];

    // dark, irregular basin around the cave mouth
    basinPath = new Path2D();
    const bcx = cave.x + 2 * U;
    const bcy = cave.y + 4 * U;
    const brx = 38 * U;
    const bry = 33 * U;
    const bpts = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const j = 0.74 + rnd() * 0.34;
      bpts.push([bcx + Math.cos(a) * brx * j, bcy + Math.sin(a) * bry * j]);
    }
    basinPath.moveTo(bpts[0][0], bpts[0][1]);
    for (let i = 1; i < bpts.length; i++) basinPath.lineTo(bpts[i][0], bpts[i][1]);
    basinPath.closePath();

    // terrain outline: space shows in the top-right corner
    const edge = [
      [W * 0.5, 0],
      [W * 0.58, H * 0.03],
      [W * 0.56, H * 0.07],
      [W * 0.66, H * 0.1],
      [W * 0.72, H * 0.16],
      [W * 0.8, H * 0.14],
      [W * 0.88, H * 0.22],
      [W, H * 0.25],
    ];
    terrainPath = new Path2D();
    terrainPath.moveTo(0, 0);
    for (const [x, y] of edge) terrainPath.lineTo(x, y);
    terrainPath.lineTo(W, H);
    terrainPath.lineTo(0, H);
    terrainPath.closePath();

    // jagged boundary between pale regolith and dark basalt
    basaltPath = new Path2D();
    let bx = W * 0.62;
    basaltPath.moveTo(bx, 0);
    for (let y = 0; y <= H; y += 9) {
      bx += (rnd() - 0.5) * W * 0.07;
      bx = Math.max(W * 0.52, Math.min(W * 0.76, bx));
      basaltPath.lineTo(bx, y);
    }
    basaltPath.lineTo(W, H);
    basaltPath.lineTo(W, 0);
    basaltPath.closePath();
  }

  /* --------------------------------------------------------------- helpers -- */
  function drawSpace(time, night) {
    const sky = ctx.createLinearGradient(0, 0, W, H);
    sky.addColorStop(0, night ? '#03030a' : '#05060f');
    sky.addColorStop(1, night ? '#080a1a' : '#0b0d1d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    for (const star of stars) {
      const tw = reduceMotion ? 1 : 0.4 + 0.6 * Math.abs(Math.sin(time * 0.9 + star.p));
      ctx.globalAlpha = 0.5 + 0.5 * tw;
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

  function drawCrater(c) {
    ellipse(c.x, c.y, c.r, c.r * 0.68, 'rgba(0,0,0,.16)');
    ellipse(c.x, c.y - c.r * 0.04, c.r * 0.78, c.r * 0.48, 'rgba(0,0,0,.2)');
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.r, c.r * 0.68, 0, Math.PI * 0.86, Math.PI * 1.95);
    ctx.stroke();
  }

  function drawBoulder(b) {
    ellipse(b.x + 1, b.y + b.r * 0.35, b.r * 1.05, b.r * 0.6, 'rgba(0,0,0,.28)');
    ellipse(b.x, b.y, b.r, b.r * 0.78, '#6f7180');
    ellipse(b.x - b.r * 0.2, b.y - b.r * 0.25, b.r * 0.6, b.r * 0.42, '#8b8d9c');
  }

  function drawCave(time, night) {
    const x = cave.x;
    const y = cave.y;
    const r = 17 * U;

    ellipse(x, y + r * 0.55, r * 1.35, r * 0.6, 'rgba(0,0,0,.3)');

    ctx.fillStyle = '#3a3948';
    ctx.beginPath();
    ctx.moveTo(x - r * 1.18, y + r * 0.75);
    ctx.quadraticCurveTo(x - r * 1.12, y - r * 0.95, x, y - r * 0.95);
    ctx.quadraticCurveTo(x + r * 1.12, y - r * 0.95, x + r * 1.18, y + r * 0.75);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#4c4b5d';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      const px = x + Math.cos(a) * r * 1.02;
      const py = y + Math.sin(a) * r * 0.75 - r * 0.15;
      ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 5, 4);
    }

    ctx.fillStyle = '#07070d';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.62, y + r * 0.72);
    ctx.quadraticCurveTo(x - r * 0.66, y - r * 0.38, x, y - r * 0.38);
    ctx.quadraticCurveTo(x + r * 0.66, y - r * 0.38, x + r * 0.62, y + r * 0.72);
    ctx.closePath();
    ctx.fill();

    const pulse = 0.14 + 0.09 * Math.sin(time * 1.6);
    ctx.globalAlpha = night ? pulse * 2 : pulse;
    ellipse(x, y + r * 0.45, r * 0.3, r * 0.16, '#3d7ef0');
    ctx.globalAlpha = 1;
  }

  function drawCrystalShard(x, y, h, color) {
    const w = h * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + w, y - h * 0.15);
    ctx.lineTo(x, y + h * 0.2);
    ctx.lineTo(x - w, y - h * 0.15);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillRect(Math.round(x - w * 0.32), Math.round(y - h * 0.8), 1, Math.max(2, Math.round(h * 0.45)));
  }

  function drawCrystalCluster(c, time, night) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2 + c.x * 0.08);
    ctx.globalAlpha = (night ? 0.3 : 0.16) + pulse * 0.12;
    ellipse(c.x, c.y, c.s * 1.4, c.s * 0.65, c.c);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ellipse(c.x, c.y + 1, c.s * 0.9, c.s * 0.28, '#000');

    drawCrystalShard(c.x - c.s * 0.5, c.y, c.s * 0.85, c.c);
    drawCrystalShard(c.x, c.y, c.s * 1.3, c.c);
    drawCrystalShard(c.x + c.s * 0.55, c.y, c.s * 0.7, c.c);
  }

  function drawRocks() {
    for (const r of rocks) {
      const s = r.s * U * 3;
      ctx.fillStyle = '#5f6170';
      ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(s), Math.round(s * 0.6));
      ctx.fillStyle = '#868896';
      ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(s), Math.round(s * 0.22));
    }
  }

  function drawRover(x, y, s) {
    const r = (v) => Math.round(v);

    ctx.globalAlpha = 0.3;
    ellipse(x + 2, y + 5 * s, 9 * s, 3 * s, '#000');
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#3a3b47';
    ctx.fillRect(r(x - 6 * s), r(y + 1 * s), r(3 * s), r(3 * s));
    ctx.fillRect(r(x + 3 * s), r(y + 1 * s), r(3 * s), r(3 * s));

    ctx.fillStyle = '#aeb3c4';
    ctx.fillRect(r(x - 7 * s), r(y - 2 * s), r(14 * s), r(4 * s));
    ctx.fillStyle = '#82869a';
    ctx.fillRect(r(x - 7 * s), r(y + 1 * s), r(14 * s), r(1 * s));

    ctx.fillStyle = '#c9cede';
    ctx.fillRect(r(x - 1 * s), r(y - 7 * s), r(1.2 * s), r(5 * s));
    ctx.fillRect(r(x - 2.2 * s), r(y - 8 * s), r(2.4 * s), r(2 * s));

    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(r(x + 6 * s), r(y - 1.6 * s), r(1.2 * s), r(1.2 * s));
  }

  function drawDish(d, time) {
    const angle = d.a + (reduceMotion ? 0 : Math.sin(time * 0.5 + d.x * 0.02) * 0.16);
    const x = d.x;
    const y = d.y;
    const r = d.r;

    ctx.strokeStyle = '#9aa0b4';
    ctx.lineWidth = Math.max(1, Math.round(U));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - r * 0.75, y + r * 1.5);
    ctx.moveTo(x, y);
    ctx.lineTo(x + r * 0.75, y + r * 1.5);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + r * 1.6);
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ellipse(0, 0, r, r * 0.52, '#b9becd');
    ellipse(0, r * 0.08, r * 0.72, r * 0.32, '#878ca0');
    ctx.fillStyle = '#5f6478';
    ctx.fillRect(-1, -r * 0.1, 2, Math.round(r * 0.55));
    ctx.fillStyle = '#6fe3ff';
    ctx.fillRect(-1, -r * 0.16, 2, 2);
    ctx.restore();
  }

  function drawRocket(x, y, s) {
    const r = (v) => Math.round(v);

    ctx.globalAlpha = 0.3;
    ellipse(x + 2 * s, y + 5 * s, 8 * s, 3 * s, '#000');
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#8d92a6';
    ctx.lineWidth = Math.max(1, Math.round(s));
    ctx.beginPath();
    ctx.moveTo(x - 3 * s, y);
    ctx.lineTo(x - 6 * s, y + 5 * s);
    ctx.moveTo(x + 3 * s, y);
    ctx.lineTo(x + 6 * s, y + 5 * s);
    ctx.stroke();

    ctx.fillStyle = '#9aa0b4';
    ctx.fillRect(r(x - 5 * s), r(y - 4 * s), r(2 * s), r(4 * s));
    ctx.fillRect(r(x + 3 * s), r(y - 4 * s), r(2 * s), r(4 * s));

    ctx.fillStyle = '#dfe2ee';
    ctx.fillRect(r(x - 3 * s), r(y - 13 * s), r(6 * s), r(13 * s));

    ctx.beginPath();
    ctx.moveTo(x - 3 * s, y - 13 * s);
    ctx.lineTo(x, y - 18 * s);
    ctx.lineTo(x + 3 * s, y - 13 * s);
    ctx.closePath();
    ctx.fillStyle = '#eef1fa';
    ctx.fill();

    ctx.fillStyle = '#3d7ef0';
    ctx.fillRect(r(x - 1 * s), r(y - 10 * s), r(2 * s), r(2 * s));
    ctx.fillStyle = '#ffb02e';
    ctx.fillRect(r(x - 3 * s), r(y - 7 * s), r(6 * s), r(1.4 * s));
    ctx.fillStyle = '#7d8195';
    ctx.fillRect(r(x - 4 * s), r(y), r(8 * s), r(1.4 * s));
  }

  function drawTank(x, y, r) {
    ellipse(x + 1, y + 2, r * 1.1, r * 0.75, 'rgba(0,0,0,.3)');
    ellipse(x, y, r, r * 0.72, '#aeb2c2');
    ellipse(x - r * 0.18, y - r * 0.2, r * 0.55, r * 0.32, 'rgba(255,255,255,.35)');
    ctx.strokeStyle = '#7d8195';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawYard(x, y, w, h) {
    ctx.strokeStyle = '#8d92a6';
    ctx.lineWidth = Math.max(1, Math.round(U));
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.strokeStyle = '#6f7488';
    ctx.strokeRect(x + 3.5, y + 3.5, w - 6, h - 6);

    ctx.fillStyle = '#9aa0b4';
    const posts = 5;
    for (let i = 0; i < posts; i++) {
      const px = Math.round(x + (w / (posts - 1)) * i);
      ctx.fillRect(px - 1, Math.round(y) - 3, 3, 4);
      ctx.fillRect(px - 1, Math.round(y + h) - 1, 3, 4);
    }

    ctx.fillStyle = '#7d8195';
    ctx.fillRect(Math.round(x + w * 0.6), Math.round(y + h * 0.52), 9, 7);
    ctx.fillStyle = '#9aa0b4';
    ctx.fillRect(Math.round(x + w * 0.6), Math.round(y + h * 0.52), 9, 2);
  }

  function drawBase(time, night) {
    const x = base.x;
    const y = base.y;
    const r = baseR;

    ctx.globalAlpha = 0.32;
    ellipse(x + 4, y + 6, r * 1.25, r * 0.9, '#000');
    ctx.globalAlpha = 1;

    drawYard(x + r * 1.05, y - r * 0.62, r * 1.9, r * 1.3);

    drawTank(x - r * 1.55, y + r * 0.1, r * 0.4);
    drawTank(x - r * 0.95, y + r * 0.42, r * 0.3);

    // dome foundation ring
    ellipse(x, y + r * 0.12, r * 1.08, r * 0.94, '#5d6072');

    // dome shell
    ellipse(x, y, r, r * 0.84, '#bcc1cf');

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.84, 0, 0, Math.PI * 2);
    ctx.clip();

    // alternating panel wedges
    ctx.translate(x, y);
    ctx.scale(1, 0.84);
    for (let i = 0; i < 8; i++) {
      if (i % 2) continue;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.07)';
      ctx.fill();
    }

    // panel seams
    ctx.strokeStyle = '#8b90a3';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.26, Math.sin(a) * r * 0.26);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.64, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // shell highlight + rim
    ellipse(x - r * 0.28, y - r * 0.3, r * 0.4, r * 0.22, 'rgba(255,255,255,.45)');
    ctx.strokeStyle = '#787c90';
    ctx.lineWidth = Math.max(1, Math.round(U));
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.84, 0, 0, Math.PI * 2);
    ctx.stroke();

    // portholes
    ctx.fillStyle = '#2f3a5c';
    for (const a of [-0.55, 0.5, 2.3, 3.7]) {
      ctx.fillRect(Math.round(x + Math.cos(a) * r * 0.72) - 1, Math.round(y + Math.sin(a) * r * 0.6) - 1, 3, 2);
    }

    // hatch
    ctx.fillStyle = '#6f7286';
    ctx.fillRect(Math.round(x - r * 0.12), Math.round(y + r * 0.56), Math.round(r * 0.24), Math.round(r * 0.3));
    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(Math.round(x - r * 0.02), Math.round(y + r * 0.68), 2, 2);

    // rim lights
    const glow = night ? 1 : 0.55;
    ctx.globalAlpha = glow;
    ctx.fillStyle = '#7ce38b';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      ctx.fillRect(Math.round(x + Math.cos(a) * r * 0.94) - 1, Math.round(y + Math.sin(a) * r * 0.78) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;

    if (Math.sin(time * 3) > 0) {
      ctx.fillStyle = '#ff5d73';
      ctx.fillRect(Math.round(x + r * 0.5), Math.round(y - r * 0.62), 2, 2);
    }
  }

  function drawAstronaut(time, night) {
    const scale = astroScale;
    const w = ASTRONAUT[0].length * scale;
    const h = ASTRONAUT.length * scale;
    const bob = reduceMotion ? 0 : Math.round(Math.sin(time * 2.2));
    const jump = state.phase === 'win' && !reduceMotion ? Math.abs(Math.sin(time * 3)) * 5 * U : 0;

    const x = Math.round(astro.x - w / 2);
    const y = Math.round(astro.y - h + bob - jump);

    ctx.globalAlpha = 0.35;
    ellipse(astro.x + 1, astro.y + 1, w * 0.42, h * 0.1, '#000');
    ctx.globalAlpha = 1;

    if (night) {
      ctx.globalAlpha = 0.16;
      ellipse(astro.x, astro.y - h * 1.4, w * 0.8, h * 0.5, '#ffe9a8');
      ctx.globalAlpha = 1;
    }

    drawSprite(ASTRONAUT, x, y, scale);
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
        const px = ((i * 53 + age * 30) % (W + 20)) - 10;
        const py = (i * 37) % H;
        ctx.fillRect(Math.round(px), Math.round(py), 2, 1);
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
    const scale = Math.max(2, Math.round(2 * U)) + 1;
    const x = W * 0.72;
    const y = H * 0.62 + Math.sin(time * 1.4) * 5;

    ctx.globalAlpha = 0.14;
    ellipse(x, y, 34 * U, 22 * U, '#7fbdff');
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(time * 0.8) * 0.22);
    const cols = ASTRONAUT[0].length;
    drawSprite(ASTRONAUT, (-cols * scale) / 2, (-ASTRONAUT.length * scale) / 2, scale);
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
    ctx.save();
    ctx.clip(terrainPath);

    // pale regolith
    ctx.fillStyle = '#b7b8c3';
    ctx.fill(terrainPath);

    // dark basalt half
    ctx.fillStyle = '#2b2b38';
    ctx.fill(basaltPath);

    // soft regolith mottling
    for (const p of patches) {
      ctx.globalAlpha = 0.055;
      ellipse(p.x, p.y, p.rx, p.ry, p.light ? '#ffffff' : '#000000');
    }
    ctx.globalAlpha = 1;

    // dark irregular basin around the cave mouth
    ctx.fillStyle = '#34333f';
    ctx.fill(basinPath);
    ctx.strokeStyle = 'rgba(18,18,28,.5)';
    ctx.lineWidth = 2;
    ctx.stroke(basinPath);

    // regolith speckle
    for (const sp of speckles) {
      ctx.fillStyle = sp.light ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.12)';
      ctx.fillRect(sp.x, sp.y, sp.s, sp.s);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(16,16,28,.8)';
    ctx.lineWidth = 2;
    ctx.stroke(terrainPath);

    for (const c of craters) drawCrater(c);
    drawRocks();
    drawCave(time, night);

    for (const b of boulders) drawBoulder(b);
    for (const c of crystals) drawCrystalCluster(c, time, night);

    drawRover(rover.x, rover.y, U);
    for (const d of dishes) drawDish(d, time);
    drawRocket(rocket.x, rocket.y, U * 1.2);
    drawBase(time, night);
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
    drawScene(now / 1000);
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
    els.sound.textContent = muted ? 'ًں”‡' : 'ًں”ٹ';
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
  resizeScene();
  window.addEventListener('resize', resizeScene);
  window.addEventListener('orientationchange', () => setTimeout(resizeScene, 120));

  buildSystems();
  els.sound.textContent = Sound.muted ? 'ًں”‡' : 'ًں”ٹ';
  els.sound.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
  els.hudHearts.innerHTML = heartsHTML(3);
  render();
  requestAnimationFrame(frame);

  // Handy for demos ("?play" jumps straight into the mission)
  if (new URLSearchParams(location.search).has('play')) startRun();
})();
