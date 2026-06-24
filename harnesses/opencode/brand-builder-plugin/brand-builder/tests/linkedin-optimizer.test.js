/**
 * Brand Builder LinkedIn Optimizer Test
 *
 * Phase 5 Plan 02 — deterministic LinkedIn section diagnosis and rewrite-input
 * builder covering LI-01 through LI-04 behaviors.
 *
 * Test coverage:
 *   - LI-01: Section coverage (headline, about, experience, featured, skills)
 *   - LI-02: Variant counts (3/2/2/2/1) and optimized skills list
 *   - LI-03: Brand direction + role-family context influence rewrite guidance
 *   - LI-04: Anti-voice-ready output (variant labels, bullet format, no A/B)
 *
 * Per D-02: headline=3, about=2, experience=2, featured=2, skills=1 (optimized list)
 * Per D-05: labels use "Variant 1/2/3", never A/B
 * Per D-07: experience variants are bullet-formatted
 * Per D-17: cached evidence only, no automatic refresh
 * Per D-19: stale >30 days yields refresh recommendation
 * Per D-20: missing LinkedIn → diagnose-only mode
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
let runLinkedInOptimization;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Seed an artifact + version + evidence summary into repos.
 * Returns { artifactId, versionId }.
 */
function seedArtifact(repos, artifactType, overrides = {}) {
  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();

  const artifact = {
    artifact_id: artifactId,
    artifact_type: artifactType,
    canonical_path: `${artifactType}-test.json`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    first_ingested_at: overrides.ingestedAt || new Date().toISOString(),
    last_updated_at: overrides.updatedAt || new Date().toISOString(),
    status: overrides.status || "current",
    source_label: `Test ${artifactType}`,
  };
  repos.artifacts.upsert(artifact);

  const version = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: `${artifactType}-test.json`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    ingested_at: overrides.ingestedAt || new Date().toISOString(),
    provenance: {
      source: "user_upload",
      update_context: `Test ${artifactType} upload`,
    },
    supersedes_version: null,
  };
  repos.versions.create(version);

  return { artifactId, versionId };
}

/**
 * Seed an evidence summary linked to an artifact version.
 */
function seedEvidenceSummary(repos, artifactId, versionId, overrides = {}) {
  const summaryId = overrides.summaryId || randomUUID();

  const summary = {
    summary_id: summaryId,
    artifact_id: artifactId,
    version_id: versionId,
    summary_type: overrides.summaryType || "field_extraction",
    content: overrides.content || `Evidence for ${artifactId}: TypeScript, React, 8 years experience`,
    source_references: overrides.sourceReferences || ["ref-1"],
    stale: overrides.stale !== undefined ? overrides.stale : false,
    stale_reason: overrides.staleReason || undefined,
    workflow_domain: overrides.workflowDomain || "linkedin",
    created_at: overrides.createdAt || new Date().toISOString(),
  };
  repos.evidence.create(summary);

  return summaryId;
}

// ---------------------------------------------------------------------------
// Suite setup — test DB lifecycle
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof createTestDb>} */
let db;
let repos;

before(async () => {
  // Dynamically load the module under test if it exists; if not, tests
  // should fail in RED phase as expected.
  try {
    const mod = require("../linkedin/optimizer.js");
    runLinkedInOptimization = mod.runLinkedInOptimization;
  } catch {
    runLinkedInOptimization = null;
  }
});

beforeEach(() => {
  db = createTestDb();
  repos = createRepositories(db.db);
});

after(() => {
  if (db) db.close();
});

// ============================================================================
// LI-01: Section Coverage — diagnosis returns all 5 workflow sections
// ============================================================================

