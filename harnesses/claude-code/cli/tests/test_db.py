import sqlite3
from mekiki import db

def test_init_creates_all_tables(mekiki_home):
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

def test_init_is_idempotent(mekiki_home):
    db.init()
    db.init()

def test_wal_mode_enabled(mekiki_home):
    db.init()
    conn = db.connect()
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"
    conn.close()

def test_schema_has_new_columns(mekiki_home):
    db.init()
    conn = db.connect()
    # skill_invocations.used_downstream
    conn.execute("SELECT used_downstream FROM skill_invocations LIMIT 0")
    # sessions.ended_cleanly + effort_level
    conn.execute("SELECT ended_cleanly, effort_level FROM sessions LIMIT 0")
    # invocation_judgments.score
    conn.execute("SELECT score FROM invocation_judgments LIMIT 0")
    conn.close()

def test_schema_migration_is_idempotent(mekiki_home):
    db.init()
    db.init()  # second call must not raise
    conn = db.connect()
    conn.execute("SELECT used_downstream FROM skill_invocations LIMIT 0")
    conn.close()
