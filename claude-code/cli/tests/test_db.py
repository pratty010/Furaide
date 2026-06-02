import sqlite3
from satori import db

def test_init_creates_all_tables(satori_home):
    db.init()
    conn = db.connect()
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    expected = {
        "source_files", "sessions", "skill_invocations",
        "invocation_judgments", "gap_findings",
        "available_skills_at_session", "skill_stats", "skill_improvements"
    }
    assert expected.issubset(tables)
    conn.close()

def test_init_is_idempotent(satori_home):
    db.init()
    db.init()

def test_wal_mode_enabled(satori_home):
    db.init()
    conn = db.connect()
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"
    conn.close()