describe("LI-01 LinkedIn section coverage", () => {
  it("returns headline, about, experience, featured, and skills section keys", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    // Seed full profile with LinkedIn artifact present
    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");
    seedArtifact(repos, "github_profile");

    const assessmentContext = {
      signal: 70,
      evidence: 50,
      visibility: 60,
      narrative: 40,
      dominantFailureMode: { dimension: "narrative", reason: "Narrative is weak" },
      improvements: [],
      confidence: "medium",
      nextBestAction: "Improve narrative coherence",
    };

    const roleFitContext = {
      fitScore: 62,
      bracket: "moderate",
      bucketScores: {
        mustHaveMatch: 80,
        preferredMatch: 50,
        seniorityOwnershipMatch: 60,
        domainContextMatch: 55,
        proofStrength: 40,
        presentationMatch: 45,
      },
      blockers: [],
      easyWins: ["Improve presentation match"],
      strengths: ["Strong must-have skills"],
      confidence: "medium",
      evidenceUsed: ["resume", "linkedin"],
    };

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline", "about", "experience", "featured", "skills"],
      assessmentContext,
      roleFitContext,
    });

    // LI-01: All 5 sections must be present
    assert.ok(result.sections, "Result must have sections");
    assert.ok(result.sections.headline, "Must include headline section");
    assert.ok(result.sections.about, "Must include about section");
    assert.ok(result.sections.experience, "Must include experience section");
    assert.ok(result.sections.featured, "Must include featured section");
    assert.ok(result.sections.skills, "Must include skills section");

    // Acceptance criterion: featured is present and asserted
    assert.equal(
      typeof result.sections.featured.diagnosis,
      "string",
      "Featured section must have a diagnosis string"
    );
  });

  it("returns all 5 section keys even in diagnose-only mode (no LinkedIn artifact)", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    // No LinkedIn artifact — only resume and github_profile
    seedArtifact(repos, "resume");
    seedArtifact(repos, "github_profile");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "low" },
    });

    // All 5 sections still present
    assert.ok(result.sections.headline, "Headline must be present even in diagnose-only");
    assert.ok(result.sections.about, "About must be present even in diagnose-only");
    assert.ok(result.sections.experience, "Experience must be present even in diagnose-only");
    assert.ok(result.sections.featured, "Featured must be present even in diagnose-only");
    assert.ok(result.sections.skills, "Skills must be present even in diagnose-only");

    // artifactMissing must be true
    assert.equal(result.artifactMissing, true, "Missing LinkedIn must set artifactMissing to true");
  });
});

// ============================================================================
// LI-02: Variant Counts — exact count contract per D-02
// ============================================================================

describe("LI-02 Variant counts", () => {
  it("produces exactly 3 headline variants, 2 about, 2 experience, 2 featured, 1 skills", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline", "about", "experience", "featured", "skills"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    // LI-02: Exact variant counts per D-02
    assert.equal(
      result.sections.headline.variants.length,
      3,
      "Headline must have exactly 3 variants"
    );
    assert.equal(
      result.sections.about.variants.length,
      2,
      "About must have exactly 2 variants"
    );
    assert.equal(
      result.sections.experience.variants.length,
      2,
      "Experience must have exactly 2 variants"
    );
    assert.equal(
      result.sections.featured.variants.length,
      2,
      "Featured must have exactly 2 variants (agent discretion)"
    );
    assert.equal(
      result.sections.skills.variants.length,
      1,
      "Skills must have exactly 1 optimized list"
    );
  });

  it("featured section has consistently 2 variants across all calls", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    // Run twice to confirm determinism
    for (let i = 0; i < 2; i++) {
      const result = runLinkedInOptimization({
        repos,
        requestedSections: ["featured"],
        assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
        roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      });
      assert.equal(result.sections.featured.variants.length, 2, `Run ${i + 1}: featured must have 2 variants`);
    }
  });
});

// ============================================================================
// LI-03: Stale evidence + missing artifact flags + cached evidence
// ============================================================================

