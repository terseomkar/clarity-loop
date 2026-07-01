/**
 * Clarity Loop — Observational Mode.
 *
 * Strips out HR, state classification, and absolute posture labels in favor of
 * (a) two raw waveform graphs of the signals the backend actually consumes, and
 * (b) breath + posture metrics computed live, client-side, from the same data.
 *
 * Breath metrics derive from the detrended chest-luminance signal:
 *   - rate           via zero-crossing count over a 30 s window
 *   - tidal volume   locked once after 30 s warmup, peak-to-trough average
 *   - depth          current rolling amplitude vs locked baseline
 *   - I:E ratio      avg rising-half duration vs avg falling-half duration
 *   - breath hold    recent stdev below a relative threshold
 *
 * Posture metrics derive from MediaPipe Pose landmarks (front-view, 7 points):
 *   - shoulder width    |L_sh - R_sh| in normalised image space
 *   - ear→shoulder      avg vertical distance (per side, averaged)
 *   - head lift ratio   ear→shoulder / shoulder width
 *   - back lift ratio   shoulder→hip / shoulder width  (torso openness)
 *   - shoulder→hip      vertical distance, None if hips off-frame
 */

// ============================================================
// TrendGraph — scrolling waveform plot
// ============================================================
class TrendGraph {
  constructor(canvas, opts) {
    this.canvas      = canvas;
    this.ctx         = canvas.getContext('2d');
    this.maxSamples  = opts.maxSamples;
    this.color       = opts.color;
    this.centered    = !!opts.centered;
    this.transform   = opts.transform || (v => v);
    this.values      = [];
    this._scaleEma   = 1e-6;
    this._resizeToContainer();
    window.addEventListener('resize', () => this._resizeToContainer());
  }

  _resizeToContainer() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width  = Math.max(100, rect.width  * dpr);
    this.canvas.height = Math.max(40,  rect.height * dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this._w = rect.width;
    this._h = rect.height;
    this._draw();
  }

  push(raw) {
    const v = this.transform(raw);
    this.values.push(v);
    if (this.values.length > this.maxSamples) this.values.shift();
    const absMax = Math.abs(v);
    this._scaleEma = Math.max(this._scaleEma * 0.995, absMax);
    this._draw();
  }

