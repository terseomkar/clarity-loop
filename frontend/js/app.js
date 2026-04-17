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
 * Week 1: only the TRIGGERED state is active. The app opens the camera,
 * establishes the WebSocket, and displays live BPM + signal quality.
 * All other states are stubs logging to console.
 */

const App = (() => {
  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let state = 'HOME';
  let camera = null;
  let socket = null;
  let latestMetrics = { bpm: null, signalQuality: 'waiting', wsConnected: false };

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

    // Week 1: auto-start camera on load for validation
    _startCV();
  }

  // ----------------------------------------------------------------
  // CV start (called on TRIGGERED in later weeks)
  // ----------------------------------------------------------------
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
      latestMetrics.bpm = msg.bpm;
      latestMetrics.signalQuality = msg.signal_quality;
      latestMetrics.state = msg.state;
      _renderMetrics();
    }
    // Future: 'intervention', 'pong', etc.
  }

  function _onSignalUpdate({ hasSignal }) {
    latestMetrics.hasSignal = hasSignal;
    _renderMetrics();
  }

  // ----------------------------------------------------------------
  // DOM updates
  // ----------------------------------------------------------------
  function _renderMetrics() {
    const bpmEl = document.getElementById('bpm-value');
    const qualityEl = document.getElementById('signal-quality');
    const wsEl = document.getElementById('ws-status');
    const stateEl = document.getElementById('phys-state');

    if (bpmEl) bpmEl.textContent = latestMetrics.bpm != null ? `${latestMetrics.bpm}` : '—';
    if (qualityEl) qualityEl.textContent = latestMetrics.signalQuality || 'waiting';
    if (wsEl) wsEl.textContent = latestMetrics.wsConnected ? 'connected' : 'disconnected';
    if (stateEl) stateEl.textContent = latestMetrics.state || 'unknown';
  }

  function _setStatus(msg) {
    const el = document.getElementById('status-msg');
    if (el) el.textContent = msg;
  }

  // ----------------------------------------------------------------
  // Public
  // ----------------------------------------------------------------
  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
