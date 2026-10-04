# Game 3 "Follow the Flame" — Integration Handoff

This file is the entry point for integrating **Game 3 — Follow the Flame** into the
Clarity Loop repo. Everything you need is here, in the prototype, or already in the repo.
Read this top to bottom, then follow the system prompt in §7. **Do not redesign anything** —
the prototype is the finished mechanic; your job is to port it into the app's vanilla
structure and wire two synthetic stand-ins to real CV signals.

---

## 0 · What this feature is

A box-breathing (**4·4·4·4**) pacer built by reusing Game 1's flame + CV pipeline. The
core inversion vs. Game 1 (Phoenix Ascent):

> **The flame LEADS, the breath FOLLOWS.** The flame's SIZE/SHAPE is driven by a fixed
> box-breathing clock in JS — **never** by the breath signal. CV is repurposed to drive
> only (a) the flame's *character* (wobble + brightness + glow, over a slow window) and
> (b) an end-of-session breath capture. This removes the real-time tracking demand that
> made Game 1 jittery and ambiguous.

Flow: **setup** (duration + active/passive guidance) → **countdown** (3·2·1) → **active**
(pacer runs, flame breathes the box pattern, phase text below the fire) → **complete**
(session-capture graph → `/survey` hand-off).

- **Active guidance** = show the "breathe in · hold · breathe out · hold" phase text.
- **Passive guidance** = hide the text; the pulsing circular glow reveals the pattern.
  The dynamic glow runs in **both** modes.

---

## 1 · Where each piece comes from (the whole strategy)

| Concern | Source to reuse | Notes |
|---|---|---|
| Screen state machine, duration picker, 3·2·1 countdown, bottom timebar, ambient-audio crossfade, `/game3` route pattern | **`frontend/js/game2.js` + `game2.html` + `game2-*` CSS** | game2 already has this exact shell. Clone its structure. |
| Flame rendering, box-breath clock, **circular pulsing glow**, adherence→character mapping, session-capture graph (`_drawCapture`) | **`Game 3 - Follow the Flame.dc.html` (the prototype — source of truth)** | Port verbatim. Do NOT reuse game1.js's `FlameField` — its glow is rectangular (cuts off top/bottom) and its API is breath-driven. The prototype's trimmed FlameField (`setBreath(b)` + `setAdherence(a)`, full-canvas circular glow) is the correct one. |
| CV acquisition: camera, ROIs, chest signal, socket | **`camera.js` (`ClarityCamera`, `onChestSample`), `websocket.js` (`ClaritySocket`), and `BreathAnalyzer` (top of `game1.js`)** | Reuse unchanged. Copy `BreathAnalyzer` into `game3.js` (or import it). |

**Two synthetic stand-ins in the prototype that you MUST replace with real CV** (§5):
1. `demoAdherence` slider + the auto-drift sine in `_loop` → a real **adherence** value computed from `BreathAnalyzer`.
2. The synthetic `raw` generator in `_loop` (`_rawEma`/`_rawDrift`) → the **real detrended chest sample** from `onChestSample`.

**Delete (demo-only):** the "demo · simulated breath adherence" slider and the "skip to end ▸" button.

---

## 2 · Paste manifest — what lands where

| Source (this handoff) | Destination in `clarity-loop/` | Action |
|---|---|---|
| `Game 3 - Follow the Flame.dc.html` | `docs/game3/` | Reference only — the **source of truth** to port from. Not served. |
| `Game 3 - INTEGRATION.md` (this file) | `docs/game3/` | Reference only. |

**Do NOT copy:** `support.js`, `doc-page.js` (design-tool runtime for the `.dc.html`),
`_ds/`, or any `screenshots/` — irrelevant to the running app.

**Files you CREATE:** `frontend/game3.html`, `frontend/js/game3.js`.
**Files you EDIT:** `frontend/css/main.css` (add `game3-*`, reusing `game2-*` where identical),
`backend/main.py` (add `GET /game3`), and the `.mode-nav` block in every page that has one
(`index.html`, `observe.html`, `mirror.html`, `game1.html`, `game2.html`, `survey.html`) —
add a `Game 3` link.

---

## 3 · Read order (before writing any code)

1. `CLAUDE.md` — repo conventions.
2. `docs/game3/Game 3 - Follow the Flame.dc.html` — the source of truth. Read the logic
   class: `PHASES`/box clock in `_loop`, the `FlameField` object in `_setupFlame`
   (`setBreath`, `setAdherence`, circular glow in `draw`), `_drawCapture`, and the screen
   markup. Ignore the DC wrapper (`<x-dc>`, `renderVals`, `{{ }}` holes, `sc-if`) — that is
   design-tool templating you convert to plain DOM.
