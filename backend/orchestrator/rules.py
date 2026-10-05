"""
Rule-based intervention picker — the offline fallback for agent.py.

┌─ NOT WIRED ────────────────────────────────────────────────────────────┐
│ This module runs (main.py calls it, via AgentOrchestrator, whenever the  │
│ survey reaches its "offering" screen), but NOTHING USES ITS RESULT.      │
│ The browser stores the `intervention` message in sessionStorage and     │
│ never reads it back; the player picks a game themselves. Six of the     │
│ eight intervention ids below have no UI at all.                         │
│ Wiring it up = deciding which game/experience each id maps to, then     │
│ having frontend/js/oshi_flow.js highlight or launch it.                 │
│ See docs/KNOWN_ISSUES.md.                                               │
└─────────────────────────────────────────────────────────────────────────┘

Decision table (first match wins — see _select):
    elevated + chest/throat + tightness/pressure  → extended_exhale
    buzzing/tingling (any state)                  → stillness_lock
    dissociated + numbness/cold                   → haptic_grounding
    elevated + head/throat + tightness/pressure   → attention_anchor
    elevated or settling                          → heartbeat_entrainment
    anything else                                 → brightness_breathing

`biofeedback_soundscape` and `spatial_audio_anchor` are never chosen by the
table; they can only appear via the cooldown fallback.

Cooldown: the same intervention is never returned twice in a row.
"""

from dataclasses import dataclass

INTERVENTIONS = [
    "extended_exhale",
    "attention_anchor",
    "biofeedback_soundscape",
    "stillness_lock",
    "haptic_grounding",
    "spatial_audio_anchor",
    "heartbeat_entrainment",
    "brightness_breathing",
]


@dataclass
class OrchestratorResult:
    """One recommendation. Same shape whether it came from rules or Haiku."""
    intervention_id: str
    params: dict
    reasoning: str
    source: str = "rules"  # "rules" | "agent"


class RuleBasedOrchestrator:
    """Deterministic picker: a fixed decision table plus a no-repeat cooldown.

    Note: main.py holds ONE AgentOrchestrator (and therefore one of these)
    for the whole server, so the cooldown is shared across all users.
    """

    def __init__(self):
        self._last_intervention: str | None = None

    def recommend(
        self,
        physio_state: str,
        emotion: str | None,
        body_region: str | None,
        sensations: list[str] | None,
        intensity: int | None,
    ) -> OrchestratorResult:
        """
        Map (physio_state + subjective input) → intervention recommendation.

        The table is a first draft: it has not been validated with users for
        whether its picks feel attuned rather than mechanical.
        """
        sensations = sensations or []
        body_region = body_region or ""

        candidate = self._select(physio_state, body_region, sensations)

        # Cooldown: don't repeat same intervention twice in a row
        if candidate == self._last_intervention:
            candidate = self._fallback(candidate)

        self._last_intervention = candidate
        reasoning = self._reason(candidate, physio_state, body_region, sensations)

        return OrchestratorResult(
            intervention_id=candidate,
            params=self._default_params(candidate),
            reasoning=reasoning,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _select(self, state: str, region: str, sensations: list[str]) -> str:
        """The decision table from the module docstring."""
        tight_or_pressure = any(s in sensations for s in ["tightness", "pressure"])
        buzz_or_tingle = any(s in sensations for s in ["buzzing", "tingling"])
        numb_or_cold = any(s in sensations for s in ["numbness", "cold"])
        head_region = region in ("head", "throat")
        chest_region = region in ("chest", "throat")

        if state == "elevated" and chest_region and tight_or_pressure:
            return "extended_exhale"
        if buzz_or_tingle:
            return "stillness_lock"
        if state == "dissociated" and numb_or_cold:
            return "haptic_grounding"
        if state == "elevated" and head_region and tight_or_pressure:
            return "attention_anchor"
        if state in ("elevated", "settling"):
            return "heartbeat_entrainment"
        return "brightness_breathing"

    def _fallback(self, exclude: str) -> str:
        """First intervention in INTERVENTIONS that isn't `exclude`
        (in practice: extended_exhale, or attention_anchor)."""
        for iv in INTERVENTIONS:
            if iv != exclude:
                return iv
        return "brightness_breathing"

    def _default_params(self, intervention_id: str) -> dict:
        defaults = {
            "extended_exhale": {"inhale_s": 4, "exhale_s": 8, "duration_min": 4},
            "attention_anchor": {"duration_min": 3},
            "biofeedback_soundscape": {"volume": 0.3},
            "stillness_lock": {"hold_s": 10},
            "haptic_grounding": {"pulse_hz": 1.0},
            "spatial_audio_anchor": {"duration_min": 3},
            "heartbeat_entrainment": {"slow_rate_bpm_per_min": 5},
            "brightness_breathing": {"inhale_s": 4, "exhale_s": 6},
        }
        return defaults.get(intervention_id, {})

    def _reason(self, iv: str, state: str, region: str, sensations: list[str]) -> str:
        """Fixed one-line reasoning per intervention. Written in experiential
        language (what it feels like), never diagnostic — agent.py's live
        Haiku reasoning follows the same tone."""
        messages = {
            "extended_exhale": "there's a lot of heat right now — your chest is holding something. let's make some room.",
            "attention_anchor": "your mind is running fast. let's give it somewhere softer to land.",
            "stillness_lock": "your body is searching for a place to land. let's find one together.",
            "haptic_grounding": "you seem far away. let's bring you back to what's here.",
            "heartbeat_entrainment": "let's slow the tempo a little — your body knows how to follow.",
            "brightness_breathing": "something can soften here. let the breath lead.",
            "biofeedback_soundscape": "just let the sound be with you for a moment.",
            "spatial_audio_anchor": "follow the sound — let your attention travel with it.",
        }
        return messages.get(iv, "let's take a moment together.")
