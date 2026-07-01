/**
 * Clarity Loop — Mirror Mode.
 *
 * Breath rendered as a vector-style fire animation.  The renderer (FlameField)
 * draws cubic-bezier flame tongues with sharp edges and concentric colour
 * layers — inspired by stylised vector campfire illustrations.  Two layers
 * drive the fire:
 *
 *   Real-time chest signal (~15 Hz):
 *       inhale  → all visible flames stretch taller in real time
 *       exhale  → flames settle, sway lengthens
 *
 *   Slow metrics (refreshed every 1 s from a 60 s rolling window):
 *       rate         → wobble (fast = jittery flicker, slow = composed)
 *       depth ratio  → emission rate, base flame size, palette warmth
 *       E:I ratio    → tongue height + lifetime (long exhale = tall coherent fire)
 *       breath hold  → palette shifts to embers, emission near zero
 *
 * Camera + ClarityCamera + WebSocket are reused from the Observation pipeline,
 * but Mirror has its own BreathAnalyzer + state — Observation Mode files are
 * untouched.
 */

// ============================================================
// BreathAnalyzer — self-contained copy (Observation Mode has its own; we
// intentionally do NOT share state across modes so they stay independent)
// ============================================================
const BreathAnalyzer = {
  samples: [],
  timestamps: [],
  WINDOW_MS: 60000,
  EXTREMA_HALF_WIN: 5,

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

  computeIE(sec = 20) {
    const ex = this.findExtrema(sec);
    if (ex.length < 3) return null;
    const rising = [], falling = [];
    for (let i = 0; i < ex.length - 1; i++) {
      const dur = ex[i + 1].t - ex[i].t;
      if (ex[i].kind === 'trough' && ex[i + 1].kind === 'peak') rising.push(dur);
      else if (ex[i].kind === 'peak' && ex[i + 1].kind === 'trough') falling.push(dur);
    }
    if (!rising.length || !falling.length) return null;
    const r = rising.reduce((a, b) => a + b, 0) / rising.length;
    const f = falling.reduce((a, b) => a + b, 0) / falling.length;
    return { rising: r, falling: f };
  },

  recentStdev(sec = 4) {
    const s = this._slice(sec);
    if (!s || s.v.length < 15) return null;
    const m = s.v.reduce((a, b) => a + b, 0) / s.v.length;
    let v = 0;
    for (const x of s.v) v += (x - m) * (x - m);
    return Math.sqrt(v / s.v.length);
  },
};


// ============================================================
// FlameField — vector-style flame tongues with crisp bezier edges.
// Each "tongue" is a teardrop-with-pointed-tip cubic-bezier shape drawn in
// 3-4 concentric colour layers (outer red → middle orange → inner yellow →
// hot core).  Multiple tongues spawn at offset positions to give the
// "multiple licking flames" look from vector illustration references.
// ============================================================

const PALETTES = {
  // Default warm fire palette
  warm:   { outer: '#c92e2e', middle: '#ef7b2a', inner: '#f9c83a', core: '#fff5b0' },
  // Slightly hotter — for deep + long-exhale breathing
  hot:    { outer: '#e93838', middle: '#ff9844', inner: '#ffd34d', core: '#ffffd8' },
  // Cooler / dimmer — for shallow rapid breathing
  cool:   { outer: '#8b2424', middle: '#bc5622', inner: '#d59230', core: '#efcb88' },
  // Embers — during breath hold
  embers: { outer: '#5e1414', middle: '#982f15', inner: '#c0701d', core: '#dca044' },
};

// Cluster of base offsets where flame tongues spawn.  Repeated entries weight
// that position more heavily (centre tongues dominate, sides occasional).
const SOURCE_OFFSETS = [
  { x:   0,  scale: 1.00 },
  { x:   0,  scale: 1.00 },
  { x:   0,  scale: 0.95 },
  { x: -52,  scale: 0.62 },
  { x:  48,  scale: 0.65 },
  { x: -22,  scale: 0.55 },
  { x:  26,  scale: 0.55 },
];

