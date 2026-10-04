"""
OshiNarrator — response handling: build → call → sanitize → fall back.

This is the piece agent.py calls. It owns the two-layer voice from the Spec:
    Layer 1 (scripted): always available, returned instantly, zero API.
    Layer 2 (live Haiku): upgrades the line if a clean one comes back in time.

Every path is safe: any error, timeout, empty, or filter-rejected line keeps
the scripted fallback. The narrator never raises into the socket loop.

Usage (in agent.py / main.py)
-----------------------------
    narrator = OshiNarrator()                      # picks up ANTHROPIC_API_KEY

    # per screen:
    line = narrator.line("sensation", subjective, req_id=req_id)
    await ws.send_text(json.dumps(line.to_message()))

    # retrospective:
    refl = narrator.reflection(session_result, subjective)
    await ws.send_text(json.dumps(refl.to_message()))

The req_id round-trips to the client, which drops stale replies (mirrors the
prototype's _reqId guard). The narrator itself is stateless per call.
"""

from __future__ import annotations

import logging
import os

from .persona import OSHI_PERSONA
from .schema import OshiLine, Reflection, Screen, SessionResult, SubjectiveInput
from .context import context_for, retro_intensity_context
from .reflection import reflection_prompt
from .guardrails import SCRIPTED, sanitize, parse_reflection, scripted_reflection

logger = logging.getLogger("clarity_loop.oshi")

MODEL = "claude-haiku-4-5-20251001"
TIMEOUT_S = 3.0            # match AgentOrchestrator.TIMEOUT_S
MAX_TOKENS_LINE = 120
MAX_TOKENS_REFLECTION = 220


class OshiNarrator:
    def __init__(self, client=None, model: str = MODEL, timeout_s: float = TIMEOUT_S):
        self.model = model
        self.timeout_s = timeout_s
        self._client = client
        if self._client is None:
            self._client = self._init_client()

    @staticmethod
    def _init_client():
        """Lazy anthropic client. Returns None if the SDK or key is absent —
        the narrator then runs scripted-only, which is a valid mode."""
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            logger.info("ANTHROPIC_API_KEY unset — Oshi runs scripted-only.")
            return None
        try:
            import anthropic
            return anthropic.Anthropic(api_key=key, timeout=TIMEOUT_S)
        except Exception:
            logger.warning("anthropic SDK unavailable — Oshi runs scripted-only.")
            return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def line(self, screen: Screen, subjective: SubjectiveInput, req_id: int = 0) -> OshiLine:
        """One spoken line for a screen. Scripted floor, live upgrade."""
        scripted = SCRIPTED.get(screen, "")
        ctx = (retro_intensity_context(subjective) if screen == "r_intensity"
               else context_for(screen, subjective))
        if ctx is None:
            return OshiLine(screen=screen, text=scripted, req_id=req_id, source="scripted")

        live = sanitize(self._complete(OSHI_PERSONA, ctx, MAX_TOKENS_LINE))
        if live:
            return OshiLine(screen=screen, text=live, req_id=req_id, source="agent")
        return OshiLine(screen=screen, text=scripted, req_id=req_id, source="scripted")

    def reflection(self, session: SessionResult, subjective: SubjectiveInput) -> Reflection:
        """The retrospective: witnessing line + contemplative question.
        Signal-conditioned prompt; per-part fallback."""
        raw = self._complete(OSHI_PERSONA, reflection_prompt(session, subjective),
                             MAX_TOKENS_REFLECTION)
        if raw:
            line, question = parse_reflection(raw, session, subjective)
            source = "agent"
        else:
            line, question = scripted_reflection(session, subjective)
            source = "scripted"
        return Reflection(line=line, question=question, source=source)

    # ------------------------------------------------------------------
    # Internal — the single Haiku call. Never raises.
    # ------------------------------------------------------------------

    def _complete(self, system: str, user: str, max_tokens: int) -> str | None:
        if self._client is None:
            return None
        try:
            msg = self._client.messages.create(
                model=self.model,
                system=system,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": user}],
            )
            return msg.content[0].text.strip()
        except Exception as e:
            # Surface the full API error message once so we can see WHY
            # a live line failed (400 body / rate-limit reason / etc.).
            # The scripted fallback still ships — this is diagnostic only.
            logger.warning("Oshi live line failed (%s): %s", type(e).__name__, e)
            return None
