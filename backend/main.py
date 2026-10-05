"""
Clarity Loop — FastAPI backend entry point.

What lives here:
    * HTTP routes that serve each page in frontend/ (plus /static and /audio)
    * ONE WebSocket endpoint, /ws, that every page talks to. Each message has
      a "type"; the handler below dispatches on it, runs the right detector
      or Oshi call, and replies.

Run (development), from the repo root:
    python -m venv .venv
    .venv\\Scripts\\activate            (Windows)   |   source .venv/bin/activate   (mac/Linux)
    pip install -r backend/requirements.txt
    uvicorn backend.main:app --reload --port 8000
    → open http://localhost:8000

WebSocket protocol
------------------
Client → Server:
    {"type": "hr_data",  "r": [...], "g": [...], "b": [...], "bufferWindow": N,
        "fps": 15, "chest": [...]}        # face RGB + chest brightness averages
    {"type": "pose_data", "landmarks": {"0": {x,y,visibility}, "7": {...}, ...}}
    {"type": "ping"}
    {"type": "subjective_input", "screen": "sensation", "sensation": "tightness",
        "sensation_alias": "tightness",  # chip word normalised for rules.py
        "intensity": 7, "body_region": "chest", "emotion": "anxious",
        "emotion_core": "Fearful", "path": null, "time_of_day": "auto",
        "req_id": 12}
    {"type": "session_complete", "path": "game1", "intensity_pre": 7,
        "intensity_post": 4, "breath_pre": null, "breath_post": null,
        "restlessness_pre": null, "restlessness_post": null,
        "sensation": "tightness", "body_region": "chest", "emotion": "anxious"}

Server → Client:
    {"type": "hr_result", "bpm": 72.3, "snr": 3.1, "spectrum": [...],
                          "signal_quality": "ok",
                          "rr_bpm": 14.2, "rr_quality": "ok", "rr_snr": 2.0,
                          "rr_peak_hz": 0.237,
                          "posture": {forward_head_lean, slump_score,
                                      shoulder_asymmetry, head_tilt_deg,
                                      restlessness, signal_quality},
                          "state": "settling",
                          "baseline": {locked, hr_bpm, rr_bpm,
                                       restlessness, posture_slump}}
    {"type": "pong"}
    {"type": "oshi_line", "screen": "sensation", "text": "…", "req_id": 12}
    {"type": "intervention", "id": "extended_exhale", "params": {...},
        "reasoning": "…", "source": "agent"}     # currently unused by the UI
    {"type": "reflection", "line": "…", "question": "…"}

Adding a new signal or message type (e.g. EEG): see docs/EXTENDING.md.
"""

import datetime
import json
import logging
import statistics
from collections import deque
from pathlib import Path

# Load .env from the project root BEFORE any module reads ANTHROPIC_API_KEY.
# OshiNarrator + AgentOrchestrator both check the env at import time, so
# this must sit above their imports.  If python-dotenv is missing (e.g.
# minimal deploy image), we just skip — the key can also be set in the
# shell environment directly.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.cv.heart_rate import HeartRateDetector
from backend.cv.respiration import RespirationDetector
from backend.cv.posture import PostureDetector
from backend.state.model import PhysiologicalStateModel
from backend.orchestrator.agent import AgentOrchestrator, SessionHistory
from backend.orchestrator.oshi import (
    OshiNarrator, SubjectiveInput, SessionResult,
)

# Survey chip word → the word rules.py's decision table expects. The client
# normally sends the translated word in `sensation_alias`; this server-side
# copy keeps the rules working for a client that doesn't.
_CHIP_ALIAS = {"jittery": "buzzing", "heavy": "pressure"}


def _resolve_time_of_day(tag: str | None) -> str:
    """Resolve 'auto' to 'morning' or 'evening' using the server clock
    (evening = 18:00–06:00).

    RuleBasedOrchestrator ignores this, but AgentOrchestrator passes it into
    the Haiku prompt as tone context, so 'auto' is never passed on.
    (oshi/context.py has its own copy of this logic, circadian_tag().)"""
    t = (tag or "auto").lower()
    if t == "morning":
        return "morning"
    if t == "evening":
        return "evening"
    h = datetime.datetime.now().hour
    return "evening" if (h < 6 or h >= 18) else "morning"

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("clarity_loop")

app = FastAPI(title="Clarity Loop")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
AUDIO_DIR    = Path(__file__).parent.parent / "audio"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
if AUDIO_DIR.exists():
    # Meditation tracks used by the game/mirror UIs.  Kept outside frontend/
    # so the raw source files aren't confused with build artefacts.
    app.mount("/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")

