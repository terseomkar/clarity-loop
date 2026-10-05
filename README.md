# Clarity Loop

**A calm, webcam-based biofeedback app.** Clarity Loop makes your body's
signals visible (heart rate, breathing, posture) using nothing but a webcam,
then guides you through a short check-in, a calming game, and a reflection
with **Grandmaster Oshi**, a gentle forest-sage guide.

It is designed to feel like *"a space you enter where your body becomes
visible"*, not like a fitness tracker. It shows trends and impressions,
never clinical numbers, and it invites awareness instead of correcting you.

> Started as a 7-week faculty capstone. Students are now extending it with
> **brain-computer interface (EEG) signals, trained deep-learning models and
> new games**. If that's you, read [docs/EXTENDING.md](docs/EXTENDING.md) after
> the quick start.

## Quick start

You need **Python 3.10+**, a webcam, and Chrome or Edge.

```bash
git clone <this repo> && cd clarity-loop

python -m venv .venv
# Windows (PowerShell / cmd):  .venv\Scripts\activate
# Windows (Git Bash):          source .venv/Scripts/activate
# macOS / Linux:               source .venv/bin/activate

pip install -r backend/requirements-dev.txt     # app + test tools
uvicorn backend.main:app --reload --port 8000
```

Open **http://localhost:8000** and allow camera access when a game asks for it.

**Optional: live AI narration.** Copy `.env.example` to `.env` and set
`ANTHROPIC_API_KEY`. Without a key, everything still works: Oshi uses
pre-written lines.

**Run the tests:**

```bash
python -m pytest     # ~1 second; no camera or API key needed
```

**Docker:**

```bash
docker compose up --build     # then open http://localhost:8000
```

## What's in the app

| URL | What you'll find |
|---|---|
| `/` | **Start here.** Oshi asks what you're feeling and where, then offers four paths: |
| `/game1` | **Phoenix Ascent**: slow, deep breaths grow a flame until a phoenix rises (camera) |
| `/game2` | **Grandmaster's Count**: count bird calls in an ambient forest (audio only) |
| `/game3` | **Follow the Flame**: box breathing (4-4-4-4) paced by a flame (camera) |
| `/game4` | **Tap the Tide**: guided EFT tapping, with points placed on your live video (camera) |
| `/dev/signals` | Developer dashboard: every live signal as numbers |
| `/dev/observe`, `/dev/mirror` | Developer views: raw waveforms; breath as fire |

After a game, the "with grandmaster oshi" button takes you back to `/` for
the reflection.

**Privacy:** video never leaves your browser. Only small averages (colour,
brightness) and body-landmark coordinates go to the local server. Nothing is
saved to disk. If an API key is set, Claude receives your survey answers and
a one-word state label; it never receives video or raw signals.

## How it works (one paragraph)

The browser runs Google's MediaPipe models to find your face and body, then
averages the colour of your forehead and cheeks and the brightness of your
chest about 15 times a second. Those numbers stream over a WebSocket to a
Python (FastAPI) server, which estimates heart rate (via "rPPG", reading
the pulse from tiny skin-colour changes), breathing rate and restlessness. It
compares them to your own baseline and labels your state
(settled / settling / elevated / …). Oshi's lines come from a scripted
library, optionally upgraded live by Claude Haiku and always filtered by
safety guardrails. Full picture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
backend/     Python server: routes, WebSocket, signal processing, Oshi
frontend/    HTML/CSS/JS pages (no framework, no build step)
audio/       sounds for the survey and games
tests/       pytest smoke tests
docs/        architecture, extension guide, glossary, known issues, design docs
```

## Documentation

| Doc | Read it when |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | You want the big picture |
| [docs/EXTENDING.md](docs/EXTENDING.md) | You're adding EEG, a model or a game |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | You hit a term like rPPG, ICA or IFS |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | Something looks unused or odd (and for project ideas) |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | You want a detailed tour of every component and game |
| [docs/design-principles.md](docs/design-principles.md) | You want the design thinking behind the app |
| [CLAUDE.md](CLAUDE.md) | You're using Claude Code (also the best summary of the **binding design rules**) |
| [CREDITS.md](CREDITS.md) | You need sources and licenses |

## Design rules

Contributions must follow the binding rules in [CLAUDE.md](CLAUDE.md#design-rules-binding).
In short:
- calm, not demanding
- trends, not numbers
- invite, don't correct
- never diagnose
- Oshi speaks in at most two gentle sentences
- raw body or brain data never goes to an AI service or into git

## License

**Not yet decided.** Until a license is chosen, use this code only for the
course. Note that `backend/cv/jade.py` is GPL-v3 and several media files
still need their licenses confirmed. See [CREDITS.md](CREDITS.md).
