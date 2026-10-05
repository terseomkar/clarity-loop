"""
Intervention picker using Claude Haiku, with rules.py as the fallback.

┌─ NOT WIRED ────────────────────────────────────────────────────────────┐
│ main.py calls recommend() when the survey reaches its "offering" screen │
│ and sends the result to the browser as {type: "intervention"}. The     │
│ browser stores it in sessionStorage but NEVER READS IT — the player     │
│ chooses a game themselves. So this module's output currently has no     │
│ effect on what the user sees. See docs/KNOWN_ISSUES.md.                 │
└─────────────────────────────────────────────────────────────────────────┘

    Input  : physiological state label + survey answers + session history
    Output : intervention_id + parameter overrides + 1–2 sentence reasoning

This module is the INTERVENTION PICKER only. Oshi's spoken lines come from
``backend/orchestrator/oshi/`` (OshiNarrator), a separate Haiku call with a
different return shape and its own guardrails. Do not conflate the two.

Tone for the reasoning line (same as ``RuleBasedOrchestrator._reason()``):
    - experiential language: sensations, textures, spatial metaphors
    - NOT clinical/diagnostic: never "elevated heart rate detected"
    - at most 2 sentences

Fallback: on any Haiku failure (missing key, missing SDK, timeout, bad
JSON, unknown intervention id, repeated pick), the recommendation from
``RuleBasedOrchestrator`` is used instead. Both paths return the SAME
shape, ``OrchestratorResult``, so callers never need to branch.

Known duplication: the Haiku client setup and model id are repeated in
oshi/narrator.py, and the banned-word list in _SYSTEM_PROMPT overlaps
oshi/persona.py FORBIDDEN_WORDS (this reasoning text is NOT run through the
Oshi guardrails). See docs/KNOWN_ISSUES.md.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field

from .rules import INTERVENTIONS, OrchestratorResult, RuleBasedOrchestrator

logger = logging.getLogger("clarity_loop.agent")


@dataclass
class SessionHistory:
    """Interventions recommended so far on one WebSocket connection, with the
    survey intensity before and (once the session completes) after. Passed
    to Haiku so it can avoid repeating something that didn't help."""
    interventions_tried: list[dict] = field(default_factory=list)
    # each entry: {"id": str, "pre_intensity": int|None, "post_intensity": int|None}


_SYSTEM_PROMPT = (
    "You are the Clarity Loop companion — a quiet, attentive presence. "
    "You observe physiological and subjective state and choose ONE "
    "intervention that meets the player where they are. "
    "Respond with JSON only, no prose outside the JSON. Schema: "
    '{"intervention_id": "one of the provided ids", '
    '"params": {}, '
    '"reasoning": "one to two phenomenological sentences, lowercase, no clinical language"}. '
    "Use only sensory / spatial metaphors (bark, moss, breath, embers, tide). "
    "Never diagnostic. Never mention: anxiety, stress, heart rate, bpm, data, "
    "metric, slider, scale, fix, correct, optimize."
)


