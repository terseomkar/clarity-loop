# Tests

Smoke tests that check the app starts, serves every page, and speaks the
WebSocket protocol correctly. They run in about a second and need no camera,
no browser, and no API key.

```bash
# one-time
pip install -r backend/requirements-dev.txt

# from the repo root
python -m pytest
```

- `conftest.py` blanks `ANTHROPIC_API_KEY` before the app loads, so tests
  always exercise the **scripted** Oshi voice and never call the Claude API.
- `test_smoke.py`:
  - `PAGE_ROUTES` lists every page URL and the HTML file it must serve.
    Update this list when you add a page or game.
  - The WebSocket tests send one of each client message and check the reply's
    *shape* (its keys), not signal accuracy.

**What these tests don't cover:** whether heart rate, breathing or posture
readings are accurate, and anything that happens in the browser. Check those
by hand with a webcam: open `/dev/signals` and play each game.

When you add a new signal (for example EEG) or a new message type, add a
WebSocket test for it here.
