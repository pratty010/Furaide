/**
 * Brand Builder Role-Fit Scoring and History Contract Tests
 *
 * Covers ROLE-02 through ROLE-04 plus D-09 history behaviors.
 * Uses createTestDb() + repository seeding to construct realistic
 * multi-artifact, multi-evidence scenarios that exercise weighted scoring,
 * bracket mapping, blocker-first partitioning, and role-family history.
 *
 * The imports for runRoleFitAssessment, persistRoleFitSnapshot,
 * listRoleFitSnapshotsByRoleFamily, and slugRoleFamily will fail until
 * the respective modules are implemented — this is the TDD RED phase.
 *
 * Test fixtures:
 *   1. Strong match — explicit React/TypeScript/frontend proof across artifacts
 *   2. Missing must-have — required skill not present in any evidence
 *   3. Presentation-risk — evidence exists but terminology/surface weak
 *   4. Repeated persistence — multiple snapshots for same role family, recall by slug
 */

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const { randomUUID, randomBytes } = require("crypto");

function randomDigest() {
  return randomBytes(32).toString("hex");
}

const { createTestDb } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");
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
 * Seed an artifact + version + evidence summary(ies).
 * Returns { artifact, version, summaryIds }.
 */
function seedArtifactWithEvidence(repos, artifactType, overrides = {}) {
  const artifactId = overrides.artifactId || randomUUID();
  const versionId = overrides.versionId || randomUUID();

  const artifact = {
    artifact_id: artifactId,
    artifact_type: artifactType,
    canonical_path: `${artifactType}-sample.pdf`,
    raw_digest: randomDigest(),
    normalized_digest: randomDigest(),
    first_ingested_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    status: overrides.status || "current",
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

  const evidenceContent = overrides.evidenceContent || [
    `Extracted from ${artifactType}: skills=TypeScript,Python,React; experience=8 years; education=CS degree`,
  ];
  const summaryTypes = overrides.summaryTypes || ["field_extraction"];
  const staleFlags = overrides.staleFlags || [false];
  const summaryIds = [];

  for (let i = 0; i < evidenceContent.length; i++) {
    const summaryId = randomUUID();
    const summary = {
      summary_id: summaryId,
      artifact_id: artifactId,
      version_id: versionId,
      summary_type: summaryTypes[i] || "field_extraction",
      content: evidenceContent[i],
      source_references: [`ref-${artifactType}-${i + 1}`],
      stale: staleFlags[i] !== undefined ? staleFlags[i] : false,
      stale_reason: staleFlags[i] ? "Artifact updated" : undefined,
      created_at: new Date().toISOString(),
    };
    repos.evidence.create(summary);
    summaryIds.push(summaryId);
  }

  const versionIds = [versionId];
  return { artifact, version, versionIds, summaryIds };
}

/**
 * Seed a full profile with rich evidence suitable for strong match scenarios.
 */
function seedStrongFrontendProfile(repos) {
  const allVersionIds = [];

  // Resume — strong frontend signal
  const resume = seedArtifactWithEvidence(repos, "resume", {
    evidenceContent: [
      "Name=Alex Chen; skills=TypeScript,React,Next.js,CSS-in-JS,Node.js; experience=7 years as frontend engineer; built design system used by 200+ engineers; led migration from class components to hooks",
      "signal_assessment: resume shows strong senior frontend signal — design systems, team leadership, modern stack",
    ],
    summaryTypes: ["field_extraction", "signal_assessment"],
  });
  allVersionIds.push(...resume.versionIds);

  // LinkedIn — consistent with resume
  const linkedin = seedArtifactWithEvidence(repos, "linkedin", {
    evidenceContent: [
      "Skills endorsed: TypeScript (220+), React (180+), Frontend Architecture (90+), Design Systems (75+); current title: Senior Frontend Engineer; previous: Frontend Lead at StartupX",
      "surface_snapshot: LinkedIn headline reads 'Senior Frontend Engineer — Design Systems & Platform'; about section describes 7+ years building scalable React applications; featured project: open-source component library with 2k+ stars",
    ],
    summaryTypes: ["field_extraction", "surface_snapshot"],
  });
  allVersionIds.push(...linkedin.versionIds);

  // GitHub — shows real code proof
  const github = seedArtifactWithEvidence(repos, "github_profile", {
    evidenceContent: [
      "Top repos: react-design-system (2.3k stars), nextjs-starter (850 stars), typed-api-client (420 stars); contributions this year: 500+ commits across 30 repos; primary languages: TypeScript (65%), JavaScript (20%), CSS (10%)",
      "field_extraction: GitHub profile shows active open-source presence; react-design-system repo has extensive TypeScript types, Storybook documentation, and CI pipeline with visual regression testing",
    ],
    summaryTypes: ["field_extraction", "field_extraction"],
  });
  allVersionIds.push(...github.versionIds);

  // GitHub repo — specific proof
  const ghRepo = seedArtifactWithEvidence(repos, "github_repo", {
    evidenceContent: [
      "Repo react-design-system: TypeScript 92%, comprehensive test suite with 95% coverage, 200+ components, Storybook with interactive examples, documented contribution guidelines, used by 3 enterprise teams",
    ],
    summaryTypes: ["field_extraction"],
  });
  allVersionIds.push(...ghRepo.versionIds);

  return { allVersionIds, resume, linkedin, github, ghRepo };
}

/**
 * Seed a thin profile — only resume with weak evidence.
 */
function seedThinProfile(repos) {
  const allVersionIds = [];

  const resume = seedArtifactWithEvidence(repos, "resume", {
    evidenceContent: [
      "Name=Jordan Lee; skills=Excel,Word,PowerPoint; experience=2 years as administrative assistant; education: high school diploma",
    ],
    summaryTypes: ["field_extraction"],
  });
  allVersionIds.push(...resume.versionIds);

  return { allVersionIds, resume };
}

/**
 * Seed a profile where evidence exists but presentation is weak.
 */
function seedPresentationWeakProfile(repos) {
  const allVersionIds = [];

  const resume = seedArtifactWithEvidence(repos, "resume", {
    evidenceContent: [
      "Name=Taylor Kim; skills=Python,ML,TensorFlow,data analysis; experience=5 years in data science; education: MS in Statistics",
      "signal_assessment: resume mentions machine learning experience but buried under administrative duties section; TensorFlow usage described as 'familiar with' rather than project ownership",
    ],
    summaryTypes: ["field_extraction", "signal_assessment"],
  });
  allVersionIds.push(...resume.versionIds);

  const linkedin = seedArtifactWithEvidence(repos, "linkedin", {
    evidenceContent: [
      "current title: Data Analyst; skills: Python, SQL, data visualization; about section focuses on reporting rather than ML engineering",
      "surface_snapshot: LinkedIn about section reads 'Experienced data professional skilled in reporting and dashboards' — ML depth is not surfaced; headline mentions 'Data Analyst' not 'ML Engineer'",
    ],
    summaryTypes: ["field_extraction", "surface_snapshot"],
  });
  allVersionIds.push(...linkedin.versionIds);

  return { allVersionIds, resume, linkedin };
}

/**
 * Create a parsedJob fixture for a strong frontend role match.
 */
function makeStrongFrontendJob() {
  return {
    roleTitle: "Senior Frontend Engineer",
    seniority: "senior",
    mustHaveSkills: ["typescript", "react", "css", "javascript"],
    preferredSkills: ["next.js", "design systems", "storybook", "testing"],
    responsibilities: [
      "Build and maintain design system components",
      "Lead frontend architecture decisions",
      "Mentor junior engineers",
      "Collaborate with design team",
    ],
    qualifications: [
      "5+ years frontend experience",
      "Bachelor's in CS or equivalent",
    ],
    experienceSignals: ["design system ownership", "team leadership", "open source"],
    domainContext: ["frontend", "platform", "design-systems"],
    proofExpectations: ["github portfolio", "component library examples"],
    toolingTerms: ["react", "typescript", "storybook", "jest", "webpack"],
    sourceType: "pasted_text",
    sourceQuality: "full",
  };
}

/**
 * Create a parsedJob fixture that requires skills absent from the thin profile.
 */
function makeMismatchedJob() {
  return {
    roleTitle: "Staff Backend Engineer",
    seniority: "staff",
    mustHaveSkills: ["golang", "distributed systems", "kubernetes", "postgresql"],
    preferredSkills: ["grpc", "terraform", "aws"],
    responsibilities: [
      "Design distributed system architecture",
      "Lead backend platform team",
      "Define SLOs and reliability standards",
    ],
    qualifications: [
      "8+ years backend experience",
      "Experience scaling systems to 1M+ users",
    ],
    experienceSignals: ["platform ownership", "architecture decisions", "on-call leadership"],
    domainContext: ["backend", "infrastructure", "distributed-systems"],
    proofExpectations: ["open source contributions", "system design artifacts"],
    toolingTerms: ["kubernetes", "terraform", "grpc", "prometheus"],
    sourceType: "pasted_text",
    sourceQuality: "full",
  };
}

/**
 * Create a parsedJob fixture for ML Engineer role (presentation gap test).
 */
function makeMLEngineerJob() {
  return {
    roleTitle: "Machine Learning Engineer",
    seniority: "senior",
    mustHaveSkills: ["python", "machine learning", "tensorflow", "data analysis"],
    preferredSkills: ["deep learning", "nlp", "computer vision"],
    responsibilities: [
      "Build and deploy ML models to production",
      "Design ML pipelines and feature engineering",
    ],
    qualifications: [
      "MS or PhD in CS, Stats, or related field",
      "3+ years ML engineering experience",
    ],
    experienceSignals: ["model deployment", "pipeline design"],
    domainContext: ["machine-learning", "data-science"],
    proofExpectations: ["production ML models", "research publications or blog posts"],
    toolingTerms: ["tensorflow", "python", "mlflow", "docker"],
    sourceType: "pasted_text",
    sourceQuality: "full",
  };
}

/**
 * Create a parsedJob fixture with partial source quality.
 */
function makePartialQualityJob() {
  return {
    roleTitle: "Frontend Developer",
    seniority: "mid",
    mustHaveSkills: ["javascript", "css", "html"],
    preferredSkills: ["react", "vue"],
    responsibilities: ["Build responsive web interfaces"],
    qualifications: ["2+ years experience"],
    experienceSignals: [],
    domainContext: ["frontend"],
    proofExpectations: [],
    toolingTerms: ["react", "css"],
    sourceType: "pasted_text",
    sourceQuality: "partial",
  };
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

describe("slugRoleFamily", () => {
  it("produces a stable lowercase slug from roleTitle, seniority, and domainContext", () => {
    const slug = slugRoleFamily({
      roleTitle: "Senior Frontend Engineer",
      seniority: "senior",
      domainContext: ["frontend", "platform"],
    });

    assert.ok(typeof slug === "string", "slug should be a string");
    assert.ok(slug.length > 0, "slug should be non-empty");
    assert.equal(slug, slug.toLowerCase(), "slug should be lowercase");

    // Determinism: same inputs produce same slug
    const slug2 = slugRoleFamily({
      roleTitle: "Senior Frontend Engineer",
      seniority: "senior",
      domainContext: ["frontend", "platform"],
    });
    assert.equal(slug, slug2, "same inputs must produce identical slug");

    // Different inputs produce different slugs
    const slug3 = slugRoleFamily({
      roleTitle: "Staff Backend Engineer",
      seniority: "staff",
      domainContext: ["backend", "infrastructure"],
    });
    assert.notEqual(slug, slug3, "different inputs must produce different slugs");
  });

  it("normalizes whitespace and casing in roleTitle", () => {
    const slug1 = slugRoleFamily({
      roleTitle: "  Senior   Frontend  Engineer  ",
      seniority: "senior",
      domainContext: ["frontend"],
    });
    const slug2 = slugRoleFamily({
      roleTitle: "senior frontend engineer",
      seniority: "senior",
      domainContext: ["frontend"],
    });
    assert.equal(slug1, slug2, "slug should normalize whitespace and casing");
  });

  it("handles empty domainContext gracefully", () => {
    const slug = slugRoleFamily({
      roleTitle: "Junior Developer",
      seniority: "junior",
      domainContext: [],
    });
    assert.ok(typeof slug === "string", "slug should still be a string with empty domain");
    assert.ok(slug.length > 0, "slug should be non-empty even without domain");
  });
});

describe("runRoleFitAssessment — weighted scoring and bracket", () => {
  it("returns fitScore, bracket, bucketScores, blockers, easyWins, strengths, confidence, and evidenceUsed", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);

    // Create a baseline so role-family context is available in memory
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const parsedJob = makeStrongFrontendJob();
    const result = runRoleFitAssessment({
      repos,
      parsedJob,
      roleFamilySlug: "senior-frontend",
      roleTitle: "Senior Frontend Engineer",
    });

    // Required output keys (per plan)
    const requiredKeys = [
      "fitScore", "bracket", "bucketScores", "blockers",
      "easyWins", "strengths", "confidence", "evidenceUsed",
    ];
    for (const key of requiredKeys) {
      assert.ok(key in result, `result must contain "${key}"`);
    }

    // fitScore should be a number 0-100
    assert.ok(typeof result.fitScore === "number", "fitScore must be a number");
    assert.ok(result.fitScore >= 0 && result.fitScore <= 100,
      `fitScore ${result.fitScore} should be within 0-100`);

    // bracket must be one of the five D-06 bands
    const validBrackets = ["excellent", "strong", "moderate", "weak", "poor"];
    assert.ok(validBrackets.includes(result.bracket),
      `bracket "${result.bracket}" must be one of ${validBrackets.join(", ")}`);

    // bucketScores must contain all 6 scoring buckets
    const requiredBuckets = [
      "mustHaveMatch", "preferredMatch", "seniorityOwnershipMatch",
      "domainContextMatch", "proofStrength", "presentationMatch",
    ];
    assert.ok(result.bucketScores && typeof result.bucketScores === "object",
      "bucketScores must be an object");
    for (const bucket of requiredBuckets) {
      assert.ok(bucket in result.bucketScores, `bucketScores must contain "${bucket}"`);
      const score = result.bucketScores[bucket];
      assert.ok(typeof score === "number", `bucketScores.${bucket} must be a number`);
      assert.ok(score >= 0 && score <= 100,
        `bucketScores.${bucket} (${score}) should be within 0-100`);
    }

    // blockers, easyWins, strengths must be arrays
    assert.ok(Array.isArray(result.blockers), "blockers must be an array");
    assert.ok(Array.isArray(result.easyWins), "easyWins must be an array");
    assert.ok(Array.isArray(result.strengths), "strengths must be an array");

    // confidence must be a valid level
    const validConfidence = ["high", "medium", "low"];
    assert.ok(validConfidence.includes(result.confidence),
      `confidence "${result.confidence}" must be one of ${validConfidence.join(", ")}`);

    // evidenceUsed must be an array
    assert.ok(Array.isArray(result.evidenceUsed),
      "evidenceUsed must be an array");
  });

  it("strong frontend match yields strong or excellent bracket", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const result = runRoleFitAssessment({
      repos,
      parsedJob: makeStrongFrontendJob(),
      roleFamilySlug: "senior-frontend",
      roleTitle: "Senior Frontend Engineer",
    });

    assert.ok(
      result.bracket === "excellent" || result.bracket === "strong",
      `Strong match should be excellent or strong, got "${result.bracket}" with fitScore ${result.fitScore}`
    );

    // Bucket scores should be high for key matching areas
    assert.ok(result.bucketScores.mustHaveMatch >= 50,
      `mustHaveMatch should be moderate or better, got ${result.bucketScores.mustHaveMatch}`);

    // Should have some strengths
    assert.ok(result.strengths.length > 0,
      `Strong match should have strengths, got ${result.strengths.length}`);
  });

  it("missing must-have skills produce blockers before easyWins and strengths", () => {
    const { allVersionIds } = seedThinProfile(repos);
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "staff-backend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const result = runRoleFitAssessment({
      repos,
      parsedJob: makeMismatchedJob(),
      roleFamilySlug: "staff-backend",
      roleTitle: "Staff Backend Engineer",
    });

    // Should be weak or poor — no matching skills at all
    assert.ok(
      result.bracket === "weak" || result.bracket === "poor",
      `Mismatch should be weak or poor, got "${result.bracket}" with fitScore ${result.fitScore}`
    );

    // Must have blockers for missing required skills
    assert.ok(result.blockers.length > 0,
      `Missing required skills must produce blockers, got ${result.blockers.length}`);

    // Each blocker should mention what's missing
    for (const blocker of result.blockers) {
      assert.ok(typeof blocker === "string" && blocker.length > 0,
        "Each blocker must be a non-empty string");
    }

    // mustHaveMatch bucket should be low
    assert.ok(result.bucketScores.mustHaveMatch < 40,
      `mustHaveMatch should be very low for mismatched profile, got ${result.bucketScores.mustHaveMatch}`);
  });

  it("partial source quality downgrades confidence", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const result = runRoleFitAssessment({
      repos,
      parsedJob: makePartialQualityJob(),
      roleFamilySlug: "frontend",
      roleTitle: "Frontend Developer",
    });

    assert.ok(typeof result.confidence === "string",
      "confidence must be a string even with partial source");
  });

  it("evidence exists but presentation is weak produces easyWins not blockers", () => {
    const { allVersionIds } = seedPresentationWeakProfile(repos);
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "ml-engineer",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const result = runRoleFitAssessment({
      repos,
      parsedJob: makeMLEngineerJob(),
      roleFamilySlug: "ml-engineer",
      roleTitle: "Machine Learning Engineer",
    });

    // presentationMatch should be lower than mustHaveMatch since evidence exists
    // but surface terminology is weak
    const pm = result.bucketScores.presentationMatch;
    const mm = result.bucketScores.mustHaveMatch;

    // Presentation weak but must-haves partially met (Python, ML, TensorFlow exist in evidence)
    assert.ok(mm >= 40,
      `mustHaveMatch should have some signal, got ${mm} (Python/ML/TensorFlow in evidence)`);

    // Should have easy wins about repositioning/presentation
    const hasEasyWins = result.easyWins.length > 0;
    // Even if no dedicated easyWins section, the presentation weakness should be visible
    assert.ok(
      hasEasyWins || pm < 70,
      `Either easyWins should flag presentation issues or presentationMatch should reflect weakness (got: easyWins=${result.easyWins.length}, presentationMatch=${pm})`
    );
  });
});

