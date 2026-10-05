# Archive: historical handoff documents

These files record how parts of Clarity Loop were designed and then moved into
this codebase. **They are history, not current documentation.** Where they
disagree with the code, the code is right.

| File(s) | What it was |
|---|---|
| `*.dc.html` | Design canvases and prototypes exported from Claude Design. They need support files (`support.js`, a `_ds/` design-system folder) that are **not** in this repo, so they show up blank or unstyled if you open them. The Oshi survey, Game 3 and Game 4 prototypes were ported to the real code (`frontend/js/oshi_flow.js`, `game3.js`, `game4.js`). |
| `INTEGRATION.md`, `Game 3 - INTEGRATION.md`, `Game 4 - INTEGRATION.md`, `Rune Circle - INTEGRATION.md` | Step-by-step "paste this here" instructions written for the Claude Code sessions that integrated each prototype. File paths and some details in them are out of date. |
| `Oshi - Paste Map.dc.html` | A map of where each piece of the Oshi prototype was pasted. |
| `Clarity Loop - Runtime Architecture.dc.html` | An earlier architecture diagram, replaced by [`../ARCHITECTURE.md`](../ARCHITECTURE.md). |

For current documentation, start at the [repo README](../../README.md).
