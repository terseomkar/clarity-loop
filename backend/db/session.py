"""
SQLite session store — Week 6 implementation target.

Schema (one row per completed intervention session):
    id                 INTEGER PRIMARY KEY
    timestamp          TEXT    (ISO 8601)
    emotion            TEXT
    body_region        TEXT
    sensations         TEXT    (JSON array)
    intensity_pre      INTEGER (1–10)
    intensity_post     INTEGER (1–10) | NULL
    physio_baseline    TEXT    (JSON PhysioSnapshot)
    physio_post        TEXT    (JSON PhysioSnapshot) | NULL
    intervention_id    TEXT
    agent_reasoning    TEXT
    duration_s         INTEGER
    source             TEXT    ("rules" | "agent")

Week 6 TODO: add last_session() query for the Home screen "return to seed" prompt.
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "sessions.db"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp       TEXT NOT NULL,
                emotion         TEXT,
                body_region     TEXT,
                sensations      TEXT,
                intensity_pre   INTEGER,
                intensity_post  INTEGER,
                physio_baseline TEXT,
                physio_post     TEXT,
                intervention_id TEXT,
                agent_reasoning TEXT,
                duration_s      INTEGER,
                source          TEXT
            )
        """)
        conn.commit()


def save_session(
    emotion: str | None,
    body_region: str | None,
    sensations: list[str] | None,
    intensity_pre: int | None,
    intensity_post: int | None,
    physio_baseline: dict | None,
    physio_post: dict | None,
    intervention_id: str,
    agent_reasoning: str,
    duration_s: int,
    source: str = "rules",
) -> int:
    init_db()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO sessions
                (timestamp, emotion, body_region, sensations, intensity_pre, intensity_post,
                 physio_baseline, physio_post, intervention_id, agent_reasoning, duration_s, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(),
                emotion,
                body_region,
                json.dumps(sensations) if sensations else None,
                intensity_pre,
                intensity_post,
                json.dumps(physio_baseline) if physio_baseline else None,
                json.dumps(physio_post) if physio_post else None,
                intervention_id,
                agent_reasoning,
                duration_s,
                source,
            ),
        )
        conn.commit()
        return cur.lastrowid


def last_session() -> dict | None:
    """Returns the most recent session row as a dict, or None."""
    try:
        init_db()
        with _connect() as conn:
            row = conn.execute(
                "SELECT * FROM sessions ORDER BY id DESC LIMIT 1"
            ).fetchone()
            return dict(row) if row else None
    except Exception:
        return None
