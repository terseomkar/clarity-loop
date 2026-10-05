# CLAUDE.md: frontend/

Plain HTML/CSS/JavaScript: **no framework, no bundler, no npm**. Files are served
as-is by FastAPI (`frontend/` is mounted at `/static`). Root rules in
[../CLAUDE.md](../CLAUDE.md) apply, especially "trends, not digits" on every
non-`/dev` page.

## Map

| Page (URL) | HTML | Script | Uses camera / WS? |
|---|---|---|---|
| `/`, `/survey` | `survey.html` | `js/oshi_flow.js` | WS only |
| `/game1` | `game1.html` | `js/game1.js` | camera + WS |
| `/game2` | `game2.html` | `js/game2.js` | neither |
| `/game3` | `game3.html` | `js/game3.js` | camera + WS |
| `/game4` | `game4.html` | `js/game4.js` | camera + WS (replies ignored) |
| `/dev/signals` | `dev/signals.html` | `js/app.js` | camera + WS |
| `/dev/observe` | `dev/observe.html` | `js/observe.js` | camera + WS |
| `/dev/mirror` | `dev/mirror.html` | `js/mirror.js` | camera + WS |

**Shared modules:** these are the only shared JS. Load them before the page script.
- `js/websocket.js`, `ClaritySocket(onMessage)`:
  - connects to `/ws`, auto-reconnects
  - `send(obj)` sends a message
  - fires `ws:open` / `ws:close` events on `document`
- `js/camera.js`, `ClarityCamera(onSignalUpdate, opts)`:
  - webcam + MediaPipe Face Mesh / Pose (loaded from CDN `<script>` tags in each page)
  - set `camera.socket = socket` to stream `hr_data` / `pose_data`
  - raw per-frame data comes through the `opts.onChestSample`, `onPoseSample` and `onFaceSample` callbacks

**Styles:** `css/main.css` is one file for all pages, with a contents table at
the top. Several games share `game2-*` classes, so edit those carefully.

**Assets:**
- images in `img/` and video in `video/`, served at `/static/...`
- audio in the repo-root `audio/`, served at `/audio/...` (URL-encode spaces in filenames)

## Key flows

- **Survey ↔ game hand-off:**
  1. `oshi_flow.js` saves answers in `sessionStorage['clarityLoop.survey.v1']`.
  2. It redirects to the chosen game.
  3. Each game ends with a link back to `/survey`, where the flow resumes at the post-game screens.
  4. `game4.js` also reads that key to show the player's chosen feeling.
- **Mute preference:** `localStorage['clarity.muted']` (game1, game3).
- **Breath visuals are computed in the browser:**
  - Each camera game runs its own `BreathAnalyzer` on `onChestSample`.
  - Backend `hr_result` is only lightly used: game1 reads `posture.restlessness`, game3 reads `signal_quality`.

## Watch out

- **Duplicated code:**
  - `BreathAnalyzer` (observe, mirror, game1, game3) and the flame renderers (mirror, game1, game3) are copies that have drifted. Each one carries a `DUPLICATE` comment listing the differences.
  - A fix in one copy is not a fix in the others, and their constants were hand-tuned per game.
- **Nav bar:**
  - The same `<nav class="mode-nav ...">` block is copied into all 8 pages, in two groups (Home + games | dev pages).
  - Adding a page means editing every nav.
- **Global names:** scripts are classic `<script>` tags sharing one global scope. Prefix new top-level names (e.g. `GAME1_DEBUG`), or wrap the file in an IIFE (an immediately-invoked function) like `game2.js` / `oshi_flow.js`.
- **Console noise:** chatty logs sit behind flags (`SIGNALS_DEBUG` in `app.js`, `GAME1_DEBUG` in `game1.js`). Keep new per-frame/per-message logging behind a flag too.
- **WebSocket over HTTPS:** `websocket.js` hard-codes `ws://`, which breaks on HTTPS. See `docs/KNOWN_ISSUES.md`.

## New game checklist (short version; full version in docs/EXTENDING.md §3)

1. `gameN.html` + `js/gameN.js`, with a header comment, the shared nav (with `active`), and a "with grandmaster oshi" link to `/survey` at the end.
2. Route in `backend/main.py` and a row in `PAGE_ROUTES` (`tests/test_smoke.py`).
3. A nav link on every page.
4. Survey offering: `PATHS` + `_handoffToGame()` in `oshi_flow.js`, plus the "four paths" lines (`oshi_flow.js` and `backend/orchestrator/oshi/{context,guardrails}.py`).
5. A new section at the end of `css/main.css`, listed in its contents table.
6. Sources for any new media in `CREDITS.md`.

Syntax-check scripts with `node --check frontend/js/<file>.js`, then test in
a real browser with a webcam.
