/**
 * Oshi Survey & Retrospective — the landing page's logic  (page: / and /survey)
 *
 * Vanilla-JS port of a design prototype made in Claude Design (kept for
 * history at docs/archive/Oshi Survey & Retrospective.dc.html; it does not
 * render on its own).
 *
 * Flow:
 *   welcome → sensation → intensity → body → emotion → offering
 *          → [redirect to the chosen game, /game1–/game4]
 *          → (player clicks "with grandmaster oshi" in the game, back to /survey)
 *          → r_intensity → reflection → complete
 *
 * The games don't run the retrospective themselves. This page resumes
 * automatically when the player returns: the answers are kept in the
 * browser's sessionStorage under CS_SURVEY_KEY. (game4.js also reads that
 * key directly.)
 *
 * Oshi's two-layer voice:
 *   Layer 1 — a scripted line (SCRIPTED below) paints if no live line arrives
 *             within SCRIPTED_FALLBACK_MS (works with no API at all).
 *   Layer 2 — the backend sends an `oshi_line` (live Haiku, or the server's
 *             own scripted line) which is revealed with a typewriter effect.
 *             Stale replies are dropped by comparing req_id.
 *
 * Content constants (CHIP_WORDS, PATHS, INSTRUCTIONS, SCRIPTED, FWHEEL) are
 * ported from the prototype. Oshi's persona text lives only on the server
 * (backend/orchestrator/oshi/master-oshi-ifs-soul-system-prompt.md).
 */

