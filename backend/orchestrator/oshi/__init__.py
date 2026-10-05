"""
Grandmaster Oshi — narration orchestration for Clarity Loop.

Oshi is the in-app guide character (an ancient sloth sage) who speaks one
short line on each survey screen and a reflection after a game. Each line
has two layers: a scripted line that is always available (no API needed),
upgraded to a live Claude Haiku line when an API key is set and the reply
passes the guardrails.

Two terms used throughout this package:
    IFS "part" — from Internal Family Systems, a therapy model: a feeling is
                 treated as one *part* of the person that can be noticed and
                 welcomed, not as the whole person. Oshi speaks about "this
                 part" rather than "your anxiety".
    prototype  — the original browser-only design prototype these modules were
                 ported from (kept for history in docs/archive/).

Public surface:
    from backend.orchestrator.oshi import OshiNarrator, SubjectiveInput, SessionResult

    narrator = OshiNarrator()
    line = narrator.line("sensation", SubjectiveInput.from_dict(msg))
    refl = narrator.reflection(SessionResult.from_dict(msg), subjective)

Everything else (persona text, context builders, reflection prompt, guardrails)
is importable directly from the submodules if you need to test them in isolation.
"""

from .narrator import OshiNarrator
from .schema import (
    SubjectiveInput, SessionResult, OshiLine, Reflection,
    Screen, TimeOfDay, Signal, AVAILABLE_SIGNALS_BY_PATH,
)
from .persona import OSHI_PERSONA, FORBIDDEN_WORDS
from .guardrails import (
    SCRIPTED, sanitize, clamp_two_sentences, passes_forbidden_filter,
    scripted_reflection, parse_reflection,
)

__all__ = [
    "OshiNarrator",
    "SubjectiveInput", "SessionResult", "OshiLine", "Reflection",
    "Screen", "TimeOfDay", "Signal", "AVAILABLE_SIGNALS_BY_PATH",
    "OSHI_PERSONA", "FORBIDDEN_WORDS",
    "SCRIPTED", "sanitize", "clamp_two_sentences", "passes_forbidden_filter",
    "scripted_reflection", "parse_reflection",
]
