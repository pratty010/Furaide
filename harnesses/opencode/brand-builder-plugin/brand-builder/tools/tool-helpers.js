"use strict";
/**
 * Brand Builder Tool Helpers
 *
 * Shared infrastructure for all Phase 2 tool wrappers:
 *   - ID generation (makeResultId, makeRunId)
 *   - Args digest (argsDigest)
 *   - Persist engine result to engine_results table (persistResult)
 *   - Log a tool call to run_log (logRun)
 *
 * All functions are pure or minimally stateful (DB IO only).
 * No LLM calls, no side effects beyond SQLite writes.
 */

const crypto = require("crypto");

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique engine_results id: er_{workflow}_{yyyymmdd}_{random4}
 *
 * @param {string} workflow - workflow name (e.g. "assess", "role-fit")
 * @returns {string}
 */
function makeResultId(workflow) {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const rand = crypto.randomBytes(2).toString("hex"); // 4 hex chars
  const safeWorkflow = String(workflow || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `er_${safeWorkflow}_${yyyy}${mm}${dd}_${rand}`;
}

/**
 * Generate a unique run id: run_{timestamp_ms}_{random4}
 *
 * @returns {string}
 */
function makeRunId() {
  const ts = Date.now();
  const rand = crypto.randomBytes(2).toString("hex");
  return `run_${ts}_${rand}`;
}

// ---------------------------------------------------------------------------
// Args digest
// ---------------------------------------------------------------------------

/**
 * SHA256 digest of JSON-stringified args (for run_log.args_digest).
 * Returns first 16 hex characters of the hash.
 *
 * @param {unknown} args - tool args object
 * @returns {string}
 */
function argsDigest(args) {
  const sorted = JSON.stringify(args, Object.keys(args || {}).sort());
  return crypto
    .createHash("sha256")
    .update(sorted)
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// persistResult
// ---------------------------------------------------------------------------

/**
 * Persist an engine result to engine_results table.
 *
 * @param {import('bun:sqlite').Database} db
 * @param {object} params
 * @param {string} params.workflow - workflow name
 * @param {string} params.runId - run id (from makeRunId)
 * @param {unknown} params.payload - result payload (will be JSON-stringified)
 * @param {string} [params.provenance] - optional provenance string
 * @param {string[]} [params.artifactVersionIds] - optional artifact version ids
 * @param {string} [params.reviewStatus='pending'] - initial review status
 * @returns {string} the inserted row id
 */
function persistResult(db, {
  workflow,
  runId,
  payload,
  provenance,
  artifactVersionIds,
  reviewStatus = "pending",
}) {
  const id = makeResultId(workflow);
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  const stmt = db.prepare(`
    INSERT INTO engine_results
      (id, workflow, run_id, payload_json, provenance, artifact_version_ids, review_status, created_at)
    VALUES
      ($id, $workflow, $run_id, $payload_json, $provenance, $artifact_version_ids, $review_status, $created_at)
  `);

  stmt.run({
    $id: id,
    $workflow: workflow,
    $run_id: runId,
    $payload_json: JSON.stringify(payload),
    $provenance: provenance ?? null,
    $artifact_version_ids: artifactVersionIds ? JSON.stringify(artifactVersionIds) : null,
    $review_status: reviewStatus,
    $created_at: now,
  });

  return id;
}

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

/**
 * Read an engine_results row by id.
 *
 * @param {import('bun:sqlite').Database} db
 * @param {string} id
 * @returns {object|null}
 */
function getResult(db, id) {
  const stmt = db.prepare("SELECT * FROM engine_results WHERE id = $id");
  return stmt.get({ $id: id }) ?? null;
}

// ---------------------------------------------------------------------------
// logRun
// ---------------------------------------------------------------------------

/**
 * Log a tool call to run_log.
 *
 * @param {import('bun:sqlite').Database} db
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.toolName
 * @param {string} [params.argsDigest]
 * @param {string} [params.resultId]
 * @param {string} params.status - 'ok' | 'error'
 * @param {string} [params.errorMessage]
 * @param {number} [params.durationMs]
 */
function logRun(db, {
  sessionId,
  toolName,
  argsDigest: digest,
  resultId,
  status,
  errorMessage,
  durationMs,
}) {
  const stmt = db.prepare(`
    INSERT INTO run_log
      (session_id, tool_name, args_digest, result_id, status, error_message, duration_ms)
    VALUES
      ($session_id, $tool_name, $args_digest, $result_id, $status, $error_message, $duration_ms)
  `);

  stmt.run({
    $session_id: sessionId,
    $tool_name: toolName,
    $args_digest: digest ?? null,
    $result_id: resultId ?? null,
    $status: status,
    $error_message: errorMessage ?? null,
    $duration_ms: durationMs ?? null,
  });
}

// ---------------------------------------------------------------------------
// updateReviewStatus
// ---------------------------------------------------------------------------

/**
 * Update review_status and optional review_notes on an engine_results row.
 *
 * @param {import('bun:sqlite').Database} db
 * @param {string} id
 * @param {'passed'|'vetoed'} status
 * @param {string} [notes]
 * @returns {object|null} updated row
 */
function updateReviewStatus(db, id, status, notes) {
  const stmt = db.prepare(`
    UPDATE engine_results
    SET review_status = $status, review_notes = $notes
    WHERE id = $id
  `);
  stmt.run({ $id: id, $status: status, $notes: notes ?? null });
  return getResult(db, id);
}

// ---------------------------------------------------------------------------
// checkAllReviewed
// ---------------------------------------------------------------------------

/**
 * Check that all engine_results rows referenced by resultIds have review_status != 'pending'.
 * Used by bb_complete_run.
 *
 * @param {import('bun:sqlite').Database} db
 * @param {string[]} resultIds
 * @returns {{ allReviewed: boolean, pending: string[] }}
 */
function checkAllReviewed(db, resultIds) {
  if (!resultIds || resultIds.length === 0) return { allReviewed: true, pending: [] };
  const placeholders = resultIds.map(() => "?").join(",");
  const rows = db.query(`SELECT id, review_status FROM engine_results WHERE id IN (${placeholders})`).all(...resultIds);
  // IDs not found in DB are also treated as not-reviewed
  const foundIds = new Set(rows.map((r) => r.id));
  const missing = resultIds.filter((id) => !foundIds.has(id));
  const pending = [
    ...rows.filter((r) => r.review_status === "pending").map((r) => r.id),
    ...missing,
  ];
  return { allReviewed: pending.length === 0, pending };
}

module.exports = {
  makeResultId,
  makeRunId,
  argsDigest,
  persistResult,
  getResult,
  logRun,
  updateReviewStatus,
  checkAllReviewed,
};
