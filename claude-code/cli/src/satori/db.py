import sqlite3
from satori.paths import state_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS source_files (
  path TEXT PRIMARY KEY,
  last_byte_processed INTEGER NOT NULL DEFAULT 0,
  last_processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  cwd TEXT,
  model TEXT,
  source TEXT,
  started_at TEXT,
  last_seen_at TEXT,
  transcript_path TEXT
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  skill TEXT NOT NULL,
  args TEXT,
  tool_use_id TEXT UNIQUE,
  turn_index INTEGER,
  trigger TEXT NOT NULL DEFAULT 'model',
  load_success INTEGER,
  load_duration_ms INTEGER,
  load_error TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_invocations_skill ON skill_invocations(skill);
CREATE INDEX IF NOT EXISTS idx_invocations_session ON skill_invocations(session_id);

CREATE TABLE IF NOT EXISTS invocation_judgments (
  invocation_id INTEGER PRIMARY KEY,
  used_downstream INTEGER,
  user_reaction TEXT,
  user_reaction_quote TEXT,
  session_ended_cleanly INTEGER,
  judgment_model TEXT,
  judged_at TEXT,
  notes TEXT,
  FOREIGN KEY (invocation_id) REFERENCES skill_invocations(id)
);

CREATE TABLE IF NOT EXISTS gap_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  prompt_excerpt TEXT,
  suggested_skill TEXT,
  reasoning TEXT,
  judgment_model TEXT,
  judged_at TEXT,
  UNIQUE(session_id, turn_index, suggested_skill)
);

CREATE TABLE IF NOT EXISTS available_skills_at_session (
  session_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_description TEXT,
  PRIMARY KEY (session_id, skill_name)
);

CREATE TABLE IF NOT EXISTS skill_stats (
  skill TEXT NOT NULL,
  window TEXT NOT NULL,
  invocations INTEGER NOT NULL,
  positive INTEGER NOT NULL,
  negative INTEGER NOT NULL,
  neutral INTEGER NOT NULL,
  none_reaction INTEGER NOT NULL,
  load_failures INTEGER NOT NULL,
  user_typed INTEGER NOT NULL,
  model_triggered INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (skill, window)
);

CREATE TABLE IF NOT EXISTS skill_improvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill TEXT NOT NULL,
  suggested_at TEXT NOT NULL,
  evidence_path TEXT NOT NULL,
  evidence_invocation_ids TEXT,
  status TEXT NOT NULL,
  status_updated_at TEXT
);
"""

def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(state_db()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
