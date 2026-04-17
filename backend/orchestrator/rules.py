"""
Rule-based intervention orchestrator — Week 4 implementation target.

Priority mapping (from 7-week plan):
    High arousal + chest/throat + tightness/pressure  → extended_exhale
    Restlessness high + buzzing/tingling               → stillness_lock
    Dissociative + numbness/cold                       → haptic_grounding
    Racing/overwhelm + head + pressure                 → attention_anchor
    Moderate arousal + seeking calm                    → visual_downregulation | heartbeat_entrainment
    General settling + any                             → brightness_breathing

Cooldown logic: same intervention not repeated twice in a row.
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
    intervention_id: str
    params: dict
    reasoning: str
    source: str = "rules"  # "rules" | "agent"


class RuleBasedOrchestrator:
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

        Week 4 TODO: flesh out the full decision matrix with Omkar's testing
        to validate that recommendations feel attuned, not algorithmic.
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
        # Week 5: replace with Claude Haiku narration. Keep tone phenomenological.
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
