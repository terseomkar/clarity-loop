/**
 * Clarity Loop — Game 4.  Tap the Tide — a guided EFT tapping session.
 *
 * The clock LEADS.  A fixed JS timer walks six tapping points (Top of Head,
 * Eyebrow, Under Eye, Chin, Collarbone, Under Arm) at a fixed dwell (default
 * 11 s) for a chosen number of cycles (default 3), while the player says
 * "I am feeling [emotion] and I accept it" aloud.  MediaPipe Face Mesh + Pose
 * landmarks ONLY locate each point on the player in the live mirrored feed and
 * pin a pulsing marker there — they never gate or advance the clock.
 *
 * Never block on the camera.  The clock runs from t=0.  If the camera is denied
 * or no face is detected, the markers sit at DEFAULT_PTS and the placeholder
 * shows; the session still completes.
 *
 * Screens:  SETUP → COUNTDOWN(3·2·1) → ACTIVE(feed + pinned marker + timer ring
 *                                             + affirmation) → COMPLETE → /survey
 *
 * Ported verbatim from the prototype (docs/game4/Game 4 - Tap the Tide.dc.html):
 *   POINTS, DEFAULT_PTS, _mx, _onFace, _onPose, _loop, _positionMarkers,
 *   _applyActive, _resolvedCycles, _resolvedSpp.  Two stand-ins replaced:
 *   the `emotion` prop → the feeling chosen in the subjective survey; the
 *   demo box (next point / skip to end) → deleted.  ONE MediaPipe pipeline
 *   (ClarityCamera) serves the game via onFaceSample + onPoseSample.
 */