  _draw() {
    const ctx = this.ctx, W = this._w, H = this._h;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const midY = this.centered ? H / 2 : H - 4;
    ctx.strokeStyle = 'rgba(120, 90, 200, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
    if (this.values.length < 2) return;

    const scale = this._scaleEma || 1;
    const yFor = v => {
      if (this.centered) {
        const n = Math.max(-1, Math.min(1, v / scale));
        return midY - n * (H / 2 - 4);
      } else {
        const n = Math.max(0, Math.min(1, v / scale));
        return midY - n * (H - 8);
      }
    };
    const stepX = W / (this.maxSamples - 1);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin  = 'round';
    ctx.beginPath();
    for (let i = 0; i < this.values.length; i++) {
      const x = i * stepX, y = yFor(this.values[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}


// ============================================================
// BreathAnalyzer — derives metrics from the detrended chest signal
// ============================================================
const BreathAnalyzer = {
  samples: [],         // detrended chest values
  timestamps: [],      // ms (performance.now)
  WINDOW_MS: 60000,    // keep last 60 s for analysis
  EXTREMA_HALF_WIN: 5, // local-extremum half-window (~330 ms at 15 fps)

  push(v, t) {
    this.samples.push(v);
    this.timestamps.push(t);
    const cutoff = t - this.WINDOW_MS;
    while (this.timestamps.length && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
      this.samples.shift();
    }
  },

  _slice(seconds) {
    if (!this.timestamps.length) return null;
    const tEnd = this.timestamps[this.timestamps.length - 1];
    const cutoff = tEnd - seconds * 1000;
    let i = 0;
    while (i < this.timestamps.length && this.timestamps[i] < cutoff) i++;
    return { v: this.samples.slice(i), t: this.timestamps.slice(i) };
  },

  // Breaths per minute via zero crossings of detrended signal
  computeRate(seconds = 30) {
    const s = this._slice(seconds);
    if (!s || s.v.length < 30) return null;
    let crossings = 0;
    for (let i = 1; i < s.v.length; i++) {
      const a = s.v[i - 1], b = s.v[i];
      if ((a > 0 && b <= 0) || (a < 0 && b >= 0)) crossings++;
    }
    const cycles = crossings / 2;
    const elapsedS = (s.t[s.t.length - 1] - s.t[0]) / 1000;
    return elapsedS > 0 ? (cycles / elapsedS) * 60 : null;
  },

  // Local extrema (peaks + troughs) in a recent window
  findExtrema(seconds = 30) {
    const s = this._slice(seconds);
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

  // Average peak-to-trough amplitude across consecutive extrema pairs
  computeAmplitude(seconds = 30) {
    const ex = this.findExtrema(seconds);
    if (ex.length < 2) return null;
    const amps = [];
    for (let i = 0; i < ex.length - 1; i++) {
      if (ex[i].kind !== ex[i + 1].kind) {
        amps.push(Math.abs(ex[i + 1].v - ex[i].v));
      }
    }
    return amps.length ? amps.reduce((a, b) => a + b, 0) / amps.length : null;
  },

  // Average rising-half vs falling-half durations across recent cycles
  computeIE(seconds = 30) {
    const ex = this.findExtrema(seconds);
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

  // Recent-window stdev of detrended signal — drops near zero during a hold
  recentStdev(seconds = 4) {
    const s = this._slice(seconds);
    if (!s || s.v.length < 15) return null;
    const mean = s.v.reduce((a, b) => a + b, 0) / s.v.length;
    let varSum = 0;
    for (const x of s.v) varSum += (x - mean) * (x - mean);
    return Math.sqrt(varSum / s.v.length);
  },
};


// ============================================================
// PostureAnalyzer — derives metrics directly from landmark snapshot
// ============================================================
const PostureAnalyzer = {
  compute(lms) {
    if (!lms) return null;

    const nose  = lms[0],  lEar = lms[7],  rEar = lms[8];
    const lSh   = lms[11], rSh  = lms[12];
    const lHip  = lms[23], rHip = lms[24];

    const visible = lm => lm && (lm.visibility ?? 1) >= 0.5;

    if (!visible(lSh) || !visible(rSh)) return null;

    const shoulderWidth = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y);

    // Per-side ear-to-shoulder vertical distance
    const lE2S = (visible(lEar) ? Math.abs(lEar.y - lSh.y) : null);
    const rE2S = (visible(rEar) ? Math.abs(rEar.y - rSh.y) : null);

    let avgE2S = null, headLiftRatio = null;
    if (lE2S != null && rE2S != null) {
      avgE2S = (lE2S + rE2S) / 2;
      headLiftRatio = shoulderWidth > 0 ? avgE2S / shoulderWidth : null;
    } else if (lE2S != null || rE2S != null) {
      avgE2S = lE2S ?? rE2S;
      headLiftRatio = shoulderWidth > 0 ? avgE2S / shoulderWidth : null;
    }

    let shoulderToHip = null, backLiftRatio = null;
    if (visible(lHip) && visible(rHip)) {
      const shMidY  = (lSh.y + rSh.y) / 2;
      const hipMidY = (lHip.y + rHip.y) / 2;
      shoulderToHip = Math.abs(hipMidY - shMidY);
      backLiftRatio = shoulderWidth > 0 ? shoulderToHip / shoulderWidth : null;
    }

    return { shoulderWidth, avgE2S, headLiftRatio, shoulderToHip, backLiftRatio };
  },
};


// ============================================================
// Observe — wires camera + analyzers + DOM
// ============================================================
const Observe = (() => {
  let camera = null, socket = null;
  let breathGraph = null, restlessGraph = null;

  // Slow EMA for breath detrending — α ≈ 1/(7 s × 15 fps) for a ~7 s baseline
  let _chestSlowEma = null;
  const _CHEST_ALPHA = 0.01;

  // Tidal volume calibration: first computed at 60 s, then refreshed every 10 min.
  // The slow refresh lets the displayed baseline adapt to long-arc session changes
  // without flickering minute-to-minute.  The breathing-depth label compares the
  // current 10 s rolling amplitude against this slowly-moving baseline.
  const BASELINE_LOCK_MS    = 60000;
  const BASELINE_REFRESH_MS = 10 * 60 * 1000;   // 10 min
  let _firstSampleAt        = null;
  let _baselineTidal        = null;
  let _lastBaselineUpdate   = 0;

  // Breath rate refresh cadence (per user spec)
  const RATE_REFRESH_MS = 30000;
  let _lastRateUpdate = 0;

  function init() {
    breathGraph = new TrendGraph(document.getElementById('breath-graph'), {
      maxSamples: 150, color: 'rgba(152, 120, 232, 0.9)', centered: true,
    });
    restlessGraph = new TrendGraph(document.getElementById('restless-graph'), {
      maxSamples: 60,  color: 'rgba(120, 200, 230, 0.9)', centered: false,
    });

    socket = new ClaritySocket(_onMessage);
    camera = new ClarityCamera(_onSignalUpdate, {
      drawLandmarks: true,
      onChestSample: _onChestSample,
      onPoseSample:  _onPoseSample,
    });
    camera.socket = socket;

    document.addEventListener('ws:open',  () => _setStatus('connected'));
    document.addEventListener('ws:close', () => _setStatus('reconnecting…'));

    // Ticker — refreshes metrics that aren't tied to a specific sample arrival
    setInterval(_tick, 1000);

    _startCV();
  }

  async function _startCV() {
    const ok = await camera.start();
    _setStatus(ok ? '' : 'camera access denied');
  }

  // -----------------------------------------------------------
  // Sample handlers (camera callbacks)
  // -----------------------------------------------------------
  function _onChestSample(raw) {
    const now = performance.now();
    if (_firstSampleAt === null) _firstSampleAt = now;

    if (_chestSlowEma === null) _chestSlowEma = raw;
    else _chestSlowEma = _chestSlowEma * (1 - _CHEST_ALPHA) + raw * _CHEST_ALPHA;

    const detrended = raw - _chestSlowEma;
    breathGraph.push(detrended);
    BreathAnalyzer.push(detrended, now);
  }

  function _onPoseSample(landmarks, motionMag) {
    restlessGraph.push(motionMag);
    const m = PostureAnalyzer.compute(landmarks);
    _renderPosture(m);
  }

  function _onSignalUpdate(_flags) { /* unused in observe mode */ }
  function _onMessage(_msg)        { /* backend metrics ignored here */ }

  // -----------------------------------------------------------
  // Ticker — runs the breath metric updates
  // -----------------------------------------------------------
  function _tick() {
    const now = performance.now();
    if (_firstSampleAt === null) return;
    const sinceStart = now - _firstSampleAt;
    const calibrating = sinceStart < BASELINE_LOCK_MS;

    // Tidal volume:
    //   - first lock at 30 s (initial display)
    //   - subsequent refreshes every 10 min from the most recent 30 s of breaths
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

    // Breathing rate — refresh every 30 s only (per spec)
    if (now - _lastRateUpdate >= RATE_REFRESH_MS) {
      const rate = BreathAnalyzer.computeRate(30);
      _setVal('m-br-rate', rate != null ? rate.toFixed(1) : '—');
      _lastRateUpdate = now;
    }

    // Tidal Volume (locked baseline)
    if (_baselineTidal != null) {
      _setVal('m-tidal-volume', _baselineTidal.toFixed(2));
    } else if (calibrating) {
      _setVal('m-tidal-volume', `calibrating ${Math.max(0, Math.ceil((BASELINE_LOCK_MS - sinceStart) / 1000))} s`);
    }

    // Breathing Depth — current 10 s rolling avg amplitude vs baseline
    const curAmp = BreathAnalyzer.computeAmplitude(10);
    if (_baselineTidal != null && curAmp != null) {
      const ratio = curAmp / _baselineTidal;
      let label;
      if (ratio < 0.7)      label = 'shallow';
      else if (ratio > 1.3) label = 'deep';
      else                  label = 'normal';
      _setVal('m-depth', `${label}  (×${ratio.toFixed(2)})`);
    } else if (calibrating) {
      _setVal('m-depth', '—');
    }

    // I:E ratio — exhale duration ÷ inhale duration (single number)
    // Assumes rising-phase of detrended chest signal = inhale.  Polarity can
    // flip with backlit / unusual lighting; if labels feel inverted that's why.
    const ie = BreathAnalyzer.computeIE(20);
    if (ie != null && ie.rising > 0 && ie.falling > 0) {
      _setVal('m-ie-ratio', (ie.falling / ie.rising).toFixed(2));
    } else {
      _setVal('m-ie-ratio', '—');
    }

    // Breath Hold — recent-stdev compared against tidal-volume-derived threshold.
    // Threshold = TV ÷ 2: anything smaller than half a normal breath in
    // recent variability is treated as a hold.  This deliberately absorbs
    // micro-twitches, heartbeat-driven chest motion, and noise-floor jitter
    // that would otherwise trip "breathing" during a real hold.
    // (Note: stdev runs lower than peak-to-peak for a given breath, so this
    // threshold is conservative — genuine shallow breaths still register.)
    // Before tidal volume is locked, fall back to an absolute floor.
    const stdev = BreathAnalyzer.recentStdev(4);
    const holdDot  = document.getElementById('hold-dot');
    const holdText = document.getElementById('hold-text');
    if (stdev == null) {
      holdDot.className  = 'dot-indicator';
      holdText.textContent = '—';
    } else {
      const thresh = (_baselineTidal != null) ? _baselineTidal / 2 : 0.3;
      const held = stdev < thresh;
      holdDot.className  = held ? 'dot-indicator held' : 'dot-indicator breathing';
      holdText.textContent = held ? 'held' : 'breathing';
    }
  }

  // -----------------------------------------------------------
  // Posture rendering
  // -----------------------------------------------------------
  function _renderPosture(m) {
    if (!m) {
      _setVal('m-sw',        '—');
      _setVal('m-e2s',       '—');
      _setVal('m-abs-ratio', '—');
      _setVal('m-back-lift', '—');
      _setVal('m-s2h',       '—');
      return;
    }
    _setVal('m-sw',        m.shoulderWidth.toFixed(3));
    _setVal('m-e2s',       m.avgE2S        != null ? m.avgE2S.toFixed(3)        : '—');
    _setVal('m-abs-ratio', m.headLiftRatio != null ? m.headLiftRatio.toFixed(2) : '—');
    _setVal('m-back-lift', m.backLiftRatio != null ? m.backLiftRatio.toFixed(2) : 'hips off-frame');
    _setVal('m-s2h',       m.shoulderToHip != null ? m.shoulderToHip.toFixed(3) : 'hips off-frame');
  }

  function _setVal(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  function _setStatus(msg) {
    const el = document.getElementById('status-msg');
    if (el) el.textContent = msg;
  }

  return { init };
})();

window.addEventListener('load', () => Observe.init());
