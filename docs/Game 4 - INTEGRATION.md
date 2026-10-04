# Game 4 "Tap the Tide" — Integration Handoff

This file is the entry point for integrating **Game 4 — Tap the Tide** into the Clarity
Loop repo. Everything you need is here, in the prototype, or already in the repo. Read this
top to bottom, then follow the system prompt in §7. **Do not redesign anything** — the
prototype `Game 4 - Tap the Tide.dc.html` is the finished mechanic; your job is to port it
into the app's vanilla structure and wire two stand-ins to real inputs.

---

## 0 · What this feature is

A guided **EFT (Emotional Freedom Technique) tapping** session. The player taps a sequence
of six body points while speaking one affirmation aloud, using the feeling they named in the
subjective survey.

> The clock LEADS. A fixed JS timer walks through the six points at a fixed dwell (default
> **11 s** per point) so the player never rushes the spoken statement. **MediaPipe** face +
> pose landmarks are used ONLY to *locate* each point on the player's body in the live camera
> feed and pin a pulsing marker there. Landmarks never gate or advance the flow.

The six points, in order (the "Gamut Point", "Side of Eye", "Under Nose" and "Side of Hand"
points from the classic chart are intentionally **excluded** per spec):

1. **Top of Head** · 2. **Eyebrow** · 3. **Under Eye** · 4. **Chin** · 5. **Collarbone** · 6. **Under Arm**

The player does two things at every point, simultaneously:
1. **Taps** the point — guided by a pulsing radar marker pinned to that landmark in the feed.
2. **Says aloud**: *"I am feeling `[emotion]` and I accept it."* (`[emotion]` = the survey feeling.)

After all six points, the sequence restarts from Top of Head. **Default 3 cycles** (18 points
total). The session ends after the last cycle.

Flow: **setup** (shows the survey emotion + sequence + cycle/interval pickers) → **countdown**
(3·2·1) → **active** (camera feed + pinned pulsing marker + per-point timer ring + affirmation)
→ **complete** (retrospective → `/survey` hand-off).

Player-configurable in setup (these MUST drive the run, not just display):
- **Cycles**: `1` / `3` / `5` presets + a custom field (1–9).
- **Seconds per point**: number input with steppers (4–30, default 11).

---

## 1 · Where each piece comes from (the whole strategy)

| Concern | Source to reuse | Notes |
|---|---|---|
| Screen state machine, 3·2·1 countdown, bottom timebar, `/game4` route pattern, `.mode-nav` | **`frontend/js/game3.js` + `game3.html` + `game3-*`/`game2-*` CSS** | Same shell shape as Game 3. Clone its structure and the setup→countdown→active→complete switch. |
| Live camera feed, MediaPipe **Face Mesh + Pose** load, `#camera-feed` video, mirrored preview | **`frontend/index.html` (Sensing) + `frontend/js/camera.js` (`ClarityCamera`)** | Reuse the exact `<video id="camera-feed">` + MediaPipe `<script>` tags from the Sensing page. Show the feed **without** the metrics grid / status pills / ROI debug boxes. |
| Point sequence, cycle/interval clock, landmark→point mapping, pulsing marker overlay, timer ring, affirmation, complete copy | **`Game 4 - Tap the Tide.dc.html` (the prototype — source of truth)** | Port verbatim. See the logic class: `POINTS`, `DEFAULT_PTS`, `_onFace`/`_onPose` (the landmark math), `_loop` (clock + ring + progress), `_applyActive` (active-marker styling), `_resolvedCycles`/`_resolvedSpp` (setup config). |

**Two stand-ins in the prototype that you MUST replace with real inputs (§5):**
1. **`emotion`** — a prop defaulting to `"anxious"`. Replace with the **feeling the player chose
   in the subjective survey** (read from the session/`app.js` state or the `/survey` payload).
2. **`DEFAULT_PTS` fallback positions** — fixed normalized coords used *only until* MediaPipe
   detects the player. In the app the real Face Mesh + Pose landmarks pin the points; the fixed
   coords stay as the graceful "no camera / no detection yet" fallback. **Keep them.**

**Delete (demo-only):** the dashed **demo** box in the active screen — the `next point ▸` and
`skip to end ▸▸` buttons (`skipPoint` / `skipEnd`).

**No backend CV work.** This game reads landmarks in the browser and paints an overlay. It does
NOT need `hr_result`, `rr_bpm`, posture, or any WebSocket reply. The only backend change is the
`GET /game4` route (§6).

---

## 2 · Paste manifest — what lands where

| Source (this handoff) | Destination in `clarity-loop/` | Action |
|---|---|---|
| `Game 4 - Tap the Tide.dc.html` | `docs/game4/` | Reference only — the **source of truth** to port from. Not served. |
| `Game 4 - INTEGRATION.md` (this file) | `docs/game4/` | Reference only. |

**Do NOT copy:** `support.js`, `doc-page.js` (design-tool runtime for the `.dc.html`), `_ds/`,
or any `screenshots/` — irrelevant to the running app.