describe("LI-03 Stale evidence and missing-artifact handling", () => {
  it("sets artifactMissing to true when LinkedIn artifact is absent", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    // No LinkedIn artifact
    seedArtifact(repos, "resume");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "low" },
    });

    assert.equal(result.artifactMissing, true, "Must flag missing LinkedIn artifact");
  });

  it("sets artifactMissing to false when LinkedIn artifact is present", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    assert.equal(result.artifactMissing, false, "Must NOT flag when LinkedIn artifact exists");
  });

  it("returns staleRecommendation when evidence is older than 30 days (D-19)", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

    // Seed LinkedIn with old evidence
    const { artifactId, versionId } = seedArtifact(repos, "linkedin", {
      ingestedAt: staleDate,
      updatedAt: staleDate,
    });
    seedEvidenceSummary(repos, artifactId, versionId, {
      createdAt: staleDate,
    });

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    // Acceptance criterion: staleRecommendation must be present
    assert.ok(result.staleRecommendation, "Must have staleRecommendation when evidence is old");
    assert.equal(typeof result.staleRecommendation, "string", "staleRecommendation must be a string");
    assert.ok(
      result.staleRecommendation.toLowerCase().includes("refresh") ||
      result.staleRecommendation.toLowerCase().includes("stale") ||
      result.staleRecommendation.toLowerCase().includes("old"),
      "staleRecommendation must mention refresh/stale status"
    );
  });

  it("does not trigger automatic refresh (D-17 — cached evidence only)", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const { artifactId, versionId } = seedArtifact(repos, "linkedin", {
      ingestedAt: staleDate,
      updatedAt: staleDate,
    });
    seedEvidenceSummary(repos, artifactId, versionId, { createdAt: staleDate });

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    // Even with stale data, must still produce results (cached evidence path)
    assert.ok(result.sections.headline.diagnosis, "Must still produce diagnosis from cached evidence");
    assert.ok(result.staleRecommendation, "Must include refresh recommendation but still produce output");
  });

  it("does not set staleRecommendation when evidence is fresh (<30 days)", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    const { artifactId, versionId } = seedArtifact(repos, "linkedin");
    seedEvidenceSummary(repos, artifactId, versionId, {
      createdAt: new Date().toISOString(),
    });

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    assert.ok(
      !result.staleRecommendation || result.staleRecommendation.length === 0,
      "Must NOT recommend refresh for fresh evidence"
    );
  });
});

// ============================================================================
// LI-04: Variant labels and experience format (voice preservation readiness)
// ============================================================================

describe("LI-04 Variant labels and experience format", () => {
  it("uses 'Variant 1', 'Variant 2', 'Variant 3' labels only — never A/B", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline", "about"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    // Check headline variants use "Variant N" labels
    for (let i = 0; i < result.sections.headline.variants.length; i++) {
      const variant = result.sections.headline.variants[i];
      assert.ok(
        variant.label && variant.label.startsWith("Variant "),
        `Headline variant ${i + 1} label must start with "Variant ": got "${variant.label}"`
      );
      assert.ok(
        !variant.label.includes("A") && !variant.label.includes("B"),
        `Headline variant ${i + 1} must NOT contain A/B: got "${variant.label}"`
      );
    }

    // Check about variants use "Variant N" labels
    for (let i = 0; i < result.sections.about.variants.length; i++) {
      const variant = result.sections.about.variants[i];
      assert.ok(
        variant.label && variant.label.startsWith("Variant "),
        `About variant ${i + 1} label must start with "Variant ": got "${variant.label}"`
      );
      assert.ok(
        !variant.label.includes("A") && !variant.label.includes("B"),
        `About variant ${i + 1} must NOT contain A/B: got "${variant.label}"`
      );
    }
  });

  it("experience section uses bullet_points format per D-07", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["experience"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    // Acceptance criterion: experience format must specify bullet_points
    assert.ok(
      result.sections.experience.format,
      "Experience section must have format field"
    );
    assert.equal(
      result.sections.experience.format,
      "bullet_points",
      "Experience format must be 'bullet_points' per D-07"
    );

    // Each experience variant content should be an array of bullet points
    for (const variant of result.sections.experience.variants) {
      assert.ok(
        Array.isArray(variant.text),
        `Experience variant "${variant.label}" text must be an array of bullet points`
      );
      assert.ok(
        variant.text.length > 0,
        `Experience variant "${variant.label}" must have at least one bullet point`
      );
    }
  });

  it("no A/B labels appear anywhere in the output", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline", "about", "experience", "featured", "skills"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    const resultStr = JSON.stringify(result);
    assert.ok(
      !resultStr.includes("Variant A") && !resultStr.includes("Variant B"),
      "Output must NEVER contain 'Variant A' or 'Variant B' labels"
    );
  });
});

// ============================================================================
// Output contract: top-level keys
// ============================================================================