# HR + RR detectors are algorithmically stateless — safe to share.
# PostureDetector holds a rolling restlessness window per user, so it's
# instantiated per-connection inside the WebSocket handler.
_hr_detector = HeartRateDetector()
_rr_detector = RespirationDetector()
# Intervention picker (NOT WIRED to the UI — see orchestrator/agent.py).
# Known issue: being module-level, its no-repeat cooldown is shared by ALL
# connected users, not tracked per user.
_orchestrator = AgentOrchestrator()


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/observe")
async def observe():
    """Observational Mode — landmarks + breath/restlessness waveforms only."""
    return FileResponse(FRONTEND_DIR / "observe.html")


@app.get("/mirror")
async def mirror():
    """Mirror Mode — breath rendered as a responsive fire animation."""
    return FileResponse(FRONTEND_DIR / "mirror.html")


@app.get("/game1")
async def game1():
    """Game 1 — gamified breath-fire experiment (scaffolded from Mirror Mode)."""
    return FileResponse(FRONTEND_DIR / "game1.html")


@app.get("/game2")
async def game2():
    """Game 2 — ambient bird-call counting meditation with Grandmaster Oshi."""
    return FileResponse(FRONTEND_DIR / "game2.html")


@app.get("/game3")
async def game3():
    """Game 3 — Follow the Flame: 4·4·4·4 box-breathing pacer.

    The flame LEADS on a fixed JS box clock; CV drives only its
    character (setAdherence) and the end-of-session capture graph."""
    return FileResponse(FRONTEND_DIR / "game3.html")


@app.get("/game4")
async def game4():
    """Game 4 — Tap the Tide: guided EFT tapping session.

    A fixed JS clock walks six tapping points at a chosen dwell for a chosen
    number of cycles.  MediaPipe Face Mesh + Pose landmarks ONLY locate each
    point on the player in the live mirrored feed — they never gate the clock.
    No backend CV work: this game paints its overlay entirely in the browser."""
    return FileResponse(FRONTEND_DIR / "game4.html")


@app.get("/survey")
async def survey():
    """Oshi Survey & Retrospective (Weeks 4–6).

    Pre-session flow (sensation → intensity → body → emotion → offering)
    gathers the subjective input the orchestrator needs, hands off to
    /game1 or /game2, then resumes at r_intensity → reflection → complete
    on return.  Fully usable with zero API — scripted fallbacks all the
    way through (see `backend/orchestrator/oshi/guardrails.py`)."""
    return FileResponse(FRONTEND_DIR / "survey.html")