**Files you CREATE:** `frontend/game4.html`, `frontend/js/game4.js`.
**Files you EDIT:** `frontend/css/main.css` (add `game4-*`, reusing `game2-*`/`game3-*` where
identical), `backend/main.py` (add `GET /game4`), and the `.mode-nav` block in every page that
has one (`index.html`, `observe.html`, `mirror.html`, `game1.html`, `game2.html`, `game3.html`,
`survey.html`) — add a `Game 4` link.

---

## 3 · Read order (before writing any code)

1. `CLAUDE.md` — repo conventions.
2. `docs/game4/Game 4 - Tap the Tide.dc.html` — the source of truth. Read the logic class in
   this order: `POINTS` + `DEFAULT_PTS`; `_startCV` (getUserMedia + Face Mesh + Pose init);
   `_onFace` / `_onPose` (the landmark→point math — **the novel part**); `_loop` (clock, ring,
   progress); `_advance` / `_applyActive`; `_resolvedCycles` / `_resolvedSpp` (setup config).
   Ignore the DC wrapper (`<x-dc>`, `renderVals`, `{{ }}` holes) — convert it to plain DOM.
3. `frontend/index.html` + `frontend/js/camera.js` — how the Sensing page loads MediaPipe and
   the camera feed. Reuse the `<script>` tags and `#camera-feed` markup verbatim.
4. `frontend/js/game3.js` — the structural template for the vanilla screen machine.

Anchor by named constant/method/element — **never by line number.**

---

## 4 · The things that would trip you up

1. **Mirror the marker coords, not just the video.** The feed is displayed mirrored
   (`transform: scaleX(-1)`). MediaPipe landmarks are in un-mirrored frame space, so every point
   x is flipped: `displayX = 1 - lm.x` (see `_mx()` in the prototype). If markers land on the
   wrong side, this is why. Y is not flipped.
2. **Face points come from Face Mesh; body points from Pose.** `_onFace` reads Face Mesh indices
   `10` (forehead top), `152` (chin), `105` (eyebrow), `145` (under-eye), and derives the crown
   above the forehead by `top.y - 0.45 * faceH`. `_onPose` reads Pose `11`/`12` (shoulders) and
   `23` (hip) to derive collarbone and under-arm. Port these formulas verbatim; they are tuned.
3. **`camera.js`'s Pose already forwards `11,12,23,24`** but its Face Mesh only drives ROIs and
   does **not** expose face landmarks to callers. Cheapest clean path: add an **`onFaceSample`**
   callback to `ClarityCamera` (forward `results.multiFaceLandmarks[0]` from the existing
   `_faceMesh.onResults`) and reuse the existing **`onPoseSample`** for body points — so ONE
   MediaPipe pipeline serves the game. Do NOT spin up a second Face Mesh + Pose in `game4.js`
   (double-running is heavy). See §5a.
4. **Never block on the camera.** The clock and the whole sequence run from t=0. If the camera is
   denied or no face is detected yet, the markers sit at `DEFAULT_PTS` and the feed shows the
   "enable your camera" placeholder — the session still completes. This is calm-tech: the guide
   never waits for CV.
5. **Positions are lerped, not snapped.** `_loop` eases `_pts` toward `_tgt` (`dt * 6`) so the
   marker glides and a jittery landmark frame doesn't make the marker twitch. Feed `_tgt` the raw
   detection; let the loop smooth it.
6. **Setup config must drive the run.** `begin()` reads `_resolvedCycles()` / `_resolvedSpp()`
   into `this._cycles` / `this._spp` — the loop and the "Cycle N of M" / complete headline all
   derive from those. Wire the pickers to state, not to display-only text. (Verified in the
   prototype: cycles=1 ends after one 6-point pass.)

---

## 5 · Input wiring (the only real work)

### 5a · Camera + landmarks (reuse the Sensing pipeline)

In `game4.html`, copy from `index.html`: the `<video id="camera-feed" playsinline muted autoplay>`
tag, the two MediaPipe `<script>` tags (Face Mesh `0.4.1633559619`, Pose `0.5.1675469404`), and
`websocket.js` + `camera.js`. **Omit** the metrics grid, status pills, and `#roi-canvas` debug
overlay. Add your own absolutely-positioned overlay `<div>` layer above the mirrored video.

Extend `ClarityCamera` with one callback (mirrors the existing `onChestSample`/`onPoseSample`):

```js
// in _initFaceMesh's onResults, alongside the existing ROI update:
if (lms && this._onFaceSample) this._onFaceSample(lms);   // full face landmark array
```

Then in `game4.js`, start the camera with both callbacks and run the prototype's math:

```js
camera = new ClarityCamera(_onSignal, {
  onFaceSample: (lms) => _onFace(lms),   // prototype _onFace body, minus the r.multiFaceLandmarks unwrap
  onPoseSample: (lms) => _onPose(lms),   // prototype _onPose body; lms is the {idx:{x,y}} object camera.js sends
});
camera.start();   // no calibration gate
```

