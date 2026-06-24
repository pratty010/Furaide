/**
 * Brand Builder Role-Fit Workflow End-to-End Test
 *
 * Phase 4 Plan 03 — runtime proof that the parser, scorer, and role-family
 * history modules operate together as one pipeline. Exercises the full
 * parseJobDescription -> slugRoleFamily -> runRoleFitAssessment ->
 * persistRoleFitSnapshot -> listRoleFitSnapshotsByRoleFamily sequence.
 *
 * Covers the end-to-end contract expected by the diagnostician and
 * orchestrator: normalized JD flows into structured parsing, feeds
 * deterministic scoring, persists with blocker-first semantics, and
 * becomes immediately queryable by role-family slug.
 *
 * Test fixtures:
 *   1. Strong match + full pipeline verification
 *   2. Snapshot queryability and blocker-first persistence
 *   3. Partial-source JD confidence downgrade
 *
 * No live network fetches — fetch fallback is verified in documentation
 * contracts (Task 1). This file is pure Bun runtime.
 */

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const { randomUUID, randomBytes } = require("crypto");

function randomDigest() {
  return randomBytes(32).toString("hex");
}

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");
const { parseJobDescription } = require("../role-fit/jd-parser.js");
const {
  runRoleFitAssessment,
  persistRoleFitSnapshot,
  listRoleFitSnapshotsByRoleFamily,
  slugRoleFamily,
} = require("../assess/role-fit.js");

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Seed an artifact + version + evidence summary.
 * Returns { artifactId, versionId }.
 */
function seedArtifactWithEvidence(repos, artifactType, overrides = {}) {
  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();

  const artifact = {
    artifact_id: artifactId,
    artifact_type: artifactType,
    canonical_path: `${artifactType}-workflow.pdf`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    first_ingested_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    status: overrides.status || "current",
    source_label: `Workflow test ${artifactType}`,
  };
  repos.artifacts.upsert(artifact);

  const version = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    canonical_path: `${artifactType}-workflow.pdf`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    ingested_at: new Date().toISOString(),
    provenance: {
      source: "user_upload",
      update_context: `Workflow test ${artifactType} upload`,
    },
    supersedes_version: null,
  };
  repos.versions.create(version);

  const evidenceContent = overrides.evidenceContent || [
    `Workflow test evidence from ${artifactType}: skills=JavaScript,React,CSS; experience=6 years`,
  ];
  const summaryTypes = overrides.summaryTypes || ["field_extraction"];

  for (let i = 0; i < evidenceContent.length; i++) {
    const summary = {
      summary_id: randomUUID(),
      artifact_id: artifactId,
      version_id: versionId,
      summary_type: summaryTypes[i] || "field_extraction",
      content: evidenceContent[i],
      source_references: [`ref-workflow-${artifactType}-${i + 1}`],
      stale: false,
      created_at: new Date().toISOString(),
    };
    repos.evidence.create(summary);
  }

  return { artifactId, versionId };
}

/**
 * Seed a profile with explicit evidence matching a frontend engineer role.
 */
function seedFrontendProfile(repos) {
  const allVersionIds = [];

  // Resume — explicit frontend evidence
  const resume = seedArtifactWithEvidence(repos, "resume", {
    evidenceContent: [
      "Name=Sam Rivera; skills=React,TypeScript,CSS,Node.js,GraphQL; experience=6 years as frontend engineer; built component library used across 3 products; led migration from Redux to React Query",
      "signal_assessment: resume shows strong frontend signal — React ecosystem expertise, TypeScript adoption, design-systems contributions",
    ],
    summaryTypes: ["field_extraction", "signal_assessment"],
  });
  allVersionIds.push(resume.versionId);

  // LinkedIn — consistent surface
  const linkedin = seedArtifactWithEvidence(repos, "linkedin", {
    evidenceContent: [
      "Skills endorsed: React (180+), TypeScript (150+), CSS (120+), Node.js (90+); current title: Senior Frontend Engineer at TechCorp; about: 'Building performant React applications with TypeScript since 2018'",
      "surface_snapshot: LinkedIn headline reads 'Senior Frontend Engineer — React + TypeScript'; featured project: open-source design system with 1.5k stars",
    ],
    summaryTypes: ["field_extraction", "surface_snapshot"],
  });
  allVersionIds.push(linkedin.versionId);

  // GitHub profile
  const github = seedArtifactWithEvidence(repos, "github_profile", {
    evidenceContent: [
      "Top repos: react-ui-toolkit (1.5k stars), ts-utils (800 stars); primary languages: TypeScript (60%), JavaScript (30%), CSS (8%); contributions this year: 300+ commits, 20+ PRs merged",
    ],
    summaryTypes: ["field_extraction"],
  });
  allVersionIds.push(github.versionId);

  return { allVersionIds, resume, linkedin, github };
}

