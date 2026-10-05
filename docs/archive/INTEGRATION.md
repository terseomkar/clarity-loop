# Oshi Survey & Retrospective — Integration Handoff

This folder is the complete handoff for integrating the **Oshi Survey & Retrospective**
feature into the Clarity Loop repo. Everything Claude Code needs is here or already in
the repo. This file is the entry point — read it first, then follow the system prompt.

---

## 0 · What this feature is

Two Oshi-guided flows that bracket a regulation session — the parts of the state machine
stubbed in Weeks 4–6:

- **Survey (pre-session)** → `SUBJ_INPUT`: sensation → intensity → body → emotion → offering.
- **Retrospective (post-session)** → `POST_SESSION`: r_intensity → reflection → complete.

Voiced by **Grandmaster Oshi** (lowercase, ≤ 2 sentences, phenomenological — never
clinical). Every line is scripted for instant paint, then optionally upgraded to a live
Claude Haiku line.

---

## 1 · Paste manifest — what lands where

| Source (this handoff) | Destination in `clarity-loop/` | Action |
|---|---|---|
| `oshi/` package | `backend/orchestrator/oshi/` | Copy the whole folder unchanged. Persona `.md` rides inside it. |
| `img/oshi-*.png` (6 portraits) | `frontend/img/` | Copy. `oshi.png` already exists there — do not clobber it. The 6: `smile, meditate, stones, glyphs, spiral, serene`. |
| `Oshi Survey & Retrospective.dc.html` | `docs/oshi/` | Reference only (the **source of truth** to port from). Not served. |
| `Oshi Survey & Retrospective - Spec.dc.html` | `docs/oshi/` | Reference only — UI + integration spec. |
| `Oshi - Paste Map.dc.html` | `docs/oshi/` | Reference only — the code index. |
| `INTEGRATION.md` (this file) | `docs/oshi/` | Reference only. |

**Files Claude Code creates** (not pasted): `frontend/survey.html`,
`frontend/js/oshi_flow.js`.
**Files Claude Code edits:** `frontend/css/main.css`, `frontend/js/app.js`,
`backend/main.py`, `backend/orchestrator/agent.py`, `.env.example`,
`backend/requirements.txt`.

---

## 2 · Read order (before writing any code)

1. `docs/oshi/Oshi Survey & Retrospective - Spec.dc.html` — behavior, WebSocket protocol
   (§6), voice contract (§7). Ignore the DC/HTML wrapper; read the `.spec` prose.
2. `docs/oshi/Oshi - Paste Map.dc.html` — maps every named block in the prototype to its
   target file, tagged **copy verbatim** / **port templating→DOM** / **rewire I/O**.
3. `docs/oshi/Oshi Survey & Retrospective.dc.html` — the source of truth to port from.
4. `backend/orchestrator/oshi/README.md` — the finished server-side narration package.

Anchor by named constant/method/element, **never by line number**.

---

## 3 · The one thing that would trip you up

The server-side Oshi **narration layer already exists** as the `backend/orchestrator/oshi/`
package (`OshiNarrator`): persona system prompt, per-screen prompt assembly, the `|||`
reflection, forbidden-word guardrails, and the scripted floor. The Spec §7 code sketch and
the Paste Map §D/§E describe *what that package does* as design rationale — they are **not**
an instruction to re-implement it in `agent.py`.

- **Do:** wire `main.py` to `OshiNarrator` per the package README (instantiate once per
  connection; `.line(...)` / `.reflection(...)`; send `.to_message()`).
- **Don't:** hand-write `_oshi_line()` or a second narration Haiku call.
- `agent.py`'s only live-Haiku job is the separate **intervention selector**
  (`_call_haiku`, returns `{intervention_id, params, reasoning}`).

The narration package runs **scripted-only** without `ANTHROPIC_API_KEY` — a valid mode.
It never raises into the socket loop.

---

## 4 · Integration rules (copy first, wire second)

- **Maximize verbatim copy.** Content constants (`PERSONA`, `CHIP_WORDS`, `EMOTIONS`,
  `PATHS`, `INSTRUCTIONS`, `SCRIPTED`, `FWHEEL`), geometry helpers (`_pt`, `_sector`,
  `_lighten`, `_buildWheel`, `_seg`, ring math), the body `<svg>`, and the 7 `@keyframes`
  are data/math — port unchanged (Paste Map §A/§B).
- **Only four things change behavior** (Paste Map §D): the per-screen `window.claude.complete`
  call, `_contextFor`, `_makeReflection`, `_makeSession`. Everything else is mechanical.