3. `frontend/js/game2.js` — the structural template for the vanilla screen machine.
4. `frontend/js/game1.js` (`BreathAnalyzer`, `_onChestSample`, `_updateSlowMetrics`) and
   `frontend/js/camera.js` (`onChestSample`, `_sendBuffer`) — the CV wiring you reuse.

Anchor by named constant/method/element — **never by line number.**

---

## 4 · The things that would trip you up

1. **Backend `rr_bpm` cannot measure box breathing.** `respiration.py` has
   `RR_LOW_HZ = 0.15 Hz` (≈ 9 BPM) as its FFT band floor. Box 4·4·4·4 is **~3.75 BPM** —
   below the floor. So adherence's rate term must come from **`BreathAnalyzer.computeRate(30)`**
   (frontend zero-crossing, works at slow rates), **not** backend `rr_bpm`.
2. **No calibration gate.** Game 1 blocks for `BASELINE_LOCK_MS` (60 s of "sit still").
   Game 3 must NOT. The pacer and capture run from t=0. Adherence defaults to a neutral
   `0.6` until a rolling baseline/rate is available; the flame simply paces calmly
   meanwhile. Never block the experience on the camera.
3. **CV never touches flame SIZE or phase.** The box clock owns height/width/emission and
   the phase text. CV drives only `setAdherence(a)` (wobble/palette/glow/sparks) and the
   capture log. If you find yourself mapping a live signal to flame height, stop — that is
   the Game 1 mistake this game exists to fix.