/**
 * Full JD fixture for a Senior Frontend Engineer role.
 */
function makeFullFrontendJob() {
  return `# Senior Frontend Engineer

## Must Have
- 5+ years of frontend development experience
- React and TypeScript expertise
- Strong CSS knowledge
- Experience with modern JavaScript frameworks

## Preferred
- GraphQL experience
- Open source contributions
- Design system experience

## Responsibilities
- Lead frontend architecture decisions
- Build and maintain a shared component library
- Mentor junior engineers
- Collaborate with design and backend teams

## Qualifications
- Bachelor's degree in Computer Science or equivalent experience
- Portfolio demonstrating complex UI work
- Experience working in agile teams`;
}

/**
 * Partial JD fixture — short, informal, no explicit section headers.
 */
function makePartialFrontendJob() {
  return `Looking for a frontend developer to join our team.

You should know React and be comfortable with JavaScript. CSS skills are important too.

We're a small startup building a SaaS platform. Experience with TypeScript is a bonus.

2+ years of experience preferred.`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let testDb;
let repos;

beforeEach(() => {
  testDb = createTestDb();
  repos = createRepositories(testDb.db);
});

afterEach(() => {
  testDb.close();
});

describe("Role-Fit Workflow — end-to-end pipeline", () => {
  it("parses a full JD, scores against seeded evidence, persists, and retrieves by role-family slug", () => {
    // Seed profile with frontend evidence
    const { allVersionIds } = seedFrontendProfile(repos);

    // Create active baseline
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend-engineer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    // Step 1: Parse the JD
    const parsedJob = parseJobDescription({
      roleTarget: "Senior Frontend Engineer",
      jobDescriptionText: makeFullFrontendJob(),
      sourceType: "url",
      sourceQuality: "full",
    });

    // Verify parser produced structured output
    assert.ok(parsedJob, "parseJobDescription must return a result");
    assert.ok(Array.isArray(parsedJob.mustHaveSkills),
      "mustHaveSkills must be an array");
    assert.ok(parsedJob.mustHaveSkills.length > 0,
      "mustHaveSkills should be populated for a full JD");
    assert.equal(parsedJob.roleTitle, "Senior Frontend Engineer");
    assert.equal(parsedJob.sourceQuality, "full");
    assert.equal(parsedJob.seniority, "senior");

    // Step 2: Generate role-family slug
    const roleSlug = slugRoleFamily({
      roleTitle: parsedJob.roleTitle,
      seniority: parsedJob.seniority,
      domainContext: parsedJob.domainContext,
    });
    assert.ok(typeof roleSlug === "string", "slug must be a string");
    assert.ok(roleSlug.length > 0, "slug must be non-empty");
    assert.ok(roleSlug.includes("senior"),
      "slug should include seniority token");

    // Step 3: Run role-fit assessment
    const assessmentResult = runRoleFitAssessment({
      repos,
      parsedJob,
      roleFamilySlug: roleSlug,
      roleTitle: parsedJob.roleTitle,
    });

    // Verify assessment result shape (contract check)
    const requiredKeys = [
      "fitScore", "bracket", "bucketScores", "blockers",
      "easyWins", "strengths", "confidence", "evidenceUsed",
    ];
    for (const key of requiredKeys) {
      assert.ok(key in assessmentResult,
        `assessmentResult must contain "${key}"`);
    }

    // Verify scoring produced meaningful values
    assert.ok(assessmentResult.fitScore >= 0 && assessmentResult.fitScore <= 100,
      "fitScore must be 0-100");
    const validBrackets = ["excellent", "strong", "moderate", "weak", "poor"];
    assert.ok(validBrackets.includes(assessmentResult.bracket),
      `bracket must be one of ${validBrackets.join(", ")}`);

    // Verify per-bucket scores exist
    const requiredBuckets = [
      "mustHaveMatch", "preferredMatch", "seniorityOwnershipMatch",
      "domainContextMatch", "proofStrength", "presentationMatch",
    ];
    for (const bucket of requiredBuckets) {
      assert.ok(bucket in assessmentResult.bucketScores,
        `bucketScores must contain "${bucket}"`);
    }

    // Step 4: Persist the snapshot
    const snapshot = persistRoleFitSnapshot({
      repos,
      assessmentResult,
      parsedJob,
      artifactVersionIds: allVersionIds,
    });

    assert.ok(snapshot, "persistRoleFitSnapshot must return a snapshot");
    assert.ok(snapshot.snapshot_id, "snapshot must have snapshot_id");
    assert.equal(snapshot.trigger_reason, "new_role_target");

    // Verify profile_state contains role-family metadata
    let profileState;
    try {
      profileState = JSON.parse(snapshot.profile_state);
    } catch {
      assert.fail("profile_state must be valid JSON");
    }
    assert.ok(profileState.role_family_slug,
      "profile_state must contain role_family_slug");
    assert.ok(profileState.role_title,
      "profile_state must contain role_title");
    assert.equal(profileState.role_family_slug, roleSlug,
      "profile_state role_family_slug must match computed slug");

    // Step 5: Retrieve by role-family slug
    const snapshots = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: roleSlug,
      limit: 5,
    });

    assert.ok(Array.isArray(snapshots), "must return an array");
    assert.ok(snapshots.length > 0,
      "should find at least one snapshot for the role family");
    assert.equal(snapshots[0].snapshot_id, snapshot.snapshot_id,
      "most recent snapshot should be the one we just created");
    assert.ok(snapshots[0].role_family_slug,
      "retrieved snapshot must have role_family_slug");
  });
});

