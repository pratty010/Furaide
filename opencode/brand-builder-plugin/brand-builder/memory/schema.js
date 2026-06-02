/**
 * Brand Builder Memory Schema Bootstrap
 *
 * Exports createTables(db, opts) — idempotently creates all 10 tables with indexes.
 * All tables use CREATE TABLE IF NOT EXISTS so the bootstrap is safe to call
 * on existing databases (D-06: regenerable from canonical artifacts).
 *
 * Tables:
 *   1. artifacts               — canonical source-of-truth artifact records
 *   2. artifact_versions        — versioned history of artifact content
 *   3. evidence_summaries       — compact derived evidence from analysis
 *   4. relationships            — typed graph edges between entities
 *   5. snapshots                — profile state captures on meaningful change
 *   6. enrichment_approvals     — remembered enrichment permission decisions
 *   7. profile_baselines        — single working profile baseline
 *   8. vec_evidence_embeddings  — sqlite-vec virtual table for embedding search
 *   9. engine_results           — durable run-scoped advisory outputs
 *  10. run_log                  — queryable audit telemetry for every tool call
 */

/** Default embedding dimension for vec_evidence_embeddings. */
const DEFAULT_EMBEDDING_DIM = 384;

const SCHEMA_SQL = `
-- 1. Artifacts: canonical source-of-truth per surface (D-01)
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id       TEXT PRIMARY KEY,
  artifact_type     TEXT NOT NULL CHECK (artifact_type IN (
                      'resume','linkedin','github_profile','github_repo','website','job_description'
                    )),
  canonical_path    TEXT NOT NULL,
  raw_digest        TEXT NOT NULL CHECK (length(raw_digest) = 64),
  normalized_digest TEXT NOT NULL CHECK (length(normalized_digest) = 64),
  first_ingested_at TEXT NOT NULL,
  last_updated_at   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'current' CHECK (status IN (
                      'current','archived','superseded'
                    )),
  source_label      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Artifact Versions: bounded history (D-08, D-13)
CREATE TABLE IF NOT EXISTS artifact_versions (
  version_id        TEXT PRIMARY KEY,
  artifact_id       TEXT NOT NULL REFERENCES artifacts(artifact_id),
  version_number    INTEGER NOT NULL CHECK (version_number > 0),
  canonical_path    TEXT NOT NULL,
  raw_digest        TEXT NOT NULL CHECK (length(raw_digest) = 64),
  normalized_digest TEXT NOT NULL CHECK (length(normalized_digest) = 64),
  ingested_at       TEXT NOT NULL,
  provenance_source TEXT NOT NULL CHECK (provenance_source IN (
                      'user_upload','user_paste','update_flow','enrichment'
                    )),
  provenance_update_context TEXT,
  provenance_goals  TEXT,
  supersedes_version TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Evidence Summaries: compact derived evidence (D-02, D-04, D-11, D-21)
CREATE TABLE IF NOT EXISTS evidence_summaries (
  summary_id        TEXT PRIMARY KEY,
  artifact_id       TEXT NOT NULL REFERENCES artifacts(artifact_id),
  version_id        TEXT NOT NULL REFERENCES artifact_versions(version_id),
  summary_type      TEXT NOT NULL CHECK (summary_type IN (
                      'field_extraction','signal_assessment','surface_snapshot'
                    )),
  content           TEXT NOT NULL,
  source_references TEXT NOT NULL DEFAULT '[]',
  stale             INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1)),
  stale_reason      TEXT,
  workflow_domain   TEXT NOT NULL DEFAULT 'assessment' CHECK (workflow_domain IN (
                      'assessment','role_fit','linkedin','github'
                    )),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Relationships: typed entity graph edges (D-02, D-04)
CREATE TABLE IF NOT EXISTS relationships (
  edge_id           TEXT PRIMARY KEY,
  source_type       TEXT NOT NULL CHECK (source_type IN (
                      'artifact','evidence','snapshot','role_family'
                    )),
  source_id         TEXT NOT NULL,
  target_type       TEXT NOT NULL CHECK (target_type IN (
                      'artifact','evidence','snapshot','role_family'
                    )),
  target_id         TEXT NOT NULL,
  relationship_kind TEXT NOT NULL CHECK (relationship_kind IN (
                      'derived_from','supersedes','contradicts','supports',
                      'belongs_to_role_family','stale_due_to'
                    )),
  weight            REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Snapshots: compact profile state captures (D-14 through D-19)
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id             TEXT PRIMARY KEY,
  trigger_reason          TEXT NOT NULL CHECK (trigger_reason IN (
                            'artifact_update','new_role_target','approved_rewrite',
                            'periodic_check','manual_request','enrichment_update'
                          )),
  profile_state           TEXT NOT NULL,
  dimension_signal        REAL NOT NULL,
  dimension_evidence      REAL NOT NULL,
  dimension_visibility    REAL NOT NULL,
  dimension_narrative     REAL NOT NULL,
  confidence              TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  dominant_failure_mode   TEXT,
  next_recommended_workflow TEXT,
  artifact_version_ids    TEXT NOT NULL DEFAULT '[]',
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Enrichment Approvals: remembered permission decisions (D-20 through D-25)
CREATE TABLE IF NOT EXISTS enrichment_approvals (
  approval_id          TEXT PRIMARY KEY,
  scope                TEXT NOT NULL CHECK (scope IN (
                         'repo_graphification','deep_analysis','external_fetch'
                       )),
  scope_key            TEXT NOT NULL,
  approved             INTEGER NOT NULL CHECK (approved IN (0,1)),
  reason_given         TEXT,
  conditions_snapshot  TEXT NOT NULL,
  stale                INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1)),
  decided_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. Profile Baselines: single working baseline (D-05)
CREATE TABLE IF NOT EXISTS profile_baselines (
  baseline_id          TEXT PRIMARY KEY,
  primary_artifact_ids TEXT NOT NULL DEFAULT '[]',
  role_family_target   TEXT,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at           TEXT NOT NULL,
  superseded_at        TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_artifacts_type_status   ON artifacts(artifact_type, status);
CREATE INDEX IF NOT EXISTS idx_versions_artifact_num    ON artifact_versions(artifact_id, version_number);
CREATE INDEX IF NOT EXISTS idx_evidence_artifact_stale  ON evidence_summaries(artifact_id, stale);
CREATE INDEX IF NOT EXISTS idx_evidence_artifact_domain_stale ON evidence_summaries(artifact_id, workflow_domain, stale);
CREATE INDEX IF NOT EXISTS idx_relationships_source     ON relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target     ON relationships(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created        ON snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_approvals_scope_key      ON enrichment_approvals(scope, scope_key);
CREATE INDEX IF NOT EXISTS idx_baselines_status         ON profile_baselines(status);
`;

