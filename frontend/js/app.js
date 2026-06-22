/**
 * Clarity Loop — App state machine.
 *
 * States (full flow — many implemented in later weeks):
 *   HOME          : seed screen, spiral visual (Week 6)
 *   TRIGGERED     : CV pipeline starts, baseline collection begins
 *   SUBJ_INPUT    : 4-step subjective input flow (Week 4)
 *   INTERVENTION  : active intervention module (Week 4)
 *   POST_SESSION  : post-check + session save (Week 5/6)
 *
 * Week 2: camera auto-starts, both HR and RR update live.
 */

const App = (() => {
  let state = 'HOME';
  let camera = null;
  let socket = null;
  let latestMetrics = {
    bpm: null, rr: null,
    signalQuality: 'waiting', rrQuality: 'waiting',
    wsConnected: false, hasSignal: false, faceDetected: false,
    poseDetected: false,
    posture: null,    // {forward_head_lean, slump_score, ..., restlessness, signal_quality}
    state: null,
  };

  // EMA smoothing (alpha=0.3 → converges in ~5 updates)
  let _smoothedBpm = null;
  let _smoothedRr  = null;
  const _BPM_ALPHA = 0.3;

  // Baseline lock transition tracking (logs once when it flips)
  let _baselineWasLocked = false;

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------
  function init() {
    socket = new ClaritySocket(_onMessage);
    camera = new ClarityCamera(_onSignalUpdate);
    camera.socket = socket;

    document.addEventListener('ws:open', () => {
      latestMetrics.wsConnected = true;
      _renderMetrics();
    });
    document.addEventListener('ws:close', () => {
      latestMetrics.wsConnected = false;
      _renderMetrics();
    });

    _startCV();
  }

  async function _startCV() {
    const ok = await camera.start();
    if (!ok) {
      _setStatus('Camera access denied — check browser permissions.');
    }
  }

  // ----------------------------------------------------------------
  // Message handler
  // ----------------------------------------------------------------
  function _onMessage(msg) {
    if (msg.type === 'hr_result') {
      // Heart rate
      if (msg.bpm != null) {
        _smoothedBpm = _smoothedBpm == null
          ? msg.bpm
          : _BPM_ALPHA * msg.bpm + (1 - _BPM_ALPHA) * _smoothedBpm;
        latestMetrics.bpm = Math.round(_smoothedBpm);
      } else {
        latestMetrics.bpm = null;
      }
      latestMetrics.signalQuality = msg.signal_quality;
      latestMetrics.state         = msg.state;
      latestMetrics.baseline      = msg.baseline || null;

      // Log baseline only on the transition from unlocked → locked
      if (msg.baseline && msg.baseline.locked && !_baselineWasLocked) {
        _baselineWasLocked = true;
        console.log('[baseline] LOCKED', msg.baseline);
      }

      console.log('[hr]', `bpm=${msg.bpm}`, `q=${msg.signal_quality}`, `snr=${msg.snr}`);
      console.log('[rr]', `bpm=${msg.rr_bpm}`, `q=${msg.rr_quality}`, `snr=${msg.rr_snr}`, `peak_hz=${msg.rr_peak_hz}`);

      // Respiration rate (Week 2)
      if (msg.rr_bpm != null) {
        _smoothedRr = _smoothedRr == null
          ? msg.rr_bpm
          : _BPM_ALPHA * msg.rr_bpm + (1 - _BPM_ALPHA) * _smoothedRr;
        latestMetrics.rr = Math.round(_smoothedRr);
      } else {
        latestMetrics.rr = null;
      }
      latestMetrics.rrQuality = msg.rr_quality;

      // Posture + restlessness (Week 3)
      latestMetrics.posture = msg.posture || null;

      _renderMetrics();
    }
  }

  function _onSignalUpdate({ hasSignal, faceDetected, poseDetected }) {
    latestMetrics.hasSignal    = hasSignal;
    latestMetrics.faceDetected = faceDetected;
    if (poseDetected !== undefined) latestMetrics.poseDetected = poseDetected;
    _renderMetrics();
  }

  // ----------------------------------------------------------------
  // DOM updates
  // ----------------------------------------------------------------
  function _renderMetrics() {
    const bpmEl    = document.getElementById('bpm-value');
    const rrEl     = document.getElementById('rr-value');
    const qualEl   = document.getElementById('signal-quality');
    const wsEl     = document.getElementById('ws-status');
    const stateEl  = document.getElementById('phys-state');
    const faceEl   = document.getElementById('face-status');

    if (bpmEl)   bpmEl.textContent   = latestMetrics.bpm  != null ? `${latestMetrics.bpm}`  : '—';
    if (rrEl)    rrEl.textContent    = latestMetrics.rr   != null ? `${latestMetrics.rr}`   : '—';
    if (qualEl)  qualEl.textContent  = latestMetrics.signalQuality || 'waiting';
    if (wsEl)    wsEl.textContent    = latestMetrics.wsConnected ? 'connected' : 'disconnected';
    if (stateEl) stateEl.textContent = latestMetrics.state || 'unknown';
    if (faceEl)  faceEl.textContent  = latestMetrics.faceDetected ? 'face tracked' : 'no face';

    // Posture + restlessness (Week 3)
    const restlessEl = document.getElementById('restless-value');
    const postureEl  = document.getElementById('posture-lines');
    const poseEl     = document.getElementById('pose-status');
    const dotPose    = document.getElementById('dot-pose');

    const p = latestMetrics.posture;
    if (restlessEl) {
      restlessEl.textContent = (p && p.restlessness != null) ? p.restlessness.toFixed(2) : '—';
    }
    if (postureEl) {
      if (p && p.signal_quality === 'ok') {
        const slump = p.slump_score != null ? p.slump_score.toFixed(2) : '—';
        const tilt  = p.head_tilt_deg != null ? `${p.head_tilt_deg.toFixed(0)}°` : '—';
        const lean  = p.forward_head_lean != null ? p.forward_head_lean.toFixed(2) : '—';
        postureEl.innerHTML = `slump ${slump}<br>lean ${lean}<br>tilt ${tilt}`;
      } else if (p && p.signal_quality === 'upper_body_only') {
        const tilt = p.head_tilt_deg != null ? `${p.head_tilt_deg.toFixed(0)}°` : '—';
        const lean = p.forward_head_lean != null ? p.forward_head_lean.toFixed(2) : '—';
        postureEl.innerHTML = `lean ${lean}<br>tilt ${tilt}<br><span style="color:var(--text-faint)">hips off-frame</span>`;
      } else {
        postureEl.textContent = '—';
      }
    }
    if (poseEl) poseEl.textContent = latestMetrics.poseDetected ? 'pose tracked' : 'no pose';
    if (dotPose) dotPose.className = latestMetrics.poseDetected ? 'status-dot ok' : 'status-dot warn';

    // Baseline status line under Physio State
    const baselineEl = document.getElementById('baseline-status');
    if (baselineEl) {
      const b = latestMetrics.baseline;
      if (b && b.locked) {
        const hr  = b.hr_bpm        != null ? Math.round(b.hr_bpm)         : '—';
        const rst = b.restlessness  != null ? b.restlessness.toFixed(2)    : '—';
        const slm = b.posture_slump != null ? b.posture_slump.toFixed(2)   : '—';
        baselineEl.textContent = `baseline · HR ${hr} · rest ${rst} · slump ${slm}`;
      } else {
        baselineEl.textContent = 'baseline: warming up…';
      }
    }

    // Signal dot: green = face + ok quality, yellow = has signal, grey = nothing
    const dotSignal = document.getElementById('dot-signal');
    if (dotSignal) {
      if (latestMetrics.signalQuality === 'ok') {
        dotSignal.className = 'status-dot ok';
      } else if (latestMetrics.hasSignal) {
        dotSignal.className = 'status-dot warn';
      } else {
        dotSignal.className = 'status-dot';
      }
    }

    // Face dot
    const dotFace = document.getElementById('dot-face');
    if (dotFace) {
      dotFace.className = latestMetrics.faceDetected ? 'status-dot ok' : 'status-dot warn';
    }
  }

  function _setStatus(msg) {
    const el = document.getElementById('status-msg');
    if (el) el.textContent = msg;
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
