/**
 * retrieval.test.js — MEM-04
 *
 * Integration tests for memory read/reuse paths.
 * Tests getArtifactContext, getFullContext, getLatestProfileState,
 * getEvidenceGraph, getRecentSnapshots, and getStalenessReport.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("crypto");

const { createRepositories } = require("../memory/repository.js");
const {
  getArtifactContext,
  getFullContext,
  getLatestProfileState,
  getEvidenceGraph,
  getRecentSnapshots,
  getStalenessReport,
} = require("../memory/retrieval.js");

const {
  createTestDb,
  SAMPLE_ARTIFACT,
  SAMPLE_ARTIFACT_VERSION,
  SAMPLE_EVIDENCE_SUMMARY,
  SAMPLE_RELATIONSHIP,
  SAMPLE_SNAPSHOT,
} = require("./helpers.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a complete artifact with version, evidence summary, relationship,
 * and snapshot for integration testing.
 */
function seedArtifactWithContext(repos, { artifactType = "resume", stale = false } = {}) {
  const now = new Date().toISOString();
  const artifactId = randomUUID();
  const versionId = randomUUID();
  const summaryId = randomUUID();
  const edgeId = randomUUID();

  // 1. Artifact
  const artifact = {
    ...SAMPLE_ARTIFACT,
    artifact_id: artifactId,
    artifact_type: artifactType,
    first_ingested_at: now,
    last_updated_at: now,
  };
  repos.artifacts.upsert(artifact);

  // 2. Version
  const version = {
    ...SAMPLE_ARTIFACT_VERSION,
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    ingested_at: now,
  };
  repos.versions.create(version);

  // 3. Evidence Summary
  const summary = {
    ...SAMPLE_EVIDENCE_SUMMARY,
    summary_id: summaryId,
    artifact_id: artifactId,
    version_id: versionId,
    created_at: now,
  };
  repos.evidence.create(summary);

  if (stale) {
    repos.evidence.markStale(summaryId, "test-stale-reason");
  }

  // 4. Relationship
  const relationship = {
    ...SAMPLE_RELATIONSHIP,
    edge_id: edgeId,
    source_type: "evidence",
    source_id: summaryId,
    target_type: "artifact",
    target_id: artifactId,
    relationship_kind: "derived_from",
  };
  repos.relationships.create(relationship);

  return { artifactId, versionId, summaryId, edgeId, now };
}

/**
 * Seed a snapshot record.
 */
function seedSnapshot(repos, { artifactVersionIds, triggerReason } = {}) {
  const snapId = randomUUID();
  const versionIds = artifactVersionIds || [randomUUID()];
  const now = new Date().toISOString();

  // Create artifacts and versions first (if they don't exist)
  // This function is used after seeding artifacts
  const snapshot = {
    ...SAMPLE_SNAPSHOT,
    snapshot_id: snapId,
    trigger_reason: triggerReason || "artifact_update",
    artifact_version_ids: versionIds,
    created_at: now,
  };
  repos.snapshots.create(snapshot);
  return { snapshotId: snapId, versionIds, now };
}

// ---------------------------------------------------------------------------
// getArtifactContext
// ---------------------------------------------------------------------------

describe("Retrieval — getArtifactContext", () => {
  it("returns current artifacts with summaries for specified types", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed a resume artifact
    const { artifactId, versionId } = seedArtifactWithContext(repos, { artifactType: "resume" });

    const result = getArtifactContext({ repos, artifactTypes: ["resume"] });
    assert.ok(result.resume, "should have resume context");
    assert.ok(result.resume.artifact, "should include artifact");
    assert.strictEqual(result.resume.artifact.artifact_id, artifactId);
    assert.strictEqual(result.resume.artifact.artifact_type, "resume");
    assert.ok(result.resume.latestVersion, "should include latest version");
    assert.strictEqual(result.resume.latestVersion.version_id, versionId);
    assert.strictEqual(result.resume.summaries.length, 1, "should include 1 non-stale summary");
    assert.strictEqual(result.resume.summaries[0].summary_id, result.resume.summaries[0].summary_id);

    close();
  });

  it("returns null for types with no current artifact", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const result = getArtifactContext({ repos, artifactTypes: ["linkedin"] });
    assert.strictEqual(result.linkedin, null, "should be null for empty type");

    close();
  });

  it("defaults to all artifact types when none specified", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed resume + linkedin
    seedArtifactWithContext(repos, { artifactType: "resume" });
    seedArtifactWithContext(repos, { artifactType: "linkedin" });

    const result = getArtifactContext({ repos });
    assert.ok(result.resume, "should include resume");
    assert.ok(result.linkedin, "should include linkedin");
    assert.ok("github_profile" in result, "should include github_profile key");
    assert.ok("github_repo" in result, "should include github_repo key");
    assert.ok("website" in result, "should include website key");
    assert.ok("job_description" in result, "should include job_description key");

    close();
  });

  it("excludes stale summaries from results", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed with a fresh summary first
    const ctx1 = seedArtifactWithContext(repos, { artifactType: "resume" });
    const artifactId = ctx1.artifactId;

    // Create a second summary and mark it stale
    const staleSummaryId = randomUUID();
    const now = new Date().toISOString();
    repos.evidence.create({
      ...SAMPLE_EVIDENCE_SUMMARY,
      summary_id: staleSummaryId,
      artifact_id: artifactId,
      version_id: ctx1.versionId,
      created_at: now,
    });
    repos.evidence.markStale(staleSummaryId, "test-stale");

    const result = getArtifactContext({ repos, artifactTypes: ["resume"] });
    assert.strictEqual(result.resume.summaries.length, 1,
      "should exclude stale summary, returning only 1 non-stale");
    assert.notStrictEqual(result.resume.summaries[0].summary_id, staleSummaryId,
      "stale summary should not be in results");

    close();
  });
});

