/**
 * Brand Builder Test Helpers
 *
 * Shared test harness providing:
 *   - createTestDb()        — in-memory SQLite DB with schema + sqlite-vec
 *   - createTestDirectory() — temp directory under data/
 *   - SAMPLE_* constants    — valid sample data for each entity type
 */

const { Database } = require("bun:sqlite");
const sqliteVec = require("sqlite-vec");
const { createTables } = require("../memory/schema.js");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// createTestDb — opens in-memory SQLite, loads sqlite-vec, bootstraps schema
// ---------------------------------------------------------------------------
function createTestDb() {
  const db = new Database(":memory:");

  // Load vector extension
  sqliteVec.load(db);

  // Bootstrap all tables
  createTables(db);

  return {
    db,
    close() {
      db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// createTestDirectory — creates a temp directory under data/ and cleans up on exit
// ---------------------------------------------------------------------------

// Track all test directories so we can clean them all up at once on process exit
const testDirs = [];
let cleanupRegistered = false;

function createTestDirectory() {
  const base = path.resolve(__dirname, "..", "data");
  const dir = fs.mkdtempSync(path.join(base, "test-"));
  testDirs.push(dir);

  // Register cleanup once, it will clean all directories
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.on("exit", () => {
      for (const testDir of testDirs) {
        try {
          fs.rmSync(testDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    });
  }

  return dir;
}

// ---------------------------------------------------------------------------
// Sample Data Constants
// ---------------------------------------------------------------------------

const SAMPLE_ARTIFACT = {
  artifact_id: "a0000001-0001-4000-8000-000000000001",
  artifact_type: "resume",
  canonical_path: "resume-2026-05.pdf",
  raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  first_ingested_at: "2026-05-07T00:00:00.000Z",
  last_updated_at: "2026-05-07T00:00:00.000Z",
  status: "current",
  source_label: "My updated resume",
};

const SAMPLE_ARTIFACT_VERSION = {
  version_id: "b0000001-0001-4000-8000-000000000001",
  artifact_id: "a0000001-0001-4000-8000-000000000001",
  version_number: 1,
  canonical_path: "resume-2026-05.pdf",
  raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ingested_at: "2026-05-07T00:00:00.000Z",
  provenance: {
    source: "user_upload",
    update_context: "First resume upload",
    goals: "Targeting senior engineering roles",
  },
  supersedes_version: null,
};

const SAMPLE_EVIDENCE_SUMMARY = {
  summary_id: "c0000001-0001-4000-8000-000000000001",
  artifact_id: "a0000001-0001-4000-8000-000000000001",
  version_id: "b0000001-0001-4000-8000-000000000001",
  summary_type: "field_extraction",
  content: "Extracted: name=Jane Doe, years_exp=8, top_skill=TypeScript",
  source_references: ["ref-resume-section-1"],
  stale: false,
  stale_reason: undefined,
  workflow_domain: "assessment",
  created_at: "2026-05-07T00:00:00.000Z",
};

const SAMPLE_RELATIONSHIP = {
  edge_id: "d0000001-0001-4000-8000-000000000001",
  source_type: "evidence",
  source_id: "c0000001-0001-4000-8000-000000000001",
  target_type: "artifact",
  target_id: "a0000001-0001-4000-8000-000000000001",
  relationship_kind: "derived_from",
  weight: 1.0,
  created_at: "2026-05-07T00:00:00.000Z",
};

const SAMPLE_SNAPSHOT = {
  snapshot_id: "e0000001-0001-4000-8000-000000000001",
  trigger_reason: "artifact_update",
  profile_state: JSON.stringify({ overview: "Initial profile ingestion" }),
  dimension_summary: {
    signal: 0.65,
    evidence: 0.50,
    visibility: 0.40,
    narrative: 0.55,
  },
  confidence: "medium",
  dominant_failure_mode: undefined,
  next_recommended_workflow: "bb-current-state",
  artifact_version_ids: ["b0000001-0001-4000-8000-000000000001"],
  created_at: "2026-05-07T00:00:00.000Z",
};


module.exports = {
  createTestDb,
  createTestDirectory,
  SAMPLE_ARTIFACT,
  SAMPLE_ARTIFACT_VERSION,
  SAMPLE_EVIDENCE_SUMMARY,
  SAMPLE_RELATIONSHIP,
  SAMPLE_SNAPSHOT,
};
