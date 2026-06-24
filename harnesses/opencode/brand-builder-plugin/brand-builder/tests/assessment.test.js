/**
 * Brand Builder Assessment Contract Tests
 *
 * Covers ASSESS-01 through ASSESS-04 with D-01 through D-11 behavioral contracts.
 * Uses createTestDb() + repository seeding to construct realistic multi-artifact,
 * multi-evidence scenarios that exercise scoring, sufficiency penalty,
 * tie-breaking, confidence thresholds, and improvement ranking.
 *
 * The runAssessment import will fail until assessment.js is implemented —
 * this is the TDD RED phase.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const { randomUUID, randomBytes } = require("crypto");

/** Generate a valid 64-char hex digest for Zod validation. */
function randomDigest() {
  return randomBytes(32).toString("hex");
}

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");
const { runAssessment, persistAssessmentSnapshot } = require("../assess/assessment.js");

// ---------------------------------------------------------------------------
// Seed helpers (local to assessment tests — does not modify shared helpers)
// ---------------------------------------------------------------------------

/**
 * Seed an artifact + version + evidence summaries into repos for a single type.
 * Returns { artifact, version, summaryIds }.
 */
function seedArtifactWithEvidence(repos, artifactType, overrides = {}) {
  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();
  const status = overrides.status || "current";

  const artifact = {
    artifact_id: artifactId,
    artifact_type: artifactType,
    canonical_path: `${artifactType}-sample.pdf`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    first_ingested_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    status,
    source_label: `Test ${artifactType}`,
  };
  repos.artifacts.upsert(artifact);

  const version = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: `${artifactType}-sample.pdf`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    ingested_at: new Date().toISOString(),
    provenance: {
      source: "user_upload",
      update_context: `Test ${artifactType} upload`,
    },
    supersedes_version: null,
  };
  repos.versions.create(version);

  const summaryCount = overrides.summaryCount || 1;
  const summaryIds = [];
  const evidenceContent = overrides.evidenceContent || [
    `Extracted from ${artifactType}: skills=TypeScript,Python,React; experience=8 years; education=CS degree`,
  ];
  const summaryTypes = overrides.summaryTypes || ["field_extraction"];
  const staleFlags = overrides.staleFlags || [false];

  for (let i = 0; i < summaryCount; i++) {
    const summaryId = randomUUID();
    const summary = {
      summary_id: summaryId,
      artifact_id: artifactId,
      version_id: versionId,
      summary_type: summaryTypes[i] || "field_extraction",
      content: evidenceContent[i] || `Evidence #${i + 1} for ${artifactType}`,
      source_references: [`ref-${artifactType}-${i + 1}`],
      stale: staleFlags[i] !== undefined ? staleFlags[i] : false,
      stale_reason: staleFlags[i] ? "Artifact updated" : undefined,
      created_at: new Date().toISOString(),
    };
    repos.evidence.create(summary);
    summaryIds.push(summaryId);
  }

  return { artifact, version, summaryIds };
}

/**
 * Seed multiple artifact types with rich evidence for testing.
 */
function seedFullProfile(repos, types = ["resume", "linkedin", "github_profile"]) {
  const seeded = {};
  for (const rtype of types) {
    seeded[rtype] = seedArtifactWithEvidence(repos, rtype, { summaryCount: 2 });
  }
  return seeded;
}

/**
 * Create a snapshot in the repos for recency testing.
 */
