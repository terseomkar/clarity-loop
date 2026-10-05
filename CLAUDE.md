# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.
Humans should start with [README.md](README.md). Folder-specific notes live in
`backend/CLAUDE.md`, `frontend/CLAUDE.md` and `backend/orchestrator/oshi/CLAUDE.md`.

## Project

**Clarity Loop** is a browser app for real-time biofeedback and emotional
regulation. A webcam is the only sensor. The app estimates heart rate,
breathing and posture, then guides the player through a short survey, a
calming game, and a reflection voiced by **Grandmaster Oshi**, a gentle guide
character. It works fully offline; with an `ANTHROPIC_API_KEY`, Oshi's lines
are upgraded live by Claude Haiku.

It began as a 7-week faculty capstone and is now being extended by students
with **BCI (EEG) signals, trained deep-learning models and new games**.
[docs/EXTENDING.md](docs/EXTENDING.md) is the guide for that work.

## Commands

```bash
# one-time setup (from the repo root)
python -m venv .venv
.venv\Scripts\activate                 # Windows (Git Bash: source .venv/Scripts/activate)
# source .venv/bin/activate            # macOS / Linux
pip install -r backend/requirements-dev.txt

# run the app → http://localhost:8000
uvicorn backend.main:app --reload --port 8000

# run the smoke tests (~1 s, no camera or API key needed)
python -m pytest

# Docker (keeps .env out of the image; key is supplied at runtime)
docker compose up --build
```

After any change, run `python -m pytest`. For anything visual or
signal-related, also load the page in a browser with a webcam; the tests
only check structure and message shapes.

## Layout

```
backend/                 Python · FastAPI          (details: backend/CLAUDE.md)
  main.py                routes + the single /ws WebSocket handler
  cv/                    heart_rate.py (rPPG), jade.py (ICA), respiration.py, posture.py
  state/model.py         readings → state label, relative to the user's baseline
  orchestrator/oshi/     Oshi's voice: scripted floor + live Haiku + guardrails
  orchestrator/agent.py  intervention picker (Haiku)  ┐ NOT WIRED to the UI
  orchestrator/rules.py  its offline fallback         ┘ (see docs/KNOWN_ISSUES.md)
  db/session.py          SQLite store — NOT WIRED (nothing saves sessions yet)
frontend/                plain HTML/CSS/JS, no build step   (details: frontend/CLAUDE.md)
  survey.html            landing page ( / and /survey )
  game1-4.html           the four games
  dev/                   developer pages: signals dashboard, observe, mirror
  js/                    one script per page + shared websocket.js, camera.js
  css/main.css           one shared stylesheet (contents table at the top)
audio/                   served at /audio/ — sources in CREDITS.md
tests/                   pytest smoke suite
docs/                    ARCHITECTURE, EXTENDING, GLOSSARY, KNOWN_ISSUES, design docs
docs/archive/            historical handoff files — do not treat as current
```

### Pages