// ---------------------------------------------------------------------------
// getFullContext
// ---------------------------------------------------------------------------

describe("Retrieval — getFullContext", () => {
  it("returns artifact, versions, summaries, relationships, and latest snapshot", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const { artifactId, versionId, summaryId } = seedArtifactWithContext(repos, { artifactType: "resume" });

    const result = getFullContext({ repos, artifactId });
    assert.ok(result.artifact, "should include artifact");
    assert.strictEqual(result.artifact.artifact_id, artifactId);
    assert.strictEqual(result.versions.length, 1, "should include 1 version");
    assert.strictEqual(result.versions[0].version_id, versionId);
    assert.strictEqual(result.summaries.length, 1, "should include 1 summary");
    assert.ok(result.relationships.length >= 1, "should include relationships");
    // latestSnapshot may be null if no snapshot was seeded

    close();
  });

  it("includes stale summaries when includeStale=true", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const { artifactId } = seedArtifactWithContext(repos, { artifactType: "resume", stale: true });

    // Without includeStale
    const resultNoStale = getFullContext({ repos, artifactId, includeStale: false });
    assert.strictEqual(resultNoStale.summaries.length, 0,
      "should not include stale summaries when includeStale=false");

    // With includeStale
    const resultWithStale = getFullContext({ repos, artifactId, includeStale: true });
    assert.strictEqual(resultWithStale.summaries.length, 1,
      "should include stale summaries when includeStale=true");

    close();
  });

  it("returns null artifact for non-existent artifactId", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const result = getFullContext({ repos, artifactId: randomUUID() });
    assert.strictEqual(result.artifact, null);
    assert.strictEqual(result.versions.length, 0);
    assert.strictEqual(result.summaries.length, 0);
    assert.strictEqual(result.relationships.length, 0);
    assert.strictEqual(result.latestSnapshot, null);

    close();
  });

  it("bounds versions to 5 for resume type per D-13", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed a resume artifact with 6 versions
    const artifactId = randomUUID();
    const now = new Date().toISOString();
    const baseArtifact = { ...SAMPLE_ARTIFACT, artifact_id: artifactId, artifact_type: "resume", first_ingested_at: now, last_updated_at: now };
    repos.artifacts.upsert(baseArtifact);

    // Create 6 versions
    for (let i = 1; i <= 6; i++) {
      const versionId = randomUUID();
      repos.versions.create({
        ...SAMPLE_ARTIFACT_VERSION,
        version_id: versionId,
        artifact_id: artifactId,
        version_number: i,
        ingested_at: now,
      });
    }

    const result = getFullContext({ repos, artifactId });
    assert.strictEqual(result.artifact.artifact_type, "resume");
    assert.strictEqual(result.versions.length, 5,
      "should return at most 5 versions for resume (D-13)");

    close();
  });

  it("finds latestSnapshot containing artifact's version IDs", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const { artifactId, versionId } = seedArtifactWithContext(repos, { artifactType: "resume" });

    // Seed a snapshot that includes this version
    const now = new Date().toISOString();
    const snapId = randomUUID();
    repos.snapshots.create({
      ...SAMPLE_SNAPSHOT,
      snapshot_id: snapId,
      artifact_version_ids: [versionId],
      created_at: now,
    });

    const result = getFullContext({ repos, artifactId });
    assert.ok(result.latestSnapshot, "should find the matching snapshot");
    assert.strictEqual(result.latestSnapshot.snapshot_id, snapId);

    close();
  });
});

