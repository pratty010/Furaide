/**
 * Phase 1 Schema Tests
 *
 * Covers:
 *   - engine_results table structure and constraints
 *   - run_log table structure and constraints
 *   - embeddingDim parameterization (default 384 and custom dim)
 *   - createTables(db) with no args still works (backward compat)
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { Database } = require("bun:sqlite");
const sqliteVec = require("sqlite-vec");
const { createTables, DEFAULT_EMBEDDING_DIM } = require("../memory/schema.js");

function makeDb() {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  return db;
}

// ---------------------------------------------------------------------------
// Helper: get list of tables in the DB
// ---------------------------------------------------------------------------
function tableNames(db) {
  return db
    .query("SELECT name FROM sqlite_master WHERE type='table' OR type='shadow' ORDER BY name")
    .all()
    .map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Helper: get list of indexes for a given table
// ---------------------------------------------------------------------------
function indexNames(db, table) {
  return db
    .query(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`)
    .all(table)
    .map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Backward-compatibility: no-arg call
// ---------------------------------------------------------------------------
describe("createTables backward compatibility", () => {
  it("works with no options argument (default embeddingDim=384)", () => {
    const db = makeDb();
    assert.doesNotThrow(() => createTables(db));
    db.close();
  });

  it("DEFAULT_EMBEDDING_DIM export equals 384", () => {
    assert.strictEqual(DEFAULT_EMBEDDING_DIM, 384);
  });
});

// ---------------------------------------------------------------------------
// engine_results table
// ---------------------------------------------------------------------------
describe("engine_results table", () => {
  it("exists after createTables", () => {
    const db = makeDb();
    createTables(db);
    const names = tableNames(db);
    assert.ok(names.includes("engine_results"), `engine_results not in [${names.join(", ")}]`);
    db.close();
  });

  it("inserts a minimal row with defaults", () => {
    const db = makeDb();
    createTables(db);

    db.exec(`
      INSERT INTO engine_results (id, workflow, run_id, payload_json)
      VALUES ('er_test_001', 'linkedin_optimization', 'run_abc123', '{"key":"val"}')
    `);

    const row = db.query("SELECT * FROM engine_results WHERE id='er_test_001'").get();
    assert.strictEqual(row.id, "er_test_001");
    assert.strictEqual(row.workflow, "linkedin_optimization");
    assert.strictEqual(row.run_id, "run_abc123");
    assert.strictEqual(row.payload_json, '{"key":"val"}');
    assert.strictEqual(row.review_status, "pending");
    assert.ok(row.created_at, "created_at should be set");
    db.close();
  });

  it("enforces review_status CHECK constraint", () => {
    const db = makeDb();
    createTables(db);

    assert.throws(() => {
      db.exec(`
        INSERT INTO engine_results (id, workflow, run_id, payload_json, review_status)
        VALUES ('er_bad', 'brand_strategy', 'run_x', '{}', 'invalid_status')
      `);
    }, /CHECK constraint failed/);
    db.close();
  });

  it("accepts all valid review_status values", () => {
    const db = makeDb();
    createTables(db);

    for (const [i, status] of ["pending", "passed", "vetoed"].entries()) {
      db.exec(`
        INSERT INTO engine_results (id, workflow, run_id, payload_json, review_status)
        VALUES ('er_status_${i}', 'brand_strategy', 'run_${i}', '{}', '${status}')
      `);
    }

    const rows = db.query("SELECT review_status FROM engine_results ORDER BY id").all();
    assert.deepStrictEqual(
      rows.map((r) => r.review_status),
      ["pending", "passed", "vetoed"]
    );
    db.close();
  });

  it("has expected indexes", () => {
    const db = makeDb();
    createTables(db);

    const idxs = indexNames(db, "engine_results");
    assert.ok(idxs.includes("idx_engine_results_workflow"), "missing idx_engine_results_workflow");
    assert.ok(idxs.includes("idx_engine_results_run_id"), "missing idx_engine_results_run_id");
    assert.ok(
      idxs.includes("idx_engine_results_review_status"),
      "missing idx_engine_results_review_status"
    );
    db.close();
  });

  it("stores optional provenance and artifact_version_ids as JSON strings", () => {
    const db = makeDb();
    createTables(db);

    const provenance = JSON.stringify(["ev_001", "rule_A"]);
    const artifactVersionIds = JSON.stringify(["av_001", "av_002"]);

    db.exec(`
      INSERT INTO engine_results (id, workflow, run_id, payload_json, provenance, artifact_version_ids)
      VALUES ('er_prov', 'growth_plan', 'run_prov', '{}', '${provenance}', '${artifactVersionIds}')
    `);

    const row = db.query("SELECT * FROM engine_results WHERE id='er_prov'").get();
    assert.strictEqual(row.provenance, provenance);
    assert.strictEqual(row.artifact_version_ids, artifactVersionIds);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// run_log table
// ---------------------------------------------------------------------------
describe("run_log table", () => {
  it("exists after createTables", () => {
    const db = makeDb();
    createTables(db);
    const names = tableNames(db);
    assert.ok(names.includes("run_log"), `run_log not in [${names.join(", ")}]`);
    db.close();
  });

  it("inserts a minimal row with AUTOINCREMENT id", () => {
    const db = makeDb();
    createTables(db);

    db.exec(`
      INSERT INTO run_log (session_id, tool_name, status)
      VALUES ('sess_001', 'bb_assess', 'ok')
    `);

    const row = db.query("SELECT * FROM run_log WHERE session_id='sess_001'").get();
    assert.ok(row.id > 0, "id should be auto-assigned");
    assert.strictEqual(row.session_id, "sess_001");
    assert.strictEqual(row.tool_name, "bb_assess");
    assert.strictEqual(row.status, "ok");
    assert.ok(row.created_at, "created_at should be set");
    db.close();
  });

  it("inserts multiple rows with sequential ids", () => {
    const db = makeDb();
    createTables(db);

    db.exec(`INSERT INTO run_log (session_id, tool_name, status) VALUES ('s', 'tool_a', 'ok')`);
    db.exec(`INSERT INTO run_log (session_id, tool_name, status) VALUES ('s', 'tool_b', 'error')`);

    const rows = db.query("SELECT id FROM run_log ORDER BY id").all();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1].id - rows[0].id, 1);
    db.close();
  });

  it("stores optional args_digest, result_id, error_message, duration_ms", () => {
    const db = makeDb();
    createTables(db);

    db.exec(`
      INSERT INTO run_log (session_id, tool_name, args_digest, result_id, status, error_message, duration_ms)
      VALUES ('sess_full', 'bb_get_context', 'sha256abc', 'er_001', 'error', 'timeout', 5200)
    `);

    const row = db.query("SELECT * FROM run_log WHERE session_id='sess_full'").get();
    assert.strictEqual(row.args_digest, "sha256abc");
    assert.strictEqual(row.result_id, "er_001");
    assert.strictEqual(row.error_message, "timeout");
    assert.strictEqual(row.duration_ms, 5200);
    db.close();
  });

  it("has expected indexes", () => {
    const db = makeDb();
    createTables(db);

    const idxs = indexNames(db, "run_log");
    assert.ok(idxs.includes("idx_run_log_session"), "missing idx_run_log_session");
    assert.ok(idxs.includes("idx_run_log_tool"), "missing idx_run_log_tool");
    assert.ok(idxs.includes("idx_run_log_created"), "missing idx_run_log_created");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// embeddingDim parameterization
// ---------------------------------------------------------------------------
describe("embeddingDim parameterization", () => {
  it("createTables with no opts creates vec table with 384-dim (default)", () => {
    const db = makeDb();
    createTables(db);

    // vec0 metadata: check that the virtual table exists
    const row = db
      .query("SELECT name FROM sqlite_master WHERE name='vec_evidence_embeddings'")
      .get();
    assert.ok(row, "vec_evidence_embeddings virtual table should exist");
    db.close();
  });

  it("createTables with embeddingDim=768 creates vec table", () => {
    const db = makeDb();
    // Should not throw — sqlite-vec supports different dimensions
    assert.doesNotThrow(() => createTables(db, { embeddingDim: 768 }));

    const row = db
      .query("SELECT name FROM sqlite_master WHERE name='vec_evidence_embeddings'")
      .get();
    assert.ok(row, "vec_evidence_embeddings should exist with dim=768");
    db.close();
  });

  it("createTables is idempotent — calling twice does not error", () => {
    const db = makeDb();
    assert.doesNotThrow(() => {
      createTables(db);
      createTables(db);
    });
    db.close();
  });
});
