/**
 * Clarity Loop — Game 3: Follow the Flame  (page: /game3)
 * A 4·4·4·4 box-breathing pacer: inhale 4 s, hold 4 s, exhale 4 s, hold 4 s.
 *
 * Design choice — the opposite of Game 1: here the flame LEADS and the
 * breath FOLLOWS. A fixed clock in this file sets the flame's size/shape and
 * the phase text. The camera only changes the flame's character (wobble,
 * colour, glow) through "adherence" — how closely the player's breathing
 * matches the pace — and feeds the end-of-session graph. Keep it that way:
 * mapping a noisy live signal straight to flame size makes a pacer jittery
 * and hard to follow.
 *
 * Screens:  SETUP → COUNTDOWN(3·2·1) → ACTIVE(pacer + flame + capture)
 *                                    → COMPLETE(capture graph → /survey)
 *
 * Adherence: BreathAnalyzer.computeRate(30) + computeRegularity(30) compared
 * with the 3.75 breaths/min box target, smoothed once per second with an
 * EMA (exponential moving average). The backend's rr_bpm can't see breathing
 * this slow (its band starts at 9 breaths/min), so this game ignores it.
 */

// ============================================================
// BreathAnalyzer — copied from game1.js. The in-browser breath counting
// works at slow box-breath cadences (one breath per 16 s), where the
// backend FFT in respiration.py does not.
//
// DUPLICATE: see the note above BreathAnalyzer in game1.js for the other
// copies (observe.js, mirror.js) and how they differ.
// ============================================================
const BreathAnalyzer = {
  samples: [],
  timestamps: [],
  WINDOW_MS: 60000,
  EXTREMA_HALF_WIN: 10,

  push(v, t) {
    this.samples.push(v);
    this.timestamps.push(t);
    const cutoff = t - this.WINDOW_MS;
    while (this.timestamps.length && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
      this.samples.shift();
    }
  },

  _slice(sec) {
    if (!this.timestamps.length) return null;
    const tEnd = this.timestamps[this.timestamps.length - 1];
    const cutoff = tEnd - sec * 1000;
    let i = 0;
    while (i < this.timestamps.length && this.timestamps[i] < cutoff) i++;
    return { v: this.samples.slice(i), t: this.timestamps.slice(i) };
  },

  computeRate(sec = 30) {
    const s = this._slice(sec);
    if (!s || s.v.length < 30) return null;
    let cx = 0;
    for (let i = 1; i < s.v.length; i++) {
      const a = s.v[i - 1], b = s.v[i];
      if ((a > 0 && b <= 0) || (a < 0 && b >= 0)) cx++;
    }
    const cycles = cx / 2;
    const elapsed = (s.t[s.t.length - 1] - s.t[0]) / 1000;
    return elapsed > 0 ? (cycles / elapsed) * 60 : null;
  },

  findExtrema(sec = 30) {
    const s = this._slice(sec);
    if (!s || s.v.length < 30) return [];
    const w = this.EXTREMA_HALF_WIN;
    const out = [];
    for (let i = w; i < s.v.length - w; i++) {
      const v = s.v[i];
      let isMax = true, isMin = true;
      for (let j = 1; j <= w; j++) {
        if (s.v[i - j] >= v) isMax = false;
        if (s.v[i - j] <= v) isMin = false;
        if (s.v[i + j] > v)  isMax = false;
        if (s.v[i + j] < v)  isMin = false;
        if (!isMax && !isMin) break;
      }
      if (isMax)      out.push({ kind: 'peak',   v, t: s.t[i] });
      else if (isMin) out.push({ kind: 'trough', v, t: s.t[i] });
    }
    return out;
  },

  computeAmplitude(sec = 30) {
    const ex = this.findExtrema(sec);
    if (ex.length < 2) return null;
    const amps = [];
    for (let i = 0; i < ex.length - 1; i++) {
      if (ex[i].kind !== ex[i + 1].kind) {
        amps.push(Math.abs(ex[i + 1].v - ex[i].v));
      }
    }
    return amps.length ? amps.reduce((a, b) => a + b, 0) / amps.length : null;
  },

  computeRegularity(sec = 30) {
    const ex = this.findExtrema(sec);
    const peaks = ex.filter(e => e.kind === 'peak');
    if (peaks.length < 3) return null;
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i].t - peaks[i - 1].t);
    if (intervals.length < 2) return null;
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    let v = 0;
    for (const x of intervals) v += (x - mean) * (x - mean);
    const stdev = Math.sqrt(v / intervals.length);
    return mean > 0 ? stdev / mean : 1.0;
  },
};


