"""
Oshi orchestration — I/O schema passed between steps.

Plain dataclasses (matching the style of rules.py / state/model.py — no new
deps). These model the payloads that cross the WebSocket (full message list
in CLAUDE.md) and the values the narrator reads. `from_dict` constructors tolerate partial / missing
fields so a half-filled survey never raises.

Wire summary
------------
    client → server   subjective_input   → SubjectiveInput
    client → server   session_complete   → SessionResult
    server → client   oshi_line          → OshiLine
    server → client   reflection         → Reflection
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# The survey/retrospective steps, in flow order. `session` is the game itself
# (out of scope for the narrator). Matches the prototype's screen keys.
Screen = Literal[
    "welcome", "sensation", "intensity", "body",
    "emotion", "offering", "session", "r_intensity", "reflection", "complete",
]

TimeOfDay = Literal["auto", "morning", "evening"]

# Which real signals a path produces. The reflection prompt is conditioned on
# this so Oshi never witnesses a shift that was never measured.
Signal = Literal["intensity", "breath", "restlessness"]

# game1 (phoenix ascent) runs the CV pipeline → breath + restlessness deltas.
# game2 (grandmaster's count) has no CV capture → intensity delta only.
# game3 and game4 are not listed, so they fall back to intensity-only (see
# SessionResult.available_signals). When a game starts reporting a new
# signal (e.g. an EEG calm score), add it to `Signal` and list it here.
AVAILABLE_SIGNALS_BY_PATH: dict[str, tuple[Signal, ...]] = {
    "game1": ("intensity", "breath", "restlessness"),
    "game2": ("intensity",),
}


@dataclass
class SubjectiveInput:
    """The pre-session survey answers (SUBJ_INPUT). Every field optional —
    the narrator is called on each screen with only what's been gathered."""
    sensation: str | None = None       # chip word or free text
    intensity: int | None = None       # 1–10 felt ring
    body_region: str | None = None     # head/throat/chest/belly/core/...
    emotion: str | None = None         # leaf word from the feeling wheel
    emotion_core: str | None = None    # the wheel's root category (parsed but not used yet)
    time_of_day: TimeOfDay = "auto"

    @classmethod
    def from_dict(cls, d: dict) -> "SubjectiveInput":
        return cls(
            sensation=d.get("sensation"),
            intensity=_as_int(d.get("intensity")),
            body_region=d.get("body_region") or d.get("body"),
            emotion=d.get("emotion"),
            emotion_core=d.get("emotion_core") or d.get("emotion_key"),
            time_of_day=d.get("time_of_day", "auto"),
        )


@dataclass
class SessionResult:
    """The post-session payload (POST_SESSION). Deltas present depend on path
    (see AVAILABLE_SIGNALS_BY_PATH). Breath/restlessness are None for game2."""
    path: str                                  # "game1" … "game4"
    intensity_pre: int | None = None
    intensity_post: int | None = None
    breath_pre: float | None = None            # breaths/min, game1 only
    breath_post: float | None = None
    restlessness_pre: float | None = None      # 0–1, game1 only
    restlessness_post: float | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "SessionResult":
        return cls(
            path=d.get("path", "game1"),
            intensity_pre=_as_int(d.get("intensity_pre")),
            intensity_post=_as_int(d.get("intensity_post")),
            breath_pre=_as_float(d.get("breath_pre")),
            breath_post=_as_float(d.get("breath_post")),
            restlessness_pre=_as_float(d.get("restlessness_pre")),
            restlessness_post=_as_float(d.get("restlessness_post")),
        )

    @property
    def available_signals(self) -> tuple[Signal, ...]:
        """What Oshi is allowed to witness for this path. Falls back to
        intensity-only for an unknown path (never over-claims)."""
        signals = AVAILABLE_SIGNALS_BY_PATH.get(self.path, ("intensity",))
        # A signal is only 'available' if we actually have both endpoints.
        present: list[Signal] = ["intensity"]
        if "breath" in signals and self.breath_pre is not None and self.breath_post is not None:
            present.append("breath")
        if ("restlessness" in signals
                and self.restlessness_pre is not None
                and self.restlessness_post is not None):
            present.append("restlessness")
        return tuple(present)


@dataclass
class OshiLine:
    """server → client: the spoken line for one screen."""
    screen: Screen
    text: str
    req_id: int = 0          # echoes the client's req_id so stale replies drop
    source: str = "scripted"  # "scripted" | "agent"

    def to_message(self) -> dict:
        return {"type": "oshi_line", "screen": self.screen,
                "text": self.text, "req_id": self.req_id}


@dataclass
class Reflection:
    """server → client: the retrospective — a witnessing line + one question."""
    line: str
    question: str
    source: str = "scripted"  # "scripted" | "agent"

    def to_message(self) -> dict:
        return {"type": "reflection", "line": self.line, "question": self.question}


# --- coercion helpers (wire values arrive as str|int|float|None) ----------
def _as_int(v) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _as_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None