// ---------------------------------------------------------------------------
// getLatestProfileState
// ---------------------------------------------------------------------------

describe("Retrieval — getLatestProfileState", () => {
  it("returns the most recent snapshot's profile state", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const now = new Date().toISOString();
    const snapId = randomUUID();
    const profileState = JSON.stringify({ signal: "strong", gaps: ["visibility"] });

    repos.snapshots.create({
      ...SAMPLE_SNAPSHOT,
      snapshot_id: snapId,
      profile_state: profileState,
      created_at: now,
    });

    const result = getLatestProfileState({ repos });
    assert.ok(result, "should return state");
    assert.strictEqual(result.profileState, profileState);
    assert.ok(result.dimensionSummary, "should include dimensionSummary");
    assert.strictEqual(typeof result.dimensionSummary.signal, "number");
    assert.strictEqual(typeof result.dimensionSummary.evidence, "number");
    assert.strictEqual(typeof result.dimensionSummary.visibility, "number");
    assert.strictEqual(typeof result.dimensionSummary.narrative, "number");
    assert.strictEqual(result.snapshotId, snapId);

    close();
  });

  it("returns null when no snapshots exist", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const result = getLatestProfileState({ repos });
    assert.strictEqual(result, null);

    close();
  });
});

// ---------------------------------------------------------------------------
// getEvidenceGraph
// ---------------------------------------------------------------------------

describe("Retrieval — getEvidenceGraph", () => {
  it("returns direct summaries and edges at depth 1", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const { artifactId, summaryId } = seedArtifactWithContext(repos, { artifactType: "resume" });

    const result = getEvidenceGraph({ repos, artifactId, depth: 1 });
    assert.ok(result.summaries, "should include summaries");
    assert.strictEqual(result.summaries.length, 1, "should have 1 summary");
    assert.strictEqual(result.summaries[0].summary_id, summaryId);
    assert.ok(result.edges.length >= 1, "should include relationship edges");

    close();
  });

  it("throws when artifactId is missing", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    assert.throws(
      () => getEvidenceGraph({ repos }),
      /artifactId/
    );

    close();
  });

  it("returns empty arrays for artifact with no evidence", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed artifact without evidence
    const artifactId = randomUUID();
    const now = new Date().toISOString();
    repos.artifacts.upsert({
      ...SAMPLE_ARTIFACT,
      artifact_id: artifactId,
      first_ingested_at: now,
      last_updated_at: now,
    });

    const result = getEvidenceGraph({ repos, artifactId, depth: 1 });
    assert.strictEqual(result.summaries.length, 0);
    assert.strictEqual(result.edges.length, 0);

    close();
  });
});

// ---------------------------------------------------------------------------
// getRecentSnapshots
// ---------------------------------------------------------------------------

describe("Retrieval — getRecentSnapshots", () => {
  it("returns snapshots in chronological order (most recent first)", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const older = "2026-01-15T00:00:00.000Z";
    const newer = "2026-06-15T00:00:00.000Z";

    const olderId = randomUUID();
    const newerId = randomUUID();

    repos.snapshots.create({
      ...SAMPLE_SNAPSHOT,
      snapshot_id: olderId,
      created_at: older,
    });
    repos.snapshots.create({
      ...SAMPLE_SNAPSHOT,
      snapshot_id: newerId,
      created_at: newer,
    });

    const result = getRecentSnapshots({ repos, limit: 10 });
    assert.ok(result.length >= 2, "should return at least 2 snapshots");
    assert.strictEqual(result[0].createdAt, newer, "most recent first");
    assert.strictEqual(result[1].createdAt, older, "older second");

    close();
  });

  it("respects the limit parameter", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed 5 snapshots
    for (let i = 0; i < 5; i++) {
      repos.snapshots.create({
        ...SAMPLE_SNAPSHOT,
        snapshot_id: randomUUID(),
        created_at: new Date().toISOString(),
      });
    }

    const result = getRecentSnapshots({ repos, limit: 3 });
    assert.strictEqual(result.length, 3, "should respect limit=3");

    close();
  });

  it("returns enriched snapshot data with dimensionSummary and version IDs", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const versionIds = [randomUUID(), randomUUID()];
    // Create the versions first
    const artifactId = randomUUID();
    const now = new Date().toISOString();
    repos.artifacts.upsert({
      ...SAMPLE_ARTIFACT,
      artifact_id: artifactId,
      first_ingested_at: now,
      last_updated_at: now,
    });
    for (const vid of versionIds) {
      repos.versions.create({
        ...SAMPLE_ARTIFACT_VERSION,
        version_id: vid,
        artifact_id: artifactId,
        version_number: versionIds.indexOf(vid) + 1,
        ingested_at: now,
      });
    }

    const snapId = randomUUID();
    repos.snapshots.create({
      ...SAMPLE_SNAPSHOT,
      snapshot_id: snapId,
      artifact_version_ids: versionIds,
      created_at: now,
    });

    const result = getRecentSnapshots({ repos, limit: 1 });
    assert.strictEqual(result.length, 1);
    const snap = result[0];
    assert.strictEqual(snap.snapshotId, snapId);
    assert.ok(snap.dimensionSummary, "should have dimensionSummary");
    assert.strictEqual(typeof snap.dimensionSummary.signal, "number");
    assert.ok(Array.isArray(snap.artifactVersionIds), "version IDs should be array");
    assert.strictEqual(snap.artifactVersionIds.length, 2);
    assert.strictEqual(snap.artifactVersionCount, 2);

    close();
  });
});