class FlameTongue {
  constructor(baseX, baseY, height, width, life) {
    this.baseX = baseX;
    this.baseY = baseY;
    this.height = height;
    this.width  = width;
    this.maxLife = life;
    this.age = 0;
    this.sway = (Math.random() - 0.5) * 0.9;   // -0.45 to +0.45 — tip drift bias
    this.flickerPhase = Math.random() * Math.PI * 2;
    this.flickerSpeed = 3.5 + Math.random() * 2.5;
  }
}

class FlameField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tongues = [];

    // Targets (lerp-driven) — set by setBreathState
    this.targetEmission     = 6;      // tongues spawned per second
    this.targetHeight       = 180;    // base tongue height (px)
    this.targetWidth        = 42;     // base half-width at base (px)
    this.targetWobble       = 0.45;   // tip flicker / sway multiplier
    this.targetLife         = 1.4;    // tongue lifetime (sec)
    this.targetPaletteShift = 0.0;    // -1.5 = embers, 0 = warm, +1 = hot

    this.emission     = this.targetEmission;
    this.height       = this.targetHeight;
    this.width        = this.targetWidth;
    this.wobble       = this.targetWobble;
    this.life         = this.targetLife;
    this.paletteShift = this.targetPaletteShift;

    // Live breath pulse — boosts flame height in real time during inhale
    this.breathPulse = 0;
    this._pulseEma   = 0;

    this._emitAccum = 0;

    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Ensure the static initial defaults also respect the screen cap so the
    // first second of rendering (before any breath metrics arrive) is bounded.
    if (this.targetHeight > this._maxTargetHeight) {
      this.targetHeight = this._maxTargetHeight;
      this.height       = this.targetHeight;
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = Math.floor(window.innerWidth  * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this._w = window.innerWidth;
    this._h = window.innerHeight;
    this._centerX = this._w / 2;
    this._baseY   = this._h * 0.67;   // base anchored at the top of the lower third — flame rises into the middle band

    // Cap so the tallest flame tip never reaches the Sensing/Observation/Mirror nav
    // (which sits at top:18px + padding ≈ 54px tall).  70px keeps a small visual buffer.
    // Divisor accounts for spawn-time randomness (×1.15) + inhale pulseBoost (×1.22).
    this._maxTargetHeight = Math.max(120, (this._baseY - 70) / 1.45);
  }

  setBreathPulse(level) { this.breathPulse = level; }

  setBreathState({ rate, depthRatio, ieRatio, isHeld }) {
    if (isHeld) {
      // Embers: tiny squat shapes, almost no flicker, glowing ember palette
      this.targetEmission     = 1.2;
      this.targetHeight       = 55;
      this.targetWidth        = 28;
      this.targetWobble       = 0.05;
      this.targetLife         = 3.0;
      this.targetPaletteShift = -1.5;
      return;
    }

    // depthRatio: 1 = normal, <0.7 shallow, >1.3 deep
    const dr = (depthRatio != null && isFinite(depthRatio))
               ? Math.max(0.35, Math.min(2.8, depthRatio))
               : 1.0;
    // rate: ~14 normal, fast >20, slow <8
    const rt = rate != null ? rate : 14;
    const rateNorm = Math.max(0.4, Math.min(2.5, (rt - 6) / 10));
    // E:I: relaxed ≥1.5, rushed <1
    const ie = ieRatio != null ? Math.max(0.5, Math.min(3.5, ieRatio)) : 1.0;
    const ieNorm = Math.max(0.6, Math.min(2.2, ie / 1.3));

    // Mappings — tuned so the contrast between the two extremes is felt:
    //
    //   shallow + fast  → MANY small tongues, very jittery, short lifetime
    //                     (chaotic swarm of small flames at the base)
    //   deep + slow     → fewer but TALL & WIDE tongues, slow flicker, long life
    //                     (big calm lush flame, takes its time)

    // Emission — rate dominates so fast-shallow gets a jittery crowd of tongues
    this.targetEmission = 4 + 5 * rateNorm + 1.5 * dr;
    //   shallow+fast ≈ 4 + 12.5 + 0.5 = 17  (many)
    //   deep+slow    ≈ 4 + 2.0  + 2.9 = 9   (fewer)

    // Height — depth & exhale grow it; rate shrinks it; capped to stay under nav
    const rawHeight = (90 + 165 * dr) * (0.6 + 0.4 * ieNorm) / Math.max(0.7, rateNorm);
    this.targetHeight = Math.min(rawHeight, this._maxTargetHeight);
    //   shallow+fast raw ≈ 148 × 0.84 / 2.5 = 50  (small)
    //   deep+slow    raw ≈ 404 × 1.48 / 0.7 = 854 → clamped to ~maxTargetHeight

    // Width — deep breath broadens the column; fast rate narrows it
    this.targetWidth = 22 + 30 * dr / Math.max(0.9, rateNorm * 0.8);
    //   shallow+fast ≈ 22 + 30×0.35 / 2.0 = 27  (thin)
    //   deep+slow    ≈ 22 + 30×1.9  / 0.9 = 85  (broad)

    // Wobble — exaggerated jitter for fast rates; near-still for slow
    this.targetWobble = 0.08 + 0.85 * rateNorm;
    //   shallow+fast ≈ 0.08 + 2.13 = 2.2   (very jittery)
    //   deep+slow    ≈ 0.08 + 0.34 = 0.42  (calm)

    // Life — long tongues for deep+slow+exhale; short for fast+shallow
    this.targetLife = Math.min(3.8, 0.7 + 1.4 * ieNorm * dr / Math.max(0.7, rateNorm));
    //   shallow+fast ≈ 0.7 + 1.4×0.6×0.35 / 2.5 = 0.82  (brief)
    //   deep+slow    ≈ min(3.8, 0.7 + 1.4×2.0×1.9 / 0.7) = 3.8  (lingering)

    // Palette shift — E:I dominates brightness now (1.4× coefficient vs depth's 0.4).
    // Long exhales push the flame toward the hot palette (bright cores, brilliant
    // edges); short rushed exhales drag it toward cool/embers (dim, desaturated).
    // Rationale: parasympathetic-activating breathwork (extended exhale) should
    // visibly *reward* the user by lighting up the fire.
    this.targetPaletteShift = (dr - 1.0) * 0.4 + 1.4 * (ieNorm - 1);
    //   short exhale (ieNorm=0.6): −0.56 contribution → cool/embers zone
    //   normal       (ieNorm=1.0):  0
    //   long exhale  (ieNorm=2.2): +1.68 contribution → fully hot palette
  }

  step(dt) {
    // Lerp params toward targets for organic transitions
    const k = Math.min(1, dt / 1.8);
    this.emission     += (this.targetEmission     - this.emission)     * k;
    this.height       += (this.targetHeight       - this.height)       * k;
    this.width        += (this.targetWidth        - this.width)        * k;
    this.wobble       += (this.targetWobble       - this.wobble)       * k;
    this.life         += (this.targetLife         - this.life)         * k;
    this.paletteShift += (this.targetPaletteShift - this.paletteShift) * k;

    this._pulseEma = this._pulseEma * 0.75 + this.breathPulse * 0.25;

    // Spawn tongues — emission boosted on inhale
    const liveEmission = Math.max(0.4, this.emission * (1 + this._pulseEma * 0.55));
    this._emitAccum += liveEmission * dt;
    const toSpawn = Math.floor(this._emitAccum);
    this._emitAccum -= toSpawn;
    for (let i = 0; i < toSpawn; i++) this._spawn();

    // Age tongues
    for (let i = this.tongues.length - 1; i >= 0; i--) {
      const t = this.tongues[i];
      t.age += dt;
      t.flickerPhase += dt * t.flickerSpeed * (0.5 + this.wobble);
      if (t.age >= t.maxLife) this.tongues.splice(i, 1);
    }
  }

  _spawn() {
    const src = SOURCE_OFFSETS[Math.floor(Math.random() * SOURCE_OFFSETS.length)];
    const baseX = this._centerX + src.x + (Math.random() - 0.5) * 14;
    const baseY = this._baseY + (Math.random() - 0.5) * 6;
    const h     = this.height * src.scale * (0.85 + Math.random() * 0.30);
    const w     = this.width  * src.scale * (0.80 + Math.random() * 0.40);
    const life  = this.life            * (0.75 + Math.random() * 0.50);
    this.tongues.push(new FlameTongue(baseX, baseY, h, w, life));
  }

  draw() {
    const ctx = this.ctx, W = this._w, H = this._h;

    // Opaque clear — sharp shapes, no trail/ghosting
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05030a';
    ctx.fillRect(0, 0, W, H);

    // Layered ambient haze at the base — warm orange core + outer violet bloom,
    // both anchored to the fire's "ground".  The violet ring is what gives the
    // overall scene its mystical undertone.
    const warmGlow = ctx.createRadialGradient(
      this._centerX, this._baseY + 40, 0,
      this._centerX, this._baseY + 40, 320
    );
    warmGlow.addColorStop(0,   'rgba(220, 90, 35, 0.22)');
    warmGlow.addColorStop(0.5, 'rgba(140, 50, 15, 0.08)');
    warmGlow.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, this._baseY - 240, W, 420);

    const violetBloom = ctx.createRadialGradient(
      this._centerX, this._baseY - 30, 0,
      this._centerX, this._baseY - 30, 380
    );
    violetBloom.addColorStop(0,   'rgba(168, 110, 220, 0.08)');
    violetBloom.addColorStop(0.6, 'rgba(110,  70, 180, 0.04)');
    violetBloom.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = violetBloom;
    ctx.fillRect(0, this._baseY - 380, W, 500);

    const palette = this._currentPalette();
    const sorted = this.tongues.slice().sort(
      (a, b) => (a.height * a.width) - (b.height * b.width)
    );

    // ---- Pass 1: mystical halo (additive blending → blooms where flames overlap)
    ctx.globalCompositeOperation = 'lighter';
    for (const t of sorted) {
      this._drawShape(t, 1.55, 'rgba(170, 115, 220, 0.05)');   // outer violet aura
      this._drawShape(t, 1.28, 'rgba(230, 120,  80, 0.07)');   // inner warm halo blends purple → orange
    }

    // ---- Pass 2: solid vector flame body (crisp edges, source-over)
    ctx.globalCompositeOperation = 'source-over';
    for (const t of sorted) this._drawTongue(t, palette);
  }

  _drawTongue(t, palette) {
    // Concentric layers — outer red drawn first, then orange, yellow, white
    this._drawShape(t, 1.00, palette.outer);
    this._drawShape(t, 0.72, palette.middle);
    this._drawShape(t, 0.46, palette.inner);
    if (t.height * Math.sin((t.age / t.maxLife) * Math.PI) > 75) {
      this._drawShape(t, 0.22, palette.core);
    }
  }

  _drawShape(t, scale, color) {
    const ctx = this.ctx;
    const life      = t.age / t.maxLife;
    const lifeScale = Math.sin(life * Math.PI);  // grows then shrinks (0..1..0)
    if (lifeScale < 0.02) return;

    const pulseBoost = 1 + Math.max(0, this._pulseEma) * 0.22;
    const h = t.height * lifeScale * scale * pulseBoost;
    const w = t.width  * lifeScale * scale;
    if (h < 3 || w < 1.5) return;

    const flickerX = Math.sin(t.flickerPhase)       * 6 * this.wobble * scale;
    const flickerY = Math.sin(t.flickerPhase * 1.3) * 4;
    const sway     = t.sway * 22 * this.wobble * (0.6 + scale);

    const baseY = t.baseY;
    const tipX  = t.baseX + sway + flickerX;
    const tipY  = baseY - h + flickerY;

    // Asymmetric bezier flame: rounded bulge at lower third, sharp point at tip
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(t.baseX - w, baseY);
    // Left edge: base → tip
    ctx.bezierCurveTo(
      t.baseX - w * 1.45, baseY - h * 0.22,    // bulges outward at lower section
      t.baseX - w * 0.18, baseY - h * 0.72,    // narrows inward approaching tip
      tipX,               tipY                  // pointed tip
    );
    // Right edge: tip → base (mirrored, slight asymmetry from flickerX)
    ctx.bezierCurveTo(
      t.baseX + w * 0.18, baseY - h * 0.72,
      t.baseX + w * 1.45, baseY - h * 0.22,
      t.baseX + w,        baseY
    );
    // Rounded base — curve back to the left base, dipping slightly below
    // baseY so the bottom of the flame reads as a soft teardrop instead of a
    // flat cutoff.  Dip scales with width, so concentric layers stay proportional.
    ctx.bezierCurveTo(
      t.baseX + w * 0.55, baseY + w * 0.45,
      t.baseX - w * 0.55, baseY + w * 0.45,
      t.baseX - w,        baseY
    );
    ctx.closePath();
    ctx.fill();
  }

  // -----------------------------------------------------------
  // Palette interpolation across paletteShift in [-1.5, +1.0]
  // -----------------------------------------------------------
  _currentPalette() {
    const s = this.paletteShift;
    if (s <= -1.0) return PALETTES.embers;
    if (s <  -0.3) return this._lerpPalette(PALETTES.embers, PALETTES.cool, (s + 1.0) / 0.7);
    if (s <   0.3) return this._lerpPalette(PALETTES.cool,   PALETTES.warm, (s + 0.3) / 0.6);
    return                this._lerpPalette(PALETTES.warm,   PALETTES.hot,  Math.min(1, (s - 0.3) / 0.7));
  }

  _lerpPalette(a, b, t) {
    return {
      outer:  this._lerpHex(a.outer,  b.outer,  t),
      middle: this._lerpHex(a.middle, b.middle, t),
      inner:  this._lerpHex(a.inner,  b.inner,  t),
      core:   this._lerpHex(a.core,   b.core,   t),
    };
  }

  _lerpHex(c1, c2, t) {
    const h = c => [parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16), parseInt(c.slice(5,7),16)];
    const a = h(c1), b = h(c2);
    const r  = Math.round(a[0] + (b[0] - a[0]) * t);
    const g  = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }
}


