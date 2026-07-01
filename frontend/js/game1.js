/**
 * Clarity Loop — Game 1.
 *
 * Scaffolded as a direct copy of Mirror Mode (mirror.js).  Currently behaves
 * identically — the goal of this step is to verify the standalone page works
 * end-to-end before the gamification layer gets added on top.
 *
 * Same architecture:
 *   Real-time chest signal (~15 Hz)  → live flame height pulse
 *   Slow metrics (1 s tick / 60 s window)
 *       rate, depthRatio, ieRatio, isHeld → flame character via FlameField
 *
 * Each mode keeps its own BreathAnalyzer + FlameField — no shared state.
 */

// ============================================================
// BreathAnalyzer
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

  // Regularity — coefficient of variation (stdev / mean) of peak-to-peak
  // breath intervals over the window.  0 = perfectly regular (metronomic),
  // ~0.15 = natural relaxed breath, ~0.3+ = clearly irregular.
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
// FlameField — vector-style flame tongues with crisp bezier edges.
// ============================================================

const PALETTES = {
  warm:   { outer: '#c92e2e', middle: '#ef7b2a', inner: '#f9c83a', core: '#fff5b0' },
  hot:    { outer: '#e93838', middle: '#ff9844', inner: '#ffd34d', core: '#ffffd8' },
  cool:   { outer: '#8b2424', middle: '#bc5622', inner: '#d59230', core: '#efcb88' },
  embers: { outer: '#5e1414', middle: '#982f15', inner: '#c0701d', core: '#dca044' },
};

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
    this.sway = (Math.random() - 0.5) * 0.9;
    this.flickerPhase = Math.random() * Math.PI * 2;
    this.flickerSpeed = 3.5 + Math.random() * 2.5;
  }
}

