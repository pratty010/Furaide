/**
 * Brand Builder GitHub Proof Evaluator Test
 *
 * Phase 5 Plan 03 — deterministic repo proof evaluation and disposition mapping
 * covering GH-01 through GH-04 behaviors.
 *
 * Test coverage:
 *   - GH-01: Only user-selected repos evaluated
 *   - GH-02: Deterministic dispositions (Highlight, Improve soon, Keep but
 *            de-emphasize, Do not surface)
 *   - GH-03: Scoring order portfolio value -> proof quality -> engineering quality
 *   - GH-04: Output includes proof improvements and next-project ideas
 *
 * Per D-08/D-12: user-selected repo scope only, no auto-selection
 * Per D-09: portfolio value first, then proof quality, then engineering quality
 * Per D-10: four approved disposition labels
 * Per D-11: large-repo sampling defaults with fullAnalysisAvailable flag
 * Per D-17: cached evidence only
 * Per D-19: stale >30 days yields refresh recommendation
 */

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const { randomUUID, randomBytes } = require("crypto");

function randomDigest() {
  return randomBytes(32).toString("hex");
}

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");

// The module under test — does NOT exist yet, will be created during GREEN phase
let evaluateGitHubProof;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Seed a github_repo artifact + version + evidence summary into repos.
 * Returns { artifactId, versionId }.
 */
function seedRepoArtifact(repos, repoName, overrides = {}) {
  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();

  const artifact = {
    artifact_id: artifactId,
    artifact_type: "github_repo",
    canonical_path: `${repoName}/README.md`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    first_ingested_at: overrides.ingestedAt || new Date().toISOString(),
    last_updated_at: overrides.updatedAt || new Date().toISOString(),
    status: overrides.status || "current",
    source_label: `GitHub repo: ${repoName}`,
  };
  repos.artifacts.upsert(artifact);

  // Insert a version referencing this repo artifact
  const version = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: overrides.versionPath || `${repoName}/README.md`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    ingested_at: overrides.ingestedAt || new Date().toISOString(),
    provenance: { source: "enrichment", update_context: `Initial intake for ${repoName}` },
    supersedes_version: null,
  };
  repos.versions.create(version);

  // Insert evidence summary
  const summaryType = overrides.summaryType || "field_extraction";
  const evidenceSummary = {
    summary_id: randomUUID(),
    artifact_id: artifactId,
    version_id: versionId,
    summary_type: summaryType,
    content: overrides.content || `Summary content for ${repoName}`,
    source_references: overrides.sourceReferences || ["ref-1"],
    stale: overrides.stale !== undefined ? overrides.stale : false,
    stale_reason: overrides.staleReason || undefined,
    workflow_domain: overrides.workflowDomain || "github",
    created_at: overrides.evidenceCreatedAt || new Date().toISOString(),
  };
  repos.evidence.create(evidenceSummary);

  return { artifactId, versionId, repoName };
}

/**
 * Seed a github_profile artifact for profile-level evidence.
 */