/**
 * SQL for the embedding_config table — singleton row tracking the active
 * embedding provider/dimension so re-embeds can detect mismatches.
 */
const EMBEDDING_CONFIG_SQL = `
-- 11. Embedding Config: singleton tracking active embedding provider (Phase 5)
CREATE TABLE IF NOT EXISTS embedding_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL DEFAULT 'transformers',
  model TEXT NOT NULL DEFAULT 'Xenova/all-MiniLM-L6-v2',
  dimension INTEGER NOT NULL DEFAULT 384,
  last_embed_at TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO embedding_config (id, provider, model, dimension)
  VALUES (1, 'transformers', 'Xenova/all-MiniLM-L6-v2', 384);
`;

/**
 * SQL for the engine_results table — durable run-scoped advisory outputs.
 * Separate from SCHEMA_SQL because the vec0 table requires parameterization
 * and we keep static DDL together.
 */
const ENGINE_RESULTS_SQL = `
-- 9. Engine Results: durable home for run-scoped advisory outputs
CREATE TABLE IF NOT EXISTS engine_results (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  run_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  provenance TEXT,
  artifact_version_ids TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'passed', 'vetoed')),
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_engine_results_workflow ON engine_results(workflow);
CREATE INDEX IF NOT EXISTS idx_engine_results_run_id ON engine_results(run_id);
CREATE INDEX IF NOT EXISTS idx_engine_results_review_status ON engine_results(review_status);
`;