function seedSnapshot(repos, overrides = {}) {
  const snapshotId = overrides.snapshotId || randomUUID();
  const snapshot = {
    snapshot_id: snapshotId,
    trigger_reason: overrides.triggerReason || "manual_request",
    profile_state: overrides.profileState || JSON.stringify({ overview: "test" }),
    dimension_summary: {
      signal: overrides.dimSignal ?? 0.65,
      evidence: overrides.dimEvidence ?? 0.50,
      visibility: overrides.dimVisibility ?? 0.40,
      narrative: overrides.dimNarrative ?? 0.55,
    },
    confidence: overrides.confidence || "medium",
    dominant_failure_mode: overrides.dominantFailureMode || undefined,
    next_recommended_workflow: overrides.nextRecWorkflow || "bb-current-state",
    artifact_version_ids: overrides.artifactVersionIds || [],
    created_at: overrides.createdAt || new Date().toISOString(),
  };
  repos.snapshots.create(snapshot);
  return snapshot;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAssessment — core scoring (ASSESS-01, ASSESS-02, D-01 through D-04)", () => {
  it("returns integer signal, evidence, visibility, narrative scores in 10-point increments", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed resume + LinkedIn with evidence
    seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: [
        "Skills: TypeScript, Python, React, Node.js, AWS; Experience: 8 years senior engineering",
        "Education: BS Computer Science, Stanford; Certifications: AWS Solutions Architect",
      ],
      summaryCount: 2,
      summaryTypes: ["field_extraction", "signal_assessment"],
    });
    seedArtifactWithEvidence(repos, "linkedin", {
      evidenceContent: [
        "LinkedIn profile: 500+ connections, active posts, clear headline and summary",
        "Endorsements: TypeScript (50+), React (40+), Leadership (30+)",
      ],
      summaryCount: 2,
      summaryTypes: ["field_extraction", "signal_assessment"],
    });

    const result = runAssessment({ repos });

    // D-01, D-02: scores are 0-100 integers
    for (const dim of ["signal", "evidence", "visibility", "narrative"]) {
      assert.ok(typeof result[dim] === "number", `${dim} should be a number`);
      assert.ok(Number.isInteger(result[dim]), `${dim} should be an integer`);
      assert.ok(result[dim] >= 0, `${dim} should be >= 0, got ${result[dim]}`);
      assert.ok(result[dim] <= 100, `${dim} should be <= 100, got ${result[dim]}`);
    }

    // D-04: scores are in 10-point intervals
    for (const dim of ["signal", "evidence", "visibility", "narrative"]) {
      assert.strictEqual(
        result[dim] % 10,
        0,
        `${dim} should be a multiple of 10, got ${result[dim]}`
      );
    }

    db.close();
  });

  it("depresses scores proportionally when artifact types are missing (D-03)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Only seed resume — 1 of 6 expected types present
    seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: [
        "Skills: TypeScript, Python, React; Experience: 8 years",
      ],
      summaryCount: 1,
      summaryTypes: ["field_extraction"],
    });

    const thinResult = runAssessment({ repos });

    // Now seed all 6 artifact types
    const { db: db2 } = createTestDb();
    const repos2 = createRepositories(db2);
    for (const rtype of ["resume", "linkedin", "github_profile", "github_repo", "website", "job_description"]) {
      seedArtifactWithEvidence(repos2, rtype, { summaryCount: 1 });
    }

    const richResult = runAssessment({ repos: repos2 });

    // D-03: missing artifacts should depress scores
    // Resume-only should have noticeably lower scores than full-profile
    const thinAvg =
      (thinResult.signal + thinResult.evidence + thinResult.visibility + thinResult.narrative) / 4;
    const richAvg =
      (richResult.signal + richResult.evidence + richResult.visibility + richResult.narrative) / 4;

    assert.ok(
      thinAvg < richAvg,
      `Resume-only average (${thinAvg}) should be lower than full-profile average (${richAvg})`
    );

    db.close();
    db2.close();
  });

  it("treats stale evidence as excluded from scoring (D-01, stale filtering)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed resume with: 1 non-stale, 2 stale summaries
    seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: [
        "Skills: TypeScript, Python — CURRENT",
        "Skills: JavaScript only — STALE",
        "Education: Bootcamp — STALE",
      ],
      summaryCount: 3,
      summaryTypes: ["field_extraction", "signal_assessment", "surface_snapshot"],
      staleFlags: [false, true, true],
    });

    const result = runAssessment({ repos });

    // Scores should reflect only the non-stale evidence
    assert.ok(result.signal >= 0 && result.signal <= 100);
    // Since we only have 1 non-stale evidence from 1 artifact, confidence should not be high
    assert.ok(result.confidence.level !== "high",
      `Confidence should not be high with only 1 artifact and 1 non-stale summary`);

    db.close();
  });
});