class FlameField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tongues = [];

    this.targetEmission     = 6;
    this.targetHeight       = 180;
    this.targetWidth        = 42;
    this.targetWobble       = 0.45;
    this.targetLife         = 1.4;
    this.targetPaletteShift = 0.0;

    this.emission     = this.targetEmission;
    this.height       = this.targetHeight;
    this.width        = this.targetWidth;
    this.wobble       = this.targetWobble;
    this.life         = this.targetLife;
    this.paletteShift = this.targetPaletteShift;

    this.breathPulse = 0;
    this._pulseEma   = 0;

    this._emitAccum = 0;

    // Game-1 specific: fire size scales with phoenix-ascent progress.  Starts
    // at 0.15 (small ember while waiting for tracking + calibration) and grows
    // to 1.0 as progress reaches the phoenix transformation.
    this.gameGrowth = 0.15;

    // Sparks system — bright rising motes triggered when E:I > 1.5
    this.sparks       = [];
    this._sparkAccum  = 0;
    this.sparkRate    = 0;     // particles/sec; set externally via setEnvironment

    // Glow boost — scales the base ambient glow alpha when breathing deeply
    this.glowBoost    = 1.0;   // 1.0 normal, up to ~2.5 at deep breathing

    this._resize();
    window.addEventListener('resize', () => this._resize());

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
    this._baseY   = this._h * 0.67;
    this._maxTargetHeight = Math.max(120, (this._baseY - 70) / 1.45);
  }

  setBreathPulse(level) { this.breathPulse = level; }

  setGameGrowth(g) { this.gameGrowth = Math.max(0, Math.min(1, g)); }

  // Engagement layer — sparkRate spawns per second; glowBoost multiplies the
  // ambient base glow alpha.  Driven by E:I and depth respectively (in GameApp).
  setEnvironment({ sparkRate, glowBoost }) {
    if (sparkRate != null) this.sparkRate = Math.max(0, sparkRate);
    if (glowBoost != null) this.glowBoost = Math.max(1.0, Math.min(2.5, glowBoost));
  }

  setBreathState({ rate, depthRatio, ieRatio, isHeld }) {
    if (isHeld) {
      this.targetEmission     = 1.2;
      this.targetHeight       = 55;
      this.targetWidth        = 28;
      this.targetWobble       = 0.05;
      this.targetLife         = 3.0;
      this.targetPaletteShift = -1.5;
      return;
    }

    const dr = (depthRatio != null && isFinite(depthRatio))
               ? Math.max(0.35, Math.min(2.8, depthRatio))
               : 1.0;
    const rt = rate != null ? rate : 14;
    const rateNorm = Math.max(0.4, Math.min(2.5, (rt - 6) / 10));
    const ie = ieRatio != null ? Math.max(0.5, Math.min(3.5, ieRatio)) : 1.0;
    const ieNorm = Math.max(0.6, Math.min(2.2, ie / 1.3));

    this.targetEmission = 4 + 5 * rateNorm + 1.5 * dr;

    const rawHeight = (90 + 165 * dr) * (0.6 + 0.4 * ieNorm) / Math.max(0.7, rateNorm);
    this.targetHeight = Math.min(rawHeight, this._maxTargetHeight);

    this.targetWidth = 22 + 30 * dr / Math.max(0.9, rateNorm * 0.8);

    this.targetWobble = 0.08 + 0.85 * rateNorm;

    this.targetLife = Math.min(3.8, 0.7 + 1.4 * ieNorm * dr / Math.max(0.7, rateNorm));

    this.targetPaletteShift = (dr - 1.0) * 0.4 + 1.4 * (ieNorm - 1);

    // Apply phoenix-ascent growth scaling — multiplies the breath-driven
    // emission + size by the game progress.  Floors prevent the flame from
    // dying entirely (always a visible ember even at game progress 0).
    const g = this.gameGrowth;
    this.targetEmission *= (0.25 + 0.75 * g);
    this.targetHeight   *= (0.30 + 0.70 * g);
    this.targetWidth    *= (0.55 + 0.45 * g);
  }

  step(dt) {
    const k = Math.min(1, dt / 1.8);
    this.emission     += (this.targetEmission     - this.emission)     * k;
    this.height       += (this.targetHeight       - this.height)       * k;
    this.width        += (this.targetWidth        - this.width)        * k;
    this.wobble       += (this.targetWobble       - this.wobble)       * k;
    this.life         += (this.targetLife         - this.life)         * k;
    this.paletteShift += (this.targetPaletteShift - this.paletteShift) * k;

    this._pulseEma = this._pulseEma * 0.75 + this.breathPulse * 0.25;

    const liveEmission = Math.max(0.4, this.emission * (1 + this._pulseEma * 0.55));
    this._emitAccum += liveEmission * dt;
    const toSpawn = Math.floor(this._emitAccum);
    this._emitAccum -= toSpawn;
    for (let i = 0; i < toSpawn; i++) this._spawn();

    for (let i = this.tongues.length - 1; i >= 0; i--) {
      const t = this.tongues[i];
      t.age += dt;
      t.flickerPhase += dt * t.flickerSpeed * (0.5 + this.wobble);
      if (t.age >= t.maxLife) this.tongues.splice(i, 1);
    }

    // Sparks — spawn from flame tips at sparkRate per second (driven by E:I)
    if (this.sparkRate > 0) {
      this._sparkAccum += this.sparkRate * dt;
      const toSpawn = Math.floor(this._sparkAccum);
      this._sparkAccum -= toSpawn;
      for (let i = 0; i < toSpawn; i++) this._spawnSpark();
    } else {
      this._sparkAccum = 0;
    }

    // Update sparks — gentle upward arc with lateral drift
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x  += s.vx * dt;
      s.y  += s.vy * dt;
      s.vy -= 35 * dt;                              // buoyancy
      s.vx += (Math.random() - 0.5) * 40 * dt;      // wander
      s.vx *= (1 - 0.55 * dt);                      // damping
      s.age += dt;
      if (s.age >= s.maxLife) this.sparks.splice(i, 1);
    }
  }

  _spawnSpark() {
    if (this.tongues.length === 0) return;
    const tg = this.tongues[Math.floor(Math.random() * this.tongues.length)];
    const lifeScale = Math.sin((tg.age / tg.maxLife) * Math.PI);
    if (lifeScale < 0.3) return;
    const tipH = tg.height * lifeScale * (0.65 + Math.random() * 0.25);
    this.sparks.push({
      x: tg.baseX + (Math.random() - 0.5) * tg.width * 0.4,
      y: tg.baseY - tipH,
      vx: (Math.random() - 0.5) * 45,
      vy: -70 - Math.random() * 70,
      age: 0,
      maxLife: 1.3 + Math.random() * 1.4,
      size: 1.3 + Math.random() * 1.8,
    });
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

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05030a';
    ctx.fillRect(0, 0, W, H);

    // Ambient glow alphas scale with glowBoost (driven by depth in GameApp)
    const gb = this.glowBoost;
    const warmGlow = ctx.createRadialGradient(
      this._centerX, this._baseY + 40, 0,
      this._centerX, this._baseY + 40, 320 * Math.sqrt(gb)
    );
    warmGlow.addColorStop(0,   `rgba(220, 90, 35, ${0.22 * gb})`);
    warmGlow.addColorStop(0.5, `rgba(140, 50, 15, ${0.08 * gb})`);
    warmGlow.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, this._baseY - 240, W, 420);

    const violetBloom = ctx.createRadialGradient(
      this._centerX, this._baseY - 30, 0,
      this._centerX, this._baseY - 30, 380 * Math.sqrt(gb)
    );
    violetBloom.addColorStop(0,   `rgba(168, 110, 220, ${0.08 * gb})`);
    violetBloom.addColorStop(0.6, `rgba(110,  70, 180, ${0.04 * gb})`);
    violetBloom.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = violetBloom;
    ctx.fillRect(0, this._baseY - 380, W, 500);

    const palette = this._currentPalette();
    const sorted = this.tongues.slice().sort(
      (a, b) => (a.height * a.width) - (b.height * b.width)
    );

    ctx.globalCompositeOperation = 'lighter';
    for (const t of sorted) {
      this._drawShape(t, 1.55, 'rgba(170, 115, 220, 0.05)');
      this._drawShape(t, 1.28, 'rgba(230, 120,  80, 0.07)');
    }

    ctx.globalCompositeOperation = 'source-over';
    for (const t of sorted) this._drawTongue(t, palette);

    // Sparks render last (additive) so they glow above the flame body
    this._drawSparks();
  }

  _drawSparks() {
    if (this.sparks.length === 0) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const t = 1 - (s.age / s.maxLife);
      const fade = t * t;
      const r = s.size * (0.7 + 0.3 * t) * 3.2;
      const alpha = 0.85 * fade;

      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0,    `rgba(255, 235, 175, ${alpha})`);
      grad.addColorStop(0.35, `rgba(255, 155,  65, ${alpha * 0.55})`);
      grad.addColorStop(1,    'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawTongue(t, palette) {
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
    const lifeScale = Math.sin(life * Math.PI);
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

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(t.baseX - w, baseY);
    ctx.bezierCurveTo(
      t.baseX - w * 1.45, baseY - h * 0.22,
      t.baseX - w * 0.18, baseY - h * 0.72,
      tipX,               tipY
    );
    ctx.bezierCurveTo(
      t.baseX + w * 0.18, baseY - h * 0.72,
      t.baseX + w * 1.45, baseY - h * 0.22,
      t.baseX + w,        baseY
    );
    ctx.bezierCurveTo(
      t.baseX + w * 0.55, baseY + w * 0.45,
      t.baseX - w * 0.55, baseY + w * 0.45,
      t.baseX - w,        baseY
    );
    ctx.closePath();
    ctx.fill();
  }

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
// Phoenix — bezier silhouette that hints at the fire's transformation at
// 25/50/75% checkpoints and fully emerges + flies up at 100% completion.
// ============================================================

