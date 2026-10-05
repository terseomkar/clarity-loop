"""
Smoke tests — "does the app still start and talk the same protocol?"

These are deliberately shallow: they prove every page is served, the
WebSocket answers each message type with the right *shape*, and the
scripted (no-API-key) Oshi voice works end to end. They do NOT judge
signal accuracy — that needs a real camera and a human.

Run:  python -m pytest          (from the repo root)
"""

from pathlib import Path

import numpy as np
import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

# ── Page routes ──────────────────────────────────────────────────────────
# (url, html file under frontend/ that the route must serve)
PAGE_ROUTES = [
    ("/",             "survey.html"),       # landing page
    ("/survey",       "survey.html"),       # games link back here
    ("/game1",        "game1.html"),
    ("/game2",        "game2.html"),
    ("/game3",        "game3.html"),
    ("/game4",        "game4.html"),
    ("/dev/signals",  "dev/signals.html"),
    ("/dev/observe",  "dev/observe.html"),
    ("/dev/mirror",   "dev/mirror.html"),
]

# Old URLs that now redirect.
REDIRECTS = [
    ("/observe", "/dev/observe"),
    ("/mirror",  "/dev/mirror"),
]


@pytest.mark.parametrize("url,html_file", PAGE_ROUTES)
def test_page_routes_serve_expected_file(client, url, html_file):
    resp = client.get(url)
    assert resp.status_code == 200
    assert resp.content == (FRONTEND / html_file).read_bytes()


@pytest.mark.parametrize("old,new", REDIRECTS)
def test_old_urls_redirect(client, old, new):
    resp = client.get(old, follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == new


def test_every_html_page_has_a_route(client):
    """Catches a new page added to frontend/ without a route (or vice versa)."""
    served = {f for _, f in PAGE_ROUTES}
    on_disk = {p.relative_to(FRONTEND).as_posix() for p in FRONTEND.rglob("*.html")}
    assert on_disk == served


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.parametrize("url", [
    "/static/css/main.css",
    "/static/img/rune_circle.png",
    "/static/video/oshi.mp4",
    "/audio/20221__ls__bird-call.wav",
])
def test_static_assets_served(client, url):
    assert client.get(url).status_code == 200


# ── Synthetic camera signal ──────────────────────────────────────────────
FPS = 15
N_FRAMES = 128
PULSE_HZ = 1.2   # 72 beats per minute


def _synthetic_rgb(seed: int = 0):
    """128 frames of per-frame RGB averages with a 72 BPM pulse buried in
    the green channel (where skin blood-volume changes show up most)."""
    rng = np.random.default_rng(seed)
    t = np.arange(N_FRAMES) / FPS
    pulse = np.sin(2 * np.pi * PULSE_HZ * t)
    r = 120 + 0.3 * pulse + rng.normal(0, 0.2, N_FRAMES)
    g = 100 + 1.0 * pulse + rng.normal(0, 0.2, N_FRAMES)
    b = 80 + 0.2 * pulse + rng.normal(0, 0.2, N_FRAMES)
    return r.tolist(), g.tolist(), b.tolist()


def test_heart_rate_detector_output_contract():
    """Checks the output SHAPE, not accuracy. The ported rPPG pipeline does
    not reliably recover a clean synthetic 72 BPM pulse (it returns anything
    from ~49 to ~148 depending on the noise seed) — see docs/KNOWN_ISSUES.md.
    The project treats BPM as a trend, never a precise number."""
    from backend.cv.heart_rate import HeartRateDetector
    r, g, b = _synthetic_rgb()
    out = HeartRateDetector().process(r=r, g=g, b=b, buffer_window=N_FRAMES, fps=FPS)
    assert out["signal_quality"] in ("ok", "poor")
    assert out["bpm"] is not None
    assert 45 <= out["bpm"] <= 200          # the detector's search band
    assert len(out["spectrum"]) == N_FRAMES


def test_heart_rate_detector_needs_enough_frames():
    from backend.cv.heart_rate import HeartRateDetector
    out = HeartRateDetector().process(r=[1] * 10, g=[1] * 10, b=[1] * 10, buffer_window=10)
    assert out["signal_quality"] == "insufficient_data"


# ── WebSocket protocol ───────────────────────────────────────────────────
def test_ws_ping_pong(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_ws_hr_data_returns_hr_result(client):
    r, g, b = _synthetic_rgb()
    with client.websocket_connect("/ws") as ws:
        # pose_data has no reply; send one to exercise the posture path.
        ws.send_json({"type": "pose_data", "landmarks": {
            "0":  {"x": 0.5,  "y": 0.3, "visibility": 0.9},
            "11": {"x": 0.4,  "y": 0.6, "visibility": 0.9},
            "12": {"x": 0.6,  "y": 0.6, "visibility": 0.9},
        }})
        ws.send_json({"type": "hr_data", "r": r, "g": g, "b": b,
                      "bufferWindow": N_FRAMES, "fps": FPS})
        msg = ws.receive_json()
    assert msg["type"] == "hr_result"
    for key in ("bpm", "rr_bpm", "rr_quality", "posture", "state",
                "baseline", "signal_quality", "spectrum"):
        assert key in msg, f"hr_result missing {key!r}"
    assert set(msg["baseline"]) >= {"locked", "hr_bpm", "rr_bpm"}


def test_ws_survey_flow_scripted(client):
    """Survey screen → Oshi line; offering → line + intervention;
    session_complete → reflection. All scripted (no API key in tests)."""
    from backend.orchestrator.oshi.guardrails import SCRIPTED
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "subjective_input", "screen": "sensation",
                      "sensation": "tightness", "intensity": 7,
                      "body_region": "chest", "req_id": 1})
        line = ws.receive_json()
        assert line["type"] == "oshi_line"
        assert line["req_id"] == 1
        assert line["text"] == SCRIPTED["sensation"]

        ws.send_json({"type": "subjective_input", "screen": "offering",
                      "path": "game1", "req_id": 2})
        line = ws.receive_json()
        assert line["type"] == "oshi_line" and line["req_id"] == 2
        iv = ws.receive_json()
        assert iv["type"] == "intervention"
        assert iv["source"] == "rules"
        assert iv["id"]

        ws.send_json({"type": "session_complete", "path": "game1",
                      "intensity_pre": 7, "intensity_post": 4})
        refl = ws.receive_json()
        assert refl["type"] == "reflection"
        assert refl["line"] and refl["question"]


def test_ws_ignores_bad_json(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_text("not json")
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


# ── Safety guardrails (binding — see CLAUDE.md) ──────────────────────────
def test_guardrails_reject_clinical_language():
    from backend.orchestrator.oshi.guardrails import sanitize, passes_forbidden_filter
    assert not passes_forbidden_filter("your heart rate shows anxiety")
    assert sanitize("Your anxiety is high.") is None
    assert sanitize("the breath settles. the tide is low. a third line.") == \
        "the breath settles. the tide is low."