`_onFace` / `_onPose` write into `_tgt`; the rAF loop lerps `_pts` toward `_tgt` and repaints the
markers. Port `_mx`, `_onFace`, `_onPose`, `_loop`, `_positionMarkers`, `_applyActive` verbatim.
(Note: `onPoseSample` hands you the `{ "11": {x,y,visibility}, ... }` object, so index with
`lms[11]` not `lms.poseLandmarks[11]` — adjust `_onPose`'s first lines accordingly.)

### 5b · Emotion (replaces the `emotion` prop)

The affirmation and the setup/complete copy read one string. Source it from the survey:

```js
const emotion = (session.subjectiveFeeling || sessionStorage.getItem('cl_feeling') || 'this feeling')
  .toString().toLowerCase();
```

Use whatever the survey/`app.js` already persists (check `survey.html` / `db/session.py` for the
key). Render it lowercase in: setup "you're working with", the active affirmation, and the
complete recap. If nothing is set, fall back to a neutral phrase — never show an empty blank.

### 5c · No backend messages

`game4.js` does not need `_onMsg` / `hr_result`. If you keep the socket connected for session
logging, ignore its replies. No `respiration.py` / `heart_rate.py` / `posture.py` involvement.

---

## 6 · Backend + nav

- `backend/main.py`: add `GET /game4` serving `frontend/game4.html`, mirroring `/game3`. Nothing
  else.
- Add a `Game 4` `<a class="mode-link" href="/game4">` to the `.mode-nav` in every page that has
  one; mark it `active` in `game4.html`.
- `game4.html`: clone `game3.html`'s `<head>` + script-load order, swap the flame canvas for the
  camera feed + overlay, and port the setup / countdown / active / complete containers from the
  prototype into `game3-*`/`game2-*`-style classes. Load `frontend/js/game4.js` last.
- CSS: reuse `game2-picker-*`, `game2-begin-btn`, `game2-countdown-num`, `game2-timebar*`,
  `mirror-nav`. Add `game4-*` only for the camera frame, the marker/radar overlay, the timer ring,
  the affirmation block, and the cycles/interval pickers.

No new Python deps. No `.env` changes. The MediaPipe scripts load from the same CDN the Sensing
page already uses.

---

## 7 · System prompt for Claude Code

> You are integrating **Game 4 — Tap the Tide**, a guided EFT tapping session, into the Clarity
> Loop repo. All source material is in `docs/game4/` and the repo. Read `CLAUDE.md`, then read this
> handoff (`docs/game4/Game 4 - INTEGRATION.md`) top to bottom and follow it exactly. **Do not
> redesign** — the prototype `docs/game4/Game 4 - Tap the Tide.dc.html` is the finished mechanic;
> port it faithfully.
>
> The strategy: Game 4 = game3.js's screen shell + the Sensing page's camera + MediaPipe pipeline
> + the prototype's point sequence / clock / landmark-mapping / pulsing-marker overlay. Reuse,
> don't reinvent. Anchor by named symbol, never by line number.
>
> Core idea: a fixed JS clock walks six tapping points (Top of Head, Eyebrow, Under Eye, Chin,
> Collarbone, Under Arm) at a fixed dwell (default 11 s) for a chosen number of cycles (default 3),
> while the player says "I am feeling [emotion] and I accept it" aloud. MediaPipe Face Mesh + Pose
> landmarks ONLY locate each point on the player in the live mirrored feed and pin a pulsing marker
> there — landmarks never gate or advance the flow. Never block the session on the camera; fall
> back to fixed marker positions when detection isn't available.
>
> Create `frontend/game4.html` and `frontend/js/game4.js`; edit `main.css`, `main.py` (add
> `/game4`), and the `.mode-nav` in every page. Convert the prototype's DC templating
> (`renderVals`/`{{ }}`) to plain DOM in the vanilla IIFE style of `game3.js`. Reuse
> `ClarityCamera` — extend it with an `onFaceSample` callback (forward the face landmark array from
> the existing Face Mesh `onResults`) and reuse the existing `onPoseSample`; do NOT run a second
> MediaPipe pipeline. Port `_mx`, `_onFace`, `_onPose`, `_loop`, `_positionMarkers`, `_applyActive`,
> `_resolvedCycles`, `_resolvedSpp` verbatim.
>
> Replace exactly two stand-ins, per §5: (1) the `emotion` prop → the feeling the player chose in
> the subjective survey (read from session/`app.js`; lowercase; neutral fallback, never blank).
> (2) keep `DEFAULT_PTS` as the no-camera/no-detection fallback — real Face Mesh + Pose landmarks
> pin the points when available. Delete the demo box (`next point` / `skip to end`).
>
> Hard rules: mirror marker x with `1 - lm.x` to match the `scaleX(-1)` feed; lerp positions (don't
> snap); no calibration gate — the clock runs from t=0; the setup cycles/interval pickers MUST drive
> the run (via `_resolvedCycles`/`_resolvedSpp` in `begin`), and the "Cycle N of M" badge and
> complete headline derive from the chosen cycles. No backend CV changes — this game only adds the
> `/game4` route. If a named anchor doesn't resolve, search the prototype for its nearest neighbor
> in the same section — do not guess.