class Phoenix {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'hidden';   // 'hidden' | 'hint' | 'emerging' | 'flying' | 'gone'
    this.alpha = 0;
    this.scale = 0.5;
    this.x = 0;
    this.y = 0;
    this.timer = 0;
    this.wingPhase = 0;
    this.hintIntensity = 0;  // 1/3, 2/3, 1.0 for the three checkpoints
  }

  triggerHint(intensity) {
    if (this.state === 'emerging' || this.state === 'flying') return;
    this.state = 'hint';
    this.timer = 0;
    this.hintIntensity = intensity;
  }

  triggerEmerge() {
    this.state = 'emerging';
    this.timer = 0;
  }

  isActive() { return this.state !== 'hidden' && this.state !== 'gone'; }

  update(dt, anchorX, anchorY) {
    this.timer += dt;
    this.wingPhase += dt * 5.5;

    if (this.state === 'hint') {
      const dur = 1.8;
      const t = this.timer / dur;
      if (t >= 1) { this.state = 'hidden'; this.alpha = 0; return; }
      // Pulse: fade in, hold briefly, fade out
      this.alpha = Math.sin(t * Math.PI) * 0.55 * this.hintIntensity;
      this.scale = 0.25 + 0.35 * this.hintIntensity;
      this.x = anchorX;
      this.y = anchorY - 80;   // sits inside the upper portion of the flame
    } else if (this.state === 'emerging') {
      const dur = 2.5;
      const t = Math.min(1, this.timer / dur);
      this.alpha = Math.min(1, t * 1.6);
      this.scale = 0.5 + 0.8 * t;
      this.x = anchorX;
      this.y = anchorY - 90 - t * 60;
      if (t >= 1) { this.state = 'flying'; this.timer = 0; }
    } else if (this.state === 'flying') {
      const dur = 3.8;
      const t = this.timer / dur;
      this.alpha = Math.max(0, 1 - t * 0.85);
      this.scale = 1.3 + t * 0.5;
      this.x = anchorX + Math.sin(t * 2.4) * 35;     // gentle lateral sway
      this.y -= (170 + t * 240) * dt;                // accelerating upward
      if (this.y < -260) { this.state = 'gone'; this.alpha = 0; }
    }
  }

  draw() {
    if (this.alpha < 0.01 || !this.isActive()) return;
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);

    const flap = Math.sin(this.wingPhase);   // -1 to +1

    const palette = {
      outer:  '#c92e2e',   // deep red
      middle: '#ef7b2a',   // orange
      inner:  '#f9c83a',   // yellow
      core:   '#fff5b0',   // pale yellow-white
    };

    // Draw order matters — back-to-front:
    //   tail (cascading below) → wings (behind body) → body → head/crest → halo
    this._drawTailFan(ctx, palette);
    this._drawWing(ctx, -1, flap, palette);
    this._drawWing(ctx,  1, flap, palette);
    this._drawBody(ctx, palette);
    this._drawHead(ctx, palette);

    // Mystical halo (additive, surrounds the entire phoenix)
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 110);
    halo.addColorStop(0,   'rgba(255, 200, 120, 0.32)');
    halo.addColorStop(0.5, 'rgba(220, 100,  60, 0.10)');
    halo.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
  }

  // Single feather: pointed tip away from origin (0,0), three concentric
  // layers (red → orange → yellow stripe) for the layered flame-feather look.
  _drawFeather(ctx, length, width, palette) {
    // Outer red
    ctx.fillStyle = palette.outer;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
       width * 0.75, -length * 0.18,
       width * 0.28, -length * 0.70,
       0,            -length
    );
    ctx.bezierCurveTo(
      -width * 0.28, -length * 0.70,
      -width * 0.75, -length * 0.18,
       0,             0
    );
    ctx.closePath();
    ctx.fill();

    // Middle orange
    ctx.fillStyle = palette.middle;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
       width * 0.50, -length * 0.18,
       width * 0.18, -length * 0.60,
       0,            -length * 0.88
    );
    ctx.bezierCurveTo(
      -width * 0.18, -length * 0.60,
      -width * 0.50, -length * 0.18,
       0,             0
    );
    ctx.closePath();
    ctx.fill();

    // Inner yellow stripe down the centre
    ctx.fillStyle = palette.inner;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
       width * 0.28, -length * 0.20,
       width * 0.08, -length * 0.55,
       0,            -length * 0.76
    );
    ctx.bezierCurveTo(
      -width * 0.08, -length * 0.55,
      -width * 0.28, -length * 0.20,
       0,             0
    );
    ctx.closePath();
    ctx.fill();
  }

  // Wing — 8 individual feathers fanned from a shoulder anchor.  dir = -1
  // for left, +1 for right.  The whole fan tilts subtly with flap.
  _drawWing(ctx, dir, flap, palette) {
    ctx.save();
    ctx.translate(dir * 5, -3);
    ctx.rotate(-dir * flap * 0.14);   // gentle flap rotation of the entire fan

    const feathers = [
      { degFromUp:  15, length: 38, width: 6.0 },
      { degFromUp:  32, length: 50, width: 7.0 },
      { degFromUp:  48, length: 58, width: 7.5 },
      { degFromUp:  65, length: 62, width: 7.5 },   // longest (mid-fan tip)
      { degFromUp:  82, length: 58, width: 7.0 },
      { degFromUp: 100, length: 50, width: 6.5 },
      { degFromUp: 118, length: 40, width: 5.5 },
      { degFromUp: 135, length: 28, width: 5.0 },
    ];

    for (const f of feathers) {
      ctx.save();
      ctx.rotate(dir * f.degFromUp * Math.PI / 180);
      this._drawFeather(ctx, f.length, f.width, palette);
      ctx.restore();
    }

    ctx.restore();
  }

  // Tail — 5 long feathers fanning downward from below the body
  _drawTailFan(ctx, palette) {
    ctx.save();
    ctx.translate(0, 14);

    const feathers = [
      { sideOffset: -2, length: 34, width: 4.5 },
      { sideOffset: -1, length: 48, width: 5.5 },
      { sideOffset:  0, length: 62, width: 6.0 },   // center is longest
      { sideOffset:  1, length: 48, width: 5.5 },
      { sideOffset:  2, length: 34, width: 4.5 },
    ];

    const spreadRad = 18 * Math.PI / 180;
    for (const f of feathers) {
      ctx.save();
      // "Down" is π; positive sideOffset rotates counterclockwise from down (right side)
      ctx.rotate(Math.PI - f.sideOffset * spreadRad);
      this._drawFeather(ctx, f.length, f.width, palette);
      ctx.restore();
    }

    ctx.restore();
  }

  // Body — layered teardrop with a glowing yellow gradient core
  _drawBody(ctx, palette) {
    // Outer
    ctx.fillStyle = palette.outer;
    ctx.beginPath();
    ctx.moveTo(0, 15);
    ctx.bezierCurveTo( 8, 10,  7, -10,  0, -15);
    ctx.bezierCurveTo(-7, -10, -8, 10,  0,  15);
    ctx.closePath();
    ctx.fill();

    // Middle orange
    ctx.fillStyle = palette.middle;
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.bezierCurveTo( 5.5, 7,   5.0, -9,  0, -13);
    ctx.bezierCurveTo(-5.0, -9, -5.5,  7,  0,  12);
    ctx.closePath();
    ctx.fill();

    // Inner gradient core (yellow → pale)
    const grad = ctx.createLinearGradient(0, -10, 0, 12);
    grad.addColorStop(0,    palette.inner);
    grad.addColorStop(0.5,  palette.core);
    grad.addColorStop(1,    palette.middle);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.bezierCurveTo( 3, 5,  3, -8,  0, -11);
    ctx.bezierCurveTo(-3, -8, -3, 5,  0,  9);
    ctx.closePath();
    ctx.fill();
  }

  // Head — profile view with crest, beak, and eye.  Face is half the prior
  // size; crest is reduced ~30% so it still reads as a crown but no longer
  // overwhelms the body.
  _drawHead(ctx, palette) {
    // Head outer (red)
    ctx.fillStyle = palette.outer;
    ctx.beginPath();
    ctx.arc(0, -19, 5, 0, Math.PI * 2);
    ctx.fill();

    // Head middle (orange)
    ctx.fillStyle = palette.middle;
    ctx.beginPath();
    ctx.arc(-0.5, -19.5, 3.75, 0, Math.PI * 2);
    ctx.fill();

    // Crest — 5 small feathers fanning upward from the top of the head
    const crest = [
      { x: -3,    deg: -32, length:  8, width: 1.7 },
      { x: -1.5,  deg: -15, length: 11, width: 1.9 },
      { x:  0,    deg:   0, length: 13, width: 2.0 },
      { x:  1.5,  deg:  15, length: 11, width: 1.9 },
      { x:  3,    deg:  32, length:  8, width: 1.7 },
    ];
    for (const c of crest) {
      ctx.save();
      ctx.translate(c.x, -24);
      ctx.rotate(c.deg * Math.PI / 180);
      this._drawFeather(ctx, c.length, c.width, palette);
      ctx.restore();
    }

    // Curved beak (points right, slightly hooked)
    ctx.fillStyle = palette.outer;
    ctx.beginPath();
    ctx.moveTo(4,   -19);
    ctx.quadraticCurveTo(8.5, -18.5,  8, -16);
    ctx.quadraticCurveTo(6.5, -17.5,  4, -17.5);
    ctx.closePath();
    ctx.fill();

    // Eye whites
    ctx.fillStyle = palette.core;
    ctx.beginPath();
    ctx.arc(1.5, -19.5, 1.3, 0, Math.PI * 2);
    ctx.fill();

    // Eye pupil
    ctx.fillStyle = '#1a0a0a';
    ctx.beginPath();
    ctx.arc(1.75, -19.5, 0.65, 0, Math.PI * 2);
    ctx.fill();
  }
}


