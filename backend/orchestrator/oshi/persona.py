"""
Grandmaster Oshi — persona loader.

The persona TEXT lives in `master-oshi-ifs-soul-system-prompt.md` (next to this
file), so the soul document is editable on its own and can be handed to Claude
Code as standalone context. This module loads it verbatim at import time and
exposes it as `OSHI_PERSONA` — the `system` prompt for every Haiku call.

`FORBIDDEN_WORDS` is kept here as a Python tuple (not parsed from the markdown)
because guardrails.py enforces it mechanically and must not drift on a prose
edit. Keep this list in sync with the FORBIDDEN section of the markdown.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger("clarity_loop.oshi")

PERSONA_PATH = Path(__file__).parent / "master-oshi-ifs-soul-system-prompt.md"

# Enforced hard filter (guardrails.passes_forbidden_filter). Mirror of the
# FORBIDDEN section in the markdown — clinical / quantified / fix-it language.
FORBIDDEN_WORDS: tuple[str, ...] = (
    "anxiety", "stress", "panic", "depression",
    "heart rate", "bpm", "data", "algorithm", "baseline", "metric",
    "physiological", "somatic", "clinical",
    "slider", "scale", "exercise",
    "fix", "correct", "treat", "change", "target", "optimize", "trigger",
)

# Minimal safety net if the markdown is missing (e.g. packaged without it).
# The full soul lives in the .md; this only keeps the service from crashing.
_FALLBACK_PERSONA = (
    "You are Grandmaster Oshi, an ancient sloth sage of a living forest. Speak "
    "in lowercase, at most two sentences, warm and potent. Treat every inner "
    "experience as a welcome 'part' of the player, never a problem to fix. Do "
    "not restate on-screen instructions. Respond with ONLY your spoken line."
)


def _load_persona() -> str:
    try:
        return PERSONA_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        logger.warning("persona markdown not found at %s — using fallback.", PERSONA_PATH)
        return _FALLBACK_PERSONA


OSHI_PERSONA = _load_persona()