@app.get("/health")
async def health():
    """Liveness check (used by the docker-compose healthcheck)."""
    return {"status": "ok", "service": "clarity-loop"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """The single WebSocket every page connects to.

    Holds per-user state for the life of the connection (baseline, posture
    window, Oshi narrator, survey answers so far) and dispatches each
    incoming JSON message on its "type" field. Message formats are listed
    in the module docstring. Unknown types are ignored; bad JSON is logged
    and skipped, so one malformed message never drops the connection.
    """
    await websocket.accept()
    logger.info("Client connected from %s", websocket.client)

    # Per-connection state — isolates baseline + restlessness window across users
    state_model = PhysiologicalStateModel()
    posture     = PostureDetector()
    bpm_history: deque = deque(maxlen=5)   # last 5 BPM readings, for a rolling median

    # Per-connection Oshi narrator.  Scripted-only if ANTHROPIC_API_KEY is
    # unset — that mode is fully supported by the package and never raises.
    narrator = OshiNarrator()

    # Last subjective payload keeps us re-callable across screens without
    # the client needing to resend every field on every message.
    latest_subj: dict = {}

    # Interventions recommended on this connection, passed to the Haiku
    # picker as context (rules.py keeps its own separate cooldown).
    session_history = SessionHistory(interventions_tried=[])

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                logger.warning("Invalid JSON from client: %r", raw[:120])
                continue

            msg_type = msg.get("type")

            if msg_type == "hr_data":
                # ── Camera signals → heart rate, breathing, state ─────
                result = _hr_detector.process(
                    r=msg.get("r", []),
                    g=msg.get("g", []),
                    b=msg.get("b", []),
                    buffer_window=msg.get("bufferWindow", 0),
                    fps=msg.get("fps"),
                )
                # Smooth BPM with a rolling median, discarding any single
                # reading more than 40 BPM away from it (an rPPG glitch).
                raw_bpm = result.get("bpm")
                if raw_bpm is not None:
                    current_median = statistics.median(bpm_history) if bpm_history else raw_bpm
                    if abs(raw_bpm - current_median) < 40:
                        bpm_history.append(raw_bpm)
                smoothed_bpm = round(statistics.median(bpm_history), 1) if bpm_history else None

                # Breathing rate — prefers chest brightness, falls back to face green channel
                rr_result = _rr_detector.process(
                    g=msg.get("g", []),
                    fps=msg.get("fps"),
                    chest=msg.get("chest", []),
                )

                # Push to state model — restlessness/slump come from the
                # latest posture snapshot (updated by pose_data messages)
                posture_snapshot = posture.latest()
                state_model.push(
                    hr=smoothed_bpm,
                    rr=rr_result.get("rr_bpm"),
                    restlessness=posture_snapshot.get("restlessness"),
                    posture_slump=posture_snapshot.get("slump_score"),
                )
                snapshot = state_model.current_snapshot()

                baseline = state_model.baseline
                await websocket.send_text(json.dumps({
                    "type":           "hr_result",
                    "bpm":            smoothed_bpm,
                    "snr":            result.get("snr"),
                    "rr_bpm":         rr_result.get("rr_bpm"),
                    "rr_quality":     rr_result.get("signal_quality"),
                    "rr_snr":         rr_result.get("snr"),
                    "rr_peak_hz":     rr_result.get("peak_hz"),
                    "spectrum":       result["spectrum"],
                    "signal_quality": result["signal_quality"],
                    "posture":        posture_snapshot,
                    "state":          snapshot.state,
                    "baseline": {
                        "locked":        baseline is not None,
                        "hr_bpm":        baseline.hr_bpm        if baseline else None,
                        "rr_bpm":        baseline.rr_bpm        if baseline else None,
                        "restlessness":  baseline.restlessness  if baseline else None,
                        "posture_slump": baseline.posture_slump if baseline else None,
                    },
                }))

            elif msg_type == "pose_data":
                # Body landmarks (~5 fps). No reply — the latest posture is
                # included in the next hr_result.
                posture.push_landmarks(msg.get("landmarks"))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            elif msg_type == "subjective_input":
                # ── Oshi Survey ───────────────────────────────────────
                # One inbound message each time a survey screen opens. Reply
                # with an `oshi_line` for that screen (echoing req_id so the
                # client can drop stale replies). On the offering screen
                # with a `path`, ALSO reply with an `intervention` from the
                # picker (not used by the UI yet — see agent.py).
                latest_subj.update({k: v for k, v in msg.items()
                                    if k not in ("type",)})

                subj = SubjectiveInput.from_dict(latest_subj)
                screen = msg.get("screen", "welcome")
                req_id = int(msg.get("req_id", 0) or 0)

                line = narrator.line(screen, subj, req_id=req_id)
                await websocket.send_text(json.dumps(line.to_message()))

                # Offering → intervention (only path where recommend() fires)
                if screen == "offering" and msg.get("path"):
                    # Prefer client-aliased chip; fall back to server alias.
                    raw_sensation = msg.get("sensation")
                    sens = (msg.get("sensation_alias")
                            or _CHIP_ALIAS.get(raw_sensation, raw_sensation))
                    physio_state = state_model.current_snapshot().state
                    time_of_day = _resolve_time_of_day(msg.get("time_of_day"))

                    try:
                        result = _orchestrator.recommend(
                            physio_state=physio_state,
                            emotion=msg.get("emotion"),
                            body_region=msg.get("body_region"),
                            sensations=[sens] if sens else [],
                            intensity=msg.get("intensity"),
                            session_history=session_history,
                            time_of_day=time_of_day,
                        )
                        await websocket.send_text(json.dumps({
                            "type":            "intervention",
                            "id":              result.intervention_id,
                            "params":          result.params,
                            "reasoning":       result.reasoning,
                            "source":          result.source,
                        }))
                        # Record for cooldown/agent-history.  Post-intensity
                        # will be attached when session_complete arrives.
                        session_history.interventions_tried.append({
                            "id":             result.intervention_id,
                            "pre_intensity":  msg.get("intensity"),
                            "post_intensity": None,
                        })
                    except Exception:
                        logger.exception("intervention selection failed")

            elif msg_type == "session_complete":
                # ── Oshi Retrospective ────────────────────────────────
                # Sent when the player returns from a game to the survey.
                # The schema allows game1 to include breath/restlessness
                # before-and-after, but in practice every game currently
                # sends intensity_pre/post only (see docs/KNOWN_ISSUES.md).
                # SessionResult.available_signals limits the reflection to
                # signals that were really measured.
                session = SessionResult.from_dict(msg)
                subj = SubjectiveInput.from_dict({
                    "sensation":    msg.get("sensation")    or latest_subj.get("sensation"),
                    "body_region":  msg.get("body_region")  or latest_subj.get("body_region"),
                    "emotion":      msg.get("emotion")      or latest_subj.get("emotion"),
                    "time_of_day":  msg.get("time_of_day")  or latest_subj.get("time_of_day", "auto"),
                    "intensity":    msg.get("intensity_pre") or latest_subj.get("intensity"),
                })
                refl = narrator.reflection(session, subj)
                await websocket.send_text(json.dumps(refl.to_message()))

                # Backfill the last intervention's post-intensity for
                # session-history cooldown accounting.
                if (session_history.interventions_tried
                        and session_history.interventions_tried[-1].get("post_intensity") is None):
                    session_history.interventions_tried[-1]["post_intensity"] = session.intensity_post

            else:
                logger.debug("Unhandled message type: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception:
        logger.exception("Unexpected WebSocket error")