// ============================================================
// FlameField — ported from the Game 3 design prototype's `_setupFlame`
// (a third flame variant; see the DUPLICATE note in game1.js). Unlike
// game1's FlameField this one has:
//   • setBreath(b) — flame SIZE driven by the box clock, not CV
//   • setAdherence(a) — CV drives wobble / palette / glow / sparks
//   • a full-canvas circular radial glow (no top/bottom cut-off)
// ============================================================
function createFlameField(canvas) {
  const PALETTES = {
    warm:   { outer: '#c92e2e', middle: '#ef7b2a', inner: '#f9c83a', core: '#fff5b0' },
    hot:    { outer: '#e93838', middle: '#ff9844', inner: '#ffd34d', core: '#ffffd8' },
    cool:   { outer: '#8b2424', middle: '#bc5622', inner: '#d59230', core: '#efcb88' },
    embers: { outer: '#5e1414', middle: '#982f15', inner: '#c0701d', core: '#dca044' },
  };
  const SRC = [
    { x:   0, scale: 1.00 }, { x:   0, scale: 1.00 }, { x:   0, scale: 0.95 },
    { x: -52, scale: 0.62 }, { x:  48, scale: 0.65 },
    { x: -22, scale: 0.55 }, { x:  26, scale: 0.55 },
  ];

  const F = {
    canvas,
    ctx: canvas.getContext('2d'),
    tongues: [],
    sparks: [],

    tH: 60, tW: 26, tE: 4, tL: 1.2, tWob: 0.1, tPal: 0,
    H:  60, W:  26, E:  4, L:  1.2, Wob:  0.1, Pal: 0,
    glowB: 1.2, glowLevel: 0.5,
    ringLevel: 0.5, tRing: 0.5,   // player's OWN raw breath 0..1 → sync ring
    sparkRate: 0,
    _acc: 0, _sacc: 0,

    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width  = Math.floor(window.innerWidth  * dpr);
      this.canvas.height = Math.floor(window.innerHeight * dpr);
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.cx = this.w / 2;
      this.baseY = this.h * 0.6;
      this.maxH = Math.max(120, (this.baseY - 70) / 1.4);
    },

    _ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); },

    // Box-clock breath level 0..1 → flame size targets.  glowLevel feeds
    // the radial-glow radius in draw() so the pattern reads even in
    // passive mode (no text).
    setBreath(b) {
      const bb = this._ease(b);
      this.tH = 55 + (this.maxH - 55) * bb;
      this.tW = 24 + 38 * bb;
      this.tE = 3 + 5.5 * bb;
      this.tL = 1.0 + 1.6 * bb;
      this.glowLevel = bb;
    },

    // Player's raw breath level 0..1 → the thin sync ring's radius.  Kept
    // SEPARATE from setBreath (box clock): the flame's size is the target
    // to match, this ring is the player's actual breath drawn against it.
    // Feed at chest-sample rate; step()'s fast lerp de-jitters it.
    setBreathRing(v) {
      this.tRing = Math.max(0, Math.min(1, v));
    },

    // CV-driven character.  Never touches height/width — those belong
    // to the box clock.  Feed at ~1 Hz; the lerp in step() smooths it.
    setAdherence(a) {
      a = Math.max(0, Math.min(1, a));
      this.tWob = 0.06 + (1 - a) * 0.9;
      this.tPal = -0.7 + 1.4 * a;
      this.glowB = 1.0 + 1.3 * a;
      this.sparkRate = a > 0.62 ? (a - 0.62) * 22 : 0;
    },

    step(dt) {
      const k = Math.min(1, dt / 1.6);
      this.H   += (this.tH   - this.H)   * k;
      this.W   += (this.tW   - this.W)   * k;
      this.E   += (this.tE   - this.E)   * k;
      this.L   += (this.tL   - this.L)   * k;
      this.Wob += (this.tWob - this.Wob) * k;
      this.Pal += (this.tPal - this.Pal) * k;
      // The ring's only smoothing stage: a light ~0.25 s lerp that kills
      // per-frame chest-signal jitter without adding phase lag the sync
      // read depends on.
      this.ringLevel += (this.tRing - this.ringLevel) * Math.min(1, dt / 0.25);

      this._acc += this.E * dt;
      let n = Math.floor(this._acc); this._acc -= n;
      for (let i = 0; i < n; i++) this._spawn();

      for (let i = this.tongues.length - 1; i >= 0; i--) {
        const t = this.tongues[i];
        t.age += dt;
        t.fp += dt * t.fs * (0.5 + this.Wob);
        if (t.age >= t.life) this.tongues.splice(i, 1);
      }

      if (this.sparkRate > 0) {
        this._sacc += this.sparkRate * dt;
        let m = Math.floor(this._sacc); this._sacc -= m;
        for (let i = 0; i < m; i++) this._spawnSpark();
      } else {
        this._sacc = 0;
      }

      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const p = this.sparks[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 32 * dt;
        p.vx *= (1 - 0.5 * dt);
        p.age += dt;
        if (p.age >= p.life) this.sparks.splice(i, 1);
      }
    },

    _spawn() {
      const src = SRC[Math.floor(Math.random() * SRC.length)];
      this.tongues.push({
        baseX: this.cx + src.x + (Math.random() - 0.5) * 12,
        baseY: this.baseY + (Math.random() - 0.5) * 6,
        height: this.H * src.scale * (0.85 + Math.random() * 0.30),
        width:  this.W * src.scale * (0.80 + Math.random() * 0.40),
        life:   this.L * (0.75 + Math.random() * 0.50),
        age: 0,
        sway: (Math.random() - 0.5) * 0.9,
        fp: Math.random() * 6.28,
        fs: 3.5 + Math.random() * 2.5,
      });
    },

    _spawnSpark() {
      if (!this.tongues.length) return;
      const tg = this.tongues[Math.floor(Math.random() * this.tongues.length)];
      const ls = Math.sin((tg.age / tg.life) * Math.PI);
      if (ls < 0.3) return;
      const tip = tg.height * ls * (0.65 + Math.random() * 0.25);
      this.sparks.push({
        x: tg.baseX + (Math.random() - 0.5) * tg.width * 0.4,
        y: tg.baseY - tip,
        vx: (Math.random() - 0.5) * 40,
        vy: -65 - Math.random() * 60,
        age: 0,
        life: 1.2 + Math.random() * 1.3,
        size: 1.2 + Math.random() * 1.6,
      });
    },

    draw() {
      const ctx = this.ctx, W = this.w, H = this.h;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05030a';
      ctx.fillRect(0, 0, W, H);

      // Circular glow centred on the flame, filling the whole canvas
      // (no top/bottom cutoff).  Radius + brightness swell with the
      // box-breath level so the 4-4-4-4 pattern reads clearly from the
      // background alone — this is the passive-mode guide.
      const gb = this.glowB;
      const gl = (this.glowLevel == null ? 0.5 : this.glowLevel);
      const cx = this.cx;
      const cy = this.baseY - (55 + (this.maxH - 55) * gl) * 0.42;
      const R = (150 + this.maxH * 0.55) * (0.58 + 0.62 * gl);
      const bright = gb * (0.5 + 0.78 * gl);

      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0,   `rgba(235,115,45,${0.24 * bright})`);
      g.addColorStop(0.45,`rgba(150,55,20,${0.10 * bright})`);
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const vb = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
      vb.addColorStop(0,   `rgba(168,110,220,${0.08 * bright})`);
      vb.addColorStop(0.55,`rgba(110,70,180,${0.04 * bright})`);
      vb.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = vb;
      ctx.fillRect(0, 0, W, H);

      // Breath-sync ring — a thin glowing orange circle sharing the glow's
      // centre, but its radius is driven by the player's OWN raw breath
      // (setBreathRing), NOT the box clock.  When the player breathes in
      // time with the 4-4-4-4 pacer, the ring swells and contracts in step
      // with the flame + background glow; drift reads as the ring racing
      // ahead of, or lagging behind, the glow's rise and fall.
      const rl = (this.ringLevel == null ? 0.5 : this.ringLevel);
      const ringR = (110 + this.maxH * 0.42) * (0.5 + 0.85 * rl);
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, 6.283);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(255,150,66,${0.15 + 0.165 * rl})`;
      ctx.shadowColor = 'rgba(255,138,52,0.64)';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const pal = this._pal();
      const sorted = this.tongues.slice()
        .sort((a, b) => (a.height * a.width) - (b.height * b.width));

      ctx.globalCompositeOperation = 'lighter';
      for (const t of sorted) {
        this._shape(t, 1.50, 'rgba(170,115,220,0.05)');
        this._shape(t, 1.26, 'rgba(230,120,80,0.07)');
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const t of sorted) this._tongue(t, pal);
      this._drawSparks();
    },

    _drawSparks() {
      if (!this.sparks.length) return;
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'lighter';
      for (const s of this.sparks) {
        const t = 1 - (s.age / s.life);
        const fade = t * t;
        const r = s.size * (0.7 + 0.3 * t) * 3.0;
        const al = 0.8 * fade;
        const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        gr.addColorStop(0,    `rgba(255,235,175,${al})`);
        gr.addColorStop(0.35, `rgba(255,155,65,${al * 0.55})`);
        gr.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },

    _tongue(t, pal) {
      this._shape(t, 1.00, pal.outer);
      this._shape(t, 0.72, pal.middle);
      this._shape(t, 0.46, pal.inner);
      if (t.height * Math.sin((t.age / t.life) * Math.PI) > 75) {
        this._shape(t, 0.22, pal.core);
      }
    },

    _shape(t, scale, color) {
      const ctx = this.ctx;
      const life = t.age / t.life;
      const ls = Math.sin(life * Math.PI);
      if (ls < 0.02) return;
      const h = t.height * ls * scale;
      const w = t.width  * ls * scale;
      if (h < 3 || w < 1.5) return;
      const fx = Math.sin(t.fp)         * 6 * this.Wob * scale;
      const fy = Math.sin(t.fp * 1.3)   * 4;
      const sway = t.sway * 22 * this.Wob * (0.6 + scale);
      const bY = t.baseY;
      const tipX = t.baseX + sway + fx;
      const tipY = bY - h + fy;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(t.baseX - w, bY);
      ctx.bezierCurveTo(t.baseX - w * 1.45, bY - h * 0.22,
                        t.baseX - w * 0.18, bY - h * 0.72,
                        tipX, tipY);
      ctx.bezierCurveTo(t.baseX + w * 0.18, bY - h * 0.72,
                        t.baseX + w * 1.45, bY - h * 0.22,
                        t.baseX + w, bY);
      ctx.bezierCurveTo(t.baseX + w * 0.55, bY + w * 0.45,
                        t.baseX - w * 0.55, bY + w * 0.45,
                        t.baseX - w, bY);
      ctx.closePath();
      ctx.fill();
    },

    _pal() {
      const s = this.Pal;
      if (s <= -1)   return PALETTES.embers;
      if (s <  -0.3) return this._lp(PALETTES.embers, PALETTES.cool, (s + 1) / 0.7);
      if (s <   0.3) return this._lp(PALETTES.cool,   PALETTES.warm, (s + 0.3) / 0.6);
      return                this._lp(PALETTES.warm,   PALETTES.hot,  Math.min(1, (s - 0.3) / 0.7));
    },
    _lp(a, b, t) {
      return {
        outer:  this._lh(a.outer,  b.outer,  t),
        middle: this._lh(a.middle, b.middle, t),
        inner:  this._lh(a.inner,  b.inner,  t),
        core:   this._lh(a.core,   b.core,   t),
      };
    },
    _lh(c1, c2, t) {
      const h = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
      const a = h(c1), b = h(c2);
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
    },
  };

  F.resize();
  window.addEventListener('resize', () => F.resize());
  return F;
}


// ============================================================
// GameApp — screen state machine, box clock, CV wiring
// ============================================================
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------
  const COUNTDOWN_S = 3;
  const BOX_SECONDS = 4;                              // per phase — the "4·4·4·4"
  const PHASE_NAMES = ['breathe in', 'hold', 'breathe out', 'hold'];
  const PHASE_KIND  = ['inhale', 'holdFull', 'exhale', 'holdEmpty'];
  const TARGET_BPM  = 60 / (4 * BOX_SECONDS);         // 3.75 BPM at 4 s

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let _screen      = 'setup';        // 'setup' | 'countdown' | 'active' | 'complete'
  let _durationS   = 300;            // seconds — default 5 min
  let _guideMode   = 'active';       // 'active' | 'passive'

  let flame        = null;
  let socket       = null;
  let camera       = null;

  // Box-clock state (owned by _loop)
  let _phaseIdx      = 0;
  let _phaseElapsed  = 0;
  let _sessionElapsed = 0;
  let _boxLevel      = 0;             // eased 0..1 box breath level (t)
  let _lastFrame     = 0;
  let _raf           = 0;

  // UI throttling — only setText when the value actually changes
  let _lastPhaseName = '';
  let _lastPhaseCount = 0;

  // Capture log — ~10 Hz during active screen; feeds _drawCapture
  let _cap        = [];
  let _lastCapMs  = 0;

  // Chest-signal running state (~15 Hz callback from camera.js)
  let _chestEma   = null;
  let _baseAmp    = 1;
  let _breathLevel = 0.5;            // latest raw breath level 0..1 → sync ring
                                     // (unsmoothed here; the flame's step()
                                     //  lerp is the only smoothing stage so
                                     //  the ring stays in phase with breath)

  // Adherence — starts neutral so the flame paces calmly while CV warms up
  let _adhEma        = 0.6;
  let _signalQuality = 'ok';

  // Countdown timer handle
  let _cdTimer = null;

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  window.addEventListener('load', init);

  function init() {
    const canvas = document.getElementById('flame-canvas');
    flame = createFlameField(canvas);

    _initSetupUI();
    _initCV();
    _initAmbientAudio();
    _startLoop();

    // Adherence updates at 1 Hz (matches game1's slow-metrics cadence);
    // per-frame setAdherence(_adhEma) inside _loop keeps the character
    // smoothed via the lerp in FlameField.step().
    setInterval(_updateAdherence, 1000);
  }

  // ------------------------------------------------------------------
  // CV wiring — no calibration gate.  Camera starts immediately;
  // the pacer + flame + capture all begin at t=0.  Signals ramp in
  // over the first ~20 s while the buffer fills.
  // ------------------------------------------------------------------
  function _initCV() {
    socket = new ClaritySocket(_onMsg);
    camera = new ClarityCamera(() => {}, {
      drawLandmarks: false,
      onChestSample: _onChestSample,
    });
    camera.socket = socket;
    camera.start();
  }

  // Ambient audio — Native American flute loop, mute preference shared
  // with game1 via localStorage key 'clarity.muted'.  Autoplay is best-
  // effort; first user interaction (or the mute-button click itself)
  // satisfies browser autoplay policies.
  function _initAmbientAudio() {
    const audio = document.getElementById('ambient-audio');
    const muteBtn = document.getElementById('mute-btn');
    if (!audio || !muteBtn) return;

    const stored = localStorage.getItem('clarity.muted');
    const startMuted = stored === '1';
    audio.muted = startMuted;
    audio.volume = 0.5;
    muteBtn.setAttribute('aria-pressed', String(startMuted));

    const tryPlay = () => audio.play().catch(() => {});
    tryPlay();
    window.addEventListener('pointerdown', tryPlay, { once: true });

    muteBtn.addEventListener('click', () => {
      audio.muted = !audio.muted;
      muteBtn.setAttribute('aria-pressed', String(audio.muted));
      localStorage.setItem('clarity.muted', audio.muted ? '1' : '0');
      if (!audio.muted && audio.paused) tryPlay();
    });
  }

  function _onMsg(msg) {
    if (msg && msg.type === 'hr_result' && msg.signal_quality) {
      _signalQuality = msg.signal_quality;
    }
  }

  // Called ~15 Hz from camera.js with the raw chest-ROI luminance.
  // Detrends with a slow EMA (drift removal), feeds BreathAnalyzer for
  // rate/regularity, and — during the active screen only — logs the
  // real physical breath at ~10 Hz for the completion graph.  This is
  // the "raw breath pattern" the graph legend promises, NOT the backend
  // FFT (which has 8.5 s latency and a 9 BPM floor).
  function _onChestSample(raw) {
    const now = performance.now();
    _chestEma = (_chestEma == null) ? raw : _chestEma * 0.99 + raw * 0.01;
    const detr = raw - _chestEma;
    BreathAnalyzer.push(detr, now);

    // Normalise the detrended breath into 0..1 with tidal amplitude filling
    // the band.  Feed it straight to _breathLevel (no EMA here — smoothing
    // adds phase lag, which would make an in-sync breather's ring look like
    // it trails the pacer).  Computed on every screen so the ring tracks the
    // breath live; the capture log still only records the active session.
    _baseAmp = BreathAnalyzer.computeAmplitude(20) || _baseAmp || 1;
    const norm = 0.5 + 0.5 * Math.max(-1, Math.min(1, detr / (_baseAmp || 1)));
    _breathLevel = norm;

    if (_screen === 'active') {
      if (now - _lastCapMs >= 100) {
        _lastCapMs = now;
        _cap.push({ t: _sessionElapsed, tgt: _boxLevel, raw: norm, ph: _phaseIdx });
      }
    }
  }

  // Adherence — the only place a live signal shapes the flame's
  // character.  Rate-match (vs. 3.75 BPM) + regularity → 0..1 target,
  // then EMA-smooth toward it.  Freeze the EMA when the signal is
  // poor or the buffer is too short — a bad camera frame must never
  // make the fire twitch.
  function _updateAdherence() {
    const rate = BreathAnalyzer.computeRate(30);
    const reg  = BreathAnalyzer.computeRegularity(30);
    const bufferReady = rate != null && reg != null;
    if (!bufferReady || _signalQuality === 'poor') return;

    const rateMatch = 1 - Math.min(1, Math.abs(rate - TARGET_BPM) / TARGET_BPM);
    const regScore  = 1 - Math.min(1, reg / 0.4);
    const target    = 0.5 * rateMatch + 0.5 * regScore;
    _adhEma += (target - _adhEma) * 0.15;
  }

  // ------------------------------------------------------------------
  // Setup UI — duration + guidance
  // ------------------------------------------------------------------
  function _initSetupUI() {
    const durButtons = document.querySelectorAll('.game2-picker-btn');
    durButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        durButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _durationS = parseInt(btn.dataset.duration, 10);
        document.getElementById('custom-duration').value = '';
      });
    });

    const customInput = document.getElementById('custom-duration');
    customInput.addEventListener('input', () => {
      const mins = parseInt(customInput.value, 10);
      if (mins && mins >= 1 && mins <= 60) {
        durButtons.forEach(b => b.classList.remove('selected'));
        _durationS = mins * 60;
      }
    });

    const modeCards = document.querySelectorAll('.game2-mode-card');
    modeCards.forEach(card => {
      card.addEventListener('click', () => {
        modeCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        _guideMode = card.dataset.mode;
      });
    });

    // Default selection — 5 min · active (matches the prototype's initial state)
    const defaultDur = document.querySelector('.game2-picker-btn[data-duration="300"]');
    if (defaultDur) defaultDur.classList.add('selected');
    const defaultMode = document.querySelector('.game2-mode-card[data-mode="active"]');
    if (defaultMode) defaultMode.classList.add('selected');

    document.getElementById('begin-btn').addEventListener('click', _startCountdown);
    document.getElementById('again-btn').addEventListener('click', _resetToSetup);
  }

  // ------------------------------------------------------------------
  // COUNTDOWN — 3·2·1 → active
  // ------------------------------------------------------------------
  function _startCountdown() {
    _screen = 'countdown';
    _showScreen('countdown-screen');
    let n = COUNTDOWN_S;
    const numEl = document.getElementById('countdown-num');
    numEl.textContent = n;
    _cdTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(_cdTimer); _cdTimer = null;
        _startActive();
      } else {
        numEl.textContent = n;
      }
    }, 1000);
  }

  // ------------------------------------------------------------------
  // ACTIVE — pacer + flame + capture, all starting at t=0
  // ------------------------------------------------------------------
  function _startActive() {
    _screen = 'active';
    _phaseIdx = 0; _phaseElapsed = 0; _sessionElapsed = 0;
    _cap = []; _lastCapMs = 0;
    _lastPhaseName = ''; _lastPhaseCount = 0;

    // Guidance-mode toggle — active shows the phase text, passive
    // hides it (the pulsing radial glow reveals the pattern in both).
    const guide = document.getElementById('phase-guide');
    if (guide) guide.style.display = (_guideMode === 'active') ? 'block' : 'none';

    _showScreen('active-screen');
  }

  function _finishSession() {
    _screen = 'complete';
    _showScreen('complete-screen');
    // Two RAFs so the capture canvas has its final laid-out size
    // (matches the prototype's _finish).
    requestAnimationFrame(() => requestAnimationFrame(_drawCapture));
  }

  function _resetToSetup() {
    _screen = 'setup';
    _showScreen('setup-screen');
  }

  // ------------------------------------------------------------------
  // rAF loop — box clock + flame render.  Runs on every screen so
  // the flame keeps breathing calmly under setup/countdown/complete
  // (b oscillates gently there; the prototype does the same).
  // ------------------------------------------------------------------
  function _startLoop() {
    _lastFrame = performance.now();
    _raf = requestAnimationFrame(_loop);
  }

  function _loop(now) {
    const dt = Math.min(0.05, (now - _lastFrame) / 1000);
    _lastFrame = now;

    let b = 0;
    if (_screen === 'active') {
      _phaseElapsed  += dt;
      _sessionElapsed += dt;
      if (_phaseElapsed >= BOX_SECONDS) {
        _phaseElapsed -= BOX_SECONDS;
        _phaseIdx = (_phaseIdx + 1) % 4;
      }
      const kind = PHASE_KIND[_phaseIdx];
      const t = _phaseElapsed / BOX_SECONDS;
      b = kind === 'inhale'   ? t
        : kind === 'holdFull' ? 1
        : kind === 'exhale'   ? 1 - t
        :                       0;
      _boxLevel = b;

      // Phase label + countdown text (throttled)
      const cnt = Math.max(1, Math.ceil(BOX_SECONDS - _phaseElapsed));
      const name = PHASE_NAMES[_phaseIdx];
      if (name !== _lastPhaseName) {
        _lastPhaseName = name;
        const el = document.getElementById('phase-name');
        if (el) el.textContent = name;
      }
      if (cnt !== _lastPhaseCount) {
        _lastPhaseCount = cnt;
        const el = document.getElementById('phase-count');
        if (el) el.textContent = cnt;
      }

      // Bottom timebar progress
      const fill = document.getElementById('timebar-fill');
      if (fill) {
        const frac = Math.min(1, _sessionElapsed / _durationS);
        fill.style.width = (frac * 100).toFixed(2) + '%';
      }

      if (_sessionElapsed >= _durationS) _finishSession();
    } else {
      // Calm idle wave for setup/countdown/complete
      b = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(now / 2600));
      _boxLevel = b;
    }

    if (flame) {
      flame.setBreath(b);
      flame.setAdherence(_adhEma);
      flame.setBreathRing(_breathLevel);
      flame.step(dt);
      flame.draw();
    }
    _raf = requestAnimationFrame(_loop);
  }

  // ------------------------------------------------------------------
  // Capture graph — draws the raw physical breath (from _onChestSample)
  // vs. the guided box target, with inhale/exhale + hold bands.  Ported
  // from the prototype's _drawCapture; only the data source changed.
  // ------------------------------------------------------------------
  function _drawCapture() {
    const cv = document.getElementById('capture-canvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 720, H = cv.clientHeight || 200;
    cv.width  = Math.floor(W * dpr);
    cv.height = Math.floor(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padL = 10, padR = 10, padT = 16, padB = 16;
    ctx.clearRect(0, 0, W, H);
    const data = _cap || [];
    // Map over the actually-captured span (not the planned duration) so
    // the trace always fills the frame, even on an early finish.
    const span = data.length ? Math.max(data[data.length - 1].t, 1) : 1;
    const X = t => padL + (t / span) * (W - padL - padR);
    const Y = v => (H - padB) - Math.max(0, Math.min(1, v)) * (H - padT - padB);

    // Guided 4-4-4-4 phase bands (inhale/exhale warm, hold violet)
    const bandCol = ph => (ph === 0 || ph === 2)
      ? 'rgba(239,123,42,0.09)'
      : 'rgba(120,90,200,0.13)';
    for (let i = 1; i < data.length; i++) {
      const x0 = X(data[i - 1].t), x1 = X(data[i].t);
      ctx.fillStyle = bandCol(data[i].ph);
      ctx.fillRect(x0, padT, Math.max(1, x1 - x0), H - padT - padB);
    }

    // Guided target curve (dashed)
    if (data.length > 1) {
      ctx.strokeStyle = 'rgba(180,160,220,0.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      data.forEach((d, i) => { const x = X(d.t), y = Y(d.tgt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Raw physical breath (solid)
    if (data.length > 1) {
      ctx.strokeStyle = '#ff8a3d';
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((d, i) => { const x = X(d.t), y = Y(d.raw); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }

    // Baseline
    ctx.strokeStyle = 'rgba(200,190,220,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB);
    ctx.stroke();

    if (!data.length) {
      ctx.fillStyle = 'rgba(200,190,220,0.4)';
      ctx.font = '12px Helvetica Neue, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('no breath captured', W / 2, H / 2);
    }
  }

  // ------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------
  function _showScreen(id) {
    const screens = ['setup-screen', 'countdown-screen', 'active-screen', 'complete-screen'];
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = (s === id) ? '' : 'none';
    });
  }
})();