/**
 * SQL for the run_log table — queryable audit telemetry for every tool call.
 */
const RUN_LOG_SQL = `
-- 10. Run Log: queryable audit telemetry for every tool call
CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_digest TEXT,
  result_id TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_run_log_session ON run_log(session_id);
CREATE INDEX IF NOT EXISTS idx_run_log_tool ON run_log(tool_name);
CREATE INDEX IF NOT EXISTS idx_run_log_created ON run_log(created_at);
`;

/**
 * Bootstrap all memory tables. Idempotent — safe to call on existing databases.
 *
 * @param {import('bun:sqlite').Database} db - an open SQLite database handle
 * @param {object} [opts]
 * @param {number} [opts.embeddingDim=384] - dimension for vec_evidence_embeddings
 */
function createTables(db, { embeddingDim = DEFAULT_EMBEDDING_DIM } = {}) {
  // Static tables (no parameterization needed)
  db.exec(SCHEMA_SQL);

  // Parameterized vec0 virtual table — inject dimension at runtime
  db.exec(`
-- 8. Vector embeddings: sqlite-vec virtual table for evidence embedding search (D-04)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_evidence_embeddings USING vec0(
  embedding float[${embeddingDim}]
);
  `);

  // Additional tables for Phase 1 persistence foundation
  db.exec(ENGINE_RESULTS_SQL);
  db.exec(RUN_LOG_SQL);

  // Embedding config singleton (Phase 5)
  db.exec(EMBEDDING_CONFIG_SQL);
}

// ---------------------------------------------------------------------------
// Embedding config helpers
// ---------------------------------------------------------------------------

/**
 * Get the active embedding config singleton row.
 * @param {import('bun:sqlite').Database} db
 * @returns {{ id: number, provider: string, model: string, dimension: number, last_embed_at: string|null, evidence_count: number }}
 */
function getEmbeddingConfig(db) {
  return db.prepare("SELECT * FROM embedding_config WHERE id = 1").get() || null;
}

/**
 * Update the embedding config singleton row.
 * @param {import('bun:sqlite').Database} db
 * @param {{ provider?: string, model?: string, dimension?: number, last_embed_at?: string, evidence_count?: number }} opts
 */
function setEmbeddingConfig(db, { provider, model, dimension, last_embed_at, evidence_count } = {}) {
  const updates = [];
  const params = {};
  if (provider !== undefined) { updates.push("provider = $provider"); params.$provider = provider; }
  if (model !== undefined) { updates.push("model = $model"); params.$model = model; }
  if (dimension !== undefined) { updates.push("dimension = $dimension"); params.$dimension = dimension; }
  if (last_embed_at !== undefined) { updates.push("last_embed_at = $last_embed_at"); params.$last_embed_at = last_embed_at; }
  if (evidence_count !== undefined) { updates.push("evidence_count = $evidence_count"); params.$evidence_count = evidence_count; }
  if (updates.length === 0) return;
  db.prepare(`UPDATE embedding_config SET ${updates.join(", ")} WHERE id = 1`).run(params);
}

module.exports = {
  createTables,
  SCHEMA_SQL,
  ENGINE_RESULTS_SQL,
  RUN_LOG_SQL,
  EMBEDDING_CONFIG_SQL,
  DEFAULT_EMBEDDING_DIM,
  getEmbeddingConfig,
  setEmbeddingConfig,
};