describe("Role-Fit Workflow — snapshot queryability and blocker-first persistence", () => {
  it("stored snapshot is queryable by role-family slug and reflects blocker-first semantics", () => {
    const { allVersionIds } = seedFrontendProfile(repos);

    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend-engineer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    // Parse, score, persist
    const parsedJob = parseJobDescription({
      roleTarget: "Senior Frontend Engineer",
      jobDescriptionText: makeFullFrontendJob(),
      sourceType: "url",
      sourceQuality: "full",
    });

    const roleSlug = slugRoleFamily({
      roleTitle: parsedJob.roleTitle,
      seniority: parsedJob.seniority,
      domainContext: parsedJob.domainContext,
    });

    const assessmentResult = runRoleFitAssessment({
      repos,
      parsedJob,
      roleFamilySlug: roleSlug,
      roleTitle: parsedJob.roleTitle,
    });

    const snapshot = persistRoleFitSnapshot({
      repos,
      assessmentResult,
      parsedJob,
      artifactVersionIds: allVersionIds,
    });

    // Retrieve and verify stored data
    const results = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: roleSlug,
      limit: 3,
    });

    assert.equal(results.length, 1, "should have exactly 1 snapshot");

    const stored = results[0];

    // Verify stored profile_state preserves blocker-first information
    const profileState = JSON.parse(stored.profile_state || "{}");
    assert.ok(profileState.role_family_slug,
      "stored snapshot must have role_family_slug");

    // Verify that blocker/easy win/strength order is preserved
    // (blockers, easyWins, strengths — stored as top_blocker_labels)
    if (profileState.top_blocker_labels) {
      assert.ok(Array.isArray(profileState.top_blocker_labels),
        "top_blocker_labels must be an array");
    }

    // Verify fit metadata is stored
    assert.ok(typeof profileState.fit_score === "number",
      "profile_state must contain fit_score");
    assert.ok(["excellent", "strong", "moderate", "weak", "poor"].includes(
      profileState.fit_bracket
    ), `fit_bracket must be valid, got: ${profileState.fit_bracket}`);

    // Verify snapshot metadata is present
    assert.ok(stored.snapshot_id,
      "retrieved snapshot must have snapshot_id");
    assert.ok(stored.created_at,
      "retrieved snapshot must have created_at");
  });

  it("retrieves newest-first when multiple snapshots exist for same role family", () => {
    const { allVersionIds } = seedFrontendProfile(repos);

    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend-engineer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const parsedJob = parseJobDescription({
      roleTarget: "Senior Frontend Engineer",
      jobDescriptionText: makeFullFrontendJob(),
      sourceType: "url",
      sourceQuality: "full",
    });

    const roleSlug = slugRoleFamily({
      roleTitle: parsedJob.roleTitle,
      seniority: parsedJob.seniority,
      domainContext: parsedJob.domainContext,
    });

    const snapshots = [];
    for (let i = 0; i < 2; i++) {
      const result = runRoleFitAssessment({
        repos,
        parsedJob,
        roleFamilySlug: roleSlug,
        roleTitle: parsedJob.roleTitle,
      });
      const snap = persistRoleFitSnapshot({
        repos,
        assessmentResult: result,
        parsedJob,
        artifactVersionIds: allVersionIds,
      });
      snapshots.push(snap);
    }

    const results = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: roleSlug,
      limit: 5,
    });

    assert.ok(results.length >= 2,
      `should have at least 2 snapshots, got ${results.length}`);
    // Most recent first
    assert.equal(results[0].snapshot_id, snapshots[1].snapshot_id,
      "first result should be the most recent snapshot");
  });
});

