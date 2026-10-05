# Extending Clarity Loop

A practical guide for adding a new signal (for example EEG from a BCI
headset), a trained model, or a new game. It describes the code **as it is
today**. There is no plug-in system yet, so each addition touches a handful of
files, and this guide lists them in order.

Before you start:
1. Read the binding design and safety rules in [`CLAUDE.md`](../CLAUDE.md#design-rules-binding).
2. Run the app and the tests (`python -m pytest`) so you know your starting point is green.
3. Open `/dev/signals` with your webcam on. That page is where you'll check a new signal first.

---

## 1. Adding a new signal (e.g. EEG)

Today, three signals come in: camera colour averages (`hr_data`), body
landmarks (`pose_data`) and survey answers (`subjective_input`). A new
signal follows the same path. The touchpoints, in order:

### 1.1 Decide where the raw data enters

| Option | When it fits | Notes |
|---|---|---|
| **Browser → WebSocket** (like the camera) | The headset can talk to the browser (e.g. Web Bluetooth / Web Serial), or you're replaying a recording | Matches the current design exactly. Send *windows* of samples or browser-computed features, not every sample. |
| **Directly into the Python backend** | The headset has a Python SDK or streams over something like Lab Streaming Layer / BrainFlow | The backend currently only *reacts* to WebSocket messages. You would need a background task that reads the device and makes results available to each connection. That's a bigger design change; discuss it before building. |

Whichever you choose: **raw EEG must never be sent to the Claude API**, and
raw recordings must never be committed to git.

### 1.2 Frontend: send a new message type
- Model a new module on `frontend/js/camera.js`. It buffers samples and calls
  `this.socket.send({type: "hr_data", ...})` on a timer.
- Use a **new** `type` (e.g. `"eeg_data"`) rather than adding fields to
  `hr_data`. Pages ignore message types they don't know, so this is safe.

### 1.3 Backend: handle the message
- **Dispatch:** add an `elif msg_type == "eeg_data":` branch in `websocket_endpoint` (`backend/main.py`).
- **Detector:** put your processing in a class, e.g. `backend/cv/eeg.py` (or a new `backend/bci/` package). Follow the existing detector convention:
  - a `process(...)` method that returns a **dict** that always includes `signal_quality` (`"ok" | "poor" | "insufficient_data" | "error"`)
  - it **never raises**; errors come back as `signal_quality: "error"`
  - plain-language module docstring (see `heart_rate.py` for the pattern)
- **Shared or per-connection?**
  - If the detector keeps per-user history (a rolling window, a baseline), create it inside `websocket_endpoint`, like `PostureDetector`.
  - If it is stateless, create it once at module level, like `_hr_detector`.

### 1.4 State model: let the signal shape the state label
- **Where:** `backend/state/model.py`
- **What to add:**
  - a keyword argument to `push()`
  - a `deque` for the signal
  - a field on `PhysioSnapshot`
  - a rule in `classify()`
  - if you need a new label, add it to `StateLabel`
- **Keep comparisons relative to the person's baseline**, as heart rate already is.

### 1.5 Reply to the browser
- **Option 1:** add your values to the `hr_result` dict in `main.py`, which already carries posture and baseline.
- **Option 2:** send a separate reply such as `{type: "eeg_result", ...}`.
- **Document it:** list the new message in the module docstring of `main.py` and in `CLAUDE.md`.

### 1.6 Show it on the dev page first
- **Where:** `frontend/js/app.js` + `frontend/dev/signals.html`
- **What:** add a metric card and read your field in `_onMessage`. Raw numbers are fine **on dev pages only**.

### 1.7 Use it in a game → see section 4

### 1.8 Let Oshi reflect on it (optional)
- **Purpose:** this lets Oshi say something like "the mind has grown quieter" after a game. Only claim this if the signal was really measured.
- **Files to change:**
  - `backend/orchestrator/oshi/schema.py`: add it to `Signal`, add `*_pre` / `*_post` fields to `SessionResult` (and `from_dict`), add it to the game's entry in `AVAILABLE_SIGNALS_BY_PATH`, and update `available_signals`.
  - `backend/orchestrator/oshi/reflection.py`: add a felt-language line in `_shift_lines()`, never a number.
  - `backend/orchestrator/oshi/guardrails.py`: add an optional variant in `scripted_reflection()`.
  - `frontend/js/oshi_flow.js` (`_sendSessionComplete`): send the before/after values.
- **Watch out:** the game must save those values itself (e.g. in sessionStorage), because the survey page has no live signals (see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) #3).

### 1.9 Test it
Add a WebSocket test to `tests/test_smoke.py`: send one `eeg_data` message
with synthetic data and assert the reply's keys.

---

## 2. Adding a trained model (deep learning)

### Where inference can run

| Where | Good for | Watch out for |
|---|---|---|
| **Backend, inside a detector** (PyTorch, ONNX Runtime, …) | Heavier models; one Python environment | The WebSocket handler is `async`, but the detectors run *synchronously* inside it. A slow model call blocks **every** connected user. Run inference off the event loop (`await asyncio.to_thread(model_fn, x)` or FastAPI's `run_in_threadpool`) and keep it well under ~1 s. |
| **Browser** (ONNX Runtime Web, TensorFlow.js) | Low latency; data never leaves the machine | Model download size; device speed varies. |

### Practical conventions
- **Load once:** load the model at module import (like `_hr_detector`), not per message.
- **Model files stay out of git.** Download them via a script, or keep them in a `models/` folder that is gitignored (add the rule when you create it).
- **Training code:** keep it out of `backend/`, for example in a top-level `ml/` or `training/` folder with its own requirements. The server shouldn't need your training dependencies.
- **Replacing the rules:** a learned classifier can replace the hand-tuned `PhysiologicalStateModel.classify()`. Keep the same output labels, or update every consumer.

### Data for training
- **No recordings yet:** nothing records sessions today (see KNOWN_ISSUES #2).
- **Before you collect data:** work out consent, anonymisation and storage with your instructor.
- **Never commit recordings to the repo.**

---

## 3. Adding a new game

Use an existing game as a template: `game3` for a camera-based pacer,
`game2` for no camera. Checklist:

1. **Page + logic:**
   - Add `frontend/game5.html` and `frontend/js/game5.js`.
   - Copy the header comment format from an existing page.
   - The page must include the shared nav bar (copy it from another page and set `active` on your link).
   - End with a link back to `/survey` ("with grandmaster oshi") so the reflection runs.
2. **Route:**
   - Add `@app.get("/game5")` in `backend/main.py`.
   - Add the page to `PAGE_ROUTES` in `tests/test_smoke.py`. A test fails if an HTML page has no route.
3. **Nav:** add the link to the nav in **all** HTML pages (it is copied, not shared).
4. **Survey offering:** the survey lets players choose a game. Add the game to:
   - `PATHS` in `frontend/js/oshi_flow.js` (title, goal, description)
   - `_handoffToGame()` in the same file (it maps the path to a URL)
   - the `offering` intent in `backend/orchestrator/oshi/context.py` (it names each path)
   - the `offering` lines in both `SCRIPTED` tables: `oshi_flow.js` and `oshi/guardrails.py` (they say "four paths")
5. **Signals for the reflection:** add an entry to `AVAILABLE_SIGNALS_BY_PATH` (`oshi/schema.py`) if the game measures anything beyond intensity.
6. **Styles:** add a new banner section at the end of `frontend/css/main.css` and list it in the contents table at the top.
7. **Audio:** files go in `audio/` (served at `/audio/...`). Record the source and license in `CREDITS.md`.

---

## 4. Applying a signal to an existing game

| Game | Where it reads signals today | Good seam for a new signal |
|---|---|---|
| **Game 1** Phoenix Ascent | `game1.js`: chest samples via `onChestSample` → `BreathAnalyzer`; backend `posture.restlessness` in the WebSocket handler (search for `_restlessness`) | The progress "contribution rate" block, which already combines several scores and gates |
| **Game 2** Grandmaster's Count | none (no camera or WebSocket) | It would need a `ClaritySocket` added; a focus/attention signal fits its counting task naturally |
| **Game 3** Follow the Flame | `game3.js` `_updateAdherence()`: in-browser breath rate + regularity | Adherence is the single number that shapes the flame's *character*. Blend a new signal in there, never into the flame's size (the clock leads) |
| **Game 4** Tap the Tide | face/pose landmarks only, for marker placement | A calm/settling signal could change marker colour or the affirmation pacing; keep the clock in charge |

Whatever you add, check it against the binding rules:
- Trends, not numbers, on user-facing pages.
- Invite awareness; don't score or correct the player.
- A poor signal must freeze reactions, not make them jitter.
