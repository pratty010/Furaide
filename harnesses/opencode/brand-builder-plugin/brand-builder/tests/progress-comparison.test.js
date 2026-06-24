const { describe, it } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("crypto");

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");
const { runProgressComparison } = require("../progress/comparison.js");

function seedArtifactWithVersion(repos, { artifactType, sourceLabel }) {
  const artifactId = randomUUID();
  const versionId = randomUUID();
  const now = new Date().toISOString();

  repos.artifacts.upsert({
    artifact_id: artifactId,
    artifact_type: artifactType,
    canonical_path: `${artifactType}-${versionId}.md`,
    raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    first_ingested_at: now,
    last_updated_at: now,
    status: "current",
    source_label: sourceLabel,
  });

  repos.versions.create({
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: `${artifactType}-${versionId}.md`,
    raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ingested_at: now,
    provenance: { source: "user_upload", update_context: "progress-test" },
    supersedes_version: null,
  });

  return versionId;
}

function seedSnapshot(repos, {
  createdAt,
  triggerReason = "artifact_update",
  dimensions,
  dominantFailureMode,
  nextRecommendedWorkflow,
  profileState = {},
  artifactVersionIds,
}) {
  repos.snapshots.create({
    snapshot_id: randomUUID(),
    trigger_reason: triggerReason,
    profile_state: JSON.stringify(profileState),
    dimension_summary: dimensions,
    confidence: "medium",
    dominant_failure_mode: dominantFailureMode,
    next_recommended_workflow: nextRecommendedWorkflow,
    artifact_version_ids: artifactVersionIds,
    created_at: createdAt,
  });
}

describe("runProgressComparison", () => {
  it("compares latest snapshot to previous using locked fields only", () => {
    const testDb = createTestDb();
    const repos = createRepositories(testDb.db);

    const resumeVersion = seedArtifactWithVersion(repos, { artifactType: "resume", sourceLabel: "resume" });
    const linkedinVersion = seedArtifactWithVersion(repos, { artifactType: "linkedin", sourceLabel: "linkedin" });

    seedSnapshot(repos, {
      createdAt: "2026-05-01T00:00:00.000Z",
      dimensions: { signal: 40, evidence: 50, visibility: 60, narrative: 70 },
      dominantFailureMode: "low visibility",
      nextRecommendedWorkflow: "bb-linkedin",
      profileState: { internal: "should-not-leak" },
      artifactVersionIds: [resumeVersion],
    });

    seedSnapshot(repos, {
      createdAt: "2026-05-02T00:00:00.000Z",
      triggerReason: "approved_rewrite",
      dimensions: { signal: 60, evidence: 45, visibility: 75, narrative: 74 },
      dominantFailureMode: "light narrative",
      nextRecommendedWorkflow: "bb-github-proof",
      profileState: { internal: "new-state" },
      artifactVersionIds: [linkedinVersion],
    });

    const result = runProgressComparison({ repos, limit: 6 });

    assert.strictEqual(result.currentSnapshot.triggerReason, "approved_rewrite");
    assert.strictEqual(result.previousSnapshot.triggerReason, "artifact_update");
    assert.strictEqual(result.recommendedNextWorkflow, "bb-github-proof");
    assert.ok(!("profileState" in result.currentSnapshot));
    assert.ok(!("profileState" in result.previousSnapshot));

    testDb.close();
  });

  it("formats arrows as ↑N, ↓N, → using meaningful threshold >= 10", () => {
    const testDb = createTestDb();
    const repos = createRepositories(testDb.db);

    const resumeVersion = seedArtifactWithVersion(repos, { artifactType: "resume", sourceLabel: "resume" });

    seedSnapshot(repos, {
      createdAt: "2026-05-01T00:00:00.000Z",
      dimensions: { signal: 40, evidence: 60, visibility: 70, narrative: 50 },
      dominantFailureMode: "low signal",
      nextRecommendedWorkflow: "bb-current-state",
      artifactVersionIds: [resumeVersion],
    });

    seedSnapshot(repos, {
      createdAt: "2026-05-02T00:00:00.000Z",
      dimensions: { signal: 50, evidence: 51, visibility: 58, narrative: 50 },
      dominantFailureMode: "low evidence",
      nextRecommendedWorkflow: "bb-linkedin",
      artifactVersionIds: [resumeVersion],
    });

    const result = runProgressComparison({ repos, limit: 6 });

    assert.strictEqual(result.arrows.signal, "↑10");
    assert.strictEqual(result.arrows.evidence, "→");
    assert.strictEqual(result.arrows.visibility, "↓12");
    assert.strictEqual(result.arrows.narrative, "→");

    testDb.close();
  });

  it("prefers role-family trend window and falls back to recent snapshots when missing", () => {
    const testDb = createTestDb();
    const repos = createRepositories(testDb.db);

    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: [],
      role_family_target: "senior-backend-engineer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const resumeVersion = seedArtifactWithVersion(repos, { artifactType: "resume", sourceLabel: "resume" });
    seedSnapshot(repos, {
      createdAt: "2026-05-01T00:00:00.000Z",
      dimensions: { signal: 40, evidence: 40, visibility: 40, narrative: 40 },
      dominantFailureMode: "low signal",
      nextRecommendedWorkflow: "bb-current-state",
      artifactVersionIds: [resumeVersion],
    });
    seedSnapshot(repos, {
      createdAt: "2026-05-02T00:00:00.000Z",
      dimensions: { signal: 50, evidence: 40, visibility: 50, narrative: 40 },
      dominantFailureMode: "low evidence",
      nextRecommendedWorkflow: "bb-linkedin",
      artifactVersionIds: [resumeVersion],
    });

    const result = runProgressComparison({ repos, limit: 4 });

    assert.strictEqual(result.comparisonWindow.mode, "recent_fallback");
    assert.strictEqual(result.comparisonWindow.roleFamilyTarget, "senior-backend-engineer");
    assert.ok(result.comparisonWindow.snapshotCount >= 2);

    testDb.close();
  });

  it("derives workflow inheritance and surface events from trigger + version ownership", () => {
    const testDb = createTestDb();
    const repos = createRepositories(testDb.db);

    const githubVersion = seedArtifactWithVersion(repos, { artifactType: "github_profile", sourceLabel: "gh" });
    const websiteVersion = seedArtifactWithVersion(repos, { artifactType: "website", sourceLabel: "site" });

    seedSnapshot(repos, {
      createdAt: "2026-05-01T00:00:00.000Z",
      dimensions: { signal: 50, evidence: 50, visibility: 50, narrative: 50 },
      dominantFailureMode: "low evidence",
      nextRecommendedWorkflow: "bb-linkedin",
      artifactVersionIds: [githubVersion],
    });

    seedSnapshot(repos, {
      createdAt: "2026-05-02T00:00:00.000Z",
      triggerReason: "new_role_target",
      dimensions: { signal: 60, evidence: 62, visibility: 60, narrative: 60 },
      dominantFailureMode: "low evidence",
      nextRecommendedWorkflow: "bb-role-fit",
      artifactVersionIds: [githubVersion, websiteVersion],
    });

    const result = runProgressComparison({ repos, limit: 6 });

    assert.strictEqual(result.recommendedNextWorkflow, "bb-role-fit");
    assert.ok(result.surfaceEvents.includes("Role target changed"));
    assert.ok(result.surfaceEvents.includes("GitHub proof artifact updated"));
    assert.ok(result.surfaceEvents.includes("Website artifact updated"));

    testDb.close();
  });
});

