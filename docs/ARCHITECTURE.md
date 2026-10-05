# Architecture

How the parts of Clarity Loop fit together at runtime. For the message
formats, see [`CLAUDE.md`](../CLAUDE.md#websocket-messages); for how to add
things, see [EXTENDING.md](EXTENDING.md).

## The big picture

```mermaid
flowchart TD
    subgraph Browser["Browser (plain HTML/CSS/JS, no framework)"]
        CAM["Webcam<br/>(getUserMedia)"]
        MP["MediaPipe Face Mesh + Pose<br/>(runs in the browser)"]
        CC["camera.js · ClarityCamera<br/>face RGB + chest brightness averages,<br/>7 body landmarks"]
        PAGES["Pages: survey (landing) · games 1–4 · dev pages<br/>own visuals, audio, in-browser BreathAnalyzer"]
        SOCK["websocket.js · ClaritySocket"]
    end

    subgraph Server["Python backend · FastAPI (backend/main.py)"]
        WS["/ws WebSocket handler<br/>(dispatches on message type)"]
        HR["cv/heart_rate.py<br/>rPPG: ICA + FFT → BPM"]
        RR["cv/respiration.py<br/>chest brightness → breaths/min"]
        PO["cv/posture.py<br/>landmarks → posture + restlessness"]
        SM["state/model.py<br/>→ state label vs. personal baseline"]
        OSHI["orchestrator/oshi/<br/>Oshi's lines + reflection<br/>(scripted floor, live upgrade, guardrails)"]
        PICK["orchestrator/agent.py + rules.py<br/>intervention picker"]
        DB[("db/session.py<br/>SQLite")]
    end

    HAIKU["Claude Haiku API<br/>(optional — needs ANTHROPIC_API_KEY)"]

    CAM --> MP --> CC
    CAM --> CC
    CC -->|"callbacks: onChestSample,<br/>onPoseSample, onFaceSample"| PAGES
    CC --> SOCK
    PAGES <--> SOCK
    SOCK <-->|JSON over WebSocket| WS
    WS --> HR & RR & PO
    HR & RR & PO --> SM
    WS --> OSHI
    WS --> PICK
    OSHI -.-> HAIKU
    PICK -.-> HAIKU
    PICK -. "NOT WIRED:<br/>result unused by UI" .-> PAGES
    DB -. "NOT WIRED:<br/>nothing calls it" .- WS
```

Dashed lines are optional or not connected. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) #1–#2.

## Two loops

The app runs two mostly independent loops over the same WebSocket.

### 1. The sensing loop (continuous, about once per second)

1. `ClarityCamera` averages the face patch (R/G/B) and chest patch
   (brightness) at ~15 frames/s. Every ~1 s it sends the last 128 frames as
   `hr_data`. MediaPipe Pose landmarks go out as `pose_data` at ~5/s.
2. `main.py` runs the heart-rate and breathing detectors, adds the latest
   posture, updates this user's `PhysiologicalStateModel`, and replies with
   `hr_result` (BPM, breathing rate, posture, state label, baseline).
3. Pages use what they need. In practice:

   | Page | Uses from `hr_result` |
   |---|---|
   | `/dev/signals` | everything (it's the dashboard) |
   | `/game1` | `posture.restlessness` (a motion gate on progress) |
   | `/game3` | `signal_quality` |
   | `/game4`, `/dev/observe`, `/dev/mirror` | nothing (camera callbacks only) |
   | `/game2`, `/` (survey) | not connected to the camera |

   Most breath-driven visuals come from the **in-browser** `BreathAnalyzer`,
   not from the backend. It reacts instantly and works at very slow
   breathing rates that the backend's FFT can't resolve.

### 2. The survey loop (event-driven)

```mermaid
sequenceDiagram
    participant P as Player
    participant S as Survey page (oshi_flow.js)
    participant B as Backend (/ws)
    participant G as Game page
    P->>S: opens /
    loop each survey screen
        S->>B: subjective_input {screen, answers so far, req_id}
        B-->>S: oshi_line {text, req_id}  (scripted or live Haiku)
    end
    S->>B: subjective_input {screen: "offering", path}
    B-->>S: oshi_line + intervention (stored, unused)
    S->>G: redirect to /gameN (answers saved in sessionStorage)
    P->>G: plays
    G->>S: "with grandmaster oshi" link → /survey (resumes)
    S->>B: session_complete {path, intensity_pre, intensity_post, ...}
    B-->>S: reflection {line, question}
```

## State: where it lives

| State | Lives in | Scope |
|---|---|---|
| Heart-rate / breathing detectors | `main.py` module level | shared by all users (they're stateless) |
| Intervention picker + its cooldown | `main.py` module level | **shared by all users** (known issue #9) |
| Baseline, posture window, BPM median, Oshi narrator, survey answers | inside `websocket_endpoint` | one per WebSocket connection |
| Survey progress across page loads | browser `sessionStorage` (`clarityLoop.survey.v1`) | one browser tab |
| Mute preference | browser `localStorage` (`clarity.muted`) | the browser |

A page reload opens a new WebSocket, so the backend baseline starts over.

## Privacy by construction

- Raw video never leaves the browser. Only averaged numbers and landmark
  coordinates are sent.
- When an API key is set, Claude Haiku receives survey answers (sensation,
  body region, emotion, intensity), the state **label**, and time of day.
  It never receives raw signals or video.
- Nothing is stored on the server today. The SQLite store is not wired.

## Design constraints that shape the architecture

- **Works with no API key.** Every Haiku call has a scripted or rule-based
  fallback, and no call is allowed to raise into the socket loop.
- **Degrades gracefully.**
  - Games 3 and 4 run on their own clock from t=0, even with the camera denied.
  - Game 1 waits for a short breath calibration.
  - A poor signal freezes visual reactions instead of making them jitter.
- **Relative, not absolute.** rPPG BPM drifts, so state is judged by change
  from the person's own baseline.

The full design rules are in [CLAUDE.md](../CLAUDE.md#design-rules-binding).