describe("runAssessment — dominant failure mode (ASSESS-01, D-05, D-06)", () => {
  it("selects the lowest-scoring dimension as dominantFailureMode (D-05)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed enough to get meaningful scores
    seedArtifactWithEvidence(repos, "resume", { summaryCount: 2 });
    seedArtifactWithEvidence(repos, "linkedin", { summaryCount: 2 });

    const result = runAssessment({ repos });

    // D-05: dominantFailureMode exists with dimension and reason
    assert.ok(result.dominantFailureMode, "dominantFailureMode should exist");
    assert.ok(typeof result.dominantFailureMode.dimension === "string",
      "dominantFailureMode.dimension should be a string");
    assert.ok(
      ["signal", "evidence", "visibility", "narrative"].includes(result.dominantFailureMode.dimension),
      `dimension should be one of the 4, got ${result.dominantFailureMode.dimension}`
    );
    assert.ok(typeof result.dominantFailureMode.reason === "string",
      "dominantFailureMode.reason should be a non-empty string");
    assert.ok(result.dominantFailureMode.reason.length > 0,
      "dominantFailureMode.reason should not be empty");

    // Verify it's actually the lowest
    const scores = {
      signal: result.signal,
      evidence: result.evidence,
      visibility: result.visibility,
      narrative: result.narrative,
    };
    const lowest = Object.entries(scores).reduce((a, b) => (a[1] <= b[1] ? a : b));
    assert.strictEqual(
      result.dominantFailureMode.dimension,
      lowest[0],
      `dominantFailureMode should be ${lowest[0]} (score: ${lowest[1]}), got ${result.dominantFailureMode.dimension}`
    );

    db.close();
  });

  it("resolves ties with Signal > Evidence > Visibility > Narrative priority (D-06)", () => {
    // This test verifies the tie-breaking contract through a targeted scenario.
    // The exact scores depend on the scoring algorithm, but the tie-breaking
    // behavior must follow D-06 priority.
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed with a single artifact — scores will be depressed by sufficiency penalty.
    // All dimensions should receive roughly equal base evidence, making ties likely.
    seedArtifactWithEvidence(repos, "resume", { summaryCount: 1 });

    const result = runAssessment({ repos });

    // Collect all scores
    const scores = [
      { dim: "signal", val: result.signal },
      { dim: "evidence", val: result.evidence },
      { dim: "visibility", val: result.visibility },
      { dim: "narrative", val: result.narrative },
    ];

    // Find the minimum score
    const minVal = Math.min(...scores.map((s) => s.val));
    const minDims = scores.filter((s) => s.val === minVal);

    // If there's a tie, verify D-06 priority order
    if (minDims.length > 1) {
      const priority = ["signal", "evidence", "visibility", "narrative"];
      const expectedDim = minDims.reduce((best, cur) => {
        const bestIdx = priority.indexOf(best.dim);
        const curIdx = priority.indexOf(cur.dim);
        return curIdx < bestIdx ? cur : best;
      });

      assert.strictEqual(
        result.dominantFailureMode.dimension,
        expectedDim.dim,
        `Tie-breaking: expected ${expectedDim.dim} (D-06 priority), got ${result.dominantFailureMode.dimension}`
      );
    }

    // Even without ties, the selected mode should be one of the valid dimensions
    assert.ok(
      ["signal", "evidence", "visibility", "narrative"].includes(result.dominantFailureMode.dimension)
    );

    db.close();
  });
});