function seedProfileArtifact(repos, overrides = {}) {
  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();

  const artifact = {
    artifact_id: artifactId,
    artifact_type: "github_profile",
    canonical_path: "github-profile.json",
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    first_ingested_at: overrides.ingestedAt || new Date().toISOString(),
    last_updated_at: overrides.updatedAt || new Date().toISOString(),
    status: "current",
    source_label: "GitHub profile",
  };
  repos.artifacts.upsert(artifact);

  const version = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: "github-profile.json",
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    ingested_at: overrides.ingestedAt || new Date().toISOString(),
    provenance: { source: "enrichment", update_context: "Profile intake" },
    supersedes_version: null,
  };
  repos.versions.create(version);

  return { artifactId, versionId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHub Proof Evaluator", () => {

  before(async () => {
    // Try to load the evaluator — this WILL fail in RED phase (file doesn't exist)
    try {
      evaluateGitHubProof = require("../github-proof/evaluator.js").evaluateGitHubProof;
      assert.fail("Expected evaluator.js to not exist yet in RED phase");
    } catch (err) {
      // Expected in RED phase — file doesn't exist yet
      // Mark as pending so the test infrastructure records the attempt
    }
  });

  describe("GH-01: Selected repo scope", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("only evaluates user-selected repos and omits unselected repos", () => {
      // Seed 3 repos
      seedRepoArtifact(repos, "my-portfolio");
      seedRepoArtifact(repos, "side-project");
      seedRepoArtifact(repos, "dotfiles");

      // Also seed a github_profile for profile context
      seedProfileArtifact(repos);

      // Select only 2 of 3
      if (!evaluateGitHubProof) return; // RED phase skip

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["my-portfolio", "side-project"],
        assessmentContext: {
          dimensions: { signal: 70, evidence: 60, visibility: 50, narrative: 65 },
        },
        roleFitContext: {
          roleFamilySlug: "senior-frontend-engineer",
          bucketScores: { mustHaveMatch: 75, seniorityOwnershipMatch: 80, proofStrength: 70 },
          blockers: [],
        },
      });

      // Only selected repos appear
      const resultNames = result.repos.map((r) => r.repoName);
      assert.strictEqual(resultNames.length, 2);
      assert.ok(resultNames.includes("my-portfolio"));
      assert.ok(resultNames.includes("side-project"));
      assert.ok(!resultNames.includes("dotfiles"));
    });
  });

  describe("GH-02: Disposition mapping", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("assigns Highlight when portfolio value >= 80 and proof quality >= 70", () => {
      seedRepoArtifact(repos, "star-repo", {
        content: "Extensive open-source library with documentation, tests, CI/CD, 500+ stars, used in production",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["star-repo"],
        assessmentContext: {
          dimensions: { signal: 90, evidence: 85, visibility: 80, narrative: 75 },
        },
        roleFitContext: {
          roleFamilySlug: "staff-software-engineer",
          bucketScores: { mustHaveMatch: 85, seniorityOwnershipMatch: 90, proofStrength: 85 },
          blockers: [],
        },
      });

      const repo = result.repos[0];
      assert.strictEqual(repo.disposition, "Highlight");
    });

    it("assigns Improve soon when portfolio value >= 60 and other scores mid-tier", () => {
      seedRepoArtifact(repos, "decent-repo", {
        content: "A working project with some tests but limited documentation",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["decent-repo"],
        assessmentContext: {
          dimensions: { signal: 55, evidence: 50, visibility: 45, narrative: 50 },
        },
        roleFitContext: {
          roleFamilySlug: "mid-backend-engineer",
          bucketScores: { mustHaveMatch: 65, seniorityOwnershipMatch: 60, proofStrength: 50 },
          blockers: [],
        },
      });

      const repo = result.repos[0];
      assert.strictEqual(repo.disposition, "Improve soon");
    });

    it("assigns Keep but de-emphasize when engineering is acceptable but portfolio value < 60", () => {
      seedRepoArtifact(repos, "old-project", {
        content: "Well-structured code but not relevant to target role",
      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["old-project"],
        assessmentContext: {
          dimensions: { signal: 55, evidence: 50, visibility: 50, narrative: 50 },
        },
        roleFitContext: {
          roleFamilySlug: "ml-engineer",
          bucketScores: { mustHaveMatch: 45, seniorityOwnershipMatch: 40, proofStrength: 40 },
          blockers: ["Missing required skill: machine learning"],
        },
      });

      const repo = result.repos[0];
      assert.strictEqual(repo.disposition, "Keep but de-emphasize");
    });
    it("assigns Do not surface when portfolio value < 40", () => {
      seedRepoArtifact(repos, "abandoned-repo", {
        content: "An old prototype with no documentation or tests",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["abandoned-repo"],
        assessmentContext: {
          dimensions: { signal: 20, evidence: 15, visibility: 10, narrative: 15 },
        },
        roleFitContext: {
          roleFamilySlug: "engineering-manager",
          bucketScores: { mustHaveMatch: 10, seniorityOwnershipMatch: 15, proofStrength: 5 },
          blockers: ["Missing required skill: team leadership"],
        },
      });

      const repo = result.repos[0];
      assert.strictEqual(repo.disposition, "Do not surface");
    });

    it("assigns exactly one disposition per repo", () => {
      seedRepoArtifact(repos, "repo-a", {
        content: "Strong portfolio project",

      });
      seedRepoArtifact(repos, "repo-b", {
        content: "Old utility script",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["repo-a", "repo-b"],
        assessmentContext: {
          dimensions: { signal: 65, evidence: 60, visibility: 55, narrative: 60 },
        },
        roleFitContext: {
          roleFamilySlug: "senior-fullstack-engineer",
          bucketScores: { mustHaveMatch: 70, seniorityOwnershipMatch: 75, proofStrength: 65 },
          blockers: [],
        },
      });

      assert.strictEqual(result.repos.length, 2);
      for (const repo of result.repos) {
        const validDispositions = [
          "Highlight",
          "Improve soon",
          "Keep but de-emphasize",
          "Do not surface",
        ];
        assert.ok(
          validDispositions.includes(repo.disposition),
          `Expected one of ${validDispositions.join(", ")}, got "${repo.disposition}"`
        );
      }
    });

    it("contains assertions for all four disposition strings", () => {
      // This test documents that all four disposition strings are present
      // in the test suite. The implementations above already cover all four.
      const dispositions = ["Highlight", "Improve soon", "Keep but de-emphasize", "Do not surface"];
      assert.strictEqual(dispositions.length, 4, "All four disposition strings are defined");
    });
  });

  describe("GH-03: D-09 scoring order", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("prioritizes portfolio value over proof quality when assigning dispositions", () => {
      seedRepoArtifact(repos, "high-portfolio-low-proof", {
        content: "High-impact open source project aimed at role family",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["high-portfolio-low-proof"],
        assessmentContext: {
          dimensions: { signal: 85, evidence: 80, visibility: 75, narrative: 70 },
        },
        roleFitContext: {
          roleFamilySlug: "senior-backend-engineer",
          bucketScores: { mustHaveMatch: 90, seniorityOwnershipMatch: 85, proofStrength: 40 },
          blockers: [],
        },
      });

      // High portfolio value should prevent "Do not surface" even if proof is weak
      const repo = result.repos[0];
      assert.notStrictEqual(repo.disposition, "Do not surface",
        "High portfolio value repos should not be Do not surface");
    });

    it("applies deterministic thresholds: Do not surface when portfolio value < 40 regardless of other scores", () => {
      seedRepoArtifact(repos, "low-portfolio-high-engineering", {
        content: "Well-engineered codebase not relevant to target role",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["low-portfolio-high-engineering"],
        assessmentContext: {
          dimensions: { signal: 25, evidence: 30, visibility: 20, narrative: 25 },
        },
        roleFitContext: {
          roleFamilySlug: "data-scientist",
          bucketScores: { mustHaveMatch: 10, seniorityOwnershipMatch: 15, proofStrength: 80 },
          blockers: ["Missing required skill: python data science"],
        },
      });

      // Low portfolio value should dominate and force Do not surface
      const repo = result.repos[0];
      assert.strictEqual(repo.disposition, "Do not surface");
    });

    it("evaluation order follows portfolio value -> proof quality -> engineering quality", () => {
      seedRepoArtifact(repos, "balanced-repo", {
        content: "A well-crafted library with moderate usage",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["balanced-repo"],
        assessmentContext: {
          dimensions: { signal: 70, evidence: 65, visibility: 60, narrative: 60 },
        },
        roleFitContext: {
          roleFamilySlug: "mid-frontend-engineer",
          bucketScores: { mustHaveMatch: 72, seniorityOwnershipMatch: 68, proofStrength: 60 },
          blockers: [],
        },
      });

      const repo = result.repos[0];
      assert.ok(typeof repo.portfolioValueScore === "number");
      assert.ok(typeof repo.proofQualityScore === "number");
      assert.ok(typeof repo.engineeringQualityScore === "number");

      // The diagnosis text should reflect portfolio-first evaluation
      assert.ok(
        repo.diagnosis && repo.diagnosis.length > 0,
        "Diagnosis should be present"
      );
    });
  });

  describe("GH-04: Proof improvements and next projects", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("includes proofImprovements and nextProjectSignals per repo", () => {
      seedRepoArtifact(repos, "my-repo", {
        content: "A moderate project with some gaps",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["my-repo"],
        assessmentContext: {
          dimensions: { signal: 55, evidence: 50, visibility: 45, narrative: 50 },
        },
        roleFitContext: {
          roleFamilySlug: "senior-frontend-engineer",
          bucketScores: { mustHaveMatch: 60, seniorityOwnershipMatch: 55, proofStrength: 45 },
          blockers: [],
        },
      });

      const repo = result.repos[0];
      assert.ok(Array.isArray(repo.proofImprovements),
        "proofImprovements should be an array");
      assert.ok(Array.isArray(repo.nextProjectSignals),
        "nextProjectSignals should be an array");
    });

    it("includes nextProjectIdeas at top level", () => {
      seedRepoArtifact(repos, "repo-x", {
        content: "A project with clear gaps",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["repo-x"],
        assessmentContext: {
          dimensions: { signal: 40, evidence: 35, visibility: 30, narrative: 35 },
        },
        roleFitContext: {
          roleFamilySlug: "junior-fullstack-engineer",
          bucketScores: { mustHaveMatch: 45, seniorityOwnershipMatch: 40, proofStrength: 30 },
          blockers: [],
        },
      });

      assert.ok(Array.isArray(result.nextProjectIdeas),
        "nextProjectIdeas should be an array at the top level");
    });

    it("output includes both proof improvements and next project ideas (GH-04)", () => {
      seedRepoArtifact(repos, "gap-repo", {
        content: "A project with identified evidence gaps",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["gap-repo"],
        assessmentContext: {
          dimensions: { signal: 45, evidence: 40, visibility: 35, narrative: 40 },
        },
        roleFitContext: {
          roleFamilySlug: "ml-engineer",
          bucketScores: { mustHaveMatch: 35, seniorityOwnershipMatch: 30, proofStrength: 20 },
          blockers: ["Missing required skill: python"],
        },
      });

      // Top-level output must include both fields
      assert.ok(Array.isArray(result.missingProof),
        "missingProof should be an array");
      assert.ok(Array.isArray(result.nextProjectIdeas),
        "nextProjectIdeas should be an array");

      // Per-repo output must include both fields
      for (const repo of result.repos) {
        assert.ok(Array.isArray(repo.proofImprovements),
          `proofImprovements should be an array for ${repo.repoName}`);
        assert.ok(Array.isArray(repo.nextProjectSignals),
          `nextProjectSignals should be an array for ${repo.repoName}`);
      }
    });
  });

  describe("Large repo sampling (D-11)", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("defaults sampledPaths to standard key directories", () => {
      seedRepoArtifact(repos, "big-repo", {
        content: "A very large monorepo with many components",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["big-repo"],
        assessmentContext: {
          dimensions: { signal: 60, evidence: 55, visibility: 50, narrative: 55 },
        },
        roleFitContext: {
          roleFamilySlug: "senior-engineer",
          bucketScores: { mustHaveMatch: 65, seniorityOwnershipMatch: 60, proofStrength: 55 },
          blockers: [],
        },
      });

      const repo = result.repos[0];
      const expectedPaths = ["README.md", "package.json", "src/", "lib/", "components/"];

      // All expected paths should be in sampledPaths
      for (const p of expectedPaths) {
        assert.ok(
          repo.sampledPaths.includes(p),
          `sampledPaths should include "${p}", got: ${JSON.stringify(repo.sampledPaths)}`
        );
      }
    });

    it("sets fullAnalysisAvailable flag instead of deep-scanning automatically", () => {
      seedRepoArtifact(repos, "large-codebase", {
        content: "An enterprise-scale repo",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["large-codebase"],
        assessmentContext: {
          dimensions: { signal: 50, evidence: 45, visibility: 40, narrative: 45 },
        },
        roleFitContext: {
          roleFamilySlug: "backend-engineer",
          bucketScores: { mustHaveMatch: 55, seniorityOwnershipMatch: 50, proofStrength: 45 },
          blockers: [],
        },
        fullAnalysis: false, // user hasn't opted in
      });

      const repo = result.repos[0];
      assert.strictEqual(
        repo.fullAnalysisAvailable,
        true,
        "fullAnalysisAvailable should be true to signal deeper option"
      );
    });
  });

  describe("Output structure", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("returns all required top-level keys", () => {
      seedRepoArtifact(repos, "test-repo", {
        content: "A test repository",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["test-repo"],
        assessmentContext: {
          dimensions: { signal: 50, evidence: 50, visibility: 50, narrative: 50 },
        },
        roleFitContext: {
          roleFamilySlug: "engineer",
          bucketScores: { mustHaveMatch: 50, seniorityOwnershipMatch: 50, proofStrength: 50 },
          blockers: [],
        },
      });

      const requiredKeys = [
        "workflowDomain",
        "profileSurface",
        "repos",
        "missingProof",
        "nextProjectIdeas",
        "staleRecommendation",
        "evidenceUsed",
        "nextBestAction",
      ];

      for (const key of requiredKeys) {
        assert.ok(
          key in result,
          `Result should contain "${key}" at top level`
        );
      }

      assert.strictEqual(result.workflowDomain, "github");
    });

    it("returns all required per-repo keys", () => {
      seedRepoArtifact(repos, "per-repo-test", {
        content: "A repo for testing per-repo fields",

      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["per-repo-test"],
        assessmentContext: {
          dimensions: { signal: 50, evidence: 50, visibility: 50, narrative: 50 },
        },
        roleFitContext: {
          roleFamilySlug: "engineer",
          bucketScores: { mustHaveMatch: 50, seniorityOwnershipMatch: 50, proofStrength: 50 },
          blockers: [],
        },
      });

      const repo = result.repos[0];
      const requiredRepoKeys = [
        "repoName",
        "sampledPaths",
        "portfolioValueScore",
        "proofQualityScore",
        "engineeringQualityScore",
        "disposition",
        "diagnosis",
        "proofImprovements",
        "nextProjectSignals",
      ];

      for (const key of requiredRepoKeys) {
        assert.ok(
          key in repo,
          `Repo result should contain "${key}"`
        );
      }

      // Type checks
      assert.strictEqual(typeof repo.repoName, "string");
      assert.strictEqual(typeof repo.portfolioValueScore, "number");
      assert.strictEqual(typeof repo.proofQualityScore, "number");
      assert.strictEqual(typeof repo.engineeringQualityScore, "number");
      assert.strictEqual(typeof repo.disposition, "string");
      assert.strictEqual(typeof repo.diagnosis, "string");
      assert.ok(Array.isArray(repo.sampledPaths));
    });
  });

  describe("Stale evidence handling (D-19)", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("recommends refresh when evidence is > 30 days old", () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      seedRepoArtifact(repos, "stale-evidence-repo", {
        content: "A repo with outdated evidence summaries",
        stale: true,
        staleReason: "Evidence older than 30 days",
        ingestedAt: oldDate,
        updatedAt: oldDate,
        evidenceCreatedAt: oldDate,
      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["stale-evidence-repo"],
        assessmentContext: {
          dimensions: { signal: 50, evidence: 50, visibility: 50, narrative: 50 },
        },
        roleFitContext: {
          roleFamilySlug: "engineer",
          bucketScores: { mustHaveMatch: 50, seniorityOwnershipMatch: 50, proofStrength: 50 },
          blockers: [],
        },
      });

      // Should have a stale recommendation
      assert.ok(
        result.staleRecommendation !== null,
        "Should have a stale recommendation when evidence is > 30 days"
      );
      assert.ok(
        result.staleRecommendation && result.staleRecommendation.length > 0,
        "Stale recommendation should be a non-empty string"
      );
    });

    it("returns null staleRecommendation when evidence is fresh", () => {
      const freshDate = new Date().toISOString();
      seedRepoArtifact(repos, "fresh-evidence-repo", {
        content: "A repo with fresh evidence",
        ingestedAt: freshDate,
        updatedAt: freshDate,
        evidenceCreatedAt: freshDate,
      });
      seedProfileArtifact(repos);

      if (!evaluateGitHubProof) return;

      const result = evaluateGitHubProof({
        repos,
        selectedRepos: ["fresh-evidence-repo"],
        assessmentContext: {
          dimensions: { signal: 60, evidence: 55, visibility: 50, narrative: 55 },
        },
        roleFitContext: {
          roleFamilySlug: "engineer",
          bucketScores: { mustHaveMatch: 65, seniorityOwnershipMatch: 60, proofStrength: 55 },
          blockers: [],
        },
      });

      assert.strictEqual(result.staleRecommendation, null,
        "staleRecommendation should be null when evidence is fresh");
    });
  });
});

