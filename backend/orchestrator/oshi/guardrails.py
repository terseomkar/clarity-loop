"""
Guardrails — the hard floor under Oshi's voice.

Three jobs:
  1. clamp_two_sentences  — the persona's two-sentence ceiling, mechanically.
  2. passes_forbidden_filter — reject any line using clinical / fix-it words.
  3. SCRIPTED + scripted_reflection — the always-available fallback lines that
     ship instantly and stand in whenever a live line is missing, late, or
     fails the filter.

The narrator calls sanitize() on every Haiku line: clamp → strip → filter.
If it fails, the scripted line stays. The flow is fully usable with zero API.

VOICE PASS: the scripted lines below were rewritten to be direct and potent —
the screen shows the instruction, so Oshi says the one thing it can't. See the
before/after table in README.md.
"""

from __future__ import annotations

import re
from .persona import FORBIDDEN_WORDS
from .schema import SessionResult, SubjectiveInput


# --- scripted fallback lines (Layer 1 — ship first, zero API) -------------
# One short line per screen. Sharpened from the prototype's two-sentence
# versions: no restating the on-screen instruction, one image at most.
SCRIPTED: dict[str, str] = {
    "welcome":   "you made it. sit — whatever part came with you is welcome here too.",
    "sensation": "something in you is speaking through the body first. what's its texture?",
    "intensity": "how much room is this part asking for? let the ring tell the truth.",
    "body":      "a part always chooses somewhere to live. where is this one?",
    "emotion":   "you're the one noticing it — not the feeling itself. what color does it carry?",
    "offering":  "four paths. one roots you down, one rinses the mind, one breathes with the flame, one taps the feeling loose.",
    "session":   "go. i'll be here when the last bird goes quiet.",
    "complete":  "a part stepped forward and you turned toward it. that's the whole thing.",
    # the live re-read line on the post-session intensity screen:
    "r_intensity": "welcome back. how much room does this part ask for now?",
}

# A single, safe contemplative question used when the live reflection question
# is missing or rejected AND we have no subjective detail to personalize it.
# IFS-informed: curiosity toward the part + its burden.
FALLBACK_QUESTION = "if this part could stay a while, what has it been carrying for you?"

# Friendly, second-person phrasing for the body keys the survey sends, so the
# scripted fallback can say "in your chest" rather than the raw region token.
_REGION_WORDS: dict[str, str] = {
    "head": "your head", "throat": "your throat", "shoulders": "your shoulders",
    "chest": "your chest", "belly": "your belly", "core": "your core",
    "arms": "your hands", "legs": "your legs", "feet": "your feet",
}


def _fallback_question(subjective: SubjectiveInput | None) -> str:
    """Signal-aware scripted question — uses AT MOST TWO subjective details
    (sensation, where it lives) to echo the spirit of the live prompt when the
    API line is missing. Falls back to the generic question when we have
    nothing to personalize with."""
    if subjective is None:
        return FALLBACK_QUESTION
    sens = (subjective.sensation or "").strip().lower() or None
    where = _REGION_WORDS.get(subjective.body_region or "")
    if sens and where:
        return f"this {sens} in {where}… is it familiar?"
    if where:
        return f"the part resting in {where}… what has it been carrying for you?"
    if sens:
        return f"this {sens}… when did you first come to know it?"
    return FALLBACK_QUESTION


def strip_quotes(s: str) -> str:
    """Remove wrapping quotes/backticks a model sometimes adds."""
    return re.sub(r'^["\'`]+|["\'`]+$', "", s.strip())


def clamp_two_sentences(s: str) -> str:
    """Keep at most two sentences — the persona's hard ceiling. Ports the
    prototype's _clamp2 regex exactly."""
    if not s:
        return s
    parts = re.findall(r"[^.!?…]+[.!?…]+|\S[^.!?…]*$", s)
    if not parts:
        return s.strip()
    return re.sub(r"\s+", " ", " ".join(parts[:2])).strip()


def passes_forbidden_filter(s: str) -> bool:
    """False if the line uses any forbidden word (whole-word, case-insensitive).
    Multi-word entries like 'heart rate' are matched as phrases."""
    if not s:
        return True
    low = s.lower()
    for word in FORBIDDEN_WORDS:
        pattern = r"\b" + re.escape(word) + r"\b"
        if re.search(pattern, low):
            return False
    return True


def sanitize(text: str | None) -> str | None:
    """Full pipeline for a live line: strip → clamp → filter.
    Returns the cleaned line, or None if it should be rejected (caller keeps
    the scripted fallback). Also enforces lowercase, per the persona."""
    if not text:
        return None
    cleaned = clamp_two_sentences(strip_quotes(text))
    if not cleaned:
        return None
    if not passes_forbidden_filter(cleaned):
        return None
    return cleaned.lower()


def scripted_reflection(
    session: SessionResult, subjective: SubjectiveInput | None = None
) -> tuple[str, str]:
    """Fallback (line, question) for the retrospective — signal-aware, so game2
    (intensity only) never references breath or stillness it never measured.
    The question is personalized from the subjective survey when available."""
    before = session.intensity_pre
    after = session.intensity_post
    signals = session.available_signals

    if before is not None and after is not None and after < before:
        line = "the wave that stood so tall now rests lower against the shore."
        if "breath" in signals:
            line = "the wave has eased, and the breath has drawn long and slow again."
    elif before is not None and after is not None and after > before:
        line = "the current rose to meet the light — even a louder wave is only weather passing."
    else:
        line = "it holds its ground, and that steadiness is welcome too."

    return line, _fallback_question(subjective)


def parse_reflection(
    text: str, session: SessionResult, subjective: SubjectiveInput | None = None
) -> tuple[str, str]:
    """Split a live reflection on ||| into (line, question), sanitize both, and
    fall back per-part to the scripted version if either is missing/rejected."""
    from .reflection import REFLECTION_SPLIT_TOKEN
    fb_line, fb_question = scripted_reflection(session, subjective)
    if not text:
        return fb_line, fb_question
    halves = text.split(REFLECTION_SPLIT_TOKEN)
    line = sanitize(halves[0]) if len(halves) > 0 else None
    question = sanitize(halves[1]) if len(halves) > 1 else None
    return (line or fb_line), (question or fb_question)