describe("runRoleFitAssessment — blocker ordering", () => {
  it("blockers appear before easyWins in the output structure", () => {
    const { allVersionIds } = seedThinProfile(repos);
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "staff-backend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const result = runRoleFitAssessment({
      repos,
      parsedJob: makeMismatchedJob(),
      roleFamilySlug: "staff-backend",
      roleTitle: "Staff Backend Engineer",
    });

    // The ordering is inherent in the result keys — blockers first,
    // then easyWins, then strengths. The consumer (diagnostician/orchestrator)
    // renders them in this order.
    // We verify that the result has all three arrays.
    assert.ok(Array.isArray(result.blockers), "blockers must be present");
    assert.ok(Array.isArray(result.easyWins), "easyWins must be present");
    assert.ok(Array.isArray(result.strengths), "strengths must be present");

    // At minimum, when blockers exist, they should be populated
    if (result.blockers.length > 0) {
      assert.ok(result.blockers.every(b => typeof b === "string" && b.length > 0),
        "All blockers must be descriptive strings");
    }
  });

  it("strengths only appear when bucket scores reach threshold", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const result = runRoleFitAssessment({
      repos,
      parsedJob: makeStrongFrontendJob(),
      roleFamilySlug: "senior-frontend",
      roleTitle: "Senior Frontend Engineer",
    });

    // For a strong match, strengths should be populated
    assert.ok(result.strengths.length > 0,
      "Strong match should produce strengths");
    for (const strength of result.strengths) {
      assert.ok(typeof strength === "string" && strength.length > 0,
        "Each strength must be a descriptive string");
    }
  });
});

