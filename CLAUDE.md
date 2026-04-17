# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Clarity Loop** — a 7-week capstone PWA for real-time biofeedback and emotional regulation. Makes the user's physiology visible (HR, respiration, posture) via webcam CV and delivers adaptive AI-guided micro-interventions.

Full plan: `../Faculty Capstone Markdowns/Claude Implementation Plan/Clarity Loop - 7 Week Project Plan.md`

## Running Locally

```bash
# From clarity-loop/ root
source .venv/Scripts/activate      # Windows activate
uvicorn backend.main:app --reload --port 8000
# open http://localhost:8000
```

First-time setup:
```bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r backend/requirements.txt
```

## Architecture

```
frontend/
  index.html            Week 1 validation view; Week 6 → full seed/home screen
  js/
    websocket.js        ClaritySocket class — auto-reconnecting WS client
    camera.js           ClarityCamera — getUserMedia, ROI extraction, sends hr_data
    app.js              App state machine (HOME → TRIGGERED → SUBJ_INPUT → INTERVENTION)
  css/main.css

backend/
  main.py               FastAPI app, /ws WebSocket endpoint, serves frontend/
  cv/
    heart_rate.py       HeartRateDetector — ICA+FFT rPPG (Week 1 ✓)
    jade.py             JADE ICA algorithm (adapted from reference)
    respiration.py      RespirationDetector stub — EVM+optical flow (Week 2)
    posture.py          PostureDetector stub — MediaPipe Pose (Week 3)
  state/
    model.py            PhysiologicalStateModel — rolling metrics → state label
  orchestrator/
    rules.py            RuleBasedOrchestrator — decision matrix (Week 4)
    agent.py            AgentOrchestrator — Claude Haiku wrapper (Week 5)
  db/
    session.py          SQLite session store (Week 6)
```

**WebSocket message flow:**
```
Browser captures face ROI → RGB channel averages (15 fps)
  → buffered to 128 frames → sent as {type:"hr_data"} every ~1 s
  → backend: JADE ICA → Hamming → FFT peak → BPM
  → reply: {type:"hr_result", bpm, spectrum, signal_quality, state}
```

## Week Status

| Week | Status | Key file |
|------|--------|----------|
| 1 | In progress | `backend/cv/heart_rate.py`, `frontend/js/camera.js` |
| 2 | Stub | `backend/cv/respiration.py` |
| 3 | Stub | `backend/cv/posture.py`, `backend/state/model.py` |
| 4 | Stub | `backend/orchestrator/rules.py` |
| 5 | Stub | `backend/orchestrator/agent.py` |
| 6 | Stub | `backend/db/session.py`, `frontend/index.html` polished |
| 7 | — | polish + demo |

## Design Constraints

- **Calm Technology**: CV pipeline runs silently in the background; never interrupts
- **Ambiguity as Design**: show BPM trend, not clinical precision; no decimal places in UI
- **Somaesthetic**: body sensation is primary; interventions invite awareness, not correction
- Agent narration: ≤ 2 sentences, phenomenological language, never diagnostic

## Collaboration

Omkar directs, tests, and describes sensations. Claude builds.
When Omkar describes what he *feels*, translate that into implementation changes — do not ask him to describe fixes.