describe("runProgressComparison — delta provenance (Phase 4)", () => {
  const { runProgressComparison } = require("../progress/comparison.js");

  it("result has provenance with inputs, rules, and trace when snapshots exist", () => {
    const { db: testDb, repos: testRepos } = require("./helpers.js").createTestDb();
    const repos = require("../memory/repository.js").createRepositories(testDb);

    // Helper to create snapshots
    function makeSnapshot(overrides) {
      const snapshotId = require("crypto").randomUUID();
      repos.snapshots.create({
        snapshot_id: snapshotId,
        trigger_reason: "manual_request",
        profile_state: JSON.stringify({ overview: "test" }),
        dimension_summary: { signal: overrides.signal || 50, evidence: 50, visibility: 40, narrative: 45 },
        confidence: "medium",
        next_recommended_workflow: "bb-role-fit",
        artifact_version_ids: [],
        created_at: overrides.createdAt || new Date().toISOString(),
      });
      return snapshotId;
    }

    makeSnapshot({ signal: 60, createdAt: new Date(Date.now() - 1000).toISOString() });
    makeSnapshot({ signal: 50, createdAt: new Date(Date.now() - 60000).toISOString() });

    const result = runProgressComparison({ repos, limit: 6 });

    assert.ok(result.provenance, "result should have a provenance field");
    assert.ok(Array.isArray(result.provenance.inputs),
      "provenance.inputs should be an array");
    assert.ok(Array.isArray(result.provenance.rules),
      "provenance.rules should be an array");
    assert.ok(typeof result.provenance.trace === "string" && result.provenance.trace.length > 0,
      "provenance.trace should be a non-empty string");

    testDb.close();
  });

  it("provenance exists even when insufficient snapshots", () => {
    const { db: testDb } = require("./helpers.js").createTestDb();
    const repos = require("../memory/repository.js").createRepositories(testDb);

    // Only one snapshot — comparison not possible
    repos.snapshots.create({
      snapshot_id: require("crypto").randomUUID(),
      trigger_reason: "manual_request",
      profile_state: JSON.stringify({ overview: "test" }),
      dimension_summary: { signal: 50, evidence: 50, visibility: 40, narrative: 45 },
      confidence: "medium",
      next_recommended_workflow: "bb-role-fit",
      artifact_version_ids: [],
      created_at: new Date().toISOString(),
    });

    const result = runProgressComparison({ repos, limit: 6 });

    assert.ok(result.provenance, "provenance should exist even with insufficient snapshots");
    assert.ok(Array.isArray(result.provenance.inputs), "provenance.inputs should be an array");
    assert.ok(Array.isArray(result.provenance.rules), "provenance.rules should be an array");
    assert.ok(typeof result.provenance.trace === "string" && result.provenance.trace.length > 0);

    testDb.close();
  });
});