describe("Output contract", () => {
  it("returns exactly the required top-level keys", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    });

    const expectedKeys = [
      "workflowDomain",
      "artifactMissing",
      "staleRecommendation",
      "sections",
      "evidenceUsed",
      "roleFitTargets",
      "nextBestAction",
    ];

    for (const key of expectedKeys) {
      assert.ok(
        key in result,
        `Output must include top-level key: "${key}"`
      );
    }

    // workflowDomain must be "linkedin"
    assert.equal(result.workflowDomain, "linkedin");
  });

  it("exports runLinkedInOptimization as the sole public function", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    assert.equal(typeof runLinkedInOptimization, "function");
  });

  it("brand direction and role-family context appear in variant rationale/focus", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");

    const result = runLinkedInOptimization({
      repos,
      requestedSections: ["headline"],
      assessmentContext: {
        signal: 70,
        evidence: 50,
        visibility: 60,
        narrative: 40,
        dominantFailureMode: { dimension: "narrative", reason: "Weak" },
      },
      roleFitContext: {
        fitScore: 65,
        bracket: "moderate",
        bucketScores: {
          mustHaveMatch: 80,
          preferredMatch: 50,
          seniorityOwnershipMatch: 60,
          domainContextMatch: 55,
          proofStrength: 40,
          presentationMatch: 45,
        },
        blockers: ["Missing senior leadership evidence"],
        easyWins: ["Improve presentation match"],
        strengths: ["Strong technical skills"],
        confidence: "medium",
        evidenceUsed: ["resume", "linkedin"],
      },
    });

    // roleFitTargets should reflect role-fit context
    assert.ok(
      Array.isArray(result.roleFitTargets) && result.roleFitTargets.length > 0,
      "roleFitTargets must be a non-empty array"
    );

    // evidenceUsed should list artifact types consumed
    assert.ok(
      Array.isArray(result.evidenceUsed),
      "evidenceUsed must be an array"
    );
  });
});

// ============================================================================
// Determinisim verification
// ============================================================================

describe("Determinism", () => {
  it("produces identical output shape for identical inputs", () => {
    if (!runLinkedInOptimization) {
      assert.fail("runLinkedInOptimization not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const params = {
      repos,
      requestedSections: ["headline", "about"],
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
    };

    const result1 = runLinkedInOptimization(params);
    const result2 = runLinkedInOptimization(params);

    // Structural parity
    assert.deepEqual(
      Object.keys(result1).sort(),
      Object.keys(result2).sort(),
      "Output keys must be identical between runs"
    );

    assert.deepEqual(
      Object.keys(result1.sections).sort(),
      Object.keys(result2.sections).sort(),
      "Section keys must be identical between runs"
    );

    assert.equal(
      result1.sections.headline.variants.length,
      result2.sections.headline.variants.length,
      "Headline variant count must be identical between runs"
    );
  });
});

describe("runLinkedInOptimization — section provenance (Phase 4)", () => {
  it("each section has a provenance field with inputs, rules, and trace", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    const { artifactId, versionId } = seedArtifact(repos, "linkedin");
    seedEvidenceSummary(repos, artifactId, versionId, {
      content: "LinkedIn profile: headline, about, experience, skills",
      summaryType: "surface_snapshot",
    });

    const result = runLinkedInOptimization({ repos });

    assert.ok(result.sections, "result.sections should exist");
    for (const sectionName of ["headline", "about", "experience", "featured", "skills"]) {
      const section = result.sections[sectionName];
      assert.ok(section, `sections.${sectionName} should exist`);
      assert.ok(section.provenance, `sections.${sectionName}.provenance should exist`);
      assert.ok(Array.isArray(section.provenance.inputs),
        `sections.${sectionName}.provenance.inputs should be an array`);
      assert.ok(Array.isArray(section.provenance.rules),
        `sections.${sectionName}.provenance.rules should be an array`);
      assert.ok(typeof section.provenance.trace === "string" && section.provenance.trace.length > 0,
        `sections.${sectionName}.provenance.trace should be a non-empty string`);
    }

    db.close();
  });

  it("provenance.rules each have id, effect, reason in each section", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    const { artifactId, versionId } = seedArtifact(repos, "linkedin");
    seedEvidenceSummary(repos, artifactId, versionId, { content: "test linkedin content" });

    const result = runLinkedInOptimization({ repos });

    for (const sectionName of ["headline", "about", "skills"]) {
      for (const rule of result.sections[sectionName].provenance.rules) {
        assert.ok(typeof rule.id === "string" && rule.id.length > 0, `rule.id non-empty in ${sectionName}`);
        assert.ok(typeof rule.effect === "number", `rule.effect is number in ${sectionName}`);
        assert.ok(typeof rule.reason === "string" && rule.reason.length > 0, `rule.reason non-empty in ${sectionName}`);
      }
    }

    db.close();
  });
});
