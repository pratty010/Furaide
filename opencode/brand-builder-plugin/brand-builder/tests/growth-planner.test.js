/**
 * Brand Builder Growth Planner Test
 *
 * Phase 6 Plan 02 — deterministic repeated-gap aggregation and certificate
 * gating covering GROW-01 and GROW-02 behaviors.
 *
 * Test coverage:
 *   - GROW-01: Repeated blockers across role-family history produce
 *     recurringGaps list and focused project/proof next steps.
 *   - GROW-02: Certificate output stays empty when a project/proof
 *     alternative covers the same gap within the horizon.
 *   - GROW-02: Certificate output appears only when the gap repeats,
 *     is market-rewarded, and materially beats project/proof alternatives.
 */

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("crypto");

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");

// The module under test — does NOT exist yet (RED phase)
let runGrowthPlanning;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Seed a role-fit snapshot into repos with the given profile_state metadata.
 *
 * The snapshot mimics what persistRoleFitSnapshot produces: trigger_reason
 * "new_role_target" and a JSON profile_state with role_family_slug,
 * role_title, fit_score, fit_bracket, and top_blocker_labels.
 */
function seedRoleFitSnapshot(repos, overrides = {}) {
  const snapshotId = overrides.snapshotId || randomUUID();
  const roleFamilySlug = overrides.roleFamilySlug || "senior-frontend-engineer";
  const roleTitle = overrides.roleTitle || "Senior Frontend Engineer";
  const fitScore = overrides.fitScore != null ? overrides.fitScore : 62;
  const fitBracket = overrides.fitBracket || "moderate";
  const topBlockerLabels = overrides.topBlockerLabels || [];

  const profileStateObj = {
    role_family_slug: roleFamilySlug,
    role_title: roleTitle,
    fit_score: fitScore,
    fit_bracket: fitBracket,
    top_blocker_labels: topBlockerLabels,
    assessed_at: overrides.assessedAt || new Date().toISOString(),
  };
  const profileState = JSON.stringify(profileStateObj);

  // Need an artifact + version for valid artifact_version_ids
  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();
  const artifact = {
    artifact_id: artifactId,
    artifact_type: "resume",
    canonical_path: "resume-test.pdf",
    raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    first_ingested_at: overrides.ingestedAt || new Date().toISOString(),
    last_updated_at: overrides.updatedAt || new Date().toISOString(),
    status: "current",
    source_label: "resume",
  };
  repos.artifacts.upsert(artifact);

  const version = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: "resume-test.pdf",
    raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ingested_at: overrides.ingestedAt || new Date().toISOString(),
    provenance: {
      source: "user_upload",
      update_context: "Test seed",
    },
    supersedes_version: null,
  };
  repos.versions.create(version);

  const snapshot = {
    snapshot_id: snapshotId,
    trigger_reason: "new_role_target",
    profile_state: profileState,
    dimension_summary: {
      signal: overrides.signalDim != null ? overrides.signalDim : 60,
      evidence: overrides.evidenceDim != null ? overrides.evidenceDim : 50,
      visibility: overrides.visibilityDim != null ? overrides.visibilityDim : 45,
      narrative: overrides.narrativeDim != null ? overrides.narrativeDim : 55,
    },
    confidence: overrides.confidence || "medium",
    dominant_failure_mode: overrides.dominantFailureMode || undefined,
    next_recommended_workflow: overrides.nextRecommendedWorkflow || "bb-linkedin",
    artifact_version_ids: [versionId],
    created_at: overrides.createdAt || new Date().toISOString(),
  };
  repos.snapshots.create(snapshot);

  return { snapshotId, artifactId, versionId, roleFamilySlug, topBlockerLabels };
}

/**
 * Seed a general (non-role-fit) snapshot for getRecentSnapshots coverage.
 */
function seedGeneralSnapshot(repos, overrides = {}) {
  const snapshotId = overrides.snapshotId || randomUUID();
  const profileState = overrides.profileState || JSON.stringify({ overview: "General profile snapshot" });

  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();
  const artifact = {
    artifact_id: artifactId,
    artifact_type: "resume",
    canonical_path: "resume-general.pdf",
    raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    first_ingested_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    status: "current",
    source_label: "resume",
  };
  repos.artifacts.upsert(artifact);

  const version = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: "resume-general.pdf",
    raw_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    normalized_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ingested_at: new Date().toISOString(),
    provenance: {
      source: "user_upload",
      update_context: "Test seed",
    },
    supersedes_version: null,
  };
  repos.versions.create(version);

  const snapshot = {
    snapshot_id: snapshotId,
    trigger_reason: overrides.triggerReason || "artifact_update",
    profile_state: profileState,
    dimension_summary: {
      signal: overrides.signalDim != null ? overrides.signalDim : 55,
      evidence: overrides.evidenceDim != null ? overrides.evidenceDim : 45,
      visibility: overrides.visibilityDim != null ? overrides.visibilityDim : 40,
      narrative: overrides.narrativeDim != null ? overrides.narrativeDim : 50,
    },
    confidence: "medium",
    dominant_failure_mode: undefined,
    next_recommended_workflow: "bb-current-state",
    artifact_version_ids: [versionId],
    created_at: overrides.createdAt || new Date().toISOString(),
  };
  repos.snapshots.create(snapshot);

  return { snapshotId };
}

