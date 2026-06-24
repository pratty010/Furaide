/**
 * Brand Builder Brand Strategy Test
 *
 * Phase 6 Plan 01 — deterministic brand strategy engine and website brief
 * assembly covering BRAND-01 and BRAND-02 behaviors.
 *
 * Test coverage:
 *   - BRAND-01: Advisory mode returns siteRecommended: false when existing
 *               surfaces cover narrative needs.
 *   - BRAND-02: Active website mode returns siteRecommended: true, siteJob,
 *               siteStructure, proofShelf, alignmentChecklist, websiteBrief.
 *   - Website brief includes on-site summaries, off-site proof links,
 *     builder-boundary notes, and concrete handoff payload.
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
let runBrandStrategy;

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
    const mod = require("../brand/strategy.js");
    runBrandStrategy = mod.runBrandStrategy;
  } catch {
    runBrandStrategy = null;
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
// BRAND-01: Advisory mode — siteRecommended: false when surfaces cover needs
// ============================================================================

describe("BRAND-01 Advisory mode", () => {
  it("returns siteRecommended: false when LinkedIn, GitHub, and resume cover narrative needs", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    // Seed full profile with LinkedIn, GitHub, and resume artifacts
    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "github_profile");
    seedArtifact(repos, "resume");
    seedArtifact(repos, "website");

    const assessmentContext = {
      signal: 75,
      evidence: 70,
      visibility: 65,
      narrative: 72,
      dominantFailureMode: null,
      improvements: [],
      confidence: "high",
      nextBestAction: "Maintain current surfaces",
    };

    const roleFitContext = {
      fitScore: 78,
      bracket: "strong",
      bucketScores: {
        mustHaveMatch: 85,
        preferredMatch: 72,
        seniorityOwnershipMatch: 75,
        domainContextMatch: 70,
        proofStrength: 68,
        presentationMatch: 65,
      },
      blockers: [],
      easyWins: [],
      strengths: ["Strong narrative across all surfaces"],
      confidence: "high",
      evidenceUsed: ["resume", "linkedin", "github_profile"],
    };

    const linkedinContext = {
      present: true,
      sections: { headline: "Senior Engineer", about: "Strong narrative" },
    };

    const githubContext = {
      repos: [],
      profileReadme: "Comprehensive profile README",
    };

    const result = runBrandStrategy({
      repos,
      websiteMode: "advisory",
      websiteGoal: "",
      brandDirection: "",
      assessmentContext,
      roleFitContext,
      linkedinContext,
      githubContext,
    });

    // BRAND-01: In advisory mode with strong existing surfaces,
    // siteRecommended should be false
    assert.equal(
      result.siteRecommended,
      false,
      "Advisory mode with strong existing surfaces: siteRecommended must be false"
    );

    // Must still produce core output keys
    assert.equal(result.workflowDomain, "brand");
    assert.ok(
      "siteJob" in result,
      "Must include siteJob even when site not recommended"
    );
    assert.ok(
      "siteStructure" in result,
      "Must include siteStructure even when site not recommended"
    );
  });

  it("returns siteRecommended: true in advisory mode when narrative visibility is insufficient", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    // Minimal profile — only resume, weak narrative
    seedArtifact(repos, "resume");

    const assessmentContext = {
      signal: 60,
      evidence: 55,
      visibility: 30,
      narrative: 35,
      dominantFailureMode: { dimension: "narrative", reason: "Weak narrative across surfaces" },
      improvements: [],
      confidence: "low",
      nextBestAction: "Improve narrative and build personal site",
    };

    const roleFitContext = {
      fitScore: 45,
      bracket: "weak",
      bucketScores: {
        mustHaveMatch: 55,
        preferredMatch: 40,
        seniorityOwnershipMatch: 35,
        domainContextMatch: 30,
        proofStrength: 25,
        presentationMatch: 20,
      },
      blockers: ["No public proof surface", "Weak narrative"],
      easyWins: ["Create personal website for narrative control"],
      strengths: [],
      confidence: "low",
      evidenceUsed: ["resume"],
    };

    const linkedinContext = { present: false };
    const githubContext = { repos: [], profileReadme: "" };

    const result = runBrandStrategy({
      repos,
      websiteMode: "advisory",
      websiteGoal: "",
      brandDirection: "",
      assessmentContext,
      roleFitContext,
      linkedinContext,
      githubContext,
    });

    // BRAND-01: In advisory mode with weak narrative/visibility,
    // siteRecommended should be true
    assert.equal(
      result.siteRecommended,
      true,
      "Advisory mode with weak narrative: siteRecommended must be true"
    );
  });
});

// ============================================================================
// BRAND-02: Active website workflow mode
// ============================================================================

describe("BRAND-02 Active website workflow mode", () => {
  it("returns siteRecommended: true with full website brief in active mode", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    // Seed full profile
    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "github_profile");
    seedArtifact(repos, "resume");
    seedArtifact(repos, "website");

    const assessmentContext = {
      signal: 70,
      evidence: 65,
      visibility: 50,
      narrative: 60,
      dominantFailureMode: { dimension: "visibility", reason: "Low surface visibility" },
      improvements: [],
      confidence: "medium",
      nextBestAction: "Build personal website",
    };

    const roleFitContext = {
      fitScore: 65,
      bracket: "moderate",
      bucketScores: {
        mustHaveMatch: 75,
        preferredMatch: 60,
        seniorityOwnershipMatch: 55,
        domainContextMatch: 50,
        proofStrength: 45,
        presentationMatch: 40,
      },
      blockers: ["Proof surface gap"],
      easyWins: ["Build personal site to showcase proof"],
      strengths: ["Strong technical skills"],
      confidence: "medium",
      evidenceUsed: ["resume", "linkedin", "github_profile"],
    };

    const linkedinContext = {
      present: true,
      sections: { headline: "Full-Stack Engineer", about: "Building scalable systems" },
    };

    const githubContext = {
      repos: [{ name: "my-app", disposition: "Highlight" }],
      profileReadme: "Open source contributor",
    };

    const result = runBrandStrategy({
      repos,
      websiteMode: "active",
      websiteGoal: "Showcase full-stack engineering portfolio and thought leadership",
      brandDirection: "Technical leadership with focus on distributed systems",
      assessmentContext,
      roleFitContext,
      linkedinContext,
      githubContext,
    });

    // BRAND-02: In active mode, siteRecommended must be true
    assert.equal(
      result.siteRecommended,
      true,
      "Active website mode: siteRecommended must be true"
    );

    // siteJob must be present and non-empty
    assert.ok(
      result.siteJob && typeof result.siteJob === "string" && result.siteJob.length > 0,
      "siteJob must be a non-empty string describing the website's purpose"
    );

    // siteStructure must be an array with at least 1 section
    assert.ok(
      Array.isArray(result.siteStructure) && result.siteStructure.length > 0,
      "siteStructure must be a non-empty array of section descriptors"
    );

    // Each site structure entry should describe a section
    for (const section of result.siteStructure) {
      assert.ok(
        section.name || section.title || section.section,
        "Each site structure entry must identify the section"
      );
    }

    // proofShelf must be present
    assert.ok(
      "proofShelf" in result,
      "proofShelf must be present in output"
    );

    // alignmentChecklist must be present
    assert.ok(
      Array.isArray(result.alignmentChecklist),
      "alignmentChecklist must be an array"
    );

    // websiteBrief must be present
    assert.ok(
      "websiteBrief" in result,
      "websiteBrief must be present in output"
    );

    // websiteBrief must be an object with brief sub-keys
    assert.equal(typeof result.websiteBrief, "object", "websiteBrief must be an object");
    assert.ok(
      result.websiteBrief !== null,
      "websiteBrief must not be null"
    );
  });

  it("active mode produces websiteBrief with on-site summaries, off-site proof links, and builder handoff", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "github_profile");
    seedArtifact(repos, "resume");
    seedArtifact(repos, "website");

    const assessmentContext = {
      signal: 70, evidence: 65, visibility: 50, narrative: 60,
      dominantFailureMode: { dimension: "visibility", reason: "Low surface visibility" },
      confidence: "medium",
    };

    const roleFitContext = {
      fitScore: 65, bracket: "moderate",
      bucketScores: { mustHaveMatch: 75, preferredMatch: 60, seniorityOwnershipMatch: 55, domainContextMatch: 50, proofStrength: 45, presentationMatch: 40 },
      blockers: ["Proof surface gap"],
      easyWins: ["Build personal site"],
      strengths: ["Strong technical skills"],
      confidence: "medium",
    };

    const linkedinContext = { present: true };
    const githubContext = {
      repos: [{ name: "my-app", disposition: "Highlight" }],
      profileReadme: "Open source contributor",
    };

    const result = runBrandStrategy({
      repos,
      websiteMode: "active",
      websiteGoal: "Showcase engineering portfolio",
      brandDirection: "Technical leadership",
      assessmentContext,
      roleFitContext,
      linkedinContext,
      githubContext,
    });

    // websiteBrief must contain on-site sumaries (content for pages/sections)
    assert.ok(
      result.websiteBrief.onSiteContent ||
      result.websiteBrief.content ||
      result.websiteBrief.sections,
      "websiteBrief must contain on-site content/sections reference"
    );

    // websiteBrief must contain off-site proof links
    assert.ok(
      result.websiteBrief.offSiteProofLinks ||
      result.websiteBrief.proofLinks ||
      result.websiteBrief.externalProof,
      "websiteBrief must contain off-site proof link references"
    );

    // websiteBrief must contain builder-boundary notes
    const briefStr = JSON.stringify(result.websiteBrief).toLowerCase();
    assert.ok(
      briefStr.includes("builder") ||
      briefStr.includes("handoff") ||
      briefStr.includes("implementation"),
      "websiteBrief must contain builder-handoff or implementation boundary notes"
    );

    // websiteBrief must be a concrete handoff payload (object with structure)
    assert.ok(
      Object.keys(result.websiteBrief).length >= 3,
      "websiteBrief must have at least 3 keys for a concrete handoff payload"
    );
  });
});

// ============================================================================
// Output contract: top-level keys
// ============================================================================

describe("Output contract", () => {
  it("returns exactly the required top-level keys", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const result = runBrandStrategy({
      repos,
      websiteMode: "advisory",
      websiteGoal: "",
      brandDirection: "",
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      linkedinContext: { present: true },
      githubContext: { repos: [], profileReadme: "" },
    });

    const expectedKeys = [
      "workflowDomain",
      "siteRecommended",
      "siteJob",
      "siteStructure",
      "proofShelf",
      "alignmentChecklist",
      "staleRecommendation",
      "evidenceUsed",
      "websiteBrief",
      "recommendedNextAction",
    ];

    for (const key of expectedKeys) {
      assert.ok(
        key in result,
        `Output must include top-level key: "${key}"`
      );
    }

    // workflowDomain must be "brand"
    assert.equal(result.workflowDomain, "brand");
  });

  it("exports runBrandStrategy as the sole public function", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    assert.equal(typeof runBrandStrategy, "function");
  });
});

// ============================================================================
// Evidenced used
// ============================================================================

describe("Evidence tracking", () => {
  it("evidenceUsed lists artifact types consumed by the strategy engine", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "github_profile");
    seedArtifact(repos, "resume");

    const result = runBrandStrategy({
      repos,
      websiteMode: "advisory",
      websiteGoal: "",
      brandDirection: "",
      assessmentContext: { signal: 70, evidence: 65, visibility: 50, narrative: 60 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      linkedinContext: { present: true },
      githubContext: { repos: [], profileReadme: "" },
    });

    assert.ok(
      Array.isArray(result.evidenceUsed),
      "evidenceUsed must be an array"
    );
    assert.ok(
      result.evidenceUsed.length > 0,
      "evidenceUsed must not be empty when artifacts exist"
    );
  });

  it("staleRecommendation is present when evidence is older than 30 days", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

    const { artifactId, versionId } = seedArtifact(repos, "linkedin", {
      ingestedAt: staleDate,
      updatedAt: staleDate,
    });
    seedEvidenceSummary(repos, artifactId, versionId, {
      createdAt: staleDate,
    });

    const result = runBrandStrategy({
      repos,
      websiteMode: "advisory",
      websiteGoal: "",
      brandDirection: "",
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      linkedinContext: { present: true },
      githubContext: { repos: [], profileReadme: "" },
    });

    // staleRecommendation must be present and non-empty
    assert.ok(
      result.staleRecommendation && result.staleRecommendation.length > 0,
      "staleRecommendation must be non-empty when evidence is >30 days"
    );
    assert.equal(typeof result.staleRecommendation, "string");
  });
});

// ============================================================================
// Alignment checklist
// ============================================================================

describe("Cross-surface alignment", () => {
  it("alignmentChecklist references LinkedIn and GitHub alignment items", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "github_profile");
    seedArtifact(repos, "resume");
    seedArtifact(repos, "website");

    const result = runBrandStrategy({
      repos,
      websiteMode: "active",
      websiteGoal: "Technical portfolio site",
      brandDirection: "Full-stack engineering leadership",
      assessmentContext: { signal: 70, evidence: 65, visibility: 50, narrative: 60 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      linkedinContext: { present: true },
      githubContext: { repos: [{ name: "my-app", disposition: "Highlight" }], profileReadme: "dev" },
    });

    assert.ok(
      Array.isArray(result.alignmentChecklist) && result.alignmentChecklist.length > 0,
      "alignmentChecklist must be a non-empty array"
    );

    // Checklist should contain items referencing cross-surface alignment
    const checklistStr = JSON.stringify(result.alignmentChecklist).toLowerCase();
    const hasSurfaceReference =
      checklistStr.includes("linkedin") ||
      checklistStr.includes("github") ||
      checklistStr.includes("resume") ||
      checklistStr.includes("cross");
    assert.ok(
      hasSurfaceReference,
      "alignmentChecklist must reference cross-surface alignment items"
    );
  });
});

// ============================================================================
// Determinism verification
// ============================================================================

describe("Determinism", () => {
  it("produces identical output shape for identical inputs", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const params = {
      repos,
      websiteMode: "active",
      websiteGoal: "Showcase portfolio",
      brandDirection: "Technical leadership",
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      linkedinContext: { present: true },
      githubContext: { repos: [], profileReadme: "" },
    };

    const result1 = runBrandStrategy(params);
    const result2 = runBrandStrategy(params);

    // Structural parity
    assert.deepEqual(
      Object.keys(result1).sort(),
      Object.keys(result2).sort(),
      "Output keys must be identical between runs"
    );

    assert.equal(result1.siteRecommended, result2.siteRecommended, "siteRecommended must be identical");
    assert.equal(result1.workflowDomain, result2.workflowDomain, "workflowDomain must be identical");
  });
});

// ============================================================================
// Builder boundary enforcement
// ============================================================================

describe("Builder boundary", () => {
  it("output does not contain implementation, deployment, or hosting instructions", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "github_profile");
    seedArtifact(repos, "resume");
    seedArtifact(repos, "website");

    const result = runBrandStrategy({
      repos,
      websiteMode: "active",
      websiteGoal: "Portfolio site",
      brandDirection: "Engineering leader",
      assessmentContext: { signal: 70, evidence: 65, visibility: 50, narrative: 60 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      linkedinContext: { present: true },
      githubContext: { repos: [], profileReadme: "" },
    });

    const resultStr = JSON.stringify(result).toLowerCase();

    // Must NOT contain deployment/hosting/implementation details
    const forbiddenPatterns = [
      "deploy to",
      "hosting on",
      "vercel",
      "netlify",
      "cloudflare",
      "npm run build",
      "react component",
      "next.js",
      "docker",
    ];

    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !resultStr.includes(pattern),
        `Output must NOT contain implementation/deployment instructions: "${pattern}"`
      );
    }
  });

  it("recommendedNextAction does not suggest direct site implementation", () => {
    if (!runBrandStrategy) {
      assert.fail("runBrandStrategy not found — module not implemented yet");
    }

    seedArtifact(repos, "linkedin");
    seedArtifact(repos, "resume");

    const result = runBrandStrategy({
      repos,
      websiteMode: "active",
      websiteGoal: "Portfolio site",
      brandDirection: "Engineering leader",
      assessmentContext: { signal: 70, evidence: 50, visibility: 60, narrative: 40 },
      roleFitContext: { bucketScores: {}, blockers: [], easyWins: [], strengths: [], confidence: "medium" },
      linkedinContext: { present: true },
      githubContext: { repos: [], profileReadme: "" },
    });

    assert.ok(
      result.recommendedNextAction && typeof result.recommendedNextAction === "string",
      "recommendedNextAction must be a non-empty string"
    );

    const actionLower = result.recommendedNextAction.toLowerCase();

    // recommendedNextAction must NOT directly prescribe implementation steps
    const forbiddenActions = [
      "npm init",
      "create react app",
      "run build",
      "deploy to",
      "push to github",
    ];

    for (const pattern of forbiddenActions) {
      assert.ok(
        !actionLower.includes(pattern),
        `recommendedNextAction must NOT include implementation step: "${pattern}"`
      );
    }
  });
});

describe("runBrandStrategy — provenance (Phase 4)", () => {
  it("result has provenance with inputs, rules, and trace", () => {
    if (!runBrandStrategy) return;

    const result = runBrandStrategy({
      repos,
      websiteMode: "advisory",
      assessmentContext: { signal: 60, evidence: 55, visibility: 40, narrative: 45 },
    });

    assert.ok(result.provenance, "result should have a provenance field");
    assert.ok(Array.isArray(result.provenance.inputs),
      "provenance.inputs should be an array");
    assert.ok(Array.isArray(result.provenance.rules),
      "provenance.rules should be an array");
    assert.ok(typeof result.provenance.trace === "string" && result.provenance.trace.length > 0,
      "provenance.trace should be a non-empty string");
  });

  it("provenance.rules each have id, effect, reason", () => {
    if (!runBrandStrategy) return;

    const result = runBrandStrategy({ repos, websiteMode: "advisory" });

    for (const rule of result.provenance.rules) {
      assert.ok(typeof rule.id === "string" && rule.id.length > 0, "rule.id non-empty");
      assert.ok(typeof rule.effect === "number", "rule.effect is number");
      assert.ok(typeof rule.reason === "string" && rule.reason.length > 0, "rule.reason non-empty");
    }
  });
});
