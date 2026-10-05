"""
Per-step context injection — the `user` half of each Haiku call.

Server-side port of the design prototype's `_contextFor(screen)` and
`_circadian()` helpers. The `system` prompt (persona) stays constant; this assembles the per-screen
user message: environment tone + what's been gathered + a tight instruction
for THIS step.

The step instructions are deliberately short and behavioral, not scripts —
they tell Oshi what this moment is for, then the persona's VOICE rules decide
how briefly to say it.
"""

from __future__ import annotations

from .schema import Screen, SubjectiveInput, TimeOfDay
import datetime


def circadian_tag(time_of_day: TimeOfDay = "auto") -> str:
    """Environment tone tag prepended to every context. `auto` reads the wall
    clock (evening = 18:00–06:00)."""
    if time_of_day == "morning":
        evening = False
    elif time_of_day == "evening":
        evening = True
    else:
        h = datetime.datetime.now().hour
        evening = h < 6 or h >= 18

    if evening:
        return ("[ENVIRONMENT: EVENING] soft, yielding, spacious — mist between "
                "the roots, faint glow on still water. lean toward rest and "
                "letting go.")
    return ("[ENVIRONMENT: MORNING/AFTERNOON] rooted, clear — bark warm in the "
            "sun. lean toward grounding and steady presence.")


def _gathered(a: SubjectiveInput) -> str:
    """Compact 'what we know so far' line. Only fields with values appear, so
    Oshi never reacts to placeholder dashes on the first screen."""
    bits = []
    if a.sensation:   bits.append(f"sensation={a.sensation}")
    if a.intensity is not None: bits.append(f"intensity={a.intensity}/10")
    if a.body_region: bits.append(f"body={a.body_region}")
    if a.emotion:     bits.append(f"emotion={a.emotion}")
    return ("gathered so far: " + ", ".join(bits) + ".") if bits else "nothing gathered yet."


# What each step is FOR. One line each. No script — the persona voices it.
# The subjective-survey steps carry a light IFS cue (Internal Family Systems —
# see oshi/__init__.py): help the player relate to the experience AS a part
# (something they can turn toward), not as all of them.
_STEP_INTENT: dict[str, str] = {
    "welcome":
        "the player has just arrived. greet them and make it safe for any part "
        "to step forward. do not explain what happens next.",
    "sensation":
        "[STEP sensation] a part is speaking through the body first. help them "
        "notice its texture plainly — don't list options, and don't make them "
        "the feeling; they're the one noticing it.",
    "intensity":
        "[STEP intensity] they're about to sense how much room this part is "
        "asking for. speak to its presence, not to a number.",
    "body":
        "[STEP body] every part chooses somewhere to rest. one small nudge to "
        "find where this one lives in the body.",
    "emotion":
        "[STEP emotion] they're about to name what this part carries. invite "
        "curiosity toward it — how they feel toward it — not judgment of it.",
    "offering":
        "[STEP offering] four paths open: 'phoenix ascent' (grounding), "
        "'grandmaster's count' (clearing the mind), 'flame flow' (paced "
        "breathing), and 'tap the tide' (tapping the feeling loose). name that a "
        "choice is here; do not push one.",
    "session":
        "[STEP session] they're leaving to walk their chosen path. send them "
        "off in one breath.",
}


def context_for(screen: Screen, subjective: SubjectiveInput) -> str | None:
    """Build the user-message context for a per-screen line. Returns None for
    screens the narrator doesn't voice live (r_intensity/reflection/complete
    are handled by their own builders)."""
    intent = _STEP_INTENT.get(screen)
    if intent is None:
        return None
    return f"{circadian_tag(subjective.time_of_day)}\n{_gathered(subjective)}\n{intent}"


def retro_intensity_context(subjective: SubjectiveInput) -> str:
    """The one live line on the post-session intensity re-read."""
    return (f"{circadian_tag(subjective.time_of_day)}\n"
            "the player has returned from their session. the same part is still "
            "here — meet them and it back gently, in one line, and let them "
            "sense how much room it asks for now. don't ask about a number.")
