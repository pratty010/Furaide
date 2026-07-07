export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  event_id       TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  source_id      TEXT NOT NULL,
  source_position INTEGER NOT NULL,
  observed_at    TEXT NOT NULL,
  ingested_at    TEXT NOT NULL,
  harness        TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  payload        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(source_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  harness       TEXT NOT NULL,
  started_at    TEXT,
  ended_at      TEXT,
  cwd           TEXT,
  model         TEXT,
  outcome_label TEXT,
  rollup        TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK(type IN ('skill','memory','instruction_edit')),
  origin       TEXT NOT NULL CHECK(origin IN ('mined','learned','preexisting')),
  surface_path TEXT,
  state        TEXT NOT NULL,
  signature    TEXT,
  created_at   TEXT NOT NULL,
  promoted_at  TEXT,
  deprecated_at TEXT
);

CREATE TABLE IF NOT EXISTS evidence_ledger (
  artifact_id   TEXT PRIMARY KEY REFERENCES artifacts(id),
  applied       INTEGER NOT NULL DEFAULT 0,
  win           INTEGER NOT NULL DEFAULT 0,
  loss          INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  last_earned_at TEXT
);

CREATE TABLE IF NOT EXISTS outcome_labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  segment_key TEXT NOT NULL,
  label       TEXT NOT NULL CHECK(label IN ('success','failure','abandoned','unknown')),
  tier        TEXT NOT NULL CHECK(tier IN ('deterministic','llm')),
  evidence_ref TEXT,
  judge_model TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE(session_id, segment_key)
);

CREATE TABLE IF NOT EXISTS workflow_ngrams (
  signature     TEXT PRIMARY KEY,
  n             INTEGER NOT NULL,
  frequency     INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  sample_sessions TEXT,
  last_seen     TEXT
);

CREATE TABLE IF NOT EXISTS rejected_signatures (
  signature   TEXT PRIMARY KEY,
  reason      TEXT,
  rejected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id    TEXT PRIMARY KEY,
  type  TEXT NOT NULL,
  label TEXT,
  attrs TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  src        TEXT NOT NULL,
  dst        TEXT NOT NULL,
  type       TEXT NOT NULL,
  valid_at   TEXT NOT NULL,
  invalid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);

CREATE TABLE IF NOT EXISTS checkpoints (
  source_id   TEXT PRIMARY KEY,
  inode       INTEGER,
  size        INTEGER,
  prefix_hash TEXT,
  offset      INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS metric_rollups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  capability  TEXT NOT NULL,
  window      TEXT NOT NULL,
  metric      TEXT NOT NULL,
  value       REAL,
  computed_at TEXT NOT NULL,
  UNIQUE(capability, window, metric)
);
`;

export const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(session_id UNINDEXED, text);
CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(artifact_id UNINDEXED, text);
CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(ref UNINDEXED, text);
`;
