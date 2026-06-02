/**
 * Phase 2 Tools Layer — Unit & Integration Tests
 *
 * Tests the tool helper infrastructure and write-through pattern logic.
 * Does NOT test opencode tool registration (requires a live opencode process).
 *
 * Coverage:
 *   - makeResultId format
 *   - argsDigest determinism
 *   - persistResult writes a row and returns the id
 *   - logRun writes a run_log row
 *   - updateReviewStatus sets review_status correctly
 *   - checkAllReviewed: passes when all reviewed, fails when any pending
 *   - bb_assess-like flow: call engine → persist → re-read
 *   - bb_role_fit-like flow: parse JD → call engine → persist → re-read
 *   - bb_record_review: sets review_status correctly
 *   - bb_complete_run: passes when all reviewed, fails when pending
 *   - runAtsScan: keyword coverage, format checks, overall score
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");
const {
  makeResultId,
  makeRunId,
  argsDigest,
  persistResult,
  getResult,
  logRun,
  updateReviewStatus,
  checkAllReviewed,
} = require("../tools/tool-helpers.js");
const { runAssessment } = require("../assess/assessment.js");
const { runRoleFitAssessment } = require("../assess/role-fit.js");
const { parseJobDescription } = require("../role-fit/jd-parser.js");
const { runAtsScan } = require("../ats/ats-scan.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const { randomBytes } = require("crypto");
function randomDigest() {
  return randomBytes(32).toString("hex");
}

function seedArtifact(repos, artifactType = "resume") {
  const { randomUUID } = require("crypto");
  const artifactId = randomUUID();
  const versionId = randomUUID();
  repos.artifacts.upsert({
    artifact_id: artifactId,
    artifact_type: artifactType,
    canonical_path: `${artifactType}-test.txt`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    first_ingested_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    status: "current",
    source_label: `Test ${artifactType}`,
  });
  repos.versions.create({
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: `${artifactType}-test.txt`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    ingested_at: new Date().toISOString(),
    provenance: { source: "user_upload", update_context: "test seed" },
    supersedes_version: null,
  });
  return { artifactId, versionId };
}

// ---------------------------------------------------------------------------
// makeResultId
// ---------------------------------------------------------------------------

describe("makeResultId", () => {
  it("produces er_{workflow}_{yyyymmdd}_{4chars} format", () => {
    const id = makeResultId("assess");
    assert.match(id, /^er_assess_\d{8}_[0-9a-f]{4}$/);
  });

  it("sanitizes workflow names with special chars", () => {
    const id = makeResultId("role-fit");
    assert.match(id, /^er_role-fit_\d{8}_[0-9a-f]{4}$/);
  });

  it("produces unique ids on repeated calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeResultId("test")));
    // Extremely unlikely to collide across 20 calls
    assert.ok(ids.size > 1, "Should produce unique ids");
  });
});

// ---------------------------------------------------------------------------
// makeRunId
// ---------------------------------------------------------------------------

describe("makeRunId", () => {
  it("produces run_{timestamp}_{4chars} format", () => {
    const id = makeRunId();
    assert.match(id, /^run_\d+_[0-9a-f]{4}$/);
  });
});

// ---------------------------------------------------------------------------
// argsDigest
// ---------------------------------------------------------------------------

describe("argsDigest", () => {
  it("is deterministic for the same input", () => {
    const args = { foo: "bar", count: 42 };
    assert.strictEqual(argsDigest(args), argsDigest(args));
  });

  it("differs for different inputs", () => {
    assert.notStrictEqual(argsDigest({ a: 1 }), argsDigest({ a: 2 }));
  });

  it("returns 16 hex chars", () => {
    const digest = argsDigest({ x: "test" });
    assert.match(digest, /^[0-9a-f]{16}$/);
  });

  it("handles null/undefined args", () => {
    const d1 = argsDigest(null);
    const d2 = argsDigest(null);
    assert.strictEqual(d1, d2);
  });
});

// ---------------------------------------------------------------------------
// persistResult + getResult
// ---------------------------------------------------------------------------

describe("persistResult", () => {
  let db, repos;

  before(() => {
    const handle = createTestDb();
    db = handle.db;
    repos = createRepositories(db);
  });

  it("writes a row and returns a valid id", () => {
    const id = persistResult(db, {
      workflow: "assess",
      runId: makeRunId(),
      payload: { signal: 60, evidence: 40 },
      provenance: "test",
    });
    assert.match(id, /^er_assess_/);
  });

  it("re-read by id matches stored payload", () => {
    const payload = { signal: 70, evidence: 50, visibility: 30, narrative: 40 };
    const id = persistResult(db, {
      workflow: "assess",
      runId: makeRunId(),
      payload,
      provenance: "test",
    });
    const row = getResult(db, id);
    assert.ok(row, "Row should exist");
    assert.strictEqual(row.workflow, "assess");
    assert.strictEqual(row.review_status, "pending");
    const parsed = JSON.parse(row.payload_json);
    assert.strictEqual(parsed.signal, 70);
    assert.strictEqual(parsed.evidence, 50);
  });

  it("defaults review_status to pending", () => {
    const id = persistResult(db, {
      workflow: "linkedin",
      runId: makeRunId(),
      payload: { test: true },
    });
    const row = getResult(db, id);
    assert.strictEqual(row.review_status, "pending");
  });

  it("stores artifact_version_ids as JSON", () => {
    const vids = ["vid-1", "vid-2"];
    const id = persistResult(db, {
      workflow: "assess",
      runId: makeRunId(),
      payload: {},
      artifactVersionIds: vids,
    });
    const row = getResult(db, id);
    assert.deepStrictEqual(JSON.parse(row.artifact_version_ids), vids);
  });
});

// ---------------------------------------------------------------------------
// logRun
// ---------------------------------------------------------------------------

describe("logRun", () => {
  let db;

  before(() => {
    const handle = createTestDb();
    db = handle.db;
  });

  it("writes a row to run_log", () => {
    const before_count = db.prepare("SELECT COUNT(*) as c FROM run_log").get().c;
    logRun(db, {
      sessionId: "test-session-1",
      toolName: "bb_assess",
      argsDigest: argsDigest({ test: true }),
      resultId: "er_assess_20260601_abcd",
      status: "ok",
      durationMs: 42,
    });
    const after_count = db.prepare("SELECT COUNT(*) as c FROM run_log").get().c;
    assert.strictEqual(after_count, before_count + 1);
  });

  it("writes error status with message", () => {
    logRun(db, {
      sessionId: "test-session-2",
      toolName: "bb_role_fit",
      status: "error",
      errorMessage: "repos is required",
    });
    const row = db.prepare("SELECT * FROM run_log WHERE session_id = 'test-session-2'").get();
    assert.strictEqual(row.status, "error");
    assert.strictEqual(row.error_message, "repos is required");
  });
});

// ---------------------------------------------------------------------------
// updateReviewStatus
// ---------------------------------------------------------------------------

describe("updateReviewStatus", () => {
  let db;

  before(() => {
    const handle = createTestDb();
    db = handle.db;
  });

  it("sets review_status to passed", () => {
    const id = persistResult(db, {
      workflow: "assess",
      runId: makeRunId(),
      payload: { test: true },
    });
    const updated = updateReviewStatus(db, id, "passed", "Looks good");
    assert.strictEqual(updated.review_status, "passed");
    assert.strictEqual(updated.review_notes, "Looks good");
  });

  it("sets review_status to vetoed", () => {
    const id = persistResult(db, {
      workflow: "linkedin",
      runId: makeRunId(),
      payload: { test: true },
    });
    const updated = updateReviewStatus(db, id, "vetoed", "Not approved");
    assert.strictEqual(updated.review_status, "vetoed");
  });

  it("returns null for non-existent id", () => {
    const updated = updateReviewStatus(db, "nonexistent-id", "passed");
    assert.strictEqual(updated, null);
  });
});

// ---------------------------------------------------------------------------
// checkAllReviewed
// ---------------------------------------------------------------------------

describe("checkAllReviewed", () => {
  let db;

  before(() => {
    const handle = createTestDb();
    db = handle.db;
  });

  it("passes when all results are reviewed", () => {
    const id1 = persistResult(db, { workflow: "assess", runId: makeRunId(), payload: {} });
    const id2 = persistResult(db, { workflow: "linkedin", runId: makeRunId(), payload: {} });
    updateReviewStatus(db, id1, "passed");
    updateReviewStatus(db, id2, "passed");
    const { allReviewed, pending } = checkAllReviewed(db, [id1, id2]);
    assert.ok(allReviewed);
    assert.strictEqual(pending.length, 0);
  });

  it("fails when any result is still pending", () => {
    const id1 = persistResult(db, { workflow: "brand", runId: makeRunId(), payload: {} });
    const id2 = persistResult(db, { workflow: "growth", runId: makeRunId(), payload: {} });
    updateReviewStatus(db, id1, "passed");
    // id2 remains pending
    const { allReviewed, pending } = checkAllReviewed(db, [id1, id2]);
    assert.ok(!allReviewed);
    assert.ok(pending.includes(id2));
  });

  it("fails for missing ids", () => {
    const { allReviewed, pending } = checkAllReviewed(db, ["nonexistent"]);
    assert.ok(!allReviewed);
    assert.ok(pending.includes("nonexistent"));
  });

  it("passes vacuously for empty id list", () => {
    const { allReviewed } = checkAllReviewed(db, []);
    assert.ok(allReviewed);
  });
});

// ---------------------------------------------------------------------------
// bb_assess-like flow: engine → persist → re-read
// ---------------------------------------------------------------------------

describe("bb_assess-like integration flow", () => {
  let db, repos;

  before(() => {
    const handle = createTestDb();
    db = handle.db;
    repos = createRepositories(db);
    // Seed a resume artifact so assessment has data
    seedArtifact(repos, "resume");
  });

  it("runs assessment, persists result, and re-reads matching payload", () => {
    const runId = makeRunId();
    const assessmentResult = runAssessment({ repos });

    // Verify shape
    assert.ok(typeof assessmentResult.signal === "number");
    assert.ok(typeof assessmentResult.evidence === "number");
    assert.ok(assessmentResult.dominantFailureMode);

    const id = persistResult(db, {
      workflow: "assess",
      runId,
      payload: assessmentResult,
      provenance: "integration test",
    });

    const row = getResult(db, id);
    assert.ok(row);
    assert.strictEqual(row.workflow, "assess");
    const parsed = JSON.parse(row.payload_json);
    assert.strictEqual(parsed.signal, assessmentResult.signal);
    assert.strictEqual(parsed.evidence, assessmentResult.evidence);
    assert.strictEqual(parsed.dominantFailureMode.dimension, assessmentResult.dominantFailureMode.dimension);
  });
});

// ---------------------------------------------------------------------------
// bb_role_fit-like flow: parse JD → engine → persist → re-read
// ---------------------------------------------------------------------------

describe("bb_role_fit-like integration flow", () => {
  let db, repos;

  before(() => {
    const handle = createTestDb();
    db = handle.db;
    repos = createRepositories(db);
    seedArtifact(repos, "resume");
  });

  it("parses JD, runs role-fit, persists result, re-reads payload", () => {
    const jdText = `## Requirements
- TypeScript
- React
- 3+ years of experience
`;
    const parsedJob = parseJobDescription({
      roleTarget: "Senior Frontend Engineer",
      jobDescriptionText: jdText,
    });

    assert.ok(Array.isArray(parsedJob.mustHaveSkills));
    assert.strictEqual(parsedJob.seniority, "senior");

    const assessmentResult = runRoleFitAssessment({
      repos,
      parsedJob,
      roleFamilySlug: "senior-frontend-engineer",
      roleTitle: "Senior Frontend Engineer",
    });

    assert.ok(typeof assessmentResult.fitScore === "number");
    assert.ok(typeof assessmentResult.bracket === "string");

    const runId = makeRunId();
    const id = persistResult(db, {
      workflow: "role-fit",
      runId,
      payload: { parsedJob, assessmentResult },
      provenance: "Role: Senior Frontend Engineer",
    });

    const row = getResult(db, id);
    assert.ok(row);
    const parsed = JSON.parse(row.payload_json);
    assert.strictEqual(parsed.assessmentResult.fitScore, assessmentResult.fitScore);
    assert.strictEqual(parsed.parsedJob.roleTitle, "Senior Frontend Engineer");
  });
});

// ---------------------------------------------------------------------------
// bb_record_review + bb_complete_run logic
// ---------------------------------------------------------------------------

describe("review/completion workflow logic", () => {
  let db;

  before(() => {
    const handle = createTestDb();
    db = handle.db;
  });

  it("record_review: sets review_status to passed on 'pass' verdict", () => {
    const id = persistResult(db, { workflow: "assess", runId: makeRunId(), payload: {} });
    const updated = updateReviewStatus(db, id, "passed", "All good");
    assert.strictEqual(updated.review_status, "passed");
  });

  it("record_review: sets review_status to vetoed on 'veto' verdict", () => {
    const id = persistResult(db, { workflow: "linkedin", runId: makeRunId(), payload: {} });
    const updated = updateReviewStatus(db, id, "vetoed", "Rejected");
    assert.strictEqual(updated.review_status, "vetoed");
  });

  it("complete_run: passes when all results are reviewed", () => {
    const id1 = persistResult(db, { workflow: "assess", runId: makeRunId(), payload: {} });
    const id2 = persistResult(db, { workflow: "brand", runId: makeRunId(), payload: {} });
    updateReviewStatus(db, id1, "passed");
    updateReviewStatus(db, id2, "vetoed");
    const { allReviewed } = checkAllReviewed(db, [id1, id2]);
    assert.ok(allReviewed);
  });

  it("complete_run: fails when any result is still pending", () => {
    const id1 = persistResult(db, { workflow: "assess", runId: makeRunId(), payload: {} });
    const id2 = persistResult(db, { workflow: "growth", runId: makeRunId(), payload: {} });
    updateReviewStatus(db, id1, "passed");
    // id2 stays pending
    const { allReviewed, pending } = checkAllReviewed(db, [id1, id2]);
    assert.ok(!allReviewed);
    assert.deepStrictEqual(pending, [id2]);
  });
});

// ---------------------------------------------------------------------------
// runAtsScan unit tests
// ---------------------------------------------------------------------------

describe("runAtsScan", () => {
  it("returns 100 keyword score when no keywords provided", () => {
    const result = runAtsScan({ resumeText: "Some resume content" });
    assert.strictEqual(result.keywordCoverage.score, 100);
    assert.strictEqual(result.keywordCoverage.matched.length, 0);
    assert.strictEqual(result.keywordCoverage.missing.length, 0);
  });

  it("detects matched and missing keywords (case-insensitive)", () => {
    const resume = "I have experience with TypeScript, React, and Node.js";
    const result = runAtsScan({
      resumeText: resume,
      jdKeywords: ["TypeScript", "React", "Python"],
    });
    assert.ok(result.keywordCoverage.matched.includes("TypeScript"));
    assert.ok(result.keywordCoverage.matched.includes("React"));
    assert.ok(result.keywordCoverage.missing.includes("Python"));
  });

  it("correctly scores partial keyword coverage", () => {
    const resume = "Expert in React and CSS";
    const result = runAtsScan({
      resumeText: resume,
      jdKeywords: ["React", "TypeScript", "GraphQL", "CSS"],
    });
    // 2 matched out of 4 = 50%
    assert.strictEqual(result.keywordCoverage.score, 50);
  });

  it("detects quantified achievements", () => {
    const resume = "Improved system performance by 40% for 10000 users";
    const result = runAtsScan({ resumeText: resume });
    assert.ok(result.formatChecks.hasQuantifiedAchievements);
  });

  it("detects bullet points", () => {
    const resume = "Skills:\n- TypeScript\n- React\n- Node.js";
    const result = runAtsScan({ resumeText: resume });
    assert.ok(result.formatChecks.hasBulletPoints);
  });

  it("detects contact info (email)", () => {
    const resume = "Jane Doe\njane@example.com\nSoftware Engineer";
    const result = runAtsScan({ resumeText: resume });
    assert.ok(result.formatChecks.hasContactInfo);
  });

  it("detects date ranges", () => {
    const resume = "Senior Engineer at Acme Corp 2020 – Present";
    const result = runAtsScan({ resumeText: resume });
    assert.ok(result.formatChecks.hasDateRanges);
  });

  it("computes overall score as 70% keyword + 30% format", () => {
    // Resume with keywords only matched (no format signals)
    const resume = "python javascript developer";
    const result = runAtsScan({
      resumeText: resume,
      jdKeywords: ["python", "javascript"],
    });
    // keyword score = 100 (2/2 matched), format score = 0 (no format signals)
    assert.strictEqual(result.keywordCoverage.score, 100);
    // overallScore = 0.7 * 100 + 0.3 * 0 = 70
    assert.strictEqual(result.overallScore, 70);
  });

  it("deduplicates keywords across jdKeywords and requiredKeywords", () => {
    const resume = "TypeScript developer";
    const result = runAtsScan({
      resumeText: resume,
      jdKeywords: ["TypeScript", "React"],
      requiredKeywords: ["TypeScript"], // duplicate
    });
    const allKeywords = [...result.keywordCoverage.matched, ...result.keywordCoverage.missing];
    // TypeScript should appear exactly once
    const count = allKeywords.filter((k) => k.toLowerCase() === "typescript").length;
    assert.strictEqual(count, 1);
  });

  it("handles empty resume text gracefully", () => {
    const result = runAtsScan({
      resumeText: "",
      jdKeywords: ["TypeScript", "React"],
    });
    assert.strictEqual(result.keywordCoverage.score, 0);
    assert.strictEqual(result.keywordCoverage.missing.length, 2);
  });
});
