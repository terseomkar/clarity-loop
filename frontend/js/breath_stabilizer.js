/**
 * BreathStabilizer — minimal spike-rejection filter on the per-tick
 * depthRatio signal (current amplitude / baseline tidal volume).
 *
 * Rejects singleton amplitude spikes from body-shift artifacts using a
 * short median filter.  Nothing else — no slew limit, no expansion, no
 * gates.  Slew-limits were clipping genuine deep-breath peaks, and the
 * expansion curve was trying to boost what the slew clipped; both were
 * removed in favor of a cleaner architecture where the "reward slow
 * deep breathing" role is handled at the flame + progress layers by the
 * pace-reward multiplier, not by shaping the depth signal itself.
 *
 * The median filter is the ONE spike-rejection stage we still need at
 * this layer — even a single 15-Hz frame that scrambles the ROI extraction
 * (blink, sudden head turn) can spike computeAmplitude(10) briefly, and
 * the pace/motion gates downstream operate on different signals and can't
 * catch that.
 */
(function () {
  'use strict';

  class BreathStabilizer {
    constructor(opts = {}) {
      this.medianSize = opts.medianSize ?? 3;    // 1 disables median
      this.reset();
    }

    reset() {
      this._buf = [];
    }

    /**
     * @param {number|null} rawDepthRatio  current amplitude / baseline tidal volume
     * @returns {number|null}              median-filtered value, or null
     */
    update(rawDepthRatio /*, timestampMs */) {
      if (rawDepthRatio == null || !isFinite(rawDepthRatio)) return null;
      this._buf.push(rawDepthRatio);
      while (this._buf.length > this.medianSize) this._buf.shift();
      return this._median(this._buf);
    }

    _median(arr) {
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    }
  }

  if (typeof window !== 'undefined') window.BreathStabilizer = BreathStabilizer;
})();