/* eslint-disable no-console */
(() => {
  'use strict';

  // -------------------------------------------------------------------
  // Content constants (verbatim from the prototype)
  // -------------------------------------------------------------------

  const CHIP_WORDS = ['tightness','heavy','jittery','pressure','numbness','activated','spacious','cold'];

  // Chip word → the word the backend's rules.py decision table expects.
  // Four chips already match directly; jittery→buzzing, heavy→pressure.
  // activated/spacious match no rule. The client sends the translated word
  // as `sensation_alias`; Oshi's narration still uses the ORIGINAL word.
  const CHIP_ALIAS = { jittery: 'buzzing', heavy: 'pressure' };

  const PATHS = [
    { key:'game1', title:'phoenix ascent',       goal:'grounded & relaxed',    desc:'breathe, and watch a slow fire rise into flight — the earth beneath you steadies.' },
    { key:'game2', title:"grandmaster's count",  goal:'reset mind & focus',    desc:'count the bird calls as they pass through — the mind rinses clear and gathers to a point.' },
    { key:'game3', title:'flame flow',           goal:'regulate inner world',  desc:'follow the flame with your breath — inhale, hold, exhale, hold — the fire leads, you let it settle you.' },
    { key:'game4', title:'tap the tide',          goal:'let the feeling move',  desc:'tap through six points on your body while you name the feeling aloud — let it move instead of holding it in.' },
  ];

  const INSTRUCTIONS = {
    sensation:   'choose the sensation closest to what you notice · or name your own',
    intensity:   'drag outward — grow the ring until it feels true',
    body:        'tap the one place it lives most',
    emotion:     'tap wherever you feel it — the outer rings name it most precisely',
    offering:    'choose one path to walk',
    r_intensity: 'and now — drag the ring to its size in this moment',
  };

  // Layer-1 scripted floor, used when no `oshi_line` arrives in time (e.g.
  // the socket isn't connected). NOTE: these are NOT the same strings as the
  // server's backend/orchestrator/oshi/guardrails.py SCRIPTED — the server
  // copy was later rewritten in a shorter voice. When the backend is up, the
  // player sees the server's version. See docs/KNOWN_ISSUES.md.
  const SCRIPTED = {
    welcome:     'welcome, traveler — settle onto the branch beside me, and we will meet whatever has come to sit with you today.',
    sensation:   'somewhere in you a current is moving; what is its texture — a tight bark, a cold fog, a buzzing ember?',
    intensity:   'let the ring grow until it matches how much space this part is asking for in your inner valley.',
    body:        'every current chooses a place to rest — where in your temple has this one settled?',
    emotion:     'step back into soft curiosity, and let this part show you the color it carries into your sky.',
    offering:    'four paths open from this branch — one to root you into the earth, one to rinse the mind clear, one to let the flame breathe with you, one to tap the feeling loose.',
    session:     'the forest will hold you now; return to me when the last bird has gone quiet.',
    r_intensity: 'and now — how vast is the wave? let the ring find its new size.',
    complete:    'nothing needed fixing — something was simply met, and welcomed.',
  };

  // Portrait swap per screen.  Files live at /static/img/oshi-*.png
  // (frontend/ is mounted at /static in backend/main.py).
  const PORTRAITS = {
    welcome:     '/static/img/oshi-smile.png',
    sensation:   '/static/img/oshi-meditate.png',
    intensity:   '/static/img/oshi-stones.png',
    body:        '/static/img/oshi-meditate.png',
    emotion:     '/static/img/oshi-glyphs.png',
    offering:    '/static/img/oshi-spiral.png',
    session:     '/static/img/oshi-serene.png',
    r_intensity: '/static/img/oshi-stones.png',
    reflection:  '/static/img/oshi-serene.png',
    complete:    '/static/img/oshi-smile.png',
  };

  // Geoffrey Roberts feeling wheel (verbatim from prototype).  Drives
  // _buildWheel: 7 cores → secondary → tertiary leaves, clockwise from
  // top: Fearful, Angry, Disgusted, Sad, Happy, Surprised, Bad.
  const FWHEEL = [
    { core:'Fearful', rgb:[240,178,90], mids:[
      { m:'Scared',    o:['Helpless','Frightened'] }, { m:'Anxious',    o:['Overwhelmed','Worried'] },
      { m:'Insecure',  o:['Inadequate','Inferior'] }, { m:'Weak',       o:['Worthless','Insignificant'] },
      { m:'Rejected',  o:['Excluded','Persecuted'] }, { m:'Threatened', o:['Nervous','Exposed'] } ] },
    { core:'Angry', rgb:[239,120,120], mids:[
      { m:'Let down',    o:['Betrayed','Resentful'] },  { m:'Humiliated', o:['Disrespected','Ridiculed'] },
      { m:'Bitter',      o:['Indignant','Violated'] },  { m:'Mad',        o:['Furious','Jealous'] },
      { m:'Aggressive',  o:['Provoked','Hostile'] },    { m:'Frustrated', o:['Infuriated','Annoyed'] },
      { m:'Distant',     o:['Withdrawn','Numb'] },      { m:'Critical',   o:['Sceptical','Dismissive'] } ] },
    { core:'Disgusted', rgb:[168,168,172], mids:[
      { m:'Disapproving', o:['Judgmental','Embarrassed'] }, { m:'Disappointed', o:['Appalled','Revolted'] },
      { m:'Awful',        o:['Nauseated','Detestable'] },   { m:'Repelled',     o:['Horrified','Hesitant'] } ] },
    { core:'Sad', rgb:[127,168,217], mids:[
      { m:'Hurt',       o:['Embarrassed','Disappointed'] }, { m:'Depressed',  o:['Inferior','Empty'] },
      { m:'Guilty',     o:['Remorseful','Ashamed'] },       { m:'Despair',    o:['Powerless','Grief'] },
      { m:'Vulnerable', o:['Fragile','Victimised'] },       { m:'Lonely',     o:['Isolated','Abandoned'] } ] },
    { core:'Happy', rgb:[242,214,75], mids:[
      { m:'Optimistic', o:['Inspired','Hopeful'] },   { m:'Trusting',   o:['Intimate','Sensitive'] },
      { m:'Peaceful',   o:['Thankful','Loving'] },    { m:'Powerful',   o:['Creative','Courageous'] },
      { m:'Accepted',   o:['Valued','Respected'] },   { m:'Proud',      o:['Confident','Successful'] },
      { m:'Interested', o:['Inquisitive','Curious'] },{ m:'Content',    o:['Joyful','Free'] },
      { m:'Playful',    o:['Cheeky','Aroused'] } ] },
    { core:'Surprised', rgb:[179,157,219], mids:[
      { m:'Excited',  o:['Energetic','Eager'] }, { m:'Amazed',   o:['Awe','Astonished'] },
      { m:'Confused', o:['Perplexed','Disillusioned'] }, { m:'Startled', o:['Dismayed','Shocked'] } ] },
    { core:'Bad', rgb:[143,206,155], mids:[
      { m:'Bored',    o:['Indifferent','Apathetic'] }, { m:'Busy',    o:['Pressured','Rushed'] },
      { m:'Stressed', o:['Overwhelmed','Out of control'] }, { m:'Tired', o:['Sleepy','Unfocussed'] } ] },
  ];

  // -------------------------------------------------------------------
  // Session state
  // -------------------------------------------------------------------

  const CS_SURVEY_KEY = 'clarityLoop.survey.v1';
  // Written when the backend sends an `intervention`, but nothing reads it
  // yet (the intervention picker is not wired — see backend/orchestrator/agent.py).
  const CS_INTERVENTION_KEY = 'clarityLoop.intervention.v1';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Screens where Oshi has a live line to add.  On enter we hold the line
  // blank and wait for the backend `oshi_line`; the scripted floor only
  // paints if nothing arrives within SCRIPTED_FALLBACK_MS.  Other screens
  // (complete) have no live upgrade, so they paint scripted immediately.
  const LIVE_SCREENS = ['welcome','sensation','intensity','body','emotion','offering','session','r_intensity'];
  const SCRIPTED_FALLBACK_MS = 5000;

  const surveyOrder = { sensation:1, intensity:2, body:3, emotion:4 };
  const stepScreens = { 1:'sensation', 2:'intensity', 3:'body', 4:'emotion' };

  const state = {
    screen: 'welcome',
    answers: {
      sensation: null, sensation_alias: null,
      intensity: null, body: null,
      emotion: null, emotion_core: null,
      path: null, intensity_after: null,
    },
    otherOpen: false,
    otherText: '',
    ringActive: false,
    contemplation: '',
    reflectionLine: '',
    _reqId: 0,
    _advTimer: null,
    _typewriter: null,
    _scriptedTimer: null,
    _lastPhysioSnapshot: null,   // captured from ws hr_result while on /survey
  };

  // -------------------------------------------------------------------
  // Helpers: DOM, persistence, geometry
  // -------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'style') e.setAttribute('style', attrs[k]);
      else if (k === 'onClick') e.addEventListener('click', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (children) children.forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  };

  const saveSurvey = () => {
    try {
      sessionStorage.setItem(CS_SURVEY_KEY, JSON.stringify(state.answers));
    } catch (_) { /* private-mode: keep going, retrospective just won't resume */ }
  };
  const loadSurvey = () => {
    try {
      const raw = sessionStorage.getItem(CS_SURVEY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  };
  const clearSurvey = () => {
    try {
      sessionStorage.removeItem(CS_SURVEY_KEY);
      sessionStorage.removeItem(CS_INTERVENTION_KEY);
    } catch (_) {}
  };

  const _pt = (cx, cy, r, deg) => {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const _sector = (cx, cy, rI, rO, a0, a1) => {
    const [x1,y1] = _pt(cx,cy,rI,a0), [x2,y2] = _pt(cx,cy,rO,a0);
    const [x3,y3] = _pt(cx,cy,rO,a1), [x4,y4] = _pt(cx,cy,rI,a1);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} `
         + `A${rO} ${rO} 0 0 1 ${x3.toFixed(1)} ${y3.toFixed(1)} `
         + `L${x4.toFixed(1)} ${y4.toFixed(1)} A${rI} ${rI} 0 0 0 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
  };
  const _lighten = (rgb, amt) => rgb.map((c) => Math.round(c + (255 - c) * amt));

  // Two-sentence clamp — matches the persona's ceiling AND server-side
  // guardrails.clamp_two_sentences.  We still run it client-side so a
  // stray typewriter overrun can't ship four sentences.
  const _clamp2 = (s) => {
    if (!s) return s;
    const parts = s.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g);
    if (!parts) return s.trim();
    return parts.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  };

  // -------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------

  let socket = null;

  const _onSocketMessage = (msg) => {
    if (msg.type === 'oshi_line') {
      // Stale-drop guard — mirrors the prototype's _reqId check.
      if (msg.req_id !== state._reqId) return;
      const clean = _clamp2(String(msg.text || '').trim());
      if (clean) _typewrite(clean, msg.req_id);
    } else if (msg.type === 'intervention') {
      try {
        sessionStorage.setItem(CS_INTERVENTION_KEY, JSON.stringify({
          id: msg.id, params: msg.params, reasoning: msg.reasoning, source: msg.source,
        }));
      } catch (_) {}
    } else if (msg.type === 'reflection') {
      // Server sends BOTH parts; we render the line as Oshi's caption
      // and the question as the big contemplation.  Both are already
      // scripted-fallback-safe from the server side.  The live reply
      // landed, so drop any pending client-side scripted fallback.
      _cancelScriptedFallback();
      if (msg.line) {
        state.reflectionLine = msg.line;
        _typewrite(msg.line, state._reqId);
      }
      if (msg.question) {
        state.contemplation = msg.question;
        const c = $('contemplation');
        if (c) c.textContent = msg.question;
      }
    } else if (msg.type === 'hr_result') {
      // Passive listener — capture a physio snapshot to attach to game1's
      // session_complete. NOTE: survey.html doesn't start the camera, so
      // no hr_result arrives here in practice and these fields stay null
      // (see docs/KNOWN_ISSUES.md).
      state._lastPhysioSnapshot = {
        rr_bpm: msg.rr_bpm,
        restlessness: msg.posture && msg.posture.restlessness,
        ts: Date.now(),
      };
    }
    // pong / anything else — ignore
  };

  const _sendSubjective = (screen, reqId) => {
    // Client → server: "subjective_input" doubles as the line-request
    // for this screen AND (when path is set) triggers the intervention
    // selection.  Server derives what to reply from the screen key.
    if (!socket || !socket.connected) return;
    const a = state.answers;
    socket.send({
      type: 'subjective_input',
      screen,
      req_id: reqId,
      sensation: a.sensation,
      sensation_alias: a.sensation_alias,
      intensity: a.intensity,
      body_region: a.body,
      emotion: a.emotion,
      emotion_core: a.emotion_core,
      path: a.path,
      time_of_day: 'auto',
    });
  };

  const _sendSessionComplete = () => {
    if (!socket || !socket.connected) return;
    const a = state.answers;
    const snap = state._lastPhysioSnapshot || {};
    const isGame1 = a.path === 'game1';
    socket.send({
      type: 'session_complete',
      path: a.path || 'game1',
      // Path-dependent: game1 carries breath/restlessness if present; the
      // other games send intensity only. Field names match SessionResult
      // in backend/orchestrator/oshi/schema.py.
      intensity_pre: a.intensity,
      intensity_post: a.intensity_after,
      breath_pre: isGame1 ? (snap.rr_bpm || null) : null,
      breath_post: isGame1 ? (snap.rr_bpm || null) : null,
      restlessness_pre: isGame1 ? (snap.restlessness || null) : null,
      restlessness_post: isGame1 ? (snap.restlessness || null) : null,
      // subjective context for the reflection prompt
      sensation: a.sensation,
      body_region: a.body,
      emotion: a.emotion,
      time_of_day: 'auto',
    });
  };

  // -------------------------------------------------------------------
  // Screen rendering — one function per screen
  // -------------------------------------------------------------------

  function _paintScripted(screen) {
    // Paint the scripted floor.  This is now a FALLBACK: it fires only for
    // screens with no live upgrade, or when the live line hasn't arrived
    // within SCRIPTED_FALLBACK_MS.  The live line still replaces it via
    // oshi_line if it lands afterwards.
    const scripted = SCRIPTED[screen] || '';
    const lineEl = $('oshi-line');
    const caret = $('oshi-caret');
    if (lineEl) lineEl.textContent = scripted;
    if (caret) caret.style.display = 'none';
    if (state._typewriter) { clearTimeout(state._typewriter); state._typewriter = null; }
  }

  function _clearLine() {
    // Blank the line while we wait for the live API response so no
    // scripted text flashes as "the thing to read".
    const lineEl = $('oshi-line');
    const caret = $('oshi-caret');
    if (lineEl) lineEl.textContent = '';
    if (caret) caret.style.display = 'none';
    if (state._typewriter) { clearTimeout(state._typewriter); state._typewriter = null; }
  }

  function _cancelScriptedFallback() {
    if (state._scriptedTimer) { clearTimeout(state._scriptedTimer); state._scriptedTimer = null; }
  }

  function _scheduleScriptedFallback(screen, reqId, paintFn) {
    // Hold the line blank, then paint the scripted floor only if the live
    // line for THIS request hasn't landed in time.  A live line cancels
    // this via _typewrite → _cancelScriptedFallback.  `paintFn` overrides
    // the default paint (reflection paints both a line AND a question).
    _cancelScriptedFallback();
    _clearLine();
    state._scriptedTimer = setTimeout(() => {
      state._scriptedTimer = null;
      if (state._reqId !== reqId) return;      // stale — moved on / upgraded
      if (paintFn) paintFn(); else _paintScripted(screen);
    }, SCRIPTED_FALLBACK_MS);
  }

  // Friendly, second-person body words — mirrors the server's _REGION_WORDS
  // so the client fallback reads the same as the API/scripted paths.
  const REGION_WORDS = {
    head:'your head', throat:'your throat', shoulders:'your shoulders',
    chest:'your chest', belly:'your belly', core:'your core',
    arms:'your hands', legs:'your legs', feet:'your feet',
  };

  function _clientReflectionQuestion() {
    // Last-resort open question if NO reflection message arrives (socket
    // down/slow).  Signal-aware, capped at two survey details, in the same
    // awareness-inviting spirit as the live prompt — never diagnostic.
    const a = state.answers;
    const sens = a.sensation ? String(a.sensation).toLowerCase() : null;
    const where = REGION_WORDS[a.body];
    if (sens && where) return `this ${sens} in ${where}… is it familiar?`;
    if (where)         return `the part resting in ${where}… what has it been carrying for you?`;
    if (sens)          return `this ${sens}… when did you first come to know it?`;
    return 'if this part could stay a while longer… what has it been carrying for you?';
  }

  function _paintReflectionFallback() {
    // Fill both halves of the retrospective from the client floor.
    const lineEl = $('oshi-line');
    const caret = $('oshi-caret');
    if (lineEl) lineEl.textContent = 'something in you was met here, and welcomed.';
    if (caret) caret.style.display = 'none';
    const c = $('contemplation');
    if (c) c.textContent = _clientReflectionQuestion();
  }

  function _typewrite(full, reqId) {
    const lineEl = $('oshi-line');
    const caret = $('oshi-caret');
    if (!lineEl) return;
    // The live line landed — kill any pending scripted fallback so it
    // can't overwrite the real reply later.
    _cancelScriptedFallback();
    if (state._typewriter) { clearTimeout(state._typewriter); state._typewriter = null; }
    lineEl.textContent = '';
    if (caret) caret.style.display = 'inline-block';
    let i = 0;
    const tick = () => {
      if (state._reqId !== reqId) { if (caret) caret.style.display = 'none'; return; }
      i += 1;
      lineEl.textContent = full.slice(0, i);
      if (i < full.length) {
        state._typewriter = setTimeout(tick, 22);
      } else {
        if (caret) caret.style.display = 'none';
        state._typewriter = null;
      }
    };
    state._typewriter = setTimeout(tick, 30);
  }

  function _showScreen(screen) {
    document.querySelectorAll('.oshi-screen').forEach((s) => s.classList.remove('active'));
    const cur = $('scr-' + screen);
    if (cur) cur.classList.add('active');
    // portrait swap
    const p = $('oshi-portrait-img');
    if (p) p.style.backgroundImage = `url('${PORTRAITS[screen] || PORTRAITS.welcome}')`;
    // per-screen instruction
    document.querySelectorAll(`#scr-${screen} [data-instr]`).forEach((n) => {
      n.textContent = INSTRUCTIONS[screen] || '';
    });
    _renderProgress();
    _renderScreen(screen);
    // Ambient bed lives only on the landing page: start on welcome (incl.
    // "begin again"), fade out + stop on any other screen (i.e. "enter").
    if (screen === 'welcome') _ambientStart(); else _ambientStop();
  }

  function _renderScreen(screen) {
    if (screen === 'sensation')   _renderSensation();
    if (screen === 'intensity')   _renderRing('ring-wrap', 'ring-el', 'intensity');
    if (screen === 'r_intensity') _renderRing('r-ring-wrap', 'r-ring-el', 'intensity_after');
    if (screen === 'body')        _renderBody();
    if (screen === 'emotion')     _renderEmotionWheel();
    if (screen === 'offering')    _renderOffering();
    if (screen === 'session')     _renderSessionScreen();
    if (screen === 'reflection')  _renderReflectionScreen();
  }

  // ---- progress dots ----
  function _renderProgress() {
    const dotsEl = $('oshi-progress');
    if (!dotsEl) return;
    const stepNo = surveyOrder[state.screen] || 0;
    if (!stepNo) { dotsEl.style.display = 'none'; return; }
    dotsEl.style.display = 'flex';
    dotsEl.innerHTML = '';
    const a = state.answers;
    const answered = { 1: !!a.sensation, 2: a.intensity != null, 3: !!a.body, 4: !!a.emotion };
    for (let i = 1; i <= 4; i++) {
      const clickable = stepNo > 0 && (i <= stepNo || answered[i]);
      const wrap = document.createElement('span');
      wrap.className = 'oshi-progress-wrap' + (clickable ? ' clickable' : '');
      wrap.title = clickable ? ('go to ' + stepScreens[i]) : '';
      const dot = document.createElement('span');
      dot.className = 'oshi-progress-dot' + (i === stepNo ? ' current' : (i < stepNo ? ' filled' : ''));
      wrap.appendChild(dot);
      if (clickable) {
        wrap.addEventListener('click', () => {
          _cancelAdvance();
          _enter(stepScreens[i]);
        });
      }
      dotsEl.appendChild(wrap);
    }
  }

  // ---- sensation ----
  function _renderSensation() {
    const row = $('chips-row');
    if (!row) return;
    row.innerHTML = '';
    const a = state.answers;
    CHIP_WORDS.forEach((w) => {
      const btn = document.createElement('button');
      btn.className = 'oshi-chip' + (a.sensation === w ? ' active' : '');
      btn.textContent = w;
      btn.addEventListener('click', () => {
        a.sensation = w;
        a.sensation_alias = CHIP_ALIAS[w] || w;
        state.otherOpen = false;
        state.otherText = '';
        $('other-input').style.display = 'none';
        _renderSensation();
        _scheduleAdvance();
      });
      row.appendChild(btn);
    });
    // "other…" chip
    const other = document.createElement('button');
    const otherActive = !!a.sensation && !CHIP_WORDS.includes(a.sensation);
    other.className = 'oshi-chip' + ((otherActive || state.otherOpen) ? ' active' : '');
    other.textContent = otherActive ? ('✎ ' + a.sensation) : 'other…';
    other.addEventListener('click', () => {
      _cancelAdvance();
      state.otherOpen = !state.otherOpen;
      const inp = $('other-input');
      inp.style.display = state.otherOpen ? 'block' : 'none';
      if (state.otherOpen) {
        inp.value = state.otherText;
        setTimeout(() => inp.focus(), 30);
      }
      _renderSensation();
    });
    row.appendChild(other);

    // input handlers (set once)
    const inp = $('other-input');
    if (!inp.dataset._bound) {
      inp.addEventListener('input', (e) => {
        const v = e.target.value;
        state.otherText = v;
        _cancelAdvance();
        const trimmed = v.trim();
        state.answers.sensation = trimmed || null;
        // Free-text sensations pass through unaliased (no rule match).
        state.answers.sensation_alias = trimmed || null;
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const s = state.answers.sensation;
          if (s && s.trim()) { _cancelAdvance(); _flow(); }
        }
      });
      inp.dataset._bound = '1';
    }
  }

  // ---- intensity ring (shared with r_intensity) ----
  function _renderRing(wrapId, ringId, field) {
    const wrap = $(wrapId);
    if (!wrap) return;
    const ring = $(ringId);
    const v = state.answers[field];
    const px = v == null ? 70 : 66 + v * 22;
    const glow = v == null ? 8 : 12 + v * 7;
    const alphaBorder = v == null ? 0.35 : 0.9;
    const alphaFill   = v == null ? 0.05 : 0.14;
    const alphaBox    = v == null ? 0.3  : 0.6;
    const alphaInset  = v == null ? 0.15 : 0.35;
    ring.style.width = px + 'px';
    ring.style.height = px + 'px';
    ring.style.borderColor = `rgba(152,120,232,${alphaBorder})`;
    ring.style.background = `radial-gradient(circle, rgba(152,120,232,${alphaFill}), transparent 72%)`;
    ring.style.boxShadow = `0 0 ${glow}px rgba(152,120,232,${alphaBox}), inset 0 0 ${glow*0.7}px rgba(152,120,232,${alphaInset})`;

    if (!wrap.dataset._bound) {
      const setRing = (e) => {
        const r = wrap.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy);
        const R = r.width / 2 - 18;
        let val = Math.round(1 + (Math.min(d, R) / R) * 9);
        val = Math.max(1, Math.min(10, val));
        state.answers[field] = val;
        _renderRing(wrapId, ringId, field);
      };
      wrap.addEventListener('pointerdown', (e) => {
        _cancelAdvance();
        state.ringActive = true;
        try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
        setRing(e);
      });
      wrap.addEventListener('pointermove', (e) => {
        if (state.ringActive) setRing(e);
      });
      wrap.addEventListener('pointerup', () => {
        state.ringActive = false;
        if (state.answers[field] != null) _scheduleAdvance(760);
      });
      wrap.dataset._bound = '1';
    }
  }

  // ---- body ----
  function _renderBody() {
    const regions = $('body-regions');
    if (!regions) return;
    const a = state.answers;
    // fill/glow per region
    regions.querySelectorAll('[data-region]').forEach((n) => {
      const k = n.dataset.region;
      const on = a.body === k;
      n.setAttribute('fill', on ? 'rgba(152,120,232,0.5)' : 'rgba(152,120,232,0)');
      n.style.cursor = 'pointer';
      n.style.pointerEvents = 'all';
      n.style.transition = 'fill 0.25s, filter 0.25s';
      n.style.filter = on ? 'drop-shadow(0 0 12px rgba(152,120,232,0.85))' : 'none';
    });
    if (!regions.dataset._bound) {
      regions.addEventListener('click', (e) => {
        const t = e.target.closest('[data-region]');
        if (!t) return;
        a.body = t.dataset.region;
        _renderBody();
        _scheduleAdvance();
      });
      regions.dataset._bound = '1';
    }
    const label = $('body-label');
    if (label) {
      const names = { head:'the head', throat:'the throat', shoulders:'the shoulders',
                      chest:'the chest', belly:'the belly', core:'the core',
                      arms:'the arms & hands', legs:'the legs', feet:'the feet' };
      label.textContent = a.body ? names[a.body] : '';
    }
  }

  // ---- emotion wheel ----
  function _buildWheel(a) {
    const cx = 400, cy = 400, R = [70, 210, 300, 388];
    const total = 82, leaf = 360 / total;
    const segs = [];
    let cursor = -90;
    const rgba = (rgb, al) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${al})`;
    FWHEEL.forEach((core, ci) => {
      const nLeaves = core.mids.reduce((s, m) => s + m.o.length, 0);
      const cStart = cursor, cEnd = cursor + nLeaves * leaf;
      segs.push(_seg({ key:`c${ci}`, word:core.core, coreName:core.core, ring:0,
        d:_sector(cx,cy,R[0],R[1],cStart,cEnd), fill:rgba(core.rgb,1),
        cx, cy, r:(R[0]+R[1])/2, ang:(cStart+cEnd)/2, fs:23, rotate:false, a }));
      let mc = cStart;
      core.mids.forEach((mid, mi) => {
        const mStart = mc, mEnd = mc + mid.o.length * leaf;
        segs.push(_seg({ key:`c${ci}m${mi}`, word:mid.m, coreName:core.core, ring:1,
          d:_sector(cx,cy,R[1],R[2],mStart,mEnd), fill:rgba(_lighten(core.rgb,0.3),1),
          cx, cy, r:(R[1]+R[2])/2, ang:(mStart+mEnd)/2, fs:13.5, rotate:true, a }));
        let oc = mStart;
        mid.o.forEach((ow, oi) => {
          const oStart = oc, oEnd = oc + leaf;
          segs.push(_seg({ key:`c${ci}m${mi}o${oi}`, word:ow, coreName:core.core, ring:2,
            d:_sector(cx,cy,R[2],R[3],oStart,oEnd), fill:rgba(_lighten(core.rgb,0.54),1),
            cx, cy, r:(R[2]+R[3])/2, ang:(oStart+oEnd)/2, fs:11, rotate:true, a }));
          oc = oEnd;
        });
        mc = mEnd;
      });
      cursor = cEnd;
    });
    return segs;
  }
  function _seg({ key, word, coreName, ring, d, fill, cx, cy, r, ang, fs, rotate, a }) {
    const [lx, ly] = _pt(cx, cy, r, ang);
    let rot = '';
    if (rotate) {
      let deg = ang;
      if (deg > 90 && deg < 270) deg += 180;
      rot = `rotate(${deg.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`;
    }
    const sel = a.emotion_key === key;
    return {
      key, label: word, d, fill,
      stroke: sel ? '#ffffff' : 'rgba(45,38,60,0.5)',
      sw: sel ? 3.5 : 0.75,
      lx: lx.toFixed(1), ly: ly.toFixed(1), rot, fs, tc: '#2a2333',
      coreName, ring, word,
    };
  }

  function _renderEmotionWheel() {
    const svg = $('wheel-svg');
    if (!svg) return;
    svg.innerHTML = '';
    const a = state.answers;
    const wheel = _buildWheel(a);
    // segments (path)
    wheel.forEach((seg) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', seg.d);
      p.setAttribute('fill', seg.fill);
      p.setAttribute('stroke', seg.stroke);
      p.setAttribute('stroke-width', String(seg.sw));
      p.style.cursor = 'pointer';
      p.addEventListener('click', () => {
        a.emotion = seg.word;
        a.emotion_key = seg.key;
        a.emotion_core = seg.coreName;
        _renderEmotionWheel();
        _scheduleAdvance(660);
      });
      svg.appendChild(p);
    });
    // labels — MUST use createElementNS for text glyphs to render.
    const labelG = document.createElementNS(SVG_NS, 'g');
    wheel.forEach((seg) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', seg.lx);
      t.setAttribute('y', seg.ly);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      if (seg.rot) t.setAttribute('transform', seg.rot);
      t.setAttribute('font-family', "'Helvetica Neue', sans-serif");
      t.setAttribute('font-weight', '500');
      t.setAttribute('font-size', seg.fs + 'px');
      t.setAttribute('fill', seg.tc);
      t.setAttribute('pointer-events', 'none');
      t.textContent = seg.label;
      labelG.appendChild(t);
    });
    svg.appendChild(labelG);
    const sel = $('emotion-sel');
    if (sel) sel.textContent = a.emotion ? a.emotion.toLowerCase() : '';
  }

  // ---- offering ----
  function _renderOffering() {
    const row = $('paths-row');
    if (!row) return;
    row.innerHTML = '';
    const a = state.answers;
    PATHS.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'oshi-card' + (a.path === p.key ? ' active' : '');
      const title = document.createElement('div');
      title.className = 'oshi-card-title';
      title.textContent = p.title;
      const goal = document.createElement('div');
      goal.className = 'oshi-card-goal';
      goal.textContent = p.goal;
      const desc = document.createElement('div');
      desc.className = 'oshi-card-desc';
      desc.textContent = p.desc;
      b.appendChild(title); b.appendChild(goal); b.appendChild(desc);
      b.addEventListener('click', () => {
        a.path = p.key;
        _renderOffering();
        // brief pause on the offering screen so selection glow is felt,
        // then the "session" screen shows a launch button.
        _scheduleAdvance(700);
      });
      row.appendChild(b);
    });
  }

  // ---- session (launch card — replaces the prototype's stand-in) ----
  function _renderSessionScreen() {
    const t = $('session-title');
    if (!t) return;
    const p = state.answers.path;
    if (p === 'game2')      t.textContent = 'the birds pass through…';
    else if (p === 'game3') t.textContent = 'the flame draws its breath…';
    else if (p === 'game4') t.textContent = 'the tide begins to turn…';
    else                    t.textContent = 'the fire finds its shape…';
  }

  // ---- reflection ----
  function _renderReflectionScreen() {
    const a = state.answers;
    // Optional before→after ring visual
    const shift = $('shift-visual');
    if (shift) {
      const before = a.intensity == null ? 6 : a.intensity;
      const after  = a.intensity_after == null ? before : a.intensity_after;
      const ringViz = (n, on) => {
        const px = 30 + n * 8;
        return {
          width: px + 'px', height: px + 'px',
          borderRadius: '50%',
          border: `2px solid rgba(152,120,232,${on ? 0.9 : 0.5})`,
          background: `radial-gradient(circle, rgba(152,120,232,${on ? 0.16 : 0.08}), transparent 70%)`,
          boxShadow: `0 0 ${on ? 24 : 12}px rgba(152,120,232,${on ? 0.5 : 0.3})`,
        };
      };
      shift.style.display = 'flex';
      Object.assign($('shift-before').style, ringViz(before, false));
      Object.assign($('shift-after').style,  ringViz(after,  true));
    }
    // Do NOT paint a default question here — it would flash as "the thing
    // to read".  The live `reflection` message fills it, or the 5-second
    // fallback (_paintReflectionFallback) does.  Only restore a question we
    // already have (e.g. re-render of the same screen).
    const c = $('contemplation');
    if (c && !c.textContent && state.contemplation) {
      c.textContent = state.contemplation;
    }
    // Journal textarea — clear on each entry so a "begin again" run
    // doesn't inherit the previous session's words.  Not persisted.
    const j = $('reflection-journal');
    if (j) j.value = '';
  }

  // -------------------------------------------------------------------
  // Flow control
  // -------------------------------------------------------------------

  function _cancelAdvance() {
    if (state._advTimer) { clearTimeout(state._advTimer); state._advTimer = null; }
  }
  function _scheduleAdvance(ms = 560) {
    _cancelAdvance();
    state._advTimer = setTimeout(() => _flow(), ms);
  }

  function _enter(screen) {
    _cancelAdvance();
    _cancelScriptedFallback();
    state.screen = screen;
    state._reqId += 1;
    // Live-upgrade screens: hold the line blank and let the API line show
    // up; only fall back to the scripted floor after SCRIPTED_FALLBACK_MS.
    // Non-live screens (e.g. complete) have no upgrade coming, so paint the
    // scripted line right away.
    if (LIVE_SCREENS.includes(screen)) {
      _scheduleScriptedFallback(screen, state._reqId);
      _showScreen(screen);
      _sendSubjective(screen, state._reqId);
    } else {
      _paintScripted(screen);
      _showScreen(screen);
    }
  }

  function _flow() {
    const s = state.screen;
    if (s === 'welcome')     return _enter('sensation');
    if (s === 'sensation')   { saveSurvey(); return _enter('intensity'); }
    if (s === 'intensity')   { saveSurvey(); return _enter('body'); }
    if (s === 'body')        { saveSurvey(); return _enter('emotion'); }
    if (s === 'emotion')     { saveSurvey(); return _enter('offering'); }
    if (s === 'offering')    { saveSurvey(); return _enter('session'); }
    if (s === 'session')     return _handoffToGame();
    if (s === 'r_intensity') return _requestReflection();
    if (s === 'reflection')  return _enter('complete');
    if (s === 'complete')    return _restart();
  }

  function _handoffToGame() {
    const p = state.answers.path;
    const target = p === 'game2' ? '/game2'
                 : p === 'game3' ? '/game3'
                 : p === 'game4' ? '/game4'
                 :                 '/game1';
    saveSurvey();
    // The game pages don't yet participate — but the survey resume-on-
    // load pattern picks up the saved answers when the user returns.
    window.location.href = target;
  }

  function _requestReflection() {
    _cancelAdvance();
    _cancelScriptedFallback();
    state.screen = 'reflection';
    state._reqId += 1;
    // Both the witnessing line AND the open question arrive live via the
    // `reflection` message.  Hold them blank and only paint the scripted
    // floor (line + signal-aware question) if nothing lands in time.
    state.contemplation = '';
    const c = $('contemplation');
    if (c) c.textContent = '';
    _scheduleScriptedFallback('reflection', state._reqId, _paintReflectionFallback);
    _showScreen('reflection');
    _sendSessionComplete();
  }

  function _restart() {
    clearSurvey();
    state.answers = {
      sensation: null, sensation_alias: null,
      intensity: null, body: null,
      emotion: null, emotion_core: null,
      path: null, intensity_after: null,
    };
    state.otherOpen = false; state.otherText = '';
    state.contemplation = ''; state.reflectionLine = '';
    _enter('welcome');
  }

  // -------------------------------------------------------------------
  // Landing-page ambient audio (welcome screen only)
  //
  // Loops the forest bed behind the welcome branch, fades in on arrival,
  // and fades out + stops the instant we leave the welcome screen (i.e.
  // when the traveler clicks "enter").  Because browsers gate autoplay-
  // with-sound behind a user gesture, we also arm a one-shot fallback so
  // the bed fades in on the first pointer/key interaction if the initial
  // play() was blocked.
  // -------------------------------------------------------------------

  const AMBIENT = {
    el: null, wrap: null, toggle: null, fadeTimer: null, gestureArmed: false,
    targetVol: 0.5, muted: false,
  };

  function _ambientInit() {
    AMBIENT.el = $('ambient-audio');
    AMBIENT.wrap = $('audio-toggle');     // .audio-toggle pill (show/hide)
    AMBIENT.toggle = $('mute-btn');       // .mute-btn (click + aria-pressed)
    if (AMBIENT.el) AMBIENT.el.volume = 0;
    if (AMBIENT.toggle) AMBIENT.toggle.addEventListener('click', _ambientToggleMute);
    _ambientRenderToggle();
  }

  function _ambientClearFade() {
    if (AMBIENT.fadeTimer) { clearInterval(AMBIENT.fadeTimer); AMBIENT.fadeTimer = null; }
  }

  // Linear volume ramp; `done` fires once the target is reached.
  function _ambientFade(to, ms, done) {
    const el = AMBIENT.el;
    if (!el) { if (done) done(); return; }
    _ambientClearFade();
    const from = el.volume;
    const steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    AMBIENT.fadeTimer = setInterval(() => {
      i += 1;
      el.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)));
      if (i >= steps) { _ambientClearFade(); if (done) done(); }
    }, 40);
  }

  function _ambientRenderToggle() {
    // aria-pressed drives the on/off SVG swap via the shared .mute-btn CSS.
    if (AMBIENT.toggle) AMBIENT.toggle.setAttribute('aria-pressed', String(AMBIENT.muted));
  }

  function _ambientArmGesture() {
    if (AMBIENT.gestureArmed) return;
    AMBIENT.gestureArmed = true;
    const kick = () => {
      document.removeEventListener('pointerdown', kick);
      document.removeEventListener('keydown', kick);
      AMBIENT.gestureArmed = false;
      // Only start if we're still on the landing page and not muted.
      if (state.screen !== 'welcome' || AMBIENT.muted || !AMBIENT.el) return;
      AMBIENT.el.play()
        .then(() => _ambientFade(AMBIENT.targetVol, 1200))
        .catch(() => {});
    };
    document.addEventListener('pointerdown', kick);
    document.addEventListener('keydown', kick);
  }

  function _ambientStart() {
    const el = AMBIENT.el;
    if (AMBIENT.wrap) AMBIENT.wrap.style.display = '';
    if (!el || AMBIENT.muted) return;
    const p = el.play();
    if (p && p.then) {
      p.then(() => _ambientFade(AMBIENT.targetVol, 1200))
       .catch(() => _ambientArmGesture());   // autoplay blocked — wait for a gesture
    } else {
      _ambientFade(AMBIENT.targetVol, 1200);
    }
  }

  function _ambientStop() {
    const el = AMBIENT.el;
    if (AMBIENT.wrap) AMBIENT.wrap.style.display = 'none';
    if (!el) return;
    _ambientFade(0, 1000, () => {
      el.pause();
      try { el.currentTime = 0; } catch (e) { /* ignore */ }
    });
  }

  function _ambientToggleMute() {
    AMBIENT.muted = !AMBIENT.muted;
    _ambientRenderToggle();
    const el = AMBIENT.el;
    if (!el) return;
    if (AMBIENT.muted) {
      _ambientFade(0, 300, () => el.pause());
    } else {
      // The click itself is a user gesture, so play() will succeed here.
      el.play().then(() => _ambientFade(AMBIENT.targetVol, 600)).catch(() => {});
    }
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  function _bindStaticButtons() {
    document.querySelectorAll('[data-oshi-begin]').forEach((b) =>
      b.addEventListener('click', () => _flow()));
    document.querySelectorAll('[data-oshi-next]').forEach((b) =>
      b.addEventListener('click', () => _flow()));
    document.querySelectorAll('[data-oshi-restart]').forEach((b) =>
      b.addEventListener('click', () => _restart()));
  }

  function _resumeIfReturningFromGame() {
    const saved = loadSurvey();
    if (saved && saved.path && saved.intensity != null && saved.intensity_after == null) {
      // Player finished the offering + walked their path; we're
      // returning fresh to /survey.  Skip straight to r_intensity.
      state.answers = { ...state.answers, ...saved };
      _enter('r_intensity');
      return true;
    }
    return false;
  }

  function init() {
    socket = new ClaritySocket(_onSocketMessage);
    _bindStaticButtons();
    _ambientInit();
    if (!_resumeIfReturningFromGame()) _enter('welcome');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