// ---------------------------------------------------------------------------
// getStalenessReport
// ---------------------------------------------------------------------------

describe("Retrieval — getStalenessReport", () => {
  it("groups stale summaries by artifact with reasons", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed two artifacts, each with a stale summary
    const ctx1 = seedArtifactWithContext(repos, { artifactType: "resume" });
    const ctx2 = seedArtifactWithContext(repos, { artifactType: "linkedin" });

    // Create additional stale summary for ctx1
    const extraStaleId = randomUUID();
    const now = new Date().toISOString();
    repos.evidence.create({
      ...SAMPLE_EVIDENCE_SUMMARY,
      summary_id: extraStaleId,
      artifact_id: ctx1.artifactId,
      version_id: ctx1.versionId,
      created_at: now,
    });

    // Mark summaries stale
    repos.evidence.markStale(ctx1.summaryId, "artifact_version_superseded");
    repos.evidence.markStale(extraStaleId, "new_role_target");
    repos.evidence.markStale(ctx2.summaryId, "conflicting_evidence");

    const report = getStalenessReport({ repos });
    assert.ok(report.length >= 2, "should have at least 2 artifact groups");

    // Find the resume group (should have 2 stale summaries)
    const resumeGroup = report.find((g) => g.artifactId === ctx1.artifactId);
    assert.ok(resumeGroup, "should include resume artifact");
    assert.strictEqual(resumeGroup.artifactType, "resume");
    assert.strictEqual(resumeGroup.staleCount, 2);
    assert.strictEqual(resumeGroup.staleSummaries.length, 2);

    // Find the linkedin group (should have 1 stale summary)
    const linkedinGroup = report.find((g) => g.artifactId === ctx2.artifactId);
    assert.ok(linkedinGroup, "should include linkedin artifact");
    assert.strictEqual(linkedinGroup.artifactType, "linkedin");
    assert.strictEqual(linkedinGroup.staleCount, 1);
    assert.strictEqual(linkedinGroup.staleSummaries[0].staleReason, "conflicting_evidence");

    close();
  });

  it("returns empty array when no stale evidence exists", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed fresh (non-stale) artifact
    seedArtifactWithContext(repos, { artifactType: "resume", stale: false });

    const report = getStalenessReport({ repos });
    assert.strictEqual(report.length, 0, "should be empty when nothing is stale");

    close();
  });

  it("sorts report by stale count descending", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    // Seed resume with 3 stale summaries
    const ctxResume = seedArtifactWithContext(repos, { artifactType: "resume" });
    for (let i = 0; i < 2; i++) {
      const sId = randomUUID();
      repos.evidence.create({
        ...SAMPLE_EVIDENCE_SUMMARY,
        summary_id: sId,
        artifact_id: ctxResume.artifactId,
        version_id: ctxResume.versionId,
        created_at: new Date().toISOString(),
      });
      repos.evidence.markStale(sId, "reason-" + i);
    }
    repos.evidence.markStale(ctxResume.summaryId, "reason-main");

    // Seed linkedin with 1 stale summary
    const ctxLinkedIn = seedArtifactWithContext(repos, { artifactType: "linkedin" });
    repos.evidence.markStale(ctxLinkedIn.summaryId, "reason-li");

    const report = getStalenessReport({ repos });
    assert.ok(report.length >= 2);
    // Most stale should be first
    assert.strictEqual(report[0].staleCount, 3, "artifact with most stale should be first");
    assert.strictEqual(report[1].staleCount, 1, "artifact with fewer stale should be second");

    close();
  });
});
