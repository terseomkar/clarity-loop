# CLAUDE.md: backend/orchestrator/oshi/

Oshi's voice. Module-by-module reference: [README.md](README.md).

## Before you edit anything here

- **The persona is data, not code.** `master-oshi-ifs-soul-system-prompt.md`
  is read at import by `persona.py` and sent as the system prompt on every
  Haiku call. Editing that file **changes app behavior** immediately (after a
  server restart).
- **The guardrails are binding** (root `CLAUDE.md`, design rules 6–8):
  - every live line goes through `guardrails.sanitize()`, which clamps it to
    two sentences, filters banned words and lowercases it
  - a rejected or missing line falls back to `SCRIPTED`
  - do not add a code path that sends a live line to the client without it
- **`FORBIDDEN_WORDS`** (`persona.py`) is the mechanical safety net. If you
  change the FORBIDDEN section of the persona `.md`, mirror it in the tuple.
  Never remove a word without review.
- **Never raise into the socket loop.** `OshiNarrator._complete()` returns
  `None` on any failure, and callers fall back to scripted lines. Keep it
  that way.
- **Only labels and survey words go to the model**: sensation, region,
  emotion, intensity, and qualitative "what shifted" phrases. No raw
  signals, numbers or EEG.

## Common tasks

- **Change a scripted line:** edit `SCRIPTED` in `guardrails.py`. Keep it to one or two short lowercase sentences, with no clinical words.
- **Change what Oshi is told per screen:** edit `_STEP_INTENT` in `context.py`.
- **Let a new signal shape the reflection:** see `docs/EXTENDING.md` §1.8. You'll need to touch `schema.py` (`Signal`, `SessionResult`, `AVAILABLE_SIGNALS_BY_PATH`), `reflection._shift_lines()` and `guardrails.scripted_reflection()`.
- **Add a game to the offering screen:** update the `offering` entry in `context._STEP_INTENT` and `SCRIPTED["offering"]`, which both say "four paths".

## Testing without an API key

`python -m pytest` runs in scripted-only mode, because `tests/conftest.py`
blanks the key. To try live lines, put a real key in `.env` and use the
survey in a browser. Look for `Oshi live line failed` warnings in the server
log.