// ============================================================
// GameApp — wires camera signals to fire + phoenix
// ============================================================
const GameApp = (() => {
  let camera = null, socket = null, fire = null, phoenix = null;

  let _chestSlowEma = null;
  const _CHEST_ALPHA = 0.01;

  const BASELINE_LOCK_MS    = 60000;
  const BASELINE_REFRESH_MS = 10 * 60 * 1000;
  let _firstSampleAt        = null;
  let _baselineTidal        = null;
  let _lastBaselineUpdate   = 0;

  // Raw depthRatio preserved for future metrics; stabilized version drives the
  // fire, the glow-boost, AND the progress rate (so movement spikes don't leak
  // into game progression).
  let _rate = null, _depthRatio = null, _depthRatioStable = null, _ie = null, _isHeld = false;
  let _regularity = null;
  const _stabilizer = new BreathStabilizer();

  // -----------------------------------------------------------
  // Phoenix Ascent — game state
  // -----------------------------------------------------------
  const STATE_IDLE     = 'IDLE';
  const STATE_ACTIVE   = 'ACTIVE';
  const STATE_PAUSED   = 'PAUSED';
  const STATE_COMPLETE = 'COMPLETE';

  let _gameState     = STATE_IDLE;
  let _progress      = 0;          // 0..1
  let _trackingGreen = false;
  let _isCalibrated  = false;

  // Per-second contribution rates — mutable so the demo toggle can swap
  // between normal pacing and 10× demo pacing without reloading the page.
  let DEPTH_RATE   = 0.0060;     // × max(0, dr - 1)
  let IE_RATE      = 0.0050;     // × max(0, ie - 1)
  let REG_POS_MAX  = 0.0030;     // peak when CV → 0
  let REG_NEG_MAX  = 0.0010;     // (currently disabled — penalty branch commented below)

  const RATES_NORMAL = { depth: 0.0060, ie: 0.0050, regPos: 0.0030, regNeg: 0.0010 };
  const RATES_DEMO   = { depth: 0.0600, ie: 0.0500, regPos: 0.0300, regNeg: 0.0100 };

  function _applyRates(useDemo) {
    const r = useDemo ? RATES_DEMO : RATES_NORMAL;
    DEPTH_RATE  = r.depth;
    IE_RATE     = r.ie;
    REG_POS_MAX = r.regPos;
    REG_NEG_MAX = r.regNeg;
  }

  // Regularity thresholds — coefficient-of-variation interpretation
  const REG_GOOD_CV  = 0.15;     // below this → fully positive
  const REG_BAD_CV   = 0.30;     // above this → starts going negative

  // Checkpoint thresholds — each shows a brief phoenix-silhouette hint inside
  // the flame, with intensity scaling so the 75% hint reads as nearly the
  // full phoenix.
  const CHECKPOINTS  = [0.25, 0.50, 0.75];
  let _checkpointsHit = [false, false, false];

  function init() {
    fire    = new FlameField(document.getElementById('flame-canvas'));
    phoenix = new Phoenix(document.getElementById('flame-canvas'));

    socket = new ClaritySocket(_onMsg);
    camera = new ClarityCamera(_onSignal, {
      drawLandmarks: false,
      onChestSample: _onChestSample,
    });
    camera.socket = socket;

    // Replay button → restart the game in place (no re-calibration)
    const replayBtn = document.getElementById('replay-btn');
    if (replayBtn) replayBtn.addEventListener('click', _resetGame);

    // Demo-speed toggle → swap rate constants and restart the run
    const demoToggle = document.getElementById('demo-toggle-input');
    if (demoToggle) {
      demoToggle.addEventListener('change', (e) => {
        _applyRates(e.target.checked);
        _resetGame();
      });
    }

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

    const norm = (_baselineTidal != null && _baselineTidal > 0)
                 ? detrended / _baselineTidal
                 : detrended * 0.3;
    fire.setBreathPulse(Math.max(-1.2, Math.min(1.2, norm)));
  }

  function _updateSlowMetrics() {
    const now = performance.now();
    if (_firstSampleAt === null) return;
    const sinceStart = now - _firstSampleAt;
    const calibrating = sinceStart < BASELINE_LOCK_MS;

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

    const rate = BreathAnalyzer.computeRate(30);
    if (rate != null) _rate = rate;

    const curAmp = BreathAnalyzer.computeAmplitude(10);
    _depthRatio = (curAmp != null && _baselineTidal != null && _baselineTidal > 0)
                  ? curAmp / _baselineTidal
                  : null;
    _depthRatioStable = _stabilizer.update(_depthRatio, performance.now());

    const ie = BreathAnalyzer.computeIE(20);
    _ie = (ie != null && ie.rising > 0 && ie.falling > 0)
          ? ie.falling / ie.rising
          : null;

    const stdev = BreathAnalyzer.recentStdev(4);
    const thresh = (_baselineTidal != null) ? _baselineTidal / 2 : 0.3;
    _isHeld = stdev != null && stdev < thresh;

    _regularity = BreathAnalyzer.computeRegularity(30);

    _setCalibration(_baselineTidal != null);

    // Phoenix-ascent state machine + progress accumulation (dt = 1 s per tick)
    _tickGame(1);

    // Apply game state to the flame.
    //   IDLE     → ember (force held), small flame, no sparks/glow
    //   ACTIVE   → breath-driven, scaled by progress, with sparks/glow rewards
    //   PAUSED   → breath-driven (no force) but progress is frozen
    //   COMPLETE → smoldering ember (force held), small fixed size, no sparks/glow.
    //              This gives the phoenix room to fly away cleanly.
    const isComplete = (_gameState === STATE_COMPLETE);
    const forceHeld  = (_gameState === STATE_IDLE) || isComplete;
    fire.setBreathState({
      rate:        _rate,
      depthRatio:  _depthRatioStable,
      ieRatio:     _ie,
      isHeld:      _isHeld || forceHeld,
    });
    fire.setGameGrowth(isComplete ? 0.25 : (0.15 + 0.85 * _progress));

    const sparkRate = isComplete ? 0
                    : (_ie != null && _ie > 1.5)
                      ? Math.min(25, (_ie - 1.5) * 10)
                      : 0;
    const glowBoost = isComplete ? 1.0
                    : (_depthRatioStable != null && _depthRatioStable > 1.0)
                      ? Math.min(3.0, _depthRatioStable)
                      : 1.0;
    fire.setEnvironment({ sparkRate, glowBoost });

    // Calibration ring — fills as we approach BASELINE_LOCK_MS
    if (_firstSampleAt != null && !_isCalibrated) {
      const sinceStart = now - _firstSampleAt;
      _updateCalibrationProgress(Math.min(1, sinceStart / BASELINE_LOCK_MS));
    }
  }

  function _updateCalibrationProgress(fraction) {
    const circle = document.getElementById('calib-progress-circle');
    if (!circle) return;
    const circumference = 2 * Math.PI * 9;  // r=9 in the SVG
    circle.style.strokeDashoffset = circumference * (1 - fraction);
  }

  // -----------------------------------------------------------
  // Game tick — advances or stalls phoenix-ascent progress
  // -----------------------------------------------------------
  function _tickGame(dt) {
    // Gate: must have BOTH tracking-green AND calibrated to participate
    if (!_trackingGreen || !_isCalibrated) {
      if (_gameState === STATE_ACTIVE) _gameState = STATE_PAUSED;
      _renderProgressUI();
      return;
    }

    // Once both gates pass, enter ACTIVE (from IDLE or PAUSED)
    if (_gameState === STATE_IDLE || _gameState === STATE_PAUSED) {
      _gameState = STATE_ACTIVE;
    }

    if (_gameState !== STATE_ACTIVE) {
      _renderProgressUI();
      return;
    }

    // ---- Contribution rates ----
    let rate = 0;

    // Depth: positive only, scales with how deep beyond normal.
    // Uses the STABILIZED value so single-tick amplitude spikes from body
    // shifts don't leak into game progression, and sustained deep breaths
    // are super-linearly rewarded via the expansion curve.
    if (_depthRatioStable != null && isFinite(_depthRatioStable)) {
      rate += Math.max(0, _depthRatioStable - 1.0) * DEPTH_RATE;
    }

    // E:I: positive only, scales with how extended the exhale is
    if (_ie != null && isFinite(_ie)) {
      rate += Math.max(0, _ie - 1.0) * IE_RATE;
    }

    // Regularity: positive contribution only for now — irregular-breath
    // penalty is intentionally commented out while we feel out whether the
    // negative pressure makes the game feel punitive or motivating.
    if (_regularity != null && isFinite(_regularity)) {
      if (_regularity < REG_GOOD_CV) {
        rate += REG_POS_MAX * (1 - _regularity / REG_GOOD_CV);
      }
      // else if (_regularity > REG_BAD_CV) {
      //   const over = Math.min(1, (_regularity - REG_BAD_CV) / 0.30);
      //   rate -= REG_NEG_MAX * over;
      // }
    }

    _progress = Math.max(0, Math.min(1, _progress + rate * dt));

    // Checkpoint hints — each fires once when progress crosses 25/50/75%
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      if (!_checkpointsHit[i] && _progress >= CHECKPOINTS[i]) {
        _checkpointsHit[i] = true;
        phoenix.triggerHint((i + 1) / 3);   // 0.33 → 0.66 → 1.0
      }
    }

    // Completion — phoenix emerges and flies upward (once)
    if (_progress >= 1 && _gameState !== STATE_COMPLETE) {
      _gameState = STATE_COMPLETE;
      phoenix.triggerEmerge();
    }

    _renderProgressUI();
  }

  function _renderProgressUI() {
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');
    if (fill) {
      fill.style.width = (_progress * 100).toFixed(1) + '%';
      fill.className = 'game-progress-fill'
        + (_gameState === STATE_PAUSED   ? ' paused'   : '')
        + (_gameState === STATE_COMPLETE ? ' complete' : '');
    }
    if (text) {
      if (_gameState === STATE_COMPLETE) {
        text.textContent = 'the phoenix has risen';
      } else if (_gameState === STATE_PAUSED) {
        text.textContent = 'paused — return to camera';
      } else if (_gameState === STATE_ACTIVE) {
        text.textContent = 'ascending — breathe deep and slow';
      } else if (!_trackingGreen) {
        text.textContent = 'waiting for camera lock';
      } else if (!_isCalibrated) {
        text.textContent = 'calibrating breath…';
      } else {
        text.textContent = 'preparing…';
      }
    }
  }

  function _startAnimation() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fire.step(dt);
      fire.draw();
      // Phoenix updates + draws on top of the flame canvas — uses the same
      // base anchor as the fire so hints sit cleanly inside the flame body.
      phoenix.update(dt, fire._centerX, fire._baseY);
      phoenix.draw();
      // Once the phoenix has exited the viewport, surface the replay button
      if (phoenix.state === 'gone' && _gameState === STATE_COMPLETE) {
        const btn = document.getElementById('replay-btn');
        if (btn && btn.style.display === 'none') btn.style.display = 'block';
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // -----------------------------------------------------------
  // Reset — replay button or demo-toggle restarts the game
  // -----------------------------------------------------------
  function _resetGame() {
    _progress         = 0;
    _checkpointsHit   = [false, false, false];
    phoenix.state     = 'hidden';
    phoenix.alpha     = 0;
    phoenix.scale     = 0.5;
    phoenix.timer     = 0;
    _stabilizer.reset();
    _depthRatioStable = null;
    // If we're already calibrated + tracking, jump straight to ACTIVE.
    // Otherwise sit at IDLE until both gates clear.
    _gameState = (_isCalibrated && _trackingGreen) ? STATE_ACTIVE : STATE_IDLE;
    const btn = document.getElementById('replay-btn');
    if (btn) btn.style.display = 'none';
  }

  function _onSignal(flags) { _setTracking(flags); }
  function _onMsg(_msg)     { /* unused */ }

  function _setTracking(flags) {
    const dot  = document.getElementById('track-dot');
    const text = document.getElementById('track-text');
    const f = !!(flags && flags.faceDetected);
    const p = !!(flags && flags.poseDetected);
    _trackingGreen = f && p;   // gates the phoenix-ascent state machine
    if (!dot || !text) return;
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

  function _setCalibration(calibrated) {
    _isCalibrated = !!calibrated;   // gates the phoenix-ascent state machine
    const dot  = document.getElementById('calib-dot');
    const text = document.getElementById('calib-text');
    const ring = document.getElementById('calib-progress-circle');
    if (!dot || !text) return;
    if (calibrated) {
      dot.className     = 'dot-indicator breathing';
      text.textContent  = 'calibrated';
      if (ring) ring.style.opacity = '0';
    } else {
      dot.className     = 'dot-indicator warn';
      text.textContent  = 'calibrating';
      if (ring) ring.style.opacity = '1';
    }
  }

  return { init };
})();

window.addEventListener('load', () => GameApp.init());
