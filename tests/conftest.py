"""
Shared pytest setup.

Forces the app into scripted-only mode BEFORE `backend.main` is imported:
`backend/main.py` calls `load_dotenv()`, which never overrides a variable that
is already set — so an empty ANTHROPIC_API_KEY here guarantees the tests make
no real Claude API calls, even if a developer has a real key in `.env`.
"""

import os

os.environ["ANTHROPIC_API_KEY"] = ""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    """A TestClient wrapping the real FastAPI app (no server process needed)."""
    from backend.main import app
    with TestClient(app) as c:
        yield c