describe("runAssessment — confidence and sufficiency (ASSESS-03, D-09, D-10)", () => {
  it("reports high confidence with 4+ artifact types, quality evidence, and recent snapshot", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed 4 artifact types with rich evidence
    for (const rtype of ["resume", "linkedin", "github_profile", "github_repo"]) {
      seedArtifactWithEvidence(repos, rtype, {
        evidenceContent: [
          `Rich evidence for ${rtype}: TypeScript expert, 8 years experience, CS degree`,
          `Additional evidence: leadership, open source contributions, AWS certified`,
        ],
        summaryCount: 2,
        summaryTypes: ["field_extraction", "signal_assessment"],
      });
    }

    // Seed a recent snapshot
    seedSnapshot(repos, { createdAt: new Date().toISOString() });

    const result = runAssessment({ repos });

    // D-09, D-10: confidence uses 3-component model
    assert.ok(result.confidence, "confidence should exist");
    assert.ok(["high", "medium", "low"].includes(result.confidence.level),
      `confidence.level should be high/medium/low, got ${result.confidence.level}`);
    assert.ok(typeof result.confidence.reason === "string",
      "confidence.reason should be a string");
    assert.ok(Array.isArray(result.confidence.artifactsAvailable),
      "confidence.artifactsAvailable should be an array");
    assert.ok(result.confidence.artifactsAvailable.length >= 4,
      `artifactsAvailable should list >= 4 types, got ${result.confidence.artifactsAvailable.length}`);

    // With 4+ artifacts and recent snapshot, confidence should be high
    assert.strictEqual(result.confidence.level, "high",
      `Expected high confidence with 4 artifacts, got ${result.confidence.level}`);

    db.close();
  });

  it("reports low confidence with only 1 artifact and no snapshots", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", { summaryCount: 1 });

    const result = runAssessment({ repos });

    assert.strictEqual(
      result.confidence.level,
      "low",
      `Expected low confidence with 1 artifact, got ${result.confidence.level}`
    );

    db.close();
  });

  it("reports medium confidence with 2-3 artifacts and reasonable evidence", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", { summaryCount: 2 });
    seedArtifactWithEvidence(repos, "linkedin", { summaryCount: 1 });

    const result = runAssessment({ repos });

    assert.strictEqual(
      result.confidence.level,
      "medium",
      `Expected medium confidence with 2 artifacts, got ${result.confidence.level}`
    );

    db.close();
  });

  it("reflects recency in confidence — old snapshots lower confidence", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed 4 artifacts for good base
    for (const rtype of ["resume", "linkedin", "github_profile", "github_repo"]) {
      seedArtifactWithEvidence(repos, rtype, { summaryCount: 2 });
    }

    // Seed an old snapshot (120 days ago)
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    seedSnapshot(repos, { createdAt: oldDate });

    const result = runAssessment({ repos });

    // Recency ratio = max(0, 1 - 120/90) = max(0, -0.33) = 0
    // With only 4/6 artifact_count and 0 recency, confidence should drop
    assert.ok(
      result.confidence.level === "medium" || result.confidence.level === "low",
      `Old snapshot should reduce confidence, got ${result.confidence.level}`
    );

    db.close();
  });
});

describe("runAssessment — improvements and next action (ASSESS-04, D-07, D-08, D-11)", () => {
  it("returns exactly three improvements sorted by ROI-derived priority (D-07, D-08)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", { summaryCount: 2 });
    seedArtifactWithEvidence(repos, "linkedin", { summaryCount: 2 });

    const result = runAssessment({ repos });

    // D-07: improvements array exists with 3 items
    assert.ok(Array.isArray(result.improvements), "improvements should be an array");
    assert.strictEqual(result.improvements.length, 3,
      `improvements should have exactly 3 items, got ${result.improvements.length}`);

    // Each improvement has required fields
    for (const imp of result.improvements) {
      assert.ok(typeof imp.action === "string" && imp.action.length > 0,
        "each improvement should have a non-empty action string");
      assert.ok(typeof imp.impact === "number" && imp.impact > 0,
        `improvement impact should be positive number, got ${imp.impact}`);
      assert.ok(typeof imp.ease === "number" && imp.ease > 0,
        `improvement ease should be positive number, got ${imp.ease}`);
      assert.ok([1, 2, 3].includes(imp.priority),
        `priority should be 1, 2, or 3, got ${imp.priority}`);
    }

    // D-08: sorted by priority ascending
    for (let i = 1; i < result.improvements.length; i++) {
      assert.ok(
        result.improvements[i].priority >= result.improvements[i - 1].priority,
        `improvements should be sorted by priority ascending`
      );
    }

    db.close();
  });

  it("derives improvements internally — dimensions below 70 produce high-impact candidates", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Only resume → most dimensions will score low
    seedArtifactWithEvidence(repos, "resume", { summaryCount: 1 });

    const result = runAssessment({ repos });

    assert.strictEqual(result.improvements.length, 3,
      "Should return exactly 3 improvements from internal derivation");

    // All improvements must have required fields
    for (const imp of result.improvements) {
      assert.ok(typeof imp.action === "string" && imp.action.length > 0,
        "each improvement should have a non-empty action string");
      assert.ok(typeof imp.impact === "number" && imp.impact > 0);
      assert.ok(typeof imp.ease === "number" && imp.ease > 0);
    }

    db.close();
  });

  it("derives improvements — missing artifact types produce high-impact candidates", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed only resume — 5 other artifact types are missing
    seedArtifactWithEvidence(repos, "resume", {
      summaryCount: 2,
      summaryTypes: ["field_extraction", "signal_assessment"],
    });

    const result = runAssessment({ repos });

    // Should have at least one improvement about adding missing artifacts
    const hasMissingArtifactImprovement = result.improvements.some(
      (imp) => imp.action.toLowerCase().includes("add") ||
               imp.action.toLowerCase().includes("upload") ||
               imp.action.toLowerCase().includes("linkedin") ||
               imp.action.toLowerCase().includes("github") ||
               imp.action.toLowerCase().includes("artifact")
    );
    assert.ok(hasMissingArtifactImprovement,
      "Should derive at least one improvement about missing artifacts");

    db.close();
  });

  it("returns non-empty nextBestAction derived from dominant failure mode (D-11)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", { summaryCount: 1 });

    const result = runAssessment({ repos });

    assert.ok(typeof result.nextBestAction === "string",
      "nextBestAction should be a string");
    assert.ok(result.nextBestAction.length > 0,
      "nextBestAction should not be empty");

    db.close();
  });

  it("nextBestAction maps to a valid workflow token (D-11)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed enough for a meaningful assessment
    seedArtifactWithEvidence(repos, "resume", { summaryCount: 2 });
    seedArtifactWithEvidence(repos, "linkedin", { summaryCount: 2 });
    seedArtifactWithEvidence(repos, "github_profile", { summaryCount: 2 });
    seedArtifactWithEvidence(repos, "github_repo", { summaryCount: 2 });
    seedSnapshot(repos, { createdAt: new Date().toISOString() });

    const result = runAssessment({ repos });

    // Valid workflow tokens from NEXT_ACTION_MAP
    const validTokens = [
      "current_state_assessment",
      "artifact_intake_update",
      "linkedin_optimization",
      "brand_strategy",
    ];

    assert.ok(
      validTokens.includes(result.nextBestAction),
      `nextBestAction "${result.nextBestAction}" should be one of: ${validTokens.join(", ")}`
    );

    db.close();
  });
});

