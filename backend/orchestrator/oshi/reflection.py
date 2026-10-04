"""
Retrospective reflection — the |||-split prompt, conditioned on real signals.

One Haiku call returns two parts joined by `|||`:
    1) a witnessing line   — honors the shift, never a number-reading
    2) a contemplative question — IFS-informed, warm curiosity, never prescriptive

The prompt is built ONLY from the signals a path actually produced
(SessionResult.available_signals). For game2 that's intensity alone, so Oshi is
never handed breath/stillness deltas he could hallucinate a reading from.

Parsing and the scripted fallback live in guardrails.py; this module owns the
prompt text and the "what changed" assembly.
"""

from __future__ import annotations

from .schema import SessionResult, SubjectiveInput
from .context import circadian_tag


REFLECTION_SPLIT_TOKEN = "|||"


def _shift_lines(session: SessionResult) -> list[str]:
    """Human-readable 'what changed', restricted to measured signals. These are
    phrased as felt shifts, not measurements — the persona forbids numbers/
    clinical terms, so we hand Oshi qualities, not readings."""
    signals = session.available_signals
    lines: list[str] = []

    if "intensity" in signals and session.intensity_pre is not None and session.intensity_post is not None:
        before, after = session.intensity_pre, session.intensity_post
        if after < before:
            lines.append("the space this part asked for has grown smaller.")
        elif after > before:
            lines.append("the space this part asks for has grown wider.")
        else:
            lines.append("the space this part asks for is holding steady.")

    if "breath" in signals:
        # game1 only — CV measured it, so Oshi may witness it.
        if session.breath_post < session.breath_pre:
            lines.append("the breath, once quick and high, has drawn longer and slower.")
        else:
            lines.append("the breath is finding its own tempo.")

    if "restlessness" in signals:
        if session.restlessness_post < session.restlessness_pre:
            lines.append("the restlessness that stirred the branches has quieted.")
        else:
            lines.append("the body is still searching for where to settle.")

    return lines


def reflection_prompt(session: SessionResult, subjective: SubjectiveInput) -> str:
    """Assemble the user message for the reflection call."""
    part = subjective.sensation or "a current"
    where = subjective.body_region or "the body"
    color = subjective.emotion or "its own color"
    changes = "\n".join(f"- {c}" for c in _shift_lines(session))

    return f"""{circadian_tag(subjective.time_of_day)}
the player has walked their path ({session.path}). the part that stepped \
forward was {part}, resting in {where}, carrying {color}.

what shifted (speak ONLY to these — invent nothing else):
{changes}

write TWO things, separated by the token {REFLECTION_SPLIT_TOKEN}
1) a reflection (one sentence, two at most) that simply witnesses what \
settled in this part. no numbers, no praise for "improvement" — just meet what \
is here now, as its own weather.
2) a single open question that helps the player become more aware of the part \
they have been sitting with — inviting curiosity, reflection, the start of a \
relationship with it. ground it in AT MOST TWO of these concrete details so it \
lands as personal: the sensation ({part}), where in the body it lives \
({where}), or how the space/intensity it asked for shifted. one sentence is \
usually enough; two at most. never diagnose, never advise, never ask the part \
to leave — only nudge the player to turn toward it with warmth and wonder.

in the spirit of (never copy these — write fresh):
- "this sensation in your shoulder... is it familiar?"
- "when was the last time you felt this with such intensity?"
- "now that you look back... what do you think this part was trying to tell you?"
- "if this part in your chest had a voice... what would it say it needs?\""""
