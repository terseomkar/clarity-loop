# Known issues and loose ends

Everything here was found during the October 2026 handoff cleanup. That
cleanup was deliberately "tidy only": documentation and dead code, **no
behavior changes**. So these items were written down, not fixed. Many make
good student projects. Each one says where to look.

## Features that exist but aren't connected

### 1. The intervention picker's answer is never used
- **Where:**
  - `backend/orchestrator/agent.py` (Claude Haiku picker)
  - `backend/orchestrator/rules.py` (offline fallback)
  - `backend/main.py` (the `subjective_input` handler, `offering` screen)
- **What happens:**
  - When the survey reaches its "offering" screen, the backend picks one of eight interventions and sends `{type:"intervention"}`.
  - `frontend/js/oshi_flow.js` saves it to sessionStorage and **never reads it back**.
  - The player chooses a game themselves.
  - Six of the eight intervention ids (see [micro-interventions.md](micro-interventions.md)) have no UI anywhere.
- **Project idea:** map each intervention to a game or a new mini-experience, then let the offering screen highlight Oshi's suggestion.

### 2. Sessions are never saved
- **Where:** `backend/db/session.py`
- **What happens:** `save_session()` / `last_session()` work, but nothing calls them, so `backend/data/sessions.db` is never created.
- **Project idea:**
  - Call `save_session()` from the `session_complete` handler in `main.py`.
  - Recorded sessions are the natural training data for future models, so think about consent and anonymisation first.

### 3. Game 1's breath / restlessness never reach Oshi's reflection
- **Where:**
  - `frontend/js/oshi_flow.js` (`_onSocketMessage` → `hr_result`, and `_sendSessionComplete`)
  - `backend/orchestrator/oshi/schema.py` (`AVAILABLE_SIGNALS_BY_PATH`)
- **What happens:**
  - The survey is meant to attach game1's breathing rate and restlessness, before and after, to `session_complete`.
  - It reads them from `hr_result` messages received **on the survey page**. That page doesn't start the camera, so none arrive and the fields are always `null`.
  - Even if they arrived, "before" and "after" would be the same snapshot.
  - Result: every reflection is based on the intensity ring only.
- **Project idea:**
  - Have each game store its own start/end readings (e.g. in sessionStorage) for the survey to send.
  - This is also exactly how an EEG-derived signal would reach the reflection. See [EXTENDING.md](EXTENDING.md).

### 4. `emotion_core` is collected but unused
- `SubjectiveInput.emotion_core` (the feeling-wheel category) is parsed in `schema.py` but not used by any prompt.

## Duplicated code

### 5. Four copies of `BreathAnalyzer`, three flame renderers
- **Where:**
  - `BreathAnalyzer` in `frontend/js/observe.js`, `mirror.js`, `game1.js`, `game3.js`
  - flame renderers: `FlameField` in `mirror.js` and `game1.js`, and `createFlameField()` in `game3.js`
- **What happens:**
  - The copies have drifted. `EXTREMA_HALF_WIN` is 5 in observe/mirror and 10 in game1/game3.
  - `computeRegularity` exists only in game1/game3; `countCycles` only in game1.
  - A fix in one copy doesn't reach the others. Each copy carries a `DUPLICATE` comment.
- **Project idea:**
  - Extract `frontend/js/shared/breath.js` with the per-game constants passed in as options.
  - Verify each game still *feels* the same, because these constants were tuned by hand.

### 6. Repeated frontend boilerplate
- **Mute button:** the mute toggle (localStorage key `clarity.muted`) is repeated in game1 and game3.
- **Screen flow:** the setup → countdown → active → complete screen flow is repeated in games 2–4.
- **Shared CSS classes:** game3 and game4 reuse `game2-*` CSS classes.
- **Nav bar:** the nav bar markup is copied into all 8 HTML files. If you change it, change every page; the smoke tests check that every page has a route.

### 7. Duplicated backend setup
- **Haiku client:** the Claude Haiku client setup and model id appear in both `orchestrator/agent.py` and `orchestrator/oshi/narrator.py`.
- **Banned words:**
  - The banned-word list appears in both `agent.py`'s prompt and `oshi/persona.py` (`FORBIDDEN_WORDS`).
  - The picker's `reasoning` text is **not** passed through the Oshi guardrails.
- **Time of day:** the "auto → morning/evening" logic appears in both `main.py` (`_resolve_time_of_day`) and `oshi/context.py` (`circadian_tag`).
- **Scripted lines:** Oshi's scripted lines exist twice with **different wording**: `frontend/js/oshi_flow.js` (`SCRIPTED`) and `backend/orchestrator/oshi/guardrails.py` (`SCRIPTED`). When the backend is reachable, the player sees the server's version.

## Correctness and robustness

### 8. Heart-rate accuracy
- **Where:** `backend/cv/heart_rate.py`
- **What happens:**
  - The ported rPPG pipeline doesn't reliably recover a clean synthetic 72 BPM pulse: it returns anything from ~49 to ~148 depending on noise.
  - The project already treats BPM as a trend, never an exact number, but a better heart-rate estimate would help every signal built on top of it.
- **Project idea:** compare the current component-selection rule with simpler baselines (green channel only, CHROM/POS methods) on recorded data.

### 9. The intervention cooldown is shared by all users
- **Where:** `backend/main.py`, `_orchestrator = AgentOrchestrator()` at module level
- **What happens:** the "don't repeat the last intervention" memory is shared by every connected browser, not kept per user. It's harmless for one user, wrong for several.

### 10. WebSocket breaks over HTTPS
- **Where:** `frontend/js/websocket.js`
- **What happens:** it always connects with `ws://`. Browsers block that on an `https://` page.
- **Fix:** `const proto = location.protocol === 'https:' ? 'wss' : 'ws';`. Needed before any HTTPS deployment.

### 11. Deprecated NumPy API
- **Where:** `backend/cv/jade.py`
- **What happens:** uses `numpy.matrix`, which NumPy has deprecated. It still works on NumPy 2.x; the warning is hidden in `pytest.ini`. A future NumPy release may remove it.

### 12. Unpinned dependencies
- **Where:** `backend/requirements.txt`
- **What happens:** every package is `>=` with no upper bound and no lock file, so a fresh install can pick up breaking versions.
- **Last known-good set (Python 3.13, 2026-10-04):** fastapi 0.136.0, uvicorn 0.44.0, numpy 2.4.4, scipy 1.17.1, python-dotenv 1.2.2, anthropic 0.116.0.

## Repository

### 13. Licensing is undecided
No LICENSE file. `jade.py` is GPL-v3. Several audio and image sources are unconfirmed. See [CREDITS.md](../CREDITS.md).

### 14. Large media files in git
- **Size:** about 25 MB of audio/images. The PNG portraits are about 2 MB each, and `frontend/img/oshi.png` is 8.6 MB.
- **Fix:** compressing to WebP or moving to Git LFS would shrink clones.

### 15. Docker setup not re-verified
- `.dockerignore` now keeps `.env` out of the image, but `docker build` wasn't re-run during the cleanup because Docker Desktop wasn't running.
- `docker-compose.yml`'s optional `env_file` syntax needs Docker Compose v2.24 or newer.