- **Templating → DOM:** convert `renderVals`/`sc-if`/`sc-for`/`{{ }}` to plain DOM render
  functions in `frontend/js/oshi_flow.js`. Build the emotion-wheel `<text>` labels and the
  `_seg` SVG with `document.createElementNS`, not `innerHTML`/`createElement` (Spec §4.5).
- **Two independent fallbacks** (Spec §6.1): intervention selection → `RuleBasedOrchestrator`
  on error/timeout; Oshi narration → `SCRIPTED` inside the package. Don't conflate them.
- **Field name is `reasoning` everywhere** — never introduce `narration`. The Week-5 stub in
  `agent.py` is self-contradictory (`OrchestratorResult(**result)` with a `narration` key
  raises `TypeError`); prompt Haiku for `reasoning` or remap before constructing.
- **Chip→rule alias** before `recommend()`: `jittery→buzzing`, `heavy→pressure`;
  `tightness/pressure/numbness/cold` pass through; `activated/spacious` free-text only (§4.2).
- **Path-dependent retro deltas** (§4.7, §6): `game1` = intensity + CV breath/restlessness;
  `game2` = intensity only. Set `SessionResult.available_signals` so Oshi never references an
  unmeasured shift.
- Preserve: scripted line paints first then upgrades (never block UI on API); the
  `_reqId`/`req_id` stale-drop guard; the forbidden-word filter as a hard floor (reject and
  fall back, never ship a tripped line). Do not paraphrase `PERSONA`.

---

## 5 · WebSocket protocol (Spec §6)

Client → server: `subjective_input`, `session_complete`.
Server → client: `oshi_line` (echoes `req_id`), `intervention` (`reasoning`, `source` =
`agent|rules`), `reflection`. Add a `/survey` route serving `survey.html`.

Config: add `anthropic` to `backend/requirements.txt`, `ANTHROPIC_API_KEY` to `.env.example`.

Milestone order (Spec §9): Week 4 scripted → Week 5 Haiku upgrade → Week 6 game hand-off +
session persistence + home = survey entry.

---

## 6 · System prompt for Claude Code

> You are integrating the **Oshi Survey & Retrospective** feature into the Clarity Loop
> repo. All source material is in `docs/oshi/` and the repo. Read `CLAUDE.md` for repo
> conventions, then read this handoff (`docs/oshi/INTEGRATION.md`) top to bottom and follow
> it exactly.
>
> Read in order: the Spec (§6 protocol, §7 voice), the Paste Map (code index — anchor by
> name, never line number), the prototype `.dc.html` (source of truth), and
> `backend/orchestrator/oshi/README.md`.
>
> Maximize verbatim copy: content constants, geometry helpers, the body `<svg>`, and the 7
> `@keyframes` are data/math — port unchanged. Only four things change behavior (Paste Map
> §D): `window.claude.complete`, `_contextFor`, `_makeReflection`, `_makeSession`. Convert
> DC templating to plain DOM in a new `frontend/js/oshi_flow.js`; build emotion-wheel SVG
> `<text>` with `createElementNS`.
>
> The server-side narration layer already exists as the `backend/orchestrator/oshi/`
> package (`OshiNarrator`). Wire `main.py` to it — do NOT hand-write `_oshi_line()` or a
> second narration Haiku call. `agent.py`'s only remaining job is the intervention selector
> (`_call_haiku`, returning `{intervention_id, params, reasoning}` — field is `reasoning`,
> never `narration`; see the §6.1 TypeError trap). The narration package is scripted-only
> without `ANTHROPIC_API_KEY` and never raises into the socket loop; don't add handling that
> assumes the key exists.
>
> Keep the two fallbacks separate (intervention → RuleBasedOrchestrator; narration →
> SCRIPTED). Alias sensation chips to rule keys before `recommend()`. Retro deltas are
> path-dependent — set `available_signals` accordingly. Preserve: scripted-first-then-upgrade,
> the `req_id` stale-drop guard, the forbidden-word filter as a hard floor, and `PERSONA`
> verbatim.
>
> Create `frontend/survey.html` + `frontend/js/oshi_flow.js`; edit `main.css`, `app.js`,
> `main.py`, `agent.py`, `.env.example`, `requirements.txt`. Implement the §6 protocol and a
> `/survey` route. Follow the Week 4→5→6 milestone order (Spec §9). If a named anchor doesn't
> resolve, search the prototype for its nearest neighbor in the same section — do not guess.