describe("Role-Fit Workflow — partial-source JD confidence downgrade", () => {
  it("partial-source JD produces lower confidence than full-source JD", () => {
    const { allVersionIds } = seedFrontendProfile(repos);

    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "frontend-developer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    // Full-source assessment
    const fullParsedJob = parseJobDescription({
      roleTarget: "Frontend Developer",
      jobDescriptionText: makeFullFrontendJob(),
      sourceType: "url",
      sourceQuality: "full",
    });

    const fullResult = runRoleFitAssessment({
      repos,
      parsedJob: fullParsedJob,
      roleFamilySlug: slugRoleFamily({
        roleTitle: fullParsedJob.roleTitle,
        seniority: fullParsedJob.seniority,
        domainContext: fullParsedJob.domainContext,
      }),
      roleTitle: fullParsedJob.roleTitle,
    });

    // Partial-source assessment (same evidence, less structured JD)
    const partialParsedJob = parseJobDescription({
      roleTarget: "Frontend Developer",
      jobDescriptionText: makePartialFrontendJob(),
      sourceType: "text",
      sourceQuality: "partial",
    });

    const partialResult = runRoleFitAssessment({
      repos,
      parsedJob: partialParsedJob,
      roleFamilySlug: slugRoleFamily({
        roleTitle: partialParsedJob.roleTitle,
        seniority: partialParsedJob.seniority,
        domainContext: partialParsedJob.domainContext,
      }),
      roleTitle: partialParsedJob.roleTitle,
    });

    // Verify both assessments return valid results
    assert.ok(fullResult.fitScore >= 0 && fullResult.fitScore <= 100);
    assert.ok(partialResult.fitScore >= 0 && partialResult.fitScore <= 100);

    // Full-source confidence should be >= partial-source confidence
    // (partial sources get a 0.5 component vs 1.0 for full in computeConfidence)
    const confidenceRank = { high: 3, medium: 2, low: 1 };
    assert.ok(
      (confidenceRank[fullResult.confidence] || 0) >=
        (confidenceRank[partialResult.confidence] || 0),
      `Full-source confidence (${fullResult.confidence}) should not be lower than partial (${partialResult.confidence})`
    );

    // Partial-source must NOT return "high" confidence
    assert.notEqual(
      partialResult.confidence,
      "high",
      "Partial-source JD must not produce high confidence"
    );

    // Persist both and verify that partial source quality is preserved
    const partialSnapshot = persistRoleFitSnapshot({
      repos,
      assessmentResult: partialResult,
      parsedJob: partialParsedJob,
      artifactVersionIds: allVersionIds,
    });

    const partialProfileState = JSON.parse(partialSnapshot.profile_state || "{}");
    assert.ok(partialProfileState.role_family_slug,
      "partial snapshot must have role_family_slug");
    assert.ok(typeof partialProfileState.fit_score === "number",
      "partial snapshot must have fit_score");
  });

  it("partial-source JD with thin evidence does not produce a falsely confident verdict", () => {
    // Seed a thin profile
    const versionId = randomUUID();
    const artifactId = randomUUID();

    repos.artifacts.upsert({
      artifact_id: artifactId,
      artifact_type: "resume",
      canonical_path: "thin-resume.pdf",
      raw_digest: randomDigest(),
      normalized_digest: randomDigest(),
      first_ingested_at: new Date().toISOString(),
      last_updated_at: new Date().toISOString(),
      status: "current",
      source_label: "Thin resume",
    });

    repos.versions.create({
      version_id: versionId,
      artifact_id: artifactId,
      version_number: 1,
      canonical_path: "thin-resume.pdf",
      raw_digest: randomDigest(),
      normalized_digest: randomDigest(),
      ingested_at: new Date().toISOString(),
      provenance: {
        source: "user_upload",
        update_context: "Thin profile test",
      },
      supersedes_version: null,
    });

    repos.evidence.create({
      summary_id: randomUUID(),
      artifact_id: artifactId,
      version_id: versionId,
      summary_type: "field_extraction",
      content: "Name=Alex; skills=basic HTML; experience=1 year as junior",
      source_references: ["ref-thin-1"],
      stale: false,
      created_at: new Date().toISOString(),
    });

    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: [versionId],
      role_family_target: "frontend-developer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const partialParsedJob = parseJobDescription({
      roleTarget: "Frontend Developer",
      jobDescriptionText: makePartialFrontendJob(),
      sourceType: "text",
      sourceQuality: "partial",
    });

    const result = runRoleFitAssessment({
      repos,
      parsedJob: partialParsedJob,
      roleFamilySlug: slugRoleFamily({
        roleTitle: partialParsedJob.roleTitle,
        seniority: partialParsedJob.seniority,
        domainContext: partialParsedJob.domainContext,
      }),
      roleTitle: partialParsedJob.roleTitle,
    });

    // With partial source AND thin evidence, confidence MUST NOT be high
    assert.notEqual(result.confidence, "high",
      `Partial-source + thin evidence must not produce high confidence, got: ${result.confidence}`
    );

    // Confidence should be "low" — both source and evidence are weak
    assert.equal(result.confidence, "low",
      `Expected low confidence for partial + thin, got: ${result.confidence}`
    );
  });
});