(() => {
  'use strict';

  const COUNTDOWN_S = 3;

  const POINTS = [
    { key: 'crown',  name: 'Top of Head', note: 'tap the crown with two fingers' },
    { key: 'brow',   name: 'Eyebrow',     note: 'the inner edge of the brow' },
    { key: 'eye',    name: 'Under Eye',   note: 'on the bone just beneath the eye' },
    { key: 'chin',   name: 'Chin',        note: 'in the crease between lip and chin' },
    { key: 'collar', name: 'Collarbone',  note: 'just below the collarbone notch' },
    { key: 'arm',    name: 'Under Arm',   note: 'about a hand-width below the armpit' },
  ];

  // Fixed fallback positions (mirrored display space, 0..1) used until MediaPipe
  // pins them.  Kept as the graceful "no camera / no detection yet" fallback.
  const DEFAULT_PTS = {
    crown:  { x: 0.50,  y: 0.13 }, brow: { x: 0.445, y: 0.28 }, eye: { x: 0.445, y: 0.35 },
    chin:   { x: 0.50,  y: 0.48 }, collar: { x: 0.44, y: 0.66 }, arm: { x: 0.36,  y: 0.78 },
  };

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let _screen = 'setup';              // 'setup' | 'countdown' | 'active' | 'complete'

  // Setup selections (drive the run via _resolvedCycles / _resolvedSpp)
  let _cyclesSel   = 3;               // 1 | 3 | 5 | 'custom'
  let _cyclesCustom = '';
  let _sppInput    = 11;

  // Resolved at begin() — the loop, cycle badge and complete headline read these
  let _cycles = 3;
  let _spp    = 11;

  // Clock + marker state (owned by _loop)
  let _pts = null, _tgt = null;
  let _pi = 0, _cy = 0, _pe = 0, _elapsed = 0, _appliedIdx = -1;
  let _last = 0, _raf = 0;
  let _markers = null;
  let _cdTimer = null;
  let _paused = false;

  // Camera state — never gates the clock; only toggles the placeholder
  let _camReady = false, _camError = false;

  // The one string sourced from the survey (never blank)
  let _emotion = 'this feeling';

  let socket = null, camera = null;

  // Element refs
  let _overlay = null, _ring = null, _sec = null, _prog = null, _placeholder = null;
  let _feed = null, _frame = null;

  window.addEventListener('load', init);

  function init() {
    _emotion = _readEmotion();

    _pts = JSON.parse(JSON.stringify(DEFAULT_PTS));
    _tgt = JSON.parse(JSON.stringify(DEFAULT_PTS));

    _overlay     = document.getElementById('g4-overlay');
    _ring        = document.getElementById('g4-ring');
    _sec         = document.getElementById('g4-sec');
    _prog        = document.getElementById('g4-prog');
    _placeholder = document.getElementById('g4-placeholder');
    _feed        = document.getElementById('camera-feed');
    _frame       = document.querySelector('.g4-frame');

    // Emotion copy — the setup "you're working with" line and the active
    // affirmation both read the same string.  Rendered lowercase, never blank.
    document.querySelectorAll('.g4-emotion').forEach((el) => { el.textContent = _emotion; });

    _initSetupUI();
    _syncSetup();
    _showScreen('setup');

    _last = performance.now();
    _raf = requestAnimationFrame(_loop);
  }

  // The subjective survey persists its answers in sessionStorage
  // (oshi_flow.js CS_SURVEY_KEY).  Read the chosen feeling; fall back to a
  // neutral phrase so the affirmation is never blank.
  function _readEmotion() {
    try {
      const raw = sessionStorage.getItem('clarityLoop.survey.v1');
      if (raw) {
        const a = JSON.parse(raw);
        if (a && a.emotion) return String(a.emotion).toLowerCase();
      }
    } catch (_) { /* private mode — neutral fallback below */ }
    return 'this feeling';
  }

  // ------------------------------------------------------------------
  // Setup UI — cycles (1/3/5 + custom) and seconds-per-point pickers
  // ------------------------------------------------------------------
  function _initSetupUI() {
    document.querySelectorAll('.g4-cycle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        _cyclesSel = parseInt(btn.dataset.cy, 10);
        _cyclesCustom = '';
        const custom = document.getElementById('g4-cycles-custom');
        if (custom) custom.value = '';
        _syncSetup();
      });
    });

    const custom = document.getElementById('g4-cycles-custom');
    if (custom) custom.addEventListener('input', () => {
      _cyclesSel = 'custom';
      _cyclesCustom = custom.value;
      _syncSetup();
    });

    const spp = document.getElementById('g4-spp');
    if (spp) spp.addEventListener('input', () => {
      _sppInput = spp.value;
      _syncSetup();
    });

    document.getElementById('g4-begin').addEventListener('click', begin);
    document.getElementById('g4-again').addEventListener('click', again);

    // Active-screen transport — pause/resume the clock and skip to the end.
    document.getElementById('g4-pause').addEventListener('click', _togglePause);
    document.getElementById('g4-skip').addEventListener('click', _skip);
  }

  function _togglePause() {
    if (_screen !== 'active') return;
    _paused = !_paused;
    _setText('g4-pause', _paused ? 'resume' : 'pause');
  }

  function _skip() {
    if (_screen === 'active') _finish();
  }

  function _resolvedCycles() {
    if (_cyclesSel === 'custom') { const n = parseInt(_cyclesCustom, 10); return (n >= 1 && n <= 9) ? n : 3; }
    return _cyclesSel;
  }
  function _resolvedSpp() { const n = parseInt(_sppInput, 10); return (n >= 4 && n <= 30) ? n : 11; }
  function _fmtTotal(sec) { const m = Math.round(sec / 60); return m <= 1 ? '1 min' : m + ' min'; }
  function _words(n) { return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] || String(n); }

  // Reflect the current selection into the picker highlight + flow summary.
  function _syncSetup() {
    document.querySelectorAll('.g4-cycle-btn').forEach((btn) => {
      btn.classList.toggle('selected', _cyclesSel === parseInt(btn.dataset.cy, 10));
    });
    const custom = document.getElementById('g4-cycles-custom');
    if (custom) custom.classList.toggle('selected', _cyclesSel === 'custom');

    const cycles = _resolvedCycles();
    const spp = _resolvedSpp();
    _setText('g4-flow-label',
      cycles + (cycles === 1 ? ' cycle' : ' cycles') + ' · ' + spp
      + 's at each point · about ' + _fmtTotal(cycles * POINTS.length * spp));
  }

  // ------------------------------------------------------------------
  // Flow: setup → countdown → active → complete
  // ------------------------------------------------------------------
  function begin() {
    // Lock the run to the setup selections — this is what drives the clock.
    _cycles = _resolvedCycles();
    _spp    = _resolvedSpp();
    _startCV();

    let n = COUNTDOWN_S;
    _screen = 'countdown';
    _setText('g4-count', n);
    _showScreen('countdown');
    _cdTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(_cdTimer); _cdTimer = null; _startActive(); }
      else _setText('g4-count', n);
    }, 1000);
  }

  function _startActive() {
    _pi = 0; _cy = 0; _pe = 0; _elapsed = 0; _appliedIdx = -1;
    _paused = false;
    _setText('g4-pause', 'pause');
    _screen = 'active';
    _showScreen('active');
    _renderPoint();
  }

  function again() {
    _screen = 'setup';
    _showScreen('setup');
  }

  function _finish() {
    _screen = 'complete';
    _setText('g4-complete-headline',
      (_cycles === 1 ? 'one round' : _words(_cycles) + ' rounds') + ', all the way through');
    _showScreen('complete');
  }

  function _advance() {
    _pi += 1;
    if (_pi >= POINTS.length) {
      _pi = 0; _cy += 1;
      if (_cy >= _cycles) { _finish(); return; }
    }
    _renderPoint();
  }

  // Cycle badge + per-point copy — derive from the chosen cycle count.
  function _renderPoint() {
    const pt = POINTS[_pi] || POINTS[0];
    _setText('g4-cycle', 'Cycle ' + (_cy + 1) + ' of ' + _cycles);
    _setText('g4-point-counter', 'Point ' + (_pi + 1) + ' of ' + POINTS.length + ' · tap gently, steadily');
    _setText('g4-point-name', pt.name);
    _setText('g4-point-note', pt.note);
  }

  // ------------------------------------------------------------------
  // Camera + landmarks — reuse the Sensing pipeline (ClarityCamera).
  // onFaceSample / onPoseSample feed the prototype's landmark math; the
  // rAF loop lerps _pts toward _tgt.  No calibration gate.
  // ------------------------------------------------------------------
  function _startCV() {
    if (camera) return;
    socket = new ClaritySocket(() => {});   // session logging only; replies ignored
    camera = new ClarityCamera(_onSignal, {
      drawLandmarks: false,
      onFaceSample: (lms) => _onFace(lms),  // full Face Mesh landmark array
      onPoseSample: (lms) => _onPose(lms),  // { "11": {x,y,visibility}, ... }
    });
    camera.socket = socket;
    camera.start().then((ok) => {
      if (ok === false) { _camError = true; _updatePlaceholder(); }
    });
  }

  function _onSignal(s) {
    if (s && s.error) { _camError = true; }
    else { _camReady = true; _camError = false; }
    _updatePlaceholder();
  }

  function _updatePlaceholder() {
    if (!_placeholder) return;
    const camOff = !_camReady || _camError;
    _placeholder.style.display = camOff ? 'flex' : 'none';
  }

  // Map a normalized landmark (video space, 0..1) onto the displayed frame
  // as an on-screen fraction (0..1), then mirror x to match the scaleX(-1)
  // feed.  The feed is `object-fit: cover`, so the video is scaled to fill the
  // frame and centre-cropped — a plain `1 - x` only lines up when the camera
  // and frame share an aspect ratio.  Accounting for the cover scale + crop is
  // what actually pins the markers to the body on 16:9 (and any) webcams.
  function _map(nx, ny) {
    const vw = _feed ? _feed.videoWidth  : 0;
    const vh = _feed ? _feed.videoHeight : 0;
    const fw = _frame ? _frame.clientWidth  : 0;
    const fh = _frame ? _frame.clientHeight : 0;
    if (!vw || !vh || !fw || !fh) return { x: 1 - nx, y: ny };  // dims not ready yet
    const s = Math.max(fw / vw, fh / vh);   // object-fit: cover
    const dw = vw * s, dh = vh * s;
    const dx = ((fw - dw) / 2 + nx * dw) / fw;
    const dy = ((fh - dh) / 2 + ny * dh) / fh;
    return { x: 1 - dx, y: dy };            // flip x only (y is not mirrored)
  }

  // Face points from Face Mesh: 10 (forehead top), 152 (chin), 105 (eyebrow).
  // The crown is derived above the forehead by 0.45·faceH.  The under-eye is
  // derived (not a raw lid landmark): centred under the pupil via the eye-corner
  // midpoint (33 outer, 133 inner) and dropped onto the cheekbone just below the
  // lower lid (145) — the raw 145 lands high and toward the corner.
  // `lm` is the landmark array (camera.js already unwrapped multiFaceLandmarks[0]).
  // Derivations happen in normalized space, then _map pins them to the frame.
  function _onFace(lm) {
    if (!lm) return;
    const top = lm[10], chin = lm[152], brow = lm[105];
    const eOut = lm[33], eIn = lm[133], eLow = lm[145];
    if (!top || !chin) return;
    const faceH = chin.y - top.y;
    _tgt.crown = _map(top.x, top.y - 0.45 * faceH);
    if (brow) _tgt.brow = _map(brow.x, brow.y);
    if (eLow) {
      // Sit the under-eye directly below the eyebrow point (same x), keeping
      // the same drop below the lower lid onto the cheekbone.
      const ex = brow ? brow.x : ((eOut && eIn) ? (eOut.x + eIn.x) / 2 : eLow.x);
      _tgt.eye = _map(ex, eLow.y + 0.13 * faceH);
    }
    _tgt.chin = _map(chin.x, chin.y);
  }

  // Body points from Pose: shoulders 11/12 and hips 23/24 derive collarbone
  // and under-arm.  camera.js hands the { idx: {x,y,visibility} } object, so
  // index with lms[11] (not lms.poseLandmarks[11]).  Both points sit on the
  // lm[12]-shoulder side of the body (the opposite side from the first cut).
  function _onPose(lms) {
    if (!lms) return;
    const ls = lms[11], rs = lms[12], lh = lms[23], rh = lms[24];
    if (!ls || !rs) return;
    const cx = (ls.x + rs.x) / 2, cy = (ls.y + rs.y) / 2;
    const sh = rs, opp = ls;      // shoulder these points hang under (+ the other side)
    const hip = rh || lh;         // matching hip for the arm drop
    // Collarbone: ~a quarter of the way from the sternum toward the shoulder,
    // just below the shoulder line (nearer the neck than the shoulder joint).
    _tgt.collar = _map(cx + 0.28 * (sh.x - cx), cy + 0.03);
    // Under-arm: on the side of the ribcage, ~a third of the way down to the hip.
    const armY = hip ? cy + 0.32 * (hip.y - cy) : cy + 0.14;
    _tgt.arm = _map(sh.x + 0.10 * (sh.x - opp.x), armY);
  }

  // ------------------------------------------------------------------
  // rAF loop — smooth positions toward targets (lerp, never snap), then the
  // fixed clock advances the point, ring and progress during the active screen.
  // ------------------------------------------------------------------
  function _loop(now) {
    const dt = Math.min(0.05, (now - _last) / 1000); _last = now;

    for (const k in _pts) {
      const p = _pts[k], t = _tgt[k];
      p.x += (t.x - p.x) * Math.min(1, dt * 6);
      p.y += (t.y - p.y) * Math.min(1, dt * 6);
    }
    _positionMarkers();

    // The clock only advances on the active screen and while not paused.
    // Marker tracking above keeps running when paused, so the points still
    // follow you — only the countdown/point progression is frozen.
    if (_screen === 'active' && !_paused) {
      _pe += dt; _elapsed += dt;
      if (_pe >= _spp) { _pe -= _spp; _advance(); }
      _applyActive();
      if (_ring) {
        const deg = (1 - _pe / _spp) * 360;
        _ring.style.background = `conic-gradient(#9878e8 ${deg.toFixed(1)}deg, rgba(120,90,200,0.15) ${deg.toFixed(1)}deg)`;
      }
      if (_sec) _sec.textContent = String(Math.max(1, Math.ceil(_spp - _pe)));
      if (_prog) {
        const total = POINTS.length * _cycles;
        const done = (_cy * POINTS.length + _pi + _pe / _spp) / total;
        _prog.style.width = (Math.min(1, done) * 100).toFixed(2) + '%';
      }
    }
    _raf = requestAnimationFrame(_loop);
  }

  function _positionMarkers() {
    if (!_overlay) return;
    if (!_markers) _markers = Array.from(_overlay.querySelectorAll('[data-pt]'));
    for (const el of _markers) {
      const p = _pts[el.dataset.pt]; if (!p) continue;
      el.style.left = (p.x * 100).toFixed(2) + '%';
      el.style.top  = (p.y * 100).toFixed(2) + '%';
    }
  }

  function _applyActive() {
    if (_appliedIdx === _pi || !_markers) { _appliedIdx = _pi; return; }
    _appliedIdx = _pi;
    const activeKey = POINTS[_pi].key;
    for (const el of _markers) {
      const active = el.dataset.pt === activeKey;
      const core = el.querySelector('[data-role=core]');
      const r1 = el.querySelector('[data-role=radar]');
      const r2 = el.querySelector('[data-role=radar2]');
      el.style.zIndex = active ? '5' : '1';
      if (active) {
        if (core) {
          core.style.width = '20px'; core.style.height = '20px';
          core.style.background = 'radial-gradient(circle, #f2ecff, #9878e8)';
          core.style.border = '1px solid rgba(216,208,232,0.9)';
          core.style.boxShadow = '0 0 18px rgba(152,120,232,0.9)';
          core.style.animation = 'g4-tap .7s ease-in-out infinite';
        }
        if (r1) r1.style.animation = 'g4-radar 1.6s ease-out infinite';
        if (r2) { r2.style.animation = 'g4-radar 1.6s ease-out infinite'; r2.style.animationDelay = '.8s'; }
      } else {
        if (core) {
          core.style.width = '11px'; core.style.height = '11px';
          core.style.background = 'rgba(216,208,232,0.5)';
          core.style.border = '1px solid rgba(152,120,232,0.55)';
          core.style.boxShadow = 'none'; core.style.animation = 'none';
        }
        if (r1) { r1.style.animation = 'none'; r1.style.opacity = '0'; }
        if (r2) { r2.style.animation = 'none'; r2.style.opacity = '0'; }
      }
    }
  }

  // ------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------
  function _setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

  function _showScreen(name) {
    const ids = { setup: 'g4-setup', countdown: 'g4-countdown', active: 'g4-active', complete: 'g4-complete' };
    for (const key in ids) {
      const el = document.getElementById(ids[key]);
      if (el) el.style.display = (key === name) ? 'flex' : 'none';
    }
  }
})();