4. **Poor signal holds steady, never jitters.** When `hr_result.signal_quality === 'poor'`
   or the breath buffer is too short, **freeze** the adherence EMA (don't update it). The
   flame's internal lerp keeps it smooth. A bad camera frame must never make the fire twitch.
5. **The prototype's flame is smoothed by design.** `setAdherence`/`setBreath` write
   *targets*; `FlameField.step` lerps toward them (`k = min(1, dt/1.6)`). Feed it values at
   ~1 Hz; do not pre-smooth into per-frame updates.

---

## 5 · Signal wiring (the only real work)

Set up CV exactly like Game 1's `init`:

```js
socket = new ClaritySocket(_onMsg);
camera = new ClarityCamera(_onSignal, { onChestSample: _onChestSample });
camera.socket = socket;
camera.start();               // no calibration gate; pacer already running
```

### 5a · Real-time chest → BreathAnalyzer + capture log (replaces synthetic `raw`)

```js
let _chestEma = null, _lastCap = 0, _baseAmp = 1;

function _onChestSample(raw) {                 // ~15 Hz from camera.js
  const now = performance.now();
  _chestEma = (_chestEma == null) ? raw : _chestEma * 0.99 + raw * 0.01;
  const detr = raw - _chestEma;                // detrended physical breath (NOT the FFT)
  BreathAnalyzer.push(detr, now);

  if (screen === 'active') {
    _baseAmp = BreathAnalyzer.computeAmplitude(20) || _baseAmp || 1;
    const norm = 0.5 + 0.5 * Math.max(-1, Math.min(1, detr / (_baseAmp || 1)));  // 0..1, tidal fills the band
    if (now - _lastCap >= 100) {                // ~10 Hz
      _lastCap = now;
      _cap.push({ t: _sessionElapsed, tgt: _boxLevel, raw: norm, ph: _phaseIdx });
    }
  }
}
```

`_cap`, `_boxLevel` (the current eased box breath level 0..1), `_phaseIdx`, and
`_sessionElapsed` come straight from the prototype's `_loop`. `_drawCapture` is already
correct — feed it real `_cap` and change nothing else. This is the "raw breath pattern, not
the 8.5 s latency signal" the graph legend promises.

### 5b · Adherence (replaces `demoAdherence` slider + auto-drift)

Compute on a 1 Hz `setInterval` (like game1's `_updateSlowMetrics`); the rAF loop calls
`fire.setAdherence(_adhEma)` every frame.

```js
let _adhEma = 0.6, _signalQuality = 'ok';
const BOX_SECONDS = 4;                          // must match the pacer
const targetBpm   = 60 / (4 * BOX_SECONDS);     // 3.75 BPM at 4 s

function _updateAdherence() {
  const rate = BreathAnalyzer.computeRate(30);        // NOT backend rr_bpm (see §4.1)
  const reg  = BreathAnalyzer.computeRegularity(30);  // 0 = metronomic, ~0.15 natural, 0.3+ irregular
  const bufferReady = rate != null && reg != null;
  if (!bufferReady || _signalQuality === 'poor') return;   // hold _adhEma steady (§4.4)

  const rateMatch = 1 - Math.min(1, Math.abs(rate - targetBpm) / targetBpm);
  const regScore  = 1 - Math.min(1, reg / 0.4);
  const target    = 0.5 * rateMatch + 0.5 * regScore;      // optionally subtract restlessness
  _adhEma += (target - _adhEma) * 0.15;
}
```

Optional refinement: fold `posture.restlessness` (from `hr_result`) in as a small penalty —
high restlessness nudges adherence down. Keep it subtle; regularity + rate-match is the
robust core.

### 5c · Backend messages (read-only; no backend CV changes)

```js
function _onMsg(msg) {
  if (msg && msg.type === 'hr_result') {
    if (msg.signal_quality) _signalQuality = msg.signal_quality;   // gate for §5b
    // msg.posture?.restlessness available if you use the optional penalty
  }
}
```

`camera.js` already sends `hr_data` (with `chest`) and `pose_data`; `main.py` already
replies with `hr_result` carrying `signal_quality`, `rr_bpm`, and `posture`. **No backend
CV work is required** — you only add the `/game3` route.

---

## 6 · Backend + nav

- `backend/main.py`: add `GET /game3` serving `frontend/game3.html`, mirroring the existing
  `/game1` / `/game2` routes. Nothing else.
- Add a `Game 3` `<a class="mode-link" href="/game3">` to the `.mode-nav` in every page that
  has one; mark it `active` in `game3.html`.
- `game3.html`: clone `game1.html`'s `<head>`, hidden `#camera-feed`/`#roi-canvas`, MediaPipe
  + `websocket.js` + `camera.js` script tags, and the `#flame-canvas`. Add the setup /
  countdown / active / complete containers (port from the prototype's screen markup into
  `game2-*`-style classes). Load `frontend/js/game3.js` last.
- CSS: reuse `game2-picker-*`, `game2-mode-card`, `game2-begin-btn`, `game2-countdown-num`,
  `game2-timebar*`, `mirror-nav`, `flame-canvas`. Add `game3-*` only for the phase-guide
  block (below the fire), the guidance picker, and the capture-canvas + legend.

No new Python deps. No `.env` changes.

---

## 7 · System prompt for Claude Code

> You are integrating **Game 3 — Follow the Flame**, a 4·4·4·4 box-breathing pacer, into the
> Clarity Loop repo. All source material is in `docs/game3/` and the repo. Read `CLAUDE.md`,
> then read this handoff (`docs/game3/Game 3 - INTEGRATION.md`) top to bottom and follow it
> exactly. **Do not redesign** — the prototype `docs/game3/Game 3 - Follow the Flame.dc.html`
> is the finished mechanic; port it faithfully.
>
> The strategy: Game 3 = game2.js's screen shell + game1.js's CV acquisition + the
> prototype's flame/box-clock/glow/capture. Reuse, don't reinvent. Anchor by named
> symbol, never by line number.
>
> Core inversion: the flame LEADS, breath FOLLOWS. A fixed JS box clock owns the flame's
> size/shape and the phase text. CV drives ONLY the flame's character (`setAdherence`) and
> the end-of-session capture graph. Never map a live signal to flame height — that is the
> Game 1 mistake this game fixes.
>
> Create `frontend/game3.html` and `frontend/js/game3.js`; edit `main.css`, `main.py`
> (add `/game3`), and the `.mode-nav` in every page. Convert the prototype's DC templating
> (`renderVals`/`{{ }}`/`sc-if`) to plain DOM in the vanilla IIFE style of `game2.js`. Port
> the prototype's `FlameField` (circular pulsing glow, `setBreath`/`setAdherence`) — do NOT
> reuse game1.js's `FlameField` (rectangular glow, breath-driven API). Reuse `ClarityCamera`,
> `ClaritySocket`, and `BreathAnalyzer` unchanged.
>
> Replace exactly two synthetic stand-ins from the prototype with real CV, per §5:
> (1) adherence — compute from `BreathAnalyzer.computeRate(30)` + `computeRegularity(30)`
> vs. the 3.75 BPM box target, EMA-smoothed at 1 Hz; **do NOT use backend `rr_bpm`** (its
> 0.15 Hz / 9 BPM floor cannot see box breathing). (2) the capture graph's raw trace — feed
> the real detrended chest sample from `onChestSample`, logged ~10 Hz during the active
> screen. Delete the demo adherence slider and the "skip to end" button.
>
> Hard rules: no calibration gate — the pacer and capture run from t=0, adherence defaults
> to 0.6 until signals are ready. When `signal_quality === 'poor'` or the breath buffer is
> short, freeze the adherence EMA (never jitter the flame). No backend CV changes — the
> repo already emits everything you read. If a named anchor doesn't resolve, search the
> prototype for its nearest neighbor in the same section — do not guess.