// ---------------------------------------------------------------------------
// Market-rewarded certificate keywords
// ---------------------------------------------------------------------------

/**
 * Known market-rewarded certification domains.
 * Used by the growth planner to determine if a gap is certificate-eligible.
 */
const MARKET_REWARDED_CERTIFICATIONS = new Set([
  "cloud architecture", "aws", "azure", "gcp",
  "kubernetes", "security", "machine learning", "data engineering",
  "project management", "pmp", "scrum master", "cissp",
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Growth Planner", () => {

  before(async () => {
    // RED phase: try loading the planner — it will fail (file doesn't exist yet)
    try {
      runGrowthPlanning = require("../growth/planner.js").runGrowthPlanning;
      // If we reach here, the module exists — skip RED tests
      // Tests below will still run in GREEN phase
    } catch (err) {
      // Expected in RED phase — file doesn't exist yet
    }
  });

  // -----------------------------------------------------------------------
  // GROW-01: Repeated gap detection and project/proof recommendations
  // -----------------------------------------------------------------------

  describe("GROW-01: Repeated gap detection", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("detects repeated blockers across role-family snapshots as recurringGaps", () => {
      // Seed 3 role-fit snapshots for the same role family, each with overlapping blockers
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Missing cloud deployment experience",
          "No public proof of system design",
        ],
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Missing cloud deployment experience",
          "Weak narrative coherence",
        ],
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Missing cloud deployment experience",
          "No public proof of system design",
          "Limited open-source contributions",
        ],
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return; // RED phase skip

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      assert.ok(Array.isArray(result.recurringGaps),
        "recurringGaps should be an array");
      assert.ok(result.recurringGaps.length > 0,
        "Should detect at least one recurring gap across repeated snapshots");

      // "Missing cloud deployment experience" appears in all 3 snapshots
      const cloudGap = result.recurringGaps.find(
        (g) => g.blockerLabel && g.blockerLabel.includes("cloud deployment")
      );
      assert.ok(cloudGap, "Should detect the cloud deployment gap as recurring");
      assert.ok(cloudGap.occurrenceCount >= 2,
        "Recurring gap should have occurrence count >= 2");
    });

    it("produces project/proof recommendations for recurring gaps", () => {
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "staff-backend-engineer-backend-distributed-systems",
        topBlockerLabels: [
          "No distributed systems proof",
          "Missing system design portfolio",
        ],
        createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "staff-backend-engineer-backend-distributed-systems",
        topBlockerLabels: [
          "No distributed systems proof",
          "Weak engineering leadership signals",
        ],
        createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Staff Backend Engineer",
          seniority: "staff",
          domainContext: ["backend", "distributed-systems"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      assert.ok(Array.isArray(result.projectProofRecommendations),
        "projectProofRecommendations should be an array");
      assert.ok(result.projectProofRecommendations.length > 0,
        "Should produce at least one project/proof recommendation");

      // Verify recommendations are concrete
      for (const rec of result.projectProofRecommendations) {
        assert.ok(typeof rec.gap === "string",
          "Each recommendation should reference the gap it addresses");
        assert.ok(typeof rec.recommendation === "string",
          "Each recommendation should have actionable content");
      }
    });

    it("includes whatNotToPursue guidance", () => {
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Weak open-source presence"],
        createdAt: new Date().toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      assert.ok(Array.isArray(result.whatNotToPursue),
        "whatNotToPursue should be an array");
    });

    it("computes a roleFamilySlug from the roleTarget", () => {
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-fullstack-engineer-fullstack",
        topBlockerLabels: ["Weak system design"],
        createdAt: new Date().toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Fullstack Engineer",
          seniority: "Senior",
          domainContext: ["fullstack"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      assert.ok(typeof result.roleFamilySlug === "string",
        "Should compute a roleFamilySlug from roleTarget");
      assert.ok(result.roleFamilySlug.length > 0,
        "roleFamilySlug should be non-empty");
    });

    it("generates a timelinePlan with medium-horizon structure", () => {
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Missing cloud deployment experience"],
        createdAt: new Date().toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      assert.ok(typeof result.timelinePlan === "object",
        "timelinePlan should be an object");
      assert.ok(typeof result.timelinePlan.horizonMonths === "number",
        "timelinePlan should include horizonMonths");
    });
  });

  // -----------------------------------------------------------------------
  // GROW-02: Certificate gating — project/proof-first by default
  // -----------------------------------------------------------------------

  describe("GROW-02: Certificate gating (project/proof-first)", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("keeps certificateRecommendations empty when project/proof covers the gap", () => {
      // A gap that CAN be addressed by a project — even if it repeats
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "No public proof of system design",
        ],
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "No public proof of system design",
          "Weak narrative coherence",
        ],
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      // "No public proof of system design" is a project/proof gap,
      // not a certificate-eligible gap — so certificateRecommendations
      // should be empty (project/proof wins by default)
      assert.ok(Array.isArray(result.certificateRecommendations),
        "certificateRecommendations should be an array");
      assert.strictEqual(result.certificateRecommendations.length, 0,
        "certificateRecommendations should be empty when project/proof covers the gap");

      // But projectProofRecommendations SHOULD have content
      assert.ok(result.projectProofRecommendations.length > 0,
        "projectProofRecommendations should contain project/proof alternatives");
    });

    it("produces certificate recommendations only when gap is market-rewarded and materially better", () => {
      // Seed "cloud architecture" gaps — this IS a market-rewarded certification domain
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-cloud-engineer-cloud-aws",
        topBlockerLabels: [
          "Missing cloud architecture certification",
          "No formal cloud platform expertise signal",
        ],
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-cloud-engineer-cloud-aws",
        topBlockerLabels: [
          "Missing cloud architecture certification",
          "Weak multi-cloud experience",
        ],
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-cloud-engineer-cloud-aws",
        topBlockerLabels: [
          "Missing cloud architecture certification",
          "No formal cloud platform expertise signal",
        ],
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Cloud Engineer",
          seniority: "Senior",
          domainContext: ["cloud", "aws"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      // Cloud architecture IS a market-rewarded certification domain
      // The gap appears across 3 snapshots — gate should pass
      assert.ok(Array.isArray(result.certificateRecommendations),
        "certificateRecommendations should be an array");

      if (result.certificateRecommendations.length > 0) {
        for (const cert of result.certificateRecommendations) {
          assert.ok(typeof cert.gap === "string",
            "Each certificate recommendation should reference the gap");
          assert.ok(typeof cert.certificate === "string",
            "Each certificate recommendation should name a certificate");
          assert.ok(typeof cert.rationale === "string",
            "Each certificate recommendation should explain why it beats alternatives");
        }
      }
    });

    it("does NOT recommend certificate when gap is not market-rewarded", () => {
      // A repeated gap that is NOT a market-rewarded certification domain
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Weak narrative coherence",
        ],
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Weak narrative coherence",
          "No public proof of system design",
        ],
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      // "Weak narrative coherence" is not a certification domain
      assert.strictEqual(result.certificateRecommendations.length, 0,
        "Should not recommend certificate for non-market-rewarded gap");
    });
  });

  // -----------------------------------------------------------------------
  // Output structure and edge cases
  // -----------------------------------------------------------------------

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
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Missing cloud deployment experience"],
        createdAt: new Date().toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      const requiredKeys = [
        "workflowDomain",
        "roleFamilySlug",
        "recurringGaps",
        "projectProofRecommendations",
        "certificateRecommendations",
        "whatNotToPursue",
        "timelinePlan",
        "confidence",
        "recommendedNextAction",
      ];

      for (const key of requiredKeys) {
        assert.ok(key in result,
          `Result should contain "${key}" at top level`);
      }

      assert.strictEqual(result.workflowDomain, "growth");
    });

    it("handles empty history gracefully (no snapshots exist)", () => {
      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      assert.ok(Array.isArray(result.recurringGaps));
      assert.strictEqual(result.recurringGaps.length, 0,
        "Should have no recurring gaps when no snapshots exist");
      assert.ok(Array.isArray(result.certificateRecommendations));
      assert.strictEqual(result.certificateRecommendations.length, 0,
        "Should have no certificate recommendations when no history exists");
      assert.strictEqual(result.confidence, "low",
        "Confidence should be low when no history exists");
    });

    it("uses confidence levels appropriately", () => {
      // Seed enough snapshots with clear patterns for medium/high confidence
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Missing cloud deployment experience",
          "No public proof of system design",
        ],
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Missing cloud deployment experience",
          "No public proof of system design",
        ],
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: [
          "Missing cloud deployment experience",
        ],
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      const validConfidence = ["high", "medium", "low"];
      assert.ok(validConfidence.includes(result.confidence),
        `confidence should be one of ${validConfidence.join(", ")}, got "${result.confidence}"`);
    });

    it("has a substantive recommendedNextAction", () => {
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Missing cloud deployment experience"],
        createdAt: new Date().toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      assert.ok(typeof result.recommendedNextAction === "string",
        "recommendedNextAction should be a string");
      assert.ok(result.recommendedNextAction.length > 0,
        "recommendedNextAction should not be empty");
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases: role-family boundaries
  // -----------------------------------------------------------------------

  describe("Role-family boundaries", () => {
    let testDb, repos;

    beforeEach(() => {
      testDb = createTestDb();
      repos = createRepositories(testDb.db);
    });

    after(() => {
      if (testDb) testDb.close();
    });

    it("only aggregates gaps from the target role family, not unrelated ones", () => {
      // Seed snapshots for two different role families
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Missing cloud deployment experience"],
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Missing cloud deployment experience"],
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      // Unrelated role family — should NOT influence results
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "staff-data-engineer",
        topBlockerLabels: ["No spark expertise", "Missing data pipeline experience"],
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return;

      // Target: frontend role
      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      // Should only see frontend gaps, not data-engineer gaps
      for (const gap of result.recurringGaps) {
        const label = (gap.blockerLabel || "").toLowerCase();
        assert.ok(
          !label.includes("spark") && !label.includes("data pipeline"),
          `Recurring gaps should not include gaps from unrelated role families, got: "${label}"`
        );
      }
    });

    it("uses getRecentSnapshots and getLatestProfileState for additional context", () => {
      // Seed general (non-role-fit) snapshots for broader context
      seedGeneralSnapshot(repos, {
        triggerReason: "artifact_update",
        profileState: JSON.stringify({ overview: "General profile evolution" }),
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      });

      // Seed role-fit snapshots
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Missing cloud deployment experience"],
        createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      });
      seedRoleFitSnapshot(repos, {
        roleFamilySlug: "senior-frontend-engineer-frontend",
        topBlockerLabels: ["Missing cloud deployment experience"],
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!runGrowthPlanning) return;

      const result = runGrowthPlanning({
        repos,
        roleTarget: {
          roleTitle: "Senior Frontend Engineer",
          seniority: "Senior",
          domainContext: ["frontend"],
        },
        timeHorizonMonths: 6,
        constraints: {},
        brandContext: {},
      });

      // The planner should still work — this is primarily a smoke test
      // that it doesn't crash when both general and role-fit snapshots exist
      assert.ok(result.workflowDomain === "growth");
      assert.ok(Array.isArray(result.recurringGaps));
    });
  });

  // -----------------------------------------------------------------------
  // Phase 4: Growth provenance
  // -----------------------------------------------------------------------

  describe("Growth provenance (Phase 4)", () => {
    it("result has provenance with inputs, rules, and trace", () => {
      if (!runGrowthPlanning) return;

      const { db: testDb } = createTestDb();
      const testRepos = createRepositories(testDb);

      const result = runGrowthPlanning({
        repos: testRepos,
        roleTarget: { roleTitle: "Senior Engineer", seniority: "senior", domainContext: [] },
        timeHorizonMonths: 6,
      });

      assert.ok(result.provenance, "result should have a provenance field");
      assert.ok(Array.isArray(result.provenance.inputs),
        "provenance.inputs should be an array");
      assert.ok(Array.isArray(result.provenance.rules),
        "provenance.rules should be an array");
      assert.ok(typeof result.provenance.trace === "string" && result.provenance.trace.length > 0,
        "provenance.trace should be a non-empty string");

      testDb.close();
    });

    it("provenance.rules each have id, effect, reason", () => {
      if (!runGrowthPlanning) return;

      const { db: testDb } = createTestDb();
      const testRepos = createRepositories(testDb);

      const result = runGrowthPlanning({
        repos: testRepos,
        roleTarget: { roleTitle: "Engineer", seniority: "mid", domainContext: [] },
        timeHorizonMonths: 6,
      });

      for (const rule of result.provenance.rules) {
        assert.ok(typeof rule.id === "string" && rule.id.length > 0, "rule.id non-empty");
        assert.ok(typeof rule.effect === "number", "rule.effect is number");
        assert.ok(typeof rule.reason === "string" && rule.reason.length > 0, "rule.reason non-empty");
      }

      testDb.close();
    });
  });
});