| URL | File | What it is |
|---|---|---|
| `/` and `/survey` | `frontend/survey.html` | Landing page: Oshi survey → game → reflection |
| `/game1` | `game1.html` | Phoenix Ascent: breath grows a flame (camera) |
| `/game2` | `game2.html` | Grandmaster's Count: bird-call meditation (no camera) |
| `/game3` | `game3.html` | Follow the Flame: box-breathing pacer (camera) |
| `/game4` | `game4.html` | Tap the Tide: EFT tapping guide (camera, landmarks only) |
| `/dev/signals` | `dev/signals.html` | Dashboard of every live signal |
| `/dev/observe` | `dev/observe.html` | Raw waveforms + landmarks |
| `/dev/mirror` | `dev/mirror.html` | Breath → fire visual (Game 1's ancestor) |

## WebSocket messages

Everything real-time goes over one WebSocket at `/ws` as JSON with a
`type` field. The authoritative list is the docstring at the top of
`backend/main.py`; keep the two in sync when you add a type.

| Direction | `type` | Sent by / when | Key fields |
|---|---|---|---|
| → server | `hr_data` | `camera.js`, ~1/s | `r`, `g`, `b`, `chest` (128-frame averages), `bufferWindow`, `fps` |
| → server | `pose_data` | `camera.js`, ~5/s | `landmarks` {"0","7","8","11","12","23","24": {x,y,visibility}} (no reply) |
| → server | `subjective_input` | survey, each screen | `screen`, `sensation`, `sensation_alias`, `intensity`, `body_region`, `emotion`, `emotion_core`, `path`, `time_of_day`, `req_id` |
| → server | `session_complete` | survey, after a game | `path`, `intensity_pre`, `intensity_post`, (`breath_*`, `restlessness_*`), `sensation`, `body_region`, `emotion` |
| → server | `ping` | (unused by pages) | |
| ← client | `hr_result` | reply to `hr_data` | `bpm`, `rr_bpm`, `signal_quality`, `rr_quality`, `posture{…, restlessness}`, `state`, `baseline{locked,…}`, `spectrum`, `snr` |
| ← client | `oshi_line` | reply to `subjective_input` | `screen`, `text`, `req_id` |
| ← client | `intervention` | on the `offering` screen | `id`, `params`, `reasoning`, `source` (stored but unused) |
| ← client | `reflection` | reply to `session_complete` | `line`, `question` |
| ← client | `pong` | reply to `ping` | |

## Design rules (binding)

These rules come from the project's design principles
([docs/design-principles.md](docs/design-principles.md)). They are
**binding**: changes that break them should not be merged. If a feature
seems to need an exception, raise it with the instructor before building.

**Experience**
1. **Calm Technology.** Sensing runs quietly in the background and never
   interrupts. No alerts, alarms or nagging prompts; feedback is ambient
   (colour, motion, sound).
2. **Trends, not digits.** User-facing pages show change and impression
   (a flame growing, a ring shrinking), never clinical numbers. No BPM, no
   decimals, no scores. Raw numbers are allowed only on `/dev/*` pages.
3. **Invite, don't correct.** Body sensation comes first. Interventions
   invite awareness; nothing tells the player they are doing it wrong or
   "optimizes" them.
4. **Reflect, don't diagnose.** Biofeedback mirrors state. The app never
   names a condition or implies a medical judgement.
5. **Degrade gracefully.** Everything works with no API key, and a poor
   signal freezes reactions instead of making them jitter.

**Oshi's voice and AI safety**
6. Oshi's lines are at most **two sentences**, lowercase, in experiential
   (phenomenological) language. Feelings are welcomed as a "part" of the
   player (IFS framing), never as problems.
7. Every live AI line passes through `oshi/guardrails.py` (two-sentence
   clamp + `FORBIDDEN_WORDS` filter) with a scripted fallback. Don't bypass
   it, and don't remove words from `FORBIDDEN_WORDS` without review.
8. **Only labels and survey answers go to the LLM.** Never send raw video,
   raw physiological signals or raw EEG to the Claude API.
9. Never commit secrets (`.env`) or recorded user data (video, EEG,
   session databases) to git.

## Working conventions

- **Plain code:** plain JS (no framework, no bundler) and plain Python dataclasses. Don't add a framework or build step without discussing it.
- **Detectors:** detector classes return a dict that always includes `signal_quality` and never raise into the socket loop.
- **Per-user state:** create it inside `websocket_endpoint`. Module-level objects are shared by all users.
- **Duplicated code:** there is deliberately duplicated frontend code (`BreathAnalyzer`, the flame renderers, the nav bar). Each copy is marked `DUPLICATE`. Change copies deliberately, never assume one fix covers all. See [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).
- **New pages and message types:** a new page needs a route in `main.py`, an entry in `PAGE_ROUTES` (`tests/test_smoke.py`), and a link in every page's nav. A new message type needs a test and a row in the table above.
- **Comments:** explain *what and why* in plain words. Expand jargon on first use (see [docs/GLOSSARY.md](docs/GLOSSARY.md)). No "Week N" or "Spec §" references.

## Collaboration model

The person testing the app (instructor or student) is the authority on how
it *feels*. When they describe a sensation ("the flame feels jumpy", "Oshi
sounds preachy"), translate it into concrete code changes yourself. Don't
ask them to specify the fix. Ask a clarifying question only when the
feeling could reasonably point in opposite directions.

## Where to look

| Task | Start here |
|---|---|
| Understand the runtime | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Add a signal (EEG), a model or a game | [docs/EXTENDING.md](docs/EXTENDING.md) |
| Unfamiliar term | [docs/GLOSSARY.md](docs/GLOSSARY.md) |
| Something seems unused or broken | [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) |
| Detailed tour of every component | [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) |
| Oshi's personality | `backend/orchestrator/oshi/master-oshi-ifs-soul-system-prompt.md` (loaded at runtime) |
| Third-party sources and licenses | [CREDITS.md](CREDITS.md) |