describe("runAssessment — score provenance (Phase 4)", () => {
  it("each dimension score has a provenance field with inputs, rules, and trace", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", {
      summaryCount: 2,
      summaryTypes: ["field_extraction", "signal_assessment"],
    });
    seedArtifactWithEvidence(repos, "linkedin", {
      summaryCount: 1,
      summaryTypes: ["surface_snapshot"],
    });

    const result = runAssessment({ repos });

    assert.ok(result.dimensions, "result should have a dimensions object");

    for (const dim of ["signal", "evidence", "visibility", "narrative"]) {
      const d = result.dimensions[dim];
      assert.ok(d, `dimensions.${dim} should exist`);
      assert.ok(typeof d.score === "number", `dimensions.${dim}.score should be a number`);
      assert.strictEqual(d.score, result[dim], `dimensions.${dim}.score should match top-level ${dim}`);

      assert.ok(d.provenance, `dimensions.${dim}.provenance should exist`);
      assert.ok(Array.isArray(d.provenance.inputs), `dimensions.${dim}.provenance.inputs should be an array`);
      assert.ok(Array.isArray(d.provenance.rules), `dimensions.${dim}.provenance.rules should be an array`);
      assert.ok(typeof d.provenance.trace === "string" && d.provenance.trace.length > 0,
        `dimensions.${dim}.provenance.trace should be a non-empty string`);
    }

    db.close();
  });

  it("provenance.rules each have id, effect, reason fields", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", { summaryCount: 1 });

    const result = runAssessment({ repos });

    for (const dim of ["signal", "evidence", "visibility", "narrative"]) {
      for (const rule of result.dimensions[dim].provenance.rules) {
        assert.ok(typeof rule.id === "string" && rule.id.length > 0,
          `rule.id should be a non-empty string in ${dim}`);
        assert.ok(typeof rule.effect === "number",
          `rule.effect should be a number in ${dim}`);
        assert.ok(typeof rule.reason === "string" && rule.reason.length > 0,
          `rule.reason should be a non-empty string in ${dim}`);
      }
    }

    db.close();
  });

  it("provenance.inputs lists evidence summary IDs used for each dimension", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    const seeded = seedArtifactWithEvidence(repos, "resume", {
      summaryCount: 2,
      summaryTypes: ["field_extraction", "signal_assessment"],
    });

    const result = runAssessment({ repos });

    // signal dimension should reference the signal_assessment summary
    const signalProvenance = result.dimensions.signal.provenance;
    assert.ok(Array.isArray(signalProvenance.inputs));
    // At least one of the seeded summary IDs should appear in a dimension that uses field_extraction
    const allInputs = Object.values(result.dimensions).flatMap((d) => d.provenance.inputs);
    const hasASeededId = seeded.summaryIds.some((id) => allInputs.includes(id));
    assert.ok(hasASeededId, "At least one seeded summary ID should appear in provenance.inputs");

    db.close();
  });

  it("provenance does not change scores (additive only)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", { summaryCount: 2 });
    seedArtifactWithEvidence(repos, "linkedin", { summaryCount: 2 });

    const result = runAssessment({ repos });

    for (const dim of ["signal", "evidence", "visibility", "narrative"]) {
      assert.strictEqual(
        result[dim],
        result.dimensions[dim].score,
        `top-level ${dim} (${result[dim]}) must equal dimensions.${dim}.score (${result.dimensions[dim].score})`
      );
    }

    db.close();
  });
});

