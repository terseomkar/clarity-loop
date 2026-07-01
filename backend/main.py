"""
Clarity Loop — FastAPI backend entry point.

Run (development):
    cd clarity-loop
    source .venv/Scripts/activate   # Windows: .venv\\Scripts\\activate
    uvicorn backend.main:app --reload --port 8000

WebSocket protocol
------------------
Client → Server:
    {"type": "hr_data",  "r": [...], "g": [...], "b": [...], "bufferWindow": N}
    {"type": "pose_data", "landmarks": {"0": {x,y,visibility}, "7": {...}, ...}}
    {"type": "ping"}

Server → Client:
    {"type": "hr_result", "bpm": 72.3, "spectrum": [...], "signal_quality": "ok",
                          "rr_bpm": 14.2, "rr_quality": "ok",
                          "posture": {forward_head_lean, slump_score,
                                      shoulder_asymmetry, head_tilt_deg,
                                      restlessness, signal_quality},
                          "state": "settling"}
    {"type": "pong"}

Future message types (Week 4+):
    Client → Server: {"type": "subjective_input", "emotion": ..., "body_region": ..., ...}
    Client → Server: {"type": "session_complete",  "intensity_post": 4}
    Server → Client: {"type": "intervention",      "id": ..., "params": ..., "reasoning": ...}
"""

import json
import logging
import statistics
from collections import deque
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.cv.heart_rate import HeartRateDetector
from backend.cv.respiration import RespirationDetector
from backend.cv.posture import PostureDetector
from backend.state.model import PhysiologicalStateModel
from backend.orchestrator.agent import AgentOrchestrator

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("clarity_loop")

app = FastAPI(title="Clarity Loop")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

# HR + RR detectors are algorithmically stateless — safe to share.
# PostureDetector holds a rolling restlessness window per user, so it's
# instantiated per-connection inside the WebSocket handler.
_hr_detector = HeartRateDetector()
_rr_detector = RespirationDetector()
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "clarity-loop"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected from %s", websocket.client)

    # Per-connection state — isolates baseline + restlessness window across users
    state_model = PhysiologicalStateModel()
    posture     = PostureDetector()
    bpm_history: deque = deque(maxlen=5)  # rolling median over last 5 readings

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
                result = _hr_detector.process(
                    r=msg.get("r", []),
                    g=msg.get("g", []),
                    b=msg.get("b", []),
                    buffer_window=msg.get("bufferWindow", 0),
                    fps=msg.get("fps"),
                )
                raw_bpm = result.get("bpm")
                if raw_bpm is not None:
                    current_median = statistics.median(bpm_history) if bpm_history else raw_bpm
                    if abs(raw_bpm - current_median) < 40:
                        bpm_history.append(raw_bpm)
                smoothed_bpm = round(statistics.median(bpm_history), 1) if bpm_history else None

                # Week 2: respiration — prefer chest pixel motion, fallback to green channel
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
                posture.push_landmarks(msg.get("landmarks"))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            else:
                logger.debug("Unhandled message type: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception:
        logger.exception("Unexpected WebSocket error")
