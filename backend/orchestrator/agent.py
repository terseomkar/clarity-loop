"""
Agentic intervention orchestrator via Claude Haiku — Week 5 implementation target.

Design intent (from 7-week plan):
    Input  : physio snapshot + subjective input + session history
    Output : intervention_id + param overrides + 1–2 sentence narration

Tone guidelines:
    - Phenomenological language: sensations, textures, spatial metaphors.
    - NOT clinical/diagnostic: never "elevated heart rate detected".
    - Narration ≤ 2 sentences. Feels like a whisper, not a paragraph.
    - Circadian tone shift: more grounded in morning, softer/more poetic in evening.

Fallback: always fall back to RuleBasedOrchestrator if API call fails or times out.

Week 5 prompt template sketch:
    SYSTEM:
        You are the Clarity Loop companion — a quiet, attentive presence.
        You observe physiological and subjective state and suggest one intervention.
        Respond with JSON: {"intervention_id": "...", "params": {...}, "narration": "..."}
        Use only phenomenological language. Maximum 2 sentences for narration.
        Time of day: {time_of_day}. Adjust tone accordingly.

    USER:
        Physiological state: {physio_snapshot}
        What the user shared: {subjective_input}
        This session so far: {session_history}
        Available interventions: {intervention_list}
"""

import json
import os
from dataclasses import dataclass

from .rules import OrchestratorResult, RuleBasedOrchestrator, INTERVENTIONS


@dataclass
class SessionHistory:
    interventions_tried: list[dict]   # [{id, pre_intensity, post_intensity}]


class AgentOrchestrator:
    """Stub — full Claude Haiku integration in Week 5."""

    TIMEOUT_S = 3.0  # fall back to rules if API exceeds this

    def __init__(self):
        self._rules = RuleBasedOrchestrator()
        self._client = None  # anthropic.Anthropic() — init in Week 5

    def recommend(
        self,
        physio_state: str,
        emotion: str | None,
        body_region: str | None,
        sensations: list[str] | None,
        intensity: int | None,
        session_history: SessionHistory | None = None,
        time_of_day: str = "day",
    ) -> OrchestratorResult:
        """
        Week 5: call Claude Haiku with the structured prompt and parse JSON response.
        Falls back to rule-based logic on any error or timeout.
        """
        # TODO Week 5: implement Haiku API call
        # try:
        #     result = self._call_haiku(...)
        #     return OrchestratorResult(**result, source="agent")
        # except Exception:
        #     pass

        # Fallback always active until Week 5
        return self._rules.recommend(physio_state, emotion, body_region, sensations, intensity)

    def _call_haiku(self, prompt_vars: dict) -> dict:
        """Week 5 implementation placeholder."""
        raise NotImplementedError