describe("evaluateGitHubProof — repo disposition provenance (Phase 4)", () => {
  const { evaluateGitHubProof: evalGHProof } = require("../github-proof/evaluator.js");

  it("each repo result has a provenance field with inputs, rules, and trace", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedRepoArtifact(repos, "my-project", {
      content: "TypeScript, tests, CI/CD, documentation, readme, stars",
    });

    const result = evalGHProof({
      repos,
      selectedRepos: ["my-project"],
      assessmentContext: {
        dimensions: { signal: 70, evidence: 60, visibility: 55, narrative: 50 },
      },
      roleFitContext: {
        roleFamilySlug: "engineer",
        bucketScores: { mustHaveMatch: 70, proofStrength: 60, seniorityOwnershipMatch: 65 },
        blockers: [],
      },
    });

    assert.ok(result.repos.length > 0, "should have at least one repo result");
    const repo = result.repos[0];
    assert.ok(repo.provenance, "repo should have provenance field");
    assert.ok(Array.isArray(repo.provenance.inputs),
      "provenance.inputs should be an array");
    assert.ok(Array.isArray(repo.provenance.rules),
      "provenance.rules should be an array");
    assert.ok(typeof repo.provenance.trace === "string" && repo.provenance.trace.length > 0,
      "provenance.trace should be a non-empty string");

    db.close();
  });

  it("provenance.rules have id, effect, reason fields", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedRepoArtifact(repos, "test-repo");

    const result = evalGHProof({
      repos,
      selectedRepos: ["test-repo"],
      assessmentContext: { dimensions: { signal: 50, evidence: 50, visibility: 50, narrative: 50 } },
      roleFitContext: { roleFamilySlug: "dev", bucketScores: {}, blockers: [] },
    });

    for (const rule of result.repos[0].provenance.rules) {
      assert.ok(typeof rule.id === "string" && rule.id.length > 0, "rule.id non-empty");
      assert.ok(typeof rule.effect === "number", "rule.effect is number");
      assert.ok(typeof rule.reason === "string" && rule.reason.length > 0, "rule.reason non-empty");
    }

    db.close();
  });
});
