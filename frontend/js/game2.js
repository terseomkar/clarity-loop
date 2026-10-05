/**
 * Clarity Loop — Game 2: Grandmaster's Count  (page: /game2)
 * An ambient bird-call counting meditation.
 *
 * This game uses NO camera and NO WebSocket — it is audio + clicks only, so
 * its reflection back on /survey is based on the intensity ring alone.
 *
 * The user picks a session duration and a mode:
 *   INTERACTIVE — click anywhere each time a bird call is heard
 *   EYES-CLOSED — no interaction; report the count at the end
 *
 * Session mechanics:
 *   • Ambient waterfall loops continuously at ~50% volume
 *   • Bird calls schedule at random intervals in
 *     [BIRD_MIN_INTERVAL_S, BIRD_MAX_INTERVAL_S] seconds (15–37 s)
 *   • ~15% of calls become a "cluster" — a second call 2-4 s later
 *   • Each call picks randomly between the two bird-call samples and
 *     plays at a random volume in [0.40, 0.80] to simulate calls from
 *     varying distances
 *   • Start + end announced by synthesized chimes so eyes-closed players
 *     know when to open their eyes
 *
 * State machine:
 *   SETUP → COUNTDOWN(3s) → ACTIVE(duration) → REVEAL
 */
(() => {
  'use strict';

  // -----------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------
  const BIRD_MIN_INTERVAL_S = 15;
  const BIRD_MAX_INTERVAL_S = 37;
  const BIRD_VOLUME_MIN     = 0.40;
  const BIRD_VOLUME_MAX     = 0.80;
  const CLUSTER_PROBABILITY = 0.15;
  const CLUSTER_MIN_DELAY_S = 2.0;
  const CLUSTER_MAX_DELAY_S = 4.0;
  const AMBIENT_VOLUME      = 0.50;

  // Guidance prompts — two phrases that alternate during the live session.
  // Each fades in, holds for PROMPT_VISIBLE_S, then fades out; a new one
  // begins every PROMPT_INTERVAL_S so the two alternate on that cadence.
  const GUIDANCE_PROMPTS = [
    'Rest your awareness on the bird calls',
    'Let the water wash away what you don’t need',
  ];
  const PROMPT_VISIBLE_S     = 5;    // how long each phrase stays visible
  const PROMPT_INTERVAL_S    = 25;   // start-to-start spacing (alternation)
  const PROMPT_FIRST_DELAY_S = 4;    // brief settle before the first phrase
  const AMBIENT_SRC         = '/audio/800738__whisperingearth__small-waterfall-in-a-park.mp3';
  const CROSSFADE_S         = 3.0;   // overlap between waterfall loop iterations
  const COUNTDOWN_S         = 3;

  const BIRD_CALL_SOURCES = [
    '/audio/20221__ls__bird-call.wav',
    '/audio/805152__mrspivey__bird-call-01.wav',
  ];

  // -----------------------------------------------------------------
  // State
  // -----------------------------------------------------------------
  let _durationS   = 120;          // user selection, default 2 min
  let _mode        = null;          // 'interactive' | 'eyes-closed'
  let _state       = 'SETUP';       // SETUP | COUNTDOWN | ACTIVE | REVEAL

  let _userTaps          = 0;
  let _actualCallCount   = 0;
  let _sessionStartMs    = 0;
  let _sessionEndMs      = 0;
  const _timeouts        = [];      // for cleanup when session ends early

  // Two audio elements playing the same waterfall track; we crossfade
  // between them at each loop boundary so there's no audible gap.
  let _ambientA = null, _ambientB = null;
  let _ambientTimers    = [];       // outstanding crossfade timers
  let _ambientRunning   = false;
  let _oshiVideo    = null;         // Grandmaster Oshi looping video
  let _audioCtx     = null;         // Web Audio for synthesized chime
  let _oshiCtx      = null;         // canvas 2d for firefly-mote overlay

  // -----------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------
  window.addEventListener('load', init);

  function init() {
    // Create the two crossfading waterfall players up front so the browser
    // starts preloading immediately — by the time the user clicks Begin,
    // both should have their metadata (duration) ready.
    _ambientA = new Audio(AMBIENT_SRC);
    _ambientB = new Audio(AMBIENT_SRC);
    _ambientA.preload = 'auto';
    _ambientB.preload = 'auto';
    _ambientA.volume = 0;
    _ambientB.volume = 0;

    // Oshi video is preloaded but starts PAUSED — Oshi only "wakes up" and
    // begins breathing when the session actually starts.  During SETUP and
    // REVEAL the poster / first frame acts as a still portrait of the scene.
    _oshiVideo = document.getElementById('oshi-media');

    _initOshiCanvas();
    _initSetupUI();
  }

  // -----------------------------------------------------------------
  // Firefly-mote canvas overlay above the Oshi image / video.  Kept
  // deliberately light — the media asset already carries the atmosphere.
  // -----------------------------------------------------------------
  function _initOshiCanvas() {
    const canvas = document.getElementById('oshi-canvas');
    if (!canvas) return;
    _oshiCtx = canvas.getContext('2d');

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.floor(window.innerWidth  * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      _oshiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // ~14 slow-drifting motes; each drifts upward with gentle sinusoidal sway.
    const motes = [];
    const MOTE_COUNT = 14;
    for (let i = 0; i < MOTE_COUNT; i++) {
      motes.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 1.2 + Math.random() * 2.5,
        vy: 6 + Math.random() * 10,       // px per second, upward
        swayAmp:  8 + Math.random() * 18,
        swayFreq: 0.15 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.35 + Math.random() * 0.4,
      });
    }

    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const w = window.innerWidth, h = window.innerHeight;
      _oshiCtx.clearRect(0, 0, w, h);
      _oshiCtx.globalCompositeOperation = 'lighter';

      for (const m of motes) {
        m.y -= m.vy * dt;
        m.phase += m.swayFreq * dt;
        const drawX = m.x + Math.sin(m.phase) * m.swayAmp;

        // Wrap around the top edge → respawn near the bottom
        if (m.y < -10) {
          m.y = h + 10 + Math.random() * 40;
          m.x = Math.random() * w;
        }

        // Soft warm firefly colour with radial fade
        const grad = _oshiCtx.createRadialGradient(drawX, m.y, 0, drawX, m.y, m.r * 4);
        grad.addColorStop(0,   `rgba(255, 220, 140, ${m.alpha})`);
        grad.addColorStop(0.4, `rgba(255, 180, 90, ${m.alpha * 0.5})`);
        grad.addColorStop(1,   'rgba(255, 180, 90, 0)');
        _oshiCtx.fillStyle = grad;
        _oshiCtx.beginPath();
        _oshiCtx.arc(drawX, m.y, m.r * 4, 0, Math.PI * 2);
        _oshiCtx.fill();
      }

      _oshiCtx.globalCompositeOperation = 'source-over';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // -----------------------------------------------------------------
  // SETUP — duration + mode pickers, begin button
  // -----------------------------------------------------------------
  function _initSetupUI() {
    // Duration preset buttons
    const durButtons = document.querySelectorAll('.game2-picker-btn');
    durButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        durButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _durationS = parseInt(btn.dataset.duration, 10);
        document.getElementById('custom-duration').value = '';
        _updateBeginState();
      });
    });

    // Custom duration input — clearing any preset selection
    const customInput = document.getElementById('custom-duration');
    customInput.addEventListener('input', () => {
      const mins = parseInt(customInput.value, 10);
      if (mins && mins >= 2 && mins <= 60) {
        durButtons.forEach(b => b.classList.remove('selected'));
        _durationS = mins * 60;
        _updateBeginState();
      }
    });

    // Mode cards
    const modeCards = document.querySelectorAll('.game2-mode-card');
    modeCards.forEach(card => {
      card.addEventListener('click', () => {
        modeCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        _mode = card.dataset.mode;
        _updateBeginState();
      });
    });

    // Default selection: 2 min, so the user only needs to pick a mode
    const defaultDurBtn = document.querySelector('.game2-picker-btn[data-duration="120"]');
    if (defaultDurBtn) defaultDurBtn.classList.add('selected');

    // Begin
    document.getElementById('begin-btn').addEventListener('click', _startCountdown);
  }

  function _updateBeginState() {
    const beginBtn = document.getElementById('begin-btn');
    beginBtn.disabled = !(_mode && _durationS >= 120);
  }

  // -----------------------------------------------------------------
  // COUNTDOWN
  // -----------------------------------------------------------------
  function _startCountdown() {
    _state = 'COUNTDOWN';
    _showScreen('countdown-screen');

    // Prime the audio context on this user gesture so autoplay policies
    // don't block the ambient track or the synthesized chime later.
    _ensureAudioCtx();
    _startAmbient();

    let n = COUNTDOWN_S;
    const numEl = document.getElementById('countdown-num');
    numEl.textContent = n;
    const tick = () => {
      n--;
      if (n > 0) {
        numEl.textContent = n;
        _timeouts.push(setTimeout(tick, 1000));
      } else {
        numEl.textContent = 'begin';
        _timeouts.push(setTimeout(_startActive, 800));
      }
    };
    _timeouts.push(setTimeout(tick, 1000));
  }

  // -----------------------------------------------------------------
  // ACTIVE — session running
  // -----------------------------------------------------------------
  function _startActive() {
    _state = 'ACTIVE';
    _userTaps        = 0;
    _actualCallCount = 0;
    _sessionStartMs  = performance.now();
    _sessionEndMs    = _sessionStartMs + _durationS * 1000;

    document.body.classList.add(`game2-mode-${_mode}`);
    _showScreen('active-screen');

    // Oshi comes alive — video loops for the entire session duration.
    // play() is safe here because we're inside a user-gesture chain (Begin
    // click → countdown → this), so autoplay policies won't block it.
    if (_oshiVideo) _oshiVideo.play().catch(() => {});

    // Start chime — soft two-tone
    _playChime('start');

    // Interactive-mode tap handler: any click/spacebar/tap logs a bird.
    if (_mode === 'interactive') {
      window.addEventListener('pointerdown', _onUserTap);
      window.addEventListener('keydown', _onKeyDown);
    }

    // Bird-call scheduler + progress-bar loop
    _scheduleNextBirdCall();
    _startProgressLoop();

    // Alternating guidance prompts — shown in both modes.
    _startGuidancePrompts();
  }

  // Fade each phrase in for PROMPT_VISIBLE_S, then out; the next phrase
  // starts one PROMPT_INTERVAL_S later, alternating between the two.  All
  // timers register in _timeouts so _clearAllTimeouts() cancels them when
  // the session ends.
  function _startGuidancePrompts() {
    const el = document.getElementById('game2-prompt');
    if (!el) return;
    el.classList.remove('visible');

    let idx = 0;
    const showNext = () => {
      if (_state !== 'ACTIVE') return;
      el.textContent = GUIDANCE_PROMPTS[idx % GUIDANCE_PROMPTS.length];
      el.classList.add('visible');
      idx++;

      _timeouts.push(setTimeout(() => el.classList.remove('visible'),
                                PROMPT_VISIBLE_S * 1000));
      _timeouts.push(setTimeout(showNext, PROMPT_INTERVAL_S * 1000));
    };

    _timeouts.push(setTimeout(showNext, PROMPT_FIRST_DELAY_S * 1000));
  }

  function _scheduleNextBirdCall() {
    const interval = BIRD_MIN_INTERVAL_S
                   + Math.random() * (BIRD_MAX_INTERVAL_S - BIRD_MIN_INTERVAL_S);
    const id = setTimeout(() => {
      if (_state !== 'ACTIVE') return;
      _triggerBirdCall();

      // Occasional cluster — second call 2-4 s after the first
      if (Math.random() < CLUSTER_PROBABILITY) {
        const clusterDelay = CLUSTER_MIN_DELAY_S
                           + Math.random() * (CLUSTER_MAX_DELAY_S - CLUSTER_MIN_DELAY_S);
        const clusterId = setTimeout(() => {
          if (_state !== 'ACTIVE') return;
          _triggerBirdCall();
        }, clusterDelay * 1000);
        _timeouts.push(clusterId);
      }

      _scheduleNextBirdCall();
    }, interval * 1000);
    _timeouts.push(id);
  }

  function _triggerBirdCall() {
    const src    = BIRD_CALL_SOURCES[Math.floor(Math.random() * BIRD_CALL_SOURCES.length)];
    const volume = BIRD_VOLUME_MIN + Math.random() * (BIRD_VOLUME_MAX - BIRD_VOLUME_MIN);
    const audio  = new Audio(src);
    audio.volume = volume;
    audio.play().catch(err => console.warn('[Clarity g2] bird call play failed:', err));
    _actualCallCount++;
  }

  function _startProgressLoop() {
    const fill = document.getElementById('timebar-fill');
    const tick = () => {
      if (_state !== 'ACTIVE') return;
      const now = performance.now();
      const fraction = Math.min(1, (now - _sessionStartMs) / (_durationS * 1000));
      if (fill) fill.style.width = (fraction * 100).toFixed(2) + '%';
      if (now >= _sessionEndMs) {
        _endSession();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function _onUserTap(e) {
    if (_state !== 'ACTIVE') return;
    _userTaps++;
    _spawnRipple(e.clientX, e.clientY);
  }

  function _onKeyDown(e) {
    if (_state !== 'ACTIVE') return;
    if (e.code === 'Space') {
      e.preventDefault();
      _userTaps++;
      // Ripple in the viewport centre for keyboard taps
      _spawnRipple(window.innerWidth / 2, window.innerHeight / 2);
    }
  }

  // Soft expanding-circle ripple to acknowledge a tap without disturbing calm
  function _spawnRipple(x, y) {
    const el = document.createElement('div');
    el.className = 'game2-ripple';
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // -----------------------------------------------------------------
  // REVEAL
  // -----------------------------------------------------------------
  function _endSession() {
    _state = 'REVEAL';
    _clearAllTimeouts();
    window.removeEventListener('pointerdown', _onUserTap);
    window.removeEventListener('keydown', _onKeyDown);
    _playChime('end');

    // Oshi settles back into stillness — pause the loop so the reveal
    // screen sits over a calm portrait rather than continued motion.
    if (_oshiVideo) _oshiVideo.pause();

    _showScreen('reveal-screen');

    if (_mode === 'eyes-closed') {
      // Ask for the count first, then reveal
      document.getElementById('reveal-input').style.display = '';
      document.getElementById('reveal-result').style.display = 'none';
      const input = document.getElementById('reveal-count-input');
      input.value = '';
      input.focus();
      document.getElementById('reveal-submit-btn').onclick = () => {
        const val = parseInt(input.value, 10);
        _userTaps = isFinite(val) && val >= 0 ? val : 0;
        _showRevealResult();
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') document.getElementById('reveal-submit-btn').click();
      };
    } else {
      _showRevealResult();
    }

    document.getElementById('reveal-again-btn').onclick = _resetToSetup;
  }

  function _showRevealResult() {
    document.getElementById('reveal-input').style.display = 'none';
    document.getElementById('reveal-result').style.display = '';
    document.getElementById('reveal-you').textContent    = _userTaps;
    document.getElementById('reveal-actual').textContent = _actualCallCount;
    document.getElementById('reveal-framing').textContent = _framingFor(_userTaps, _actualCallCount);
  }

  // Phenomenological framing — never "score", never "correct/wrong".
  // The point of the game is presence, not accuracy.
  function _framingFor(heard, actual) {
    if (actual === 0) return 'no birds sang. only the water.';
    const diff = heard - actual;
    if (diff === 0)         return 'each one arrived and was met.';
    if (diff > 0 && diff <= 2) return 'a few arrived without asking. still, you were listening.';
    if (diff > 2)              return 'you were listening for more than sang. that\'s a kind of attention too.';
    if (diff === -1)           return 'one slipped past. or arrived without you.';
    if (diff <= -3)            return 'many arrived while you were somewhere else. the forest kept singing.';
    return 'a few slipped past unnoticed. the forest kept singing regardless.';
  }

  function _resetToSetup() {
    _state = 'SETUP';
    document.body.classList.remove('game2-mode-interactive', 'game2-mode-eyes-closed');
    // Rewind the video so the next session starts from the same still
    // portrait, not from wherever the last pause left off.
    if (_oshiVideo) {
      _oshiVideo.pause();
      try { _oshiVideo.currentTime = 0; } catch (e) { /* ignore */ }
    }
    _showScreen('setup-screen');
  }

  // -----------------------------------------------------------------
  // Waterfall ambient — two Audio() elements playing the same file,
  // crossfaded at each loop boundary so there's no audible gap.  Each
  // "iteration" plays one element from t=0; ~CROSSFADE_S seconds before
  // it ends we start the other element at volume 0 and linearly ramp
  // both (out fading down, in fading up) over CROSSFADE_S seconds.
  // -----------------------------------------------------------------
  function _startAmbient() {
    if (_ambientRunning) return;
    _ambientRunning = true;
    _playAmbientIteration(_ambientA, _ambientB);
  }

  function _stopAmbient() {
    _ambientRunning = false;
    _ambientTimers.forEach(clearTimeout);
    _ambientTimers = [];
    [_ambientA, _ambientB].forEach(a => {
      if (a) { _fadeAudio(a, a.volume, 0, 400); setTimeout(() => a.pause(), 500); }
    });
  }

  function _playAmbientIteration(current, next) {
    if (!_ambientRunning) return;
    current.currentTime = 0;
    current.volume = AMBIENT_VOLUME;
    current.play().catch(err => console.warn('[Clarity g2] ambient play failed', err));

    // Duration may not be known yet if metadata hasn't loaded.  Either
    // schedule immediately or wait for the loadedmetadata event.
    const ready = () => _scheduleCrossfade(current, next);
    if (isFinite(current.duration) && current.duration > 0) {
      ready();
    } else {
      current.addEventListener('loadedmetadata', ready, { once: true });
    }
  }

  function _scheduleCrossfade(current, next) {
    if (!_ambientRunning) return;
    const dur = current.duration;
    // Trigger the crossfade CROSSFADE_S seconds before this iteration ends.
    // Must subtract current.currentTime because on iteration 2+ the "current"
    // audio has already been playing for CROSSFADE_S seconds (that's when the
    // previous crossfade handed it off).  If we don't account for that, every
    // crossfade after the first fires CROSSFADE_S seconds too late — the
    // audio ends before the timer fires and the "incoming" track fades in
    // from silence, reading as an abrupt restart.
    const timeLeft   = dur - current.currentTime;
    const startInMs  = Math.max(0, (timeLeft - CROSSFADE_S) * 1000);
    const startTimer = setTimeout(() => {
      if (!_ambientRunning) return;
      // Kick off the incoming track at volume 0
      next.currentTime = 0;
      next.volume = 0;
      next.play().catch(() => {});
      // Linear crossfade over CROSSFADE_S seconds
      _fadeAudio(current, AMBIENT_VOLUME, 0, CROSSFADE_S * 1000);
      _fadeAudio(next,    0, AMBIENT_VOLUME, CROSSFADE_S * 1000);
      // Once the crossfade completes, pause the outgoing track and
      // start scheduling the NEXT crossfade on what's now the current one.
      const swapTimer = setTimeout(() => {
        if (!_ambientRunning) return;
        current.pause();
        _scheduleCrossfade(next, current);
      }, CROSSFADE_S * 1000);
      _ambientTimers.push(swapTimer);
    }, startInMs);
    _ambientTimers.push(startTimer);
  }

  function _fadeAudio(audio, from, to, durationMs) {
    const startTime = performance.now();
    const step = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // -----------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------
  function _showScreen(id) {
    const screens = ['setup-screen', 'countdown-screen', 'active-screen', 'reveal-screen'];
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = (s === id) ? '' : 'none';
    });
  }

  function _clearAllTimeouts() {
    while (_timeouts.length) clearTimeout(_timeouts.pop());
  }

  function _ensureAudioCtx() {
    if (_audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) _audioCtx = new AC();
  }

  // Soft two-tone chime for start/end — uses Web Audio API so we don't
  // need another asset file.  Gentle warm sine wave with an exponential
  // decay envelope.  Start chime rises; end chime falls (major third down).
  function _playChime(kind) {
    _ensureAudioCtx();
    if (!_audioCtx) return;
    const ctx = _audioCtx;
    const now = ctx.currentTime;
    // A major third — 220 Hz + 277.18 Hz (A3 + C#4)
    const notes = (kind === 'start') ? [220.00, 277.18] : [277.18, 220.00];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Envelope: quick fade-in, ~1.5 s exponential decay
      const t0 = now + i * 0.35;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.22, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 1.7);
    });
  }
})();
