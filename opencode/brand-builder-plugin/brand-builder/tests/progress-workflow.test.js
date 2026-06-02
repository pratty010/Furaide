const { describe, it } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("crypto");
const { readFileSync } = require("fs");

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");
const { runProgressComparison } = require("../progress/comparison.js");

function seedArtifactWithVersion(repos, artifactType) {
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
    source_label: artifactType,
  });

  repos.versions.create({
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: `${artifactType}-${versionId}.md`,
    raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ingested_at: now,
    provenance: { source: "user_upload", update_context: "progress-workflow-test" },
    supersedes_version: null,
  });

  return versionId;
}

function seedSnapshot(repos, payload) {
  repos.snapshots.create({
    snapshot_id: randomUUID(),
    trigger_reason: payload.triggerReason || "artifact_update",
    profile_state: JSON.stringify(payload.profileState || {}),
    dimension_summary: payload.dimensions,
    confidence: "medium",
    dominant_failure_mode: payload.dominantFailureMode,
    next_recommended_workflow: payload.nextRecommendedWorkflow,
    artifact_version_ids: payload.artifactVersionIds || [],
    created_at: payload.createdAt,
  });
}

function progressRedirectForNoHistory(result) {
  if (result.currentSnapshot) return null;
  return "bb-current-state";
}

describe("progress workflow contracts", () => {
  it("doc contracts align on progress_feedback and bb-progress worker-only routing", () => {
    const files = {
      agent: readFileSync(".opencode/agents/brand-builder.md", "utf8"),
      intent: readFileSync(".opencode/brand-builder/references/intent-routing.md", "utf8"),
      workflow: readFileSync(".opencode/brand-builder/workflows/workflow-command-routing.md", "utf8"),
      synthesis: readFileSync(".opencode/brand-builder/references/synthesis-and-clarification.md", "utf8"),
      command: readFileSync(".opencode/command/bb-progress.md", "utf8"),
    };

    assert.ok(files.intent.includes("progress_feedback"));
    assert.ok(files.intent.includes("bb-progress"));
    assert.ok(files.workflow.includes("| bb-progress | progress_feedback |"));
    assert.ok(files.command.includes("intent_id: progress_feedback"));
    assert.ok(files.agent.includes("<progress_feedback>"));
    assert.ok(files.synthesis.includes("## Progress Feedback Intake"));

    assert.ok(!files.intent.includes("progress_comparison"));
    assert.ok(!files.workflow.includes("progress_comparison"));
    assert.ok(!files.command.includes("progress_comparison"));

    const progressRow = files.intent
      .split("\n")
      .find((line) => line.includes("| progress_feedback |")) || "";
    assert.ok(!progressRow.includes("bb-diagnostician"));
  });

  it("runProgressComparison produces arrows, trend context, events, and latest recommended workflow", () => {
    const testDb = createTestDb();
    const repos = createRepositories(testDb.db);

    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: [],
      role_family_target: "senior-frontend-engineer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const roleFitVersion = seedArtifactWithVersion(repos, "job_description");
    const linkedinVersion = seedArtifactWithVersion(repos, "linkedin");
    const githubVersion = seedArtifactWithVersion(repos, "github_repo");

    seedSnapshot(repos, {
      createdAt: "2026-05-01T00:00:00.000Z",
      triggerReason: "new_role_target",
      dimensions: { signal: 45, evidence: 40, visibility: 35, narrative: 50 },
      dominantFailureMode: "low visibility",
      nextRecommendedWorkflow: "bb-role-fit",
      artifactVersionIds: [roleFitVersion],
    });

    seedSnapshot(repos, {
      createdAt: "2026-05-02T00:00:00.000Z",
      triggerReason: "approved_rewrite",
      dimensions: { signal: 52, evidence: 48, visibility: 55, narrative: 56 },
      dominantFailureMode: "low evidence",
      nextRecommendedWorkflow: "bb-linkedin",
      artifactVersionIds: [linkedinVersion],
    });

    seedSnapshot(repos, {
      createdAt: "2026-05-03T00:00:00.000Z",
      triggerReason: "artifact_update",
      dimensions: { signal: 64, evidence: 50, visibility: 66, narrative: 58 },
      dominantFailureMode: "light narrative",
      nextRecommendedWorkflow: "bb-github-proof",
      artifactVersionIds: [githubVersion],
    });

    const result = runProgressComparison({ repos, limit: 6 });

    assert.ok(result.arrows.signal.startsWith("↑"));
    assert.ok(result.arrows.visibility.startsWith("↑"));
    assert.strictEqual(result.arrows.narrative, "→");
    assert.ok(result.trend.length >= 3);
    assert.ok(["recent_fallback", "role_family"].includes(result.comparisonWindow.mode));
    assert.ok(Array.isArray(result.surfaceEvents));
    assert.strictEqual(result.recommendedNextWorkflow, "bb-github-proof");

    testDb.close();
  });

  it("no-history case redirects safely instead of fabricating comparison", () => {
    const testDb = createTestDb();
    const repos = createRepositories(testDb.db);

    const result = runProgressComparison({ repos, limit: 6 });

    assert.strictEqual(result.currentSnapshot, null);
    assert.strictEqual(result.previousSnapshot, null);
    assert.strictEqual(result.narrativeSummary.includes("Not enough snapshot history"), true);
    assert.strictEqual(progressRedirectForNoHistory(result), "bb-current-state");

    testDb.close();
  });
});