class AgentOrchestrator:
    """Haiku-driven intervention selector with a rule-based fallback."""

    TIMEOUT_S = 3.0
    MODEL = "claude-haiku-4-5-20251001"

    def __init__(self):
        self._rules = RuleBasedOrchestrator()
        self._last_intervention: str | None = None   # agent-path cooldown
        self._client = self._init_client()

    @staticmethod
    def _init_client():
        """Lazy anthropic client; returns None if key/SDK absent (scripted-only)."""
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            logger.info("ANTHROPIC_API_KEY unset — AgentOrchestrator falls back to rules.")
            return None
        try:
            import anthropic
            return anthropic.Anthropic(api_key=key, timeout=AgentOrchestrator.TIMEOUT_S)
        except Exception:
            logger.warning("anthropic SDK unavailable — AgentOrchestrator falls back to rules.")
            return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

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
        """Choose an intervention. Live Haiku first, rules on any failure.

        The rules fallback ignores ``session_history`` and ``time_of_day``
        (its ``recommend()`` takes only 5 args) — that is intentional.
        """
        rules_fallback = lambda: self._rules.recommend(
            physio_state, emotion, body_region, sensations, intensity
        )

        if self._client is None:
            return rules_fallback()

        try:
            result_dict = self._call_haiku({
                "physio_state": physio_state,
                "emotion": emotion,
                "body_region": body_region,
                "sensations": sensations or [],
                "intensity": intensity,
                "time_of_day": time_of_day,
                "history": [
                    {"id": h.get("id"), "pre": h.get("pre_intensity"), "post": h.get("post_intensity")}
                    for h in (session_history.interventions_tried if session_history else [])
                ],
                "last_intervention": self._last_intervention,
            })
        except Exception as e:
            logger.debug("agent selector failed (%s) — falling back to rules.", type(e).__name__)
            return rules_fallback()

        if result_dict is None:
            return rules_fallback()

        # Guard: unknown intervention id → fall back rather than ship an
        # unrenderable one.
        iv_id = result_dict.get("intervention_id")
        if iv_id not in INTERVENTIONS:
            logger.debug("agent returned unknown intervention_id=%r — rules fallback.", iv_id)
            return rules_fallback()

        # Cooldown on the agent path — don't repeat back-to-back.
        if iv_id == self._last_intervention:
            logger.debug("agent repeated %s — asking rules for a fresh pick.", iv_id)
            return rules_fallback()

        self._last_intervention = iv_id
        return OrchestratorResult(
            intervention_id=iv_id,
            params=result_dict.get("params") or {},
            reasoning=(result_dict.get("reasoning") or "").strip(),
            source="agent",
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _call_haiku(self, ctx: dict) -> dict | None:
        """One Haiku call, JSON-only.  Return dict on success, None on
        malformed reply.  Never raises past the caller."""
        assert self._client is not None
        user = self._build_user(ctx)
        try:
            msg = self._client.messages.create(
                model=self.MODEL,
                system=_SYSTEM_PROMPT,
                max_tokens=280,
                messages=[{"role": "user", "content": user}],
            )
            text = (msg.content[0].text or "").strip()
        except Exception as e:
            logger.debug("Haiku selector call failed: %s", type(e).__name__)
            return None

        # Remap in case Haiku returns `narration` despite the schema —
        # never construct OrchestratorResult from `narration` (TypeError).
        return self._parse_json(text)

    @staticmethod
    def _build_user(ctx: dict) -> str:
        """Format the context dict as the user message for Haiku. Only labels
        and survey answers are sent — never raw camera or signal data."""
        return (
            f"Physiological state: {ctx['physio_state']} (may be 'unknown' when no CV pipeline is running).\n"
            f"Time of day: {ctx['time_of_day']}.\n"
            f"Subjective — sensations: {ctx['sensations']}, "
            f"body region: {ctx['body_region']}, emotion: {ctx['emotion']}, "
            f"intensity: {ctx['intensity']}/10.\n"
            f"Recent history (most recent first): {ctx['history'][-3:]}.\n"
            f"Last intervention (cool it down): {ctx['last_intervention']}.\n\n"
            f"Available intervention_ids: {INTERVENTIONS}.\n"
            "Return JSON ONLY. Do not include markdown fences."
        )

    @staticmethod
    def _parse_json(text: str) -> dict | None:
        """Salvage-parse the JSON body; tolerate stray ``` fences."""
        if not text:
            return None
        # Strip fenced code blocks if the model wrapped them.
        t = text.strip()
        if t.startswith("```"):
            # drop first fence line + trailing fence
            t = t.split("\n", 1)[1] if "\n" in t else t[3:]
            if t.endswith("```"):
                t = t[:-3]
        # Grab from first '{' to last '}' to be forgiving.
        i, j = t.find("{"), t.rfind("}")
        if i < 0 or j < 0 or j <= i:
            return None
        try:
            result = json.loads(t[i:j + 1])
        except json.JSONDecodeError:
            return None
        if not isinstance(result, dict):
            return None
        # Guard the TypeError trap: if the model returned `narration`
        # instead of `reasoning`, remap so OrchestratorResult(**...) works.
        if "reasoning" not in result and "narration" in result:
            result["reasoning"] = result.pop("narration")
        return result
