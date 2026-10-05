# CLAUDE.md: backend/

Python 3.10+ · FastAPI · NumPy/SciPy · optional `anthropic` SDK.
Root rules in [../CLAUDE.md](../CLAUDE.md) apply. Runtime picture:
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Map

| File | Role |
|---|---|
| `main.py` | All HTTP routes (pages, `/static`, `/audio`, `/health`) and the single `/ws` handler, `websocket_endpoint`, which dispatches on `msg["type"]`. Its module docstring is the authoritative message list. |
| `cv/heart_rate.py` | `HeartRateDetector`: face colour averages → BPM via ICA + FFT (rPPG). Stateless, shared. |
| `cv/jade.py` | JADE ICA algorithm (GPL-v3, ported; leave as is unless replacing). |
| `cv/respiration.py` | `RespirationDetector`: chest brightness → breaths/min. Stateless, shared. |
| `cv/posture.py` | `PostureDetector`: 7 landmarks → posture + restlessness. **Per connection.** |
| `state/model.py` | `PhysiologicalStateModel`: rolling readings → state label vs. personal baseline. **Per connection.** |
| `orchestrator/oshi/` | Oshi's lines and reflection. See its own CLAUDE.md. |
| `orchestrator/agent.py`, `rules.py` | Intervention picker + fallback. **Runs, but the UI ignores its result.** |
| `db/session.py` | SQLite store. **Never called.** |

## How a message flows

```
browser → /ws → json.loads → websocket_endpoint
  "hr_data"          → _hr_detector.process → BPM rolling median (drops ±40 jumps)
                       → _rr_detector.process → posture.latest() → state_model.push
                       → reply "hr_result"
  "pose_data"        → posture.push_landmarks            (no reply)
  "subjective_input" → narrator.line → reply "oshi_line"
                       (+ on screen "offering" with path: _orchestrator.recommend → "intervention")
  "session_complete" → narrator.reflection → reply "reflection"
  "ping"             → "pong"
  anything else      → ignored (debug log)
```

## Conventions

- **Detectors:** a `process(...)`-style method returns a `dict` that always has
  `signal_quality` (`"ok" | "poor" | "insufficient_data" | "error"`). They catch
  their own exceptions and never raise into the socket loop.
- **Where state lives:**
  - Anything that remembers a user (windows, baselines, history) is created
    **inside** `websocket_endpoint`.
  - Module-level objects are shared by every connected browser. The
    `_orchestrator` cooldown being shared this way is a known issue.
- **Blocking work:** the handler is `async` but detectors run synchronously.
  Heavy work (e.g. deep-learning inference) must go through
  `asyncio.to_thread(...)` or it stalls every user. See `docs/EXTENDING.md` §2.
- **API key:**
  - `.env` is loaded at the top of `main.py` **before** the orchestrator
    imports, because both read `ANTHROPIC_API_KEY` when they are constructed.
  - With no key, everything runs in scripted / rules mode.
- **Docstrings:** plain-language module docstrings that explain the *why* and
  expand jargon (see `cv/heart_rate.py`). No "Week N" / "Spec §" references.

## Adding things

- **New signal / message type** (e.g. EEG): follow `docs/EXTENDING.md` §1. In short:
  1. Add an `elif` branch in `websocket_endpoint`.
  2. Add a detector class following the conventions above.
  3. Add fields to `PhysiologicalStateModel.push()` / `PhysioSnapshot`.
  4. Add the reply fields.
  5. List the message in the `main.py` docstring and the root CLAUDE.md table.
  6. Add a test in `tests/test_smoke.py`.
- **New page route:** add the `@app.get` function and a row in `PAGE_ROUTES` (`tests/test_smoke.py`).

## Testing

```bash
python -m pytest            # from the repo root; scripted-only, no camera
python -m pyflakes backend  # optional: unused imports / names
```