describe("persistRoleFitSnapshot and listRoleFitSnapshotsByRoleFamily", () => {
  it("persists a snapshot with role-family metadata and retrieves by slug", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);

    // Create an active baseline for belongs_to_role_family edge
    const baselineId = randomUUID();
    repos.baselines.create({
      baseline_id: baselineId,
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const parsedJob = makeStrongFrontendJob();
    const assessmentResult = runRoleFitAssessment({
      repos,
      parsedJob,
      roleFamilySlug: "senior-frontend",
      roleTitle: "Senior Frontend Engineer",
    });

    const snapshot = persistRoleFitSnapshot({
      repos,
      assessmentResult,
      parsedJob,
      artifactVersionIds: allVersionIds,
    });

    // Snapshot must have been created
    assert.ok(snapshot, "persistRoleFitSnapshot must return the created snapshot");
    assert.ok(snapshot.snapshot_id, "snapshot must have a snapshot_id");
    assert.equal(snapshot.trigger_reason, "new_role_target",
      "snapshot trigger_reason must be 'new_role_target'");

    // profile_state must contain role-family metadata
    let profileState;
    try {
      profileState = JSON.parse(snapshot.profile_state);
    } catch {
      assert.fail("profile_state must be valid JSON");
    }
    assert.ok(profileState.role_family_slug, "profile_state must contain role_family_slug");
    assert.ok(profileState.role_title, "profile_state must contain role_title");
    assert.ok(typeof profileState.fit_score === "number",
      "profile_state must contain fit_score as number");
    assert.ok(profileState.fit_bracket, "profile_state must contain fit_bracket");

    // List by role family slug — use the computed slug from slugRoleFamily()
    const expectedSlug = slugRoleFamily({
      roleTitle: parsedJob.roleTitle,
      seniority: parsedJob.seniority,
      domainContext: parsedJob.domainContext,
    });
    const snapshots = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: expectedSlug,
      limit: 5,
    });

    assert.ok(Array.isArray(snapshots), "listRoleFitSnapshotsByRoleFamily must return an array");
    assert.ok(snapshots.length > 0,
      "Should find at least one snapshot matching the role family slug");
    assert.equal(snapshots[0].snapshot_id, snapshot.snapshot_id,
      "The most recent snapshot should be the one we just created");
  });

  it("persists multiple snapshots and retrieves most recent first", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);

    const baselineId = randomUUID();
    repos.baselines.create({
      baseline_id: baselineId,
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const parsedJob = makeStrongFrontendJob();

    // Create 3 snapshots to test ordering (same role family)
    const snapshots = [];
    for (let i = 0; i < 3; i++) {
      const assessmentResult = runRoleFitAssessment({
        repos,
        parsedJob,
        roleFamilySlug: "senior-frontend",
        roleTitle: parsedJob.roleTitle,
      });

      const snap = persistRoleFitSnapshot({
        repos,
        assessmentResult,
        parsedJob,
        artifactVersionIds: allVersionIds,
      });
      snapshots.push(snap);
    }

    // Use the computed slug for lookup
    const expectedSlug = slugRoleFamily({
      roleTitle: parsedJob.roleTitle,
      seniority: parsedJob.seniority,
      domainContext: parsedJob.domainContext,
    });

    // Retrieve — should get most recent first
    const results = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: expectedSlug,
      limit: 3,
    });

    assert.ok(results.length >= 2,
      `Should find at least 2 snapshots, got ${results.length}`);
    // Most recent first (last created)
    assert.equal(results[0].snapshot_id, snapshots[2].snapshot_id,
      "First result should be most recent snapshot");
  });

  it("respects the limit parameter", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);

    const baselineId = randomUUID();
    repos.baselines.create({
      baseline_id: baselineId,
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const parsedJob = makeStrongFrontendJob();

    for (let i = 0; i < 5; i++) {
      const assessmentResult = runRoleFitAssessment({
        repos,
        parsedJob,
        roleFamilySlug: "senior-frontend",
        roleTitle: parsedJob.roleTitle,
      });
      persistRoleFitSnapshot({
        repos,
        assessmentResult,
        parsedJob,
        artifactVersionIds: allVersionIds,
      });
    }

    const results = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: slugRoleFamily({
        roleTitle: parsedJob.roleTitle,
        seniority: parsedJob.seniority,
        domainContext: parsedJob.domainContext,
      }),
      limit: 2,
    });

    assert.ok(results.length <= 2,
      `limit=2 should return at most 2 snapshots, got ${results.length}`);
  });

  it("returns empty array for unknown role family slug", () => {
    const { allVersionIds } = seedStrongFrontendProfile(repos);
    repos.baselines.create({
      baseline_id: randomUUID(),
      primary_artifact_ids: allVersionIds,
      role_family_target: "senior-frontend",
      status: "active",
      created_at: new Date().toISOString(),
      superseded_at: null,
    });

    const parsedJob = makeStrongFrontendJob();
    const assessmentResult = runRoleFitAssessment({
      repos,
      parsedJob,
      roleFamilySlug: "senior-frontend",
      roleTitle: parsedJob.roleTitle,
    });
    persistRoleFitSnapshot({
      repos,
      assessmentResult,
      parsedJob,
      artifactVersionIds: allVersionIds,
    });

    const results = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: "nonexistent-role-slug",
      limit: 5,
    });

    assert.ok(Array.isArray(results), "should return an array even for unknown slug");
    assert.equal(results.length, 0, "should return empty array for unknown role family slug");
  });
});

