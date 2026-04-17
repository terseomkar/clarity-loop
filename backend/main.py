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
    {"type": "ping"}

Server → Client:
    {"type": "hr_result", "bpm": 72.3, "spectrum": [...], "signal_quality": "ok"}
    {"type": "metrics",   "hr": 72.3, "rr": null, "restlessness": null,
                          "posture": null, "state": "unknown"}
    {"type": "pong"}

Future message types (Week 4+):
    Client → Server: {"type": "subjective_input", "emotion": ..., "body_region": ..., ...}
    Client → Server: {"type": "session_complete",  "intensity_post": 4}
    Server → Client: {"type": "intervention",      "id": ..., "params": ..., "reasoning": ...}
"""

import json
import logging
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

# Detector instances are stateless algorithmically; state is held per-connection
# in the WebSocket handler. For Week 1, one global instance is fine.
_hr_detector = HeartRateDetector()
_rr_detector = RespirationDetector()
_posture_detector = PostureDetector()
_orchestrator = AgentOrchestrator()


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "clarity-loop"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected from %s", websocket.client)

    # Per-connection state model (isolates baseline across concurrent connections)
    state_model = PhysiologicalStateModel()

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
                )
                # Push to state model (rr/restlessness stay None until Week 2/3)
                state_model.push(hr=result.get("bpm"), rr=None, restlessness=None)
                snapshot = state_model.current_snapshot()

                await websocket.send_text(json.dumps({
                    "type": "hr_result",
                    "bpm": result["bpm"],
                    "spectrum": result["spectrum"],
                    "signal_quality": result["signal_quality"],
                    "state": snapshot.state,
                }))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            else:
                logger.debug("Unhandled message type: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception:
        logger.exception("Unexpected WebSocket error")