describe("persistAssessmentSnapshot — snapshot persistence (03-03, T-03-07, T-03-08)", () => {
  it("persists a compact snapshot containing scores, confidence, failure mode, and next workflow", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed artifacts with version IDs we can track
    const resume = seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: ["Skills: TypeScript, Python, React; Experience: 8 years senior engineering"],
      summaryCount: 2,
      summaryTypes: ["field_extraction", "signal_assessment"],
    });
    const linkedin = seedArtifactWithEvidence(repos, "linkedin", {
      evidenceContent: ["LinkedIn: 500+ connections, active posts, clear headline"],
      summaryCount: 1,
      summaryTypes: ["field_extraction"],
    });

    // Run assessment first (candidates and next action are derived internally)
    const assessmentResult = runAssessment({
      repos,
    });

    // Persist the assessment snapshot
    const artifactVersionIds = [resume.version.version_id, linkedin.version.version_id];
    const snapshot = persistAssessmentSnapshot({
      repos,
      assessmentResult,
      artifactVersionIds,
      triggerReason: "manual_request",
      goalContext: { primary_goal: "Senior Fullstack Engineer", timeline: "30 days" },
      nextRecommendedWorkflow: "bb-role-fit",
    });

    // Verify snapshot was created
    assert.ok(snapshot, "Snapshot should be created");
    assert.ok(snapshot.snapshot_id, "Snapshot should have an ID");
    assert.strictEqual(snapshot.trigger_reason, "manual_request");

    // Verify the persisted scores match assessment
    // Snapshots store dimension_summary as flattened columns
    assert.strictEqual(snapshot.dimension_signal, assessmentResult.signal,
      `Snapshot signal ${snapshot.dimension_signal} should match assessment ${assessmentResult.signal}`);
    assert.strictEqual(snapshot.dimension_evidence, assessmentResult.evidence);
    assert.strictEqual(snapshot.dimension_visibility, assessmentResult.visibility);
    assert.strictEqual(snapshot.dimension_narrative, assessmentResult.narrative);

    // Verify confidence and failure mode persisted
    assert.strictEqual(snapshot.confidence, assessmentResult.confidence.level);
    assert.ok(snapshot.next_recommended_workflow, "Next workflow should be set");

    // Verify the snapshot can be read back through retrieval APIs
    const { getRecentSnapshots } = require("../memory/retrieval.js");
    const recentSnapshots = getRecentSnapshots({ repos, limit: 5 });
    assert.ok(recentSnapshots.length >= 1, "Should have at least one snapshot");
    const retrieved = recentSnapshots[0];
    assert.strictEqual(retrieved.dimensionSummary.signal, assessmentResult.signal);
    assert.strictEqual(retrieved.confidence, assessmentResult.confidence.level);
    assert.strictEqual(retrieved.nextRecommendedWorkflow, "bb-role-fit");

    db.close();
  });

  it("uses version IDs from assessed artifacts for provenance tracing (T-03-08)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    const resume = seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: ["Skills: TypeScript, 8 years experience"],
      summaryCount: 1,
      summaryTypes: ["field_extraction"],
    });

    const assessmentResult = runAssessment({ repos });

    const artifactVersionIds = [resume.version.version_id];
    const snapshot = persistAssessmentSnapshot({
      repos,
      assessmentResult,
      artifactVersionIds,
      triggerReason: "artifact_update",
      nextRecommendedWorkflow: "bb-current-state",
    });

    // Verify version IDs are stored
    const { getRecentSnapshots } = require("../memory/retrieval.js");
    const recent = getRecentSnapshots({ repos, limit: 1 });
    assert.ok(recent.length === 1);
    assert.ok(recent[0].artifactVersionIds.includes(resume.version.version_id),
      "Stored snapshot should reference the artifact version ID for provenance");

    // Verify artifactVersionCount reflects our single version
    assert.strictEqual(recent[0].artifactVersionCount, 1);

    db.close();
  });

  it("captures goal context and recommendation themes in profileState without duplicating full report (T-03-09)", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    const resume = seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: ["Skills: TypeScript, Python; Experience: 8 years"],
      summaryCount: 1,
      summaryTypes: ["field_extraction"],
    });

    const assessmentResult = runAssessment({
      repos,
    });

    const snapshot = persistAssessmentSnapshot({
      repos,
      assessmentResult,
      artifactVersionIds: [resume.version.version_id],
      triggerReason: "manual_request",
      goalContext: { primary_goal: "Senior Engineer", timeline: "60 days" },
      nextRecommendedWorkflow: "bb-intake",
    });

    // profileState should be a compact JSON string, not empty
    const profileState = snapshot.profile_state || snapshot.profileState;
    assert.ok(typeof profileState === "string" && profileState.length > 0,
      "profileState should be a non-empty compact string");

    // Parse and verify it contains goal context, not full report duplication
    const parsed = JSON.parse(profileState);
    assert.ok(parsed.goal || parsed.primary_goal || parsed.themes,
      "profileState should contain goal context or recommendation themes");
    // Should NOT contain the full assessment details (that's in dimension columns)
    assert.ok(!parsed.scores, "profileState should not duplicate full score details");
    assert.ok(!parsed.improvements, "profileState should not duplicate full improvement list");

    db.close();
  });

  it("rejects empty artifact version IDs", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: ["Skills: TypeScript"],
      summaryCount: 1,
      summaryTypes: ["field_extraction"],
    });

    const assessmentResult = runAssessment({ repos });

    assert.throws(
      () => persistAssessmentSnapshot({
        repos,
        assessmentResult,
        artifactVersionIds: [],
        triggerReason: "manual_request",
      }),
      /artifactVersionIds must not be empty/,
      "Should reject empty artifactVersionIds"
    );

    db.close();
  });

  it("rejects non-existent artifact version IDs", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: ["Skills: TypeScript"],
      summaryCount: 1,
      summaryTypes: ["field_extraction"],
    });

    const assessmentResult = runAssessment({ repos });

    assert.throws(
      () => persistAssessmentSnapshot({
        repos,
        assessmentResult,
        artifactVersionIds: ["nonexistent-version-id-00000000"],
        triggerReason: "manual_request",
      }),
      /does not reference an existing version/,
      "Should reject non-existent version IDs"
    );

    db.close();
  });
});