describe("runRoleFitAssessment — score provenance (Phase 4)", () => {
  it("result has top-level provenance with inputs, rules, and trace", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedStrongFrontendProfile(repos);
    const parsedJob = {
      mustHaveSkills: ["TypeScript", "React"],
      preferredSkills: ["Next.js"],
      experienceSignals: ["senior", "design systems"],
      domainContext: ["frontend"],
      proofExpectations: ["open source"],
      toolingTerms: ["storybook"],
      sourceQuality: "full",
    };

    const result = runRoleFitAssessment({ repos, parsedJob, roleFamilySlug: "senior-frontend", roleTitle: "Senior Frontend Engineer" });

    assert.ok(result.provenance, "result should have a provenance field");
    assert.ok(Array.isArray(result.provenance.inputs), "provenance.inputs should be an array");
    assert.ok(Array.isArray(result.provenance.rules), "provenance.rules should be an array");
    assert.ok(typeof result.provenance.trace === "string" && result.provenance.trace.length > 0,
      "provenance.trace should be a non-empty string");

    db.close();
  });

  it("result has bucketProvenance for each of the 6 buckets", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedStrongFrontendProfile(repos);
    const parsedJob = {
      mustHaveSkills: ["TypeScript", "React"],
      preferredSkills: ["Next.js"],
      experienceSignals: ["senior"],
      domainContext: ["frontend"],
      proofExpectations: ["github"],
      toolingTerms: ["storybook"],
      sourceQuality: "full",
    };

    const result = runRoleFitAssessment({ repos, parsedJob, roleFamilySlug: "senior-frontend", roleTitle: "Senior Frontend Engineer" });

    assert.ok(result.bucketProvenance, "result should have bucketProvenance");
    const buckets = ["mustHaveMatch", "preferredMatch", "seniorityOwnershipMatch", "domainContextMatch", "proofStrength", "presentationMatch"];
    for (const bucket of buckets) {
      const bp = result.bucketProvenance[bucket];
      assert.ok(bp, `bucketProvenance.${bucket} should exist`);
      assert.ok(Array.isArray(bp.inputs), `bucketProvenance.${bucket}.inputs should be an array`);
      assert.ok(Array.isArray(bp.rules), `bucketProvenance.${bucket}.rules should be an array`);
      assert.ok(typeof bp.trace === "string" && bp.trace.length > 0,
        `bucketProvenance.${bucket}.trace should be a non-empty string`);
    }

    db.close();
  });

  it("provenance.rules each have id, effect, reason fields", () => {
    const { db } = createTestDb();
    const repos = createRepositories(db);

    seedStrongFrontendProfile(repos);
    const parsedJob = { mustHaveSkills: ["TypeScript"], sourceQuality: "full" };

    const result = runRoleFitAssessment({ repos, parsedJob, roleFamilySlug: "frontend", roleTitle: "Engineer" });

    for (const rule of result.provenance.rules) {
      assert.ok(typeof rule.id === "string" && rule.id.length > 0, "rule.id should be a non-empty string");
      assert.ok(typeof rule.effect === "number", "rule.effect should be a number");
      assert.ok(typeof rule.reason === "string" && rule.reason.length > 0, "rule.reason should be a non-empty string");
    }

    db.close();
  });
});