// ============================================================
// MirrorApp — wires camera signals to fire
// ============================================================
const MirrorApp = (() => {
  let camera = null, socket = null, fire = null;

  // Detrend EMA — α ≈ 7 s baseline at 15 fps
  let _chestSlowEma = null;
  const _CHEST_ALPHA = 0.01;

  // Calibration / baseline (matches Observation Mode logic but separate state)
  const BASELINE_LOCK_MS    = 60000;
  const BASELINE_REFRESH_MS = 10 * 60 * 1000;
  let _firstSampleAt        = null;
  let _baselineTidal        = null;
  let _lastBaselineUpdate   = 0;

  // Cached slow metrics — raw depthRatio preserved; stabilized version drives the fire
  let _rate = null, _depthRatio = null, _depthRatioStable = null, _ie = null, _isHeld = false;
  const _stabilizer = new BreathStabilizer();

  function init() {
    fire = new FlameField(document.getElementById('flame-canvas'));

    socket = new ClaritySocket(_onMsg);
    camera = new ClarityCamera(_onSignal, {
      drawLandmarks: false,
      onChestSample: _onChestSample,
    });
    camera.socket = socket;

    _startCV();
    _startAnimation();
    setInterval(_updateSlowMetrics, 1000);
  }

  async function _startCV() {
    const ok = await camera.start();
    if (!ok) {
      _setTracking({ faceDetected: false, poseDetected: false });
    }
  }

  function _onChestSample(raw) {
    const now = performance.now();
    if (_firstSampleAt === null) _firstSampleAt = now;
    if (_chestSlowEma === null) _chestSlowEma = raw;
    else _chestSlowEma = _chestSlowEma * (1 - _CHEST_ALPHA) + raw * _CHEST_ALPHA;
    const detrended = raw - _chestSlowEma;
    BreathAnalyzer.push(detrended, now);

    // Real-time breath pulse for the fire — normalise by baseline tidal
    const norm = (_baselineTidal != null && _baselineTidal > 0)
                 ? detrended / _baselineTidal
                 : detrended * 0.3;  // mild scaling pre-calibration
    fire.setBreathPulse(Math.max(-1.2, Math.min(1.2, norm)));
  }

  function _updateSlowMetrics() {
    const now = performance.now();
    if (_firstSampleAt === null) return;
    const sinceStart = now - _firstSampleAt;
    const calibrating = sinceStart < BASELINE_LOCK_MS;

    // Baseline tidal volume — first computed at 60 s, refreshes every 10 min
    if (!calibrating) {
      const due = (_baselineTidal === null)
                  || (now - _lastBaselineUpdate >= BASELINE_REFRESH_MS);
      if (due) {
        const amp = BreathAnalyzer.computeAmplitude(30);
        if (amp != null) {
          _baselineTidal = amp;
          _lastBaselineUpdate = now;
        }
      }
    }

    // Rate (every ~1 s — Mirror needs a faster pulse than Observation to feel alive)
    const rate = BreathAnalyzer.computeRate(30);
    if (rate != null) _rate = rate;

    // Depth ratio — raw stays untouched for future metrics; stabilized drives the fire
    const curAmp = BreathAnalyzer.computeAmplitude(10);
    _depthRatio = (curAmp != null && _baselineTidal != null && _baselineTidal > 0)
                  ? curAmp / _baselineTidal
                  : null;
    _depthRatioStable = _stabilizer.update(_depthRatio, performance.now());

    // E:I ratio (uses falling / rising — falling phase is exhale per our convention)
    const ie = BreathAnalyzer.computeIE(20);
    _ie = (ie != null && ie.rising > 0 && ie.falling > 0)
          ? ie.falling / ie.rising
          : null;

    // Breath hold — same TV/2 logic Omkar refined in Observation Mode
    const stdev = BreathAnalyzer.recentStdev(4);
    const thresh = (_baselineTidal != null) ? _baselineTidal / 2 : 0.3;
    _isHeld = stdev != null && stdev < thresh;

    fire.setBreathState({
      rate:        _rate,
      depthRatio:  _depthRatioStable,
      ieRatio:     _ie,
      isHeld:      _isHeld,
    });

    _setCalibration(_baselineTidal != null);
  }

  function _startAnimation() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);  // clamp dt for tab-switch safety
      last = now;
      fire.step(dt);
      fire.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  function _onSignal(flags) { _setTracking(flags); }
  function _onMsg(_msg)     { /* backend metrics not consumed here */ }

  // Tracking indicator — green when face+pose both locked, yellow when only
  // one is detected (poor / partial signal), red when neither
  function _setTracking(flags) {
    const dot  = document.getElementById('track-dot');
    const text = document.getElementById('track-text');
    if (!dot || !text) return;
    const f = !!(flags && flags.faceDetected);
    const p = !!(flags && flags.poseDetected);
    if (f && p) {
      dot.className   = 'dot-indicator breathing';
      text.textContent = 'tracking';
    } else if (f || p) {
      dot.className   = 'dot-indicator warn';
      text.textContent = 'partial signal';
    } else {
      dot.className   = 'dot-indicator held';
      text.textContent = 'no signal';
    }
  }

  // Calibration indicator — orange while tidal volume is still being established,
  // green once the baseline has locked in
  function _setCalibration(calibrated) {
    const dot  = document.getElementById('calib-dot');
    const text = document.getElementById('calib-text');
    if (!dot || !text) return;
    if (calibrated) {
      dot.className   = 'dot-indicator breathing';
      text.textContent = 'calibrated';
    } else {
      dot.className   = 'dot-indicator warn';
      text.textContent = 'calibrating';
    }
  }

  return { init };
})();

window.addEventListener('load', () => MirrorApp.init());
