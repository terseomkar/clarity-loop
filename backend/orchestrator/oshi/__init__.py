"""
Grandmaster Oshi — narration orchestration for Clarity Loop.

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