describe("end-to-end current-state assessment workflow (03-03, Phase 3 completion)", () => {
  it("seeds artifacts, supplies prompt-owned candidates, assesses, persists, and reads back through retrieval APIs", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Step 1: Seed a multi-artifact profile (simulating Phase 2 intake)
    const resume = seedArtifactWithEvidence(repos, "resume", {
      evidenceContent: [
        "Skills: TypeScript, Python, React, Node.js; Experience: 8 years senior fullstack",
        "Education: BS Computer Science; Certifications: AWS Solutions Architect",
      ],
      summaryCount: 2,
      summaryTypes: ["field_extraction", "signal_assessment"],
    });
    const linkedin = seedArtifactWithEvidence(repos, "linkedin", {
      evidenceContent: [
        "LinkedIn profile: 500+ connections, clear headline 'Senior Software Engineer', active posts on system design",
      ],
      summaryCount: 1,
      summaryTypes: ["surface_snapshot"],
    });
    const github = seedArtifactWithEvidence(repos, "github_profile", {
      evidenceContent: [
        "GitHub: 200+ contributions/year, 5 pinned repos, 50+ stars on OSS project",
      ],
      summaryCount: 1,
      summaryTypes: ["signal_assessment"],
    });

    // Step 2: Run the deterministic assessment (candidates and next action are derived internally)
    const result = runAssessment({
      repos,
    });

    // Step 4: Verify assessment output shape
    assert.ok(typeof result.signal === "number" && result.signal >= 0);
    assert.ok(typeof result.evidence === "number" && result.evidence >= 0);
    assert.ok(typeof result.visibility === "number" && result.visibility >= 0);
    assert.ok(typeof result.narrative === "number" && result.narrative >= 0);
    assert.ok(result.dominantFailureMode);
    assert.ok(result.dominantFailureMode.dimension);
    assert.ok(result.dominantFailureMode.reason);
    assert.strictEqual(result.improvements.length, 3);
    assert.ok(result.confidence);
    assert.ok(typeof result.nextBestAction === "string" && result.nextBestAction.length > 0,
      "nextBestAction should be a non-empty string derived internally");

    // Verify all scores are multiples of 10 (D-04)
    for (const dim of ["signal", "evidence", "visibility", "narrative"]) {
      assert.strictEqual(result[dim] % 10, 0,
        `${dim} should be multiple of 10, got ${result[dim]}`);
    }

    // Step 5: Persist the assessment as a snapshot
    const artifactVersionIds = [
      resume.version.version_id,
      linkedin.version.version_id,
      github.version.version_id,
    ];

    const snapshot = persistAssessmentSnapshot({
      repos,
      assessmentResult: result,
      artifactVersionIds,
      triggerReason: "manual_request",
      goalContext: { primary_goal: "Senior Staff Engineer", timeline: "90 days" },
      nextRecommendedWorkflow: "bb-role-fit",
    });

    assert.ok(snapshot.snapshot_id, "Snapshot should have an ID");

    // Step 6: Read back through Phase 2 retrieval APIs
    const { getRecentSnapshots, getLatestProfileState } = require("../memory/retrieval.js");

    // 6a: getRecentSnapshots — verify snapshot history
    const recent = getRecentSnapshots({ repos, limit: 5 });
    assert.ok(recent.length >= 1, "Should find at least one snapshot");
    const stored = recent[0];
    assert.strictEqual(stored.dimensionSummary.signal, result.signal);
    assert.strictEqual(stored.dimensionSummary.evidence, result.evidence);
    assert.strictEqual(stored.dimensionSummary.visibility, result.visibility);
    assert.strictEqual(stored.dimensionSummary.narrative, result.narrative);
    assert.strictEqual(stored.confidence, result.confidence.level);
    assert.strictEqual(stored.nextRecommendedWorkflow, "bb-role-fit");
    assert.ok(stored.artifactVersionIds.includes(resume.version.version_id),
      "Should trace back to resume version");
    assert.ok(stored.artifactVersionIds.includes(linkedin.version.version_id),
      "Should trace back to linkedin version");
    assert.ok(stored.artifactVersionIds.includes(github.version.version_id),
      "Should trace back to github version");

    // 6b: getLatestProfileState — verify profile state is accessible
    const profileState = getLatestProfileState({ repos });
    assert.ok(profileState, "Should have a profile state from snapshot");
    assert.ok(profileState.profileState, "Should have profileState string");

    // Parse and verify compact profileState content
    const parsed = JSON.parse(profileState.profileState);
    assert.strictEqual(parsed.primary_goal, "Senior Staff Engineer");
    assert.strictEqual(parsed.timeline, "90 days");
    assert.ok(Array.isArray(parsed.top_recommendation_themes),
      "Should contain top recommendation themes");
    assert.ok(parsed.top_recommendation_themes.length <= 3,
      "Should have at most 3 theme entries");
    assert.ok(parsed.artifact_sufficiency_tier, "Should record sufficiency tier");

    db.close();
  });
});

describe("runAssessment — defensive validation", () => {
  it("throws when repos is missing", () => {
    assert.throws(
      () => runAssessment({}),
      /repos is required/,
      "Should throw on missing repos"
    );
  });

  it("handles empty artifact types gracefully", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // No artifacts seeded
    const result = runAssessment({ repos, artifactTypes: [] });

    // Should still return the contract shape
    assert.ok(typeof result.signal === "number");
    assert.ok(typeof result.evidence === "number");
    assert.ok(typeof result.visibility === "number");
    assert.ok(typeof result.narrative === "number");
    assert.ok(result.dominantFailureMode);
    assert.ok(Array.isArray(result.improvements));
    assert.ok(result.confidence);

    db.close();
  });

  it("handles no current artifacts gracefully", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    // Seed an artifact with non-current status
    seedArtifactWithEvidence(repos, "resume", { status: "archived" });

    const result = runAssessment({ repos });

    // All scores should be 0 since no current artifacts
    assert.strictEqual(result.signal, 0);
    assert.strictEqual(result.evidence, 0);
    assert.strictEqual(result.visibility, 0);
    assert.strictEqual(result.narrative, 0);

    db.close();
  });
});
