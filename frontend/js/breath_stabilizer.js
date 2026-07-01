/**
 * BreathStabilizer — turns a noisy per-tick depthRatio (~1 Hz, unit = current
 * amplitude / baseline tidal volume) into a fire-friendly signal that
 *
 *   (a) rejects body-movement transients that spike amplitude for 1-2 ticks,
 *   (b) amplifies sustained deep breaths super-linearly,
 *
 * while leaving raw depthRatio untouched for metrics/logging.
 *
 * Three cascaded stages:
 *   1. Median-of-N filter        — kills singleton spikes
 *   2. Slew-limit up / exp-decay — smooth on rise, natural on release
 *   3. Expansion curve above 1   — reward sustained deep breathing
 *
 * All parameters are tunable per-instance; defaults are calibrated for the
 * 1 Hz Mirror / Game 1 metric loop.
 */
(function () {
  'use strict';

  class BreathStabilizer {
    constructor(opts = {}) {
      this.medianSize     = opts.medianSize     ?? 3;      // 1 disables median
      this.maxRisePerSec  = opts.maxRisePerSec  ?? 0.6;    // depth-ratio units / sec
      this.decayTau       = opts.decayTau       ?? 0.35;   // seconds (fall)
      this.expansionPower = opts.expansionPower ?? 2.0;    // >1 = super-linear
      this.expansionCoef  = opts.expansionCoef  ?? 1.5;    // strength of tail
      this.reset();
    }

    reset() {
      this._buf = [];
      this._value = null;
      this._lastMs = null;
    }

    /**
     * @param {number|null} rawDepthRatio  current amplitude / baseline tidal volume
     * @param {number}      timestampMs    performance.now()
     * @returns {number|null}              stabilized + amplified value, or null
     */
    update(rawDepthRatio, timestampMs) {
      if (rawDepthRatio == null || !isFinite(rawDepthRatio)) return null;

      // 1. Median filter — rejects single-tick amplitude spikes from body shifts
      this._buf.push(rawDepthRatio);
      while (this._buf.length > this.medianSize) this._buf.shift();
      const filtered = this._median(this._buf);

      // 2. Asymmetric time filter
      if (this._lastMs == null || this._value == null) {
        this._value = filtered;
      } else {
        const dt = Math.max(0.001, (timestampMs - this._lastMs) / 1000);
        if (filtered > this._value) {
          const cap = this._value + this.maxRisePerSec * dt;
          this._value = Math.min(filtered, cap);
        } else {
          const alpha = 1 - Math.exp(-dt / this.decayTau);
          this._value += alpha * (filtered - this._value);
        }
      }
      this._lastMs = timestampMs;

      // 3. Expansion — sustained deep breaths get super-linear reward
      const dev = this._value - 1.0;
      if (dev <= 0) return this._value;
      return 1.0 + dev + this.expansionCoef * Math.pow(dev, this.expansionPower);
    }

    _median(arr) {
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    }
  }

  if (typeof window !== 'undefined') window.BreathStabilizer = BreathStabilizer;
})();
