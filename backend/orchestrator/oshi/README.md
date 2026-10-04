# Oshi orchestration (`backend/orchestrator/oshi/`)

Server-side narration for Grandmaster Oshi. This package owns everything the
prototype ran client-side through `window.claude.complete`: the persona, the
per-step prompt assembly, the retrospective prompt, the guardrails, and the
call/fallback logic. `agent.py` talks to one class — `OshiNarrator`.

The persona **text** is not in the code. It lives in
[`master-oshi-ifs-soul-system-prompt.md`](./master-oshi-ifs-soul-system-prompt.md)
— the canonical soul document — and `persona.py` loads it at import. Edit Oshi's
voice there; the code never needs to change for a wording pass.

## Layout

```
oshi/
├─ master-oshi-ifs-soul-system-prompt.md   # the persona (system prompt) — source of truth
├─ __init__.py        # public exports
├─ persona.py         # loads the .md → OSHI_PERSONA; FORBIDDEN_WORDS tuple
├─ schema.py          # dataclasses for the payloads between steps
├─ context.py         # per-step user prompt + circadian tag
├─ reflection.py      # the |||-split retrospective prompt
├─ guardrails.py      # clamp / forbidden filter / scripted fallbacks / parsing
└─ narrator.py        # OshiNarrator: build → call Haiku → sanitize → fall back
```

## Data flow

```
client msg ──► SubjectiveInput.from_dict / SessionResult.from_dict   (schema.py)
                     │
                     ▼
        OshiNarrator.line() / .reflection()                          (narrator.py)
                     │
          ┌──────────┴───────────┐
          ▼                      ▼
   context.py / reflection.py   persona.py (OSHI_PERSONA = system)
   build the user prompt         + guardrails.SCRIPTED (instant floor)
          │
          ▼
   Haiku call (_complete, never raises)
          │
          ▼
   guardrails.sanitize / parse_reflection   (strip → clamp → forbidden filter)
          │
          ▼
   OshiLine / Reflection ──► .to_message() ──► JSON over the socket
```

Two layers, always. **Scripted** lines (`guardrails.SCRIPTED`) are the floor —
returned instantly, zero API, the flow works fully offline. **Live Haiku**
upgrades a line only if a clean one comes back in time. Any error, timeout,
empty, or filter-rejected line keeps the scripted line. `OshiNarrator` never
raises into the socket loop.

## Module reference

**`persona.py`** — `OSHI_PERSONA` (str, loaded from the `.md`; a minimal inline
fallback is used only if the file is missing) and `FORBIDDEN_WORDS` (tuple,
enforced mechanically — kept in sync with the markdown's FORBIDDEN section).

**`schema.py`** — plain dataclasses, no new deps:
- `SubjectiveInput(sensation, intensity, body_region, emotion, emotion_core, time_of_day)` + `.from_dict()`
- `SessionResult(path, intensity_pre/post, breath_pre/post, restlessness_pre/post)` + `.from_dict()` and `.available_signals` (which shifts Oshi may witness — see below)
- `OshiLine` / `Reflection` with `.to_message()` for the wire
- `AVAILABLE_SIGNALS_BY_PATH` — `game1 → (intensity, breath, restlessness)`, `game2 → (intensity,)`

**`context.py`** — `context_for(screen, subjective)` builds the per-screen user
message (circadian tag + gathered-so-far + a one-line step intent). Returns
`None` for screens the narrator doesn't voice live. `circadian_tag(time_of_day)`
resolves `auto` against the wall clock. `retro_intensity_context()` is the one
live line on the post-session re-read.

**`reflection.py`** — `reflection_prompt(session, subjective)` assembles the
retrospective ask, and `_shift_lines()` builds the "what changed" list **only
from measured signals**. `REFLECTION_SPLIT_TOKEN` (`|||`) separates the two
requested parts.

**`guardrails.py`** — the enforcement floor:
- `sanitize(text)` → `strip_quotes` → `clamp_two_sentences` → `passes_forbidden_filter` → lowercase; returns `None` to reject (caller keeps scripted).
- `SCRIPTED` — one short fallback line per screen. `FALLBACK_QUESTION` for the retrospective.
- `scripted_reflection(session)` → signal-aware `(line, question)` fallback.
- `parse_reflection(text, session)` → splits a live reflection on `|||`, sanitizes each half, falls back per-part.

**`narrator.py`** — `OshiNarrator(client=None, model="claude-haiku-4-5", timeout_s=3.0)`:
- `.line(screen, subjective, req_id=0) -> OshiLine`
- `.reflection(session, subjective) -> Reflection`
- `_complete(system, user, max_tokens)` — the single Haiku call; returns `None` on any failure.
- Constructs its own `anthropic.Anthropic` from `ANTHROPIC_API_KEY`; if the SDK or key is absent it runs **scripted-only** (a valid mode), so nothing breaks in dev.

## Signal-conditioned retrospective

`SessionResult.available_signals` gates what Oshi is allowed to witness, so he
never references a shift that was not measured:
- **game1 (phoenix ascent)** — CV pipeline → intensity + breath + restlessness.
- **game2 (grandmaster's count)** — no CV → intensity only.

A signal counts as available only when *both* endpoints are present, so a
dropped CV reading silently degrades to intensity-only rather than fabricating a
breath shift.

## Wiring (`agent.py` / `main.py`)

```python
from backend.orchestrator.oshi import OshiNarrator, SubjectiveInput, SessionResult

narrator = OshiNarrator()   # reads ANTHROPIC_API_KEY; scripted-only if absent

# on an "oshi_line" request:
subj = SubjectiveInput.from_dict(msg)
line = narrator.line(msg["screen"], subj, req_id=msg.get("req_id", 0))
await ws.send_text(json.dumps(line.to_message()))

# on "session_complete":
refl = narrator.reflection(SessionResult.from_dict(msg), subj)
await ws.send_text(json.dumps(refl.to_message()))
```

`req_id` round-trips to the client so it can drop stale async replies (mirrors
the prototype's `_reqId` guard).

## Integration checklist

- Copy `oshi/` into `backend/orchestrator/`.
- Add `anthropic` to `backend/requirements.txt`; `ANTHROPIC_API_KEY` to `.env.example`.
- Confirm the `session_complete` message keys match `SessionResult.from_dict`
  (`intensity_pre/post`, `breath_pre/post`, `restlessness_pre/post`) — adjust the
  constructor if your wire names differ.
- Model / timeout are `MODEL` / `TIMEOUT_S` in `narrator.py` (default
  `claude-haiku-4-5`, 3 s — matches `AgentOrchestrator.TIMEOUT_S`).

## Quick check

```python
from backend.orchestrator.oshi import OshiNarrator, SubjectiveInput

n = OshiNarrator()                       # no key → scripted-only
subj = SubjectiveInput(sensation="tightness", intensity=7, body_region="chest")
print(n.line("sensation", subj).text)    # → the scripted sensation line
```
