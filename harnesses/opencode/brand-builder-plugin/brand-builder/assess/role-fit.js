/**
 * Brand Builder Role-Fit Assessment Engine
 *
 * Deterministic scoring module that evaluates profile evidence against a
 * parsed job description to produce weighted bucket scores, a 5-band fit
 * bracket, blocker-first output partitioning, and confidence.
 *
 * Per D-04 through D-08 and ROLE-02 through ROLE-04. No LLM calls — pure
 * computation using evidence-summary content and latest profile-state strings.
 *
 * Module exports:
 *   - runRoleFitAssessment({ repos, parsedJob, roleFamilySlug, roleTitle })
 *
 * Re-exports from history.js:
 *   - persistRoleFitSnapshot({ repos, assessmentResult, parsedJob, artifactVersionIds })
 *   - listRoleFitSnapshotsByRoleFamily({ repos, roleFamilySlug, limit })
 *   - slugRoleFamily({ roleTitle, seniority, domainContext })
 */

const {
  getArtifactContext,
  getLatestProfileState,
} = require("../memory/retrieval.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bucket weights (must sum to 1.0). Reordered: required-first per plan. */
const BUCKET_WEIGHTS = {
  mustHaveMatch: 0.30,
  preferredMatch: 0.10,
  seniorityOwnershipMatch: 0.20,
  domainContextMatch: 0.15,
  proofStrength: 0.15,
  presentationMatch: 0.10,
};

/** D-06 bracket thresholds (inclusive lower bound). */
const BRACKET_THRESHOLDS = [
  { min: 90, bracket: "excellent" },
  { min: 75, bracket: "strong" },
  { min: 60, bracket: "moderate" },
  { min: 40, bracket: "weak" },
  { min: 0, bracket: "poor" },
];

/** Blocker thresholds per plan rules. */
const BLOCKER_SENIORITY_OWNERSHIP_THRESHOLD = 50;
const BLOCKER_PROOF_STRENGTH_THRESHOLD = 40;

/** Easy-win presentation threshold. */
const EASYWIN_PRESENTATION_THRESHOLD = 60;

/** Strength threshold — bucket score >= this is a strength. */
const STRENGTH_THRESHOLD = 70;

/** Confidence — max evidence summaries per artifact for "rich" threshold. */
const RICH_EVIDENCE_PER_ARTIFACT = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all evidence text from artifact context + latest profile state
 * into a single lowercase string for deterministic term matching.
 *
 * @param {object} context — result from getArtifactContext()
 * @param {object|null} profileState — result from getLatestProfileState()
 * @returns {string}
 */
function buildEvidenceCorpus(context, profileState) {
  const parts = [];

  for (const rtype of Object.keys(context)) {
    const entry = context[rtype];
    if (!entry) continue;

    // Include artifact type label
    parts.push(rtype);

    // Include version file path if available
    if (entry.latestVersion && entry.latestVersion.canonical_path) {
      parts.push(entry.latestVersion.canonical_path);
    }

    // Include all non-stale evidence summary content
    for (const summary of entry.summaries || []) {
      if (summary.content) {
        parts.push(summary.content);
      }
      if (summary.summary_type) {
        parts.push(summary.summary_type);
      }
    }
  }

  // Include profile state JSON as text
  if (profileState && profileState.profileState) {
    parts.push(profileState.profileState);
  }

  // Dimension summary labels
  if (profileState && profileState.dimensionSummary) {
    const ds = profileState.dimensionSummary;
    parts.push(`signal:${ds.signal} evidence:${ds.evidence} visibility:${ds.visibility} narrative:${ds.narrative}`);
  }

  return parts.join(" ").toLowerCase();
}

/**
 * Determine if a term is present in the evidence corpus.
 * For single-word terms: exact substring match.
 * For multi-word terms (2+ words): checks if >= 70% of the individual
 * words appear anywhere in the corpus (near-exact proximity match).
 *
 * @param {string} corpus — lowercase evidence text
 * @param {string} term — lowercase search term
 * @returns {boolean}
 */
function termInCorpus(corpus, term) {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return false;

  // Single-word or short term: exact substring match
  const words = normalized.split(/\s+/);
  if (words.length <= 1) {
    return corpus.includes(normalized);
  }

  // Multi-word term: check if >= 70% of words appear individually
  // Also try exact phrase match first (preferred)
  if (corpus.includes(normalized)) return true;

  let matched = 0;
  for (const word of words) {
    if (word.length > 1 && corpus.includes(word)) {
      matched++;
    }
  }

  // Require at least 70% of meaningful words to match
  const threshold = Math.max(1, Math.ceil(words.length * 0.7));
  return matched >= threshold;
}

/**
 * Score a list of terms against the evidence corpus.
 * Returns a 0-100 score based on match ratio.
 *
 * @param {string} corpus — lowercase evidence text
 * @param {string[]} terms — array of terms to match
 * @returns {number} 0-100
 */
function scoreTermList(corpus, terms) {
  if (!terms || terms.length === 0) return 100; // No terms expected = perfect match
  let matched = 0;
  for (const term of terms) {
    if (termInCorpus(corpus, term)) {
      matched++;
    }
  }
  return Math.round((matched / terms.length) * 100);
}

/**
 * Map a numeric fit score to a bracket label.
 *
 * @param {number} fitScore — 0-100
 * @returns {string} bracket label
 */
function scoreToBracket(fitScore) {
  for (const { min, bracket } of BRACKET_THRESHOLDS) {
    if (fitScore >= min) return bracket;
  }
  return "poor";
}

/**
 * Compute confidence level considering source quality and evidence depth.
 *
 * @param {object} parsedJob
 * @param {object} context — getArtifactContext result
 * @param {object|null} profileState
 * @returns {string} "high", "medium", or "low"
 */
function computeConfidence(parsedJob, context, profileState) {
  let confidenceScore = 0;

  // Component 1: Source quality (0-1)
  if (parsedJob.sourceQuality === "full") {
    confidenceScore += 1;
  } else if (parsedJob.sourceQuality === "partial") {
    confidenceScore += 0.5;
  } else {
    confidenceScore += 0.3;
  }

  // Component 2: Evidence depth ratio
  let totalSummaries = 0;
  let artifactCount = 0;
  for (const rtype of Object.keys(context)) {
    const entry = context[rtype];
    if (entry && entry.artifact) {
      artifactCount++;
      totalSummaries += (entry.summaries || []).length;
    }
  }
  const expectedSummaries = artifactCount * RICH_EVIDENCE_PER_ARTIFACT;
  const evidenceRatio = expectedSummaries > 0
    ? Math.min(1, totalSummaries / expectedSummaries)
    : 0;
  confidenceScore += evidenceRatio;

  // Component 3: Snapshot recency (0-1)
  let recencyScore = 0;
  if (profileState && profileState.createdAt) {
    const daysSince = (Date.now() - new Date(profileState.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    recencyScore = Math.max(0, 1 - daysSince / 90);
  }
  confidenceScore += recencyScore;

  // Average of 3 components
  const avg = confidenceScore / 3;

  if (avg >= 0.7) return "high";
  if (avg >= 0.35) return "medium";
  return "low";
}

/**
 * Build blocker entries deterministically from bucket scores and parsed job.
 *
 * Blockers are:
 *   - Any mustHaveSkill not present in evidence
 *   - seniorityOwnershipMatch < 50 when seniority/ownership expectations exist
 *   - proofStrength < 40 when proof expectations exist
 *
 * @param {object} bucketScores
 * @param {object} parsedJob
 * @param {string} corpus
 * @returns {string[]}
 */
function buildBlockers(bucketScores, parsedJob, corpus) {
  const blockers = [];

  // Blocker: missing must-have skills
  if (parsedJob.mustHaveSkills && parsedJob.mustHaveSkills.length > 0) {
    const missing = [];
    for (const skill of parsedJob.mustHaveSkills) {
      if (!termInCorpus(corpus, skill)) {
        missing.push(skill);
      }
    }
    if (missing.length > 0) {
      blockers.push(
        `Missing required skill${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        `These are listed as must-haves in the job description and no supporting evidence was found in your profile artifacts.`
      );
    }
  }

  // Blocker: severe seniority mismatch
  const hasSeniorityExpectations =
    (parsedJob.experienceSignals && parsedJob.experienceSignals.length > 0) ||
    (parsedJob.seniority && parsedJob.seniority !== "junior" && parsedJob.seniority !== "mid");
  if (hasSeniorityExpectations && bucketScores.seniorityOwnershipMatch < BLOCKER_SENIORITY_OWNERSHIP_THRESHOLD) {
    const seniorityLabel = parsedJob.seniority || "expected";
    blockers.push(
      `Seniority/ownership mismatch: the role expects ${seniorityLabel}-level ownership ` +
      `(score: ${bucketScores.seniorityOwnershipMatch}/100). Your profile evidence does not strongly demonstrate ` +
      `the depth of ownership, team leadership, or architectural decision-making expected at this level.`
    );
  }

  // Blocker: weak proof
  const hasProofExpectations =
    (parsedJob.proofExpectations && parsedJob.proofExpectations.length > 0);
  if (hasProofExpectations && bucketScores.proofStrength < BLOCKER_PROOF_STRENGTH_THRESHOLD) {
    blockers.push(
      `Weak proof strength (score: ${bucketScores.proofStrength}/100). ` +
      `The job description expects evidence of ${parsedJob.proofExpectations.join(", ")}. ` +
      `Your profile currently lacks the public artifacts (GitHub repos, portfolio, publications) ` +
      `that would substantiate these claims.`
    );
  }

  return blockers;
}

/**
 * Build easy-wins from presentation/terminology problems and adjacent evidence.
 *
 * Easy wins are:
 *   - presentationMatch < 60 when evidence exists for the actual skills
 *   - preferred/domain gaps where evidence is adjacent but not clearly surfaced
 *
 * @param {object} bucketScores
 * @param {object} parsedJob
 * @param {string} corpus
 * @returns {string[]}
 */
function buildEasyWins(bucketScores, parsedJob, corpus) {
  const easyWins = [];

  // Easy win: presentation gap when evidence exists
  if (bucketScores.presentationMatch < EASYWIN_PRESENTATION_THRESHOLD) {
    // Check if evidence exists for key terms (in must-haves or preferred)
    const allTargetedSkills = [
      ...(parsedJob.mustHaveSkills || []),
      ...(parsedJob.preferredSkills || []),
      ...(parsedJob.toolingTerms || []),
    ];
    const presentSkills = allTargetedSkills.filter(t => termInCorpus(corpus, t));
    if (presentSkills.length > 0) {
      easyWins.push(
        `Presentation gap: your profile contains evidence for ${presentSkills.slice(0, 5).join(", ")}` +
        `${presentSkills.length > 5 ? ` and ${presentSkills.length - 5} more` : ""} ` +
        `but the terminology, surface positioning, or artifact structure may not make this immediately visible. ` +
        `Repositioning existing content to match the job description's language would improve perceived fit ` +
        `without requiring new experience.`
      );
    }
  }

  // Easy win: preferred skill gaps with adjacent evidence
  if (parsedJob.preferredSkills && parsedJob.preferredSkills.length > 0) {
    const matchedPreferred = parsedJob.preferredSkills.filter(t => termInCorpus(corpus, t));
    const missingPreferred = parsedJob.preferredSkills.filter(t => !termInCorpus(corpus, t));
    if (matchedPreferred.length > 0 && missingPreferred.length > 0 && missingPreferred.length <= 3) {
      easyWins.push(
        `Near-match on preferred skills: you demonstrate ${matchedPreferred.join(", ")} ` +
        `but are missing ${missingPreferred.join(", ")}. ` +
        `These adjacent skills often transfer — consider highlighting related experience ` +
        `or adding a quick proof project to close these small gaps.`
      );
    }
  }

  // Easy win: domain context gap with transferable evidence
  if (parsedJob.domainContext && parsedJob.domainContext.length > 0) {
    const matchedDomain = parsedJob.domainContext.filter(t => termInCorpus(corpus, t));
    if (matchedDomain.length === 0 && bucketScores.domainContextMatch < 50) {
      // Check if any tooling or skills terms match as transferable signal
      const allTerms = [
        ...(parsedJob.mustHaveSkills || []),
        ...(parsedJob.toolingTerms || []),
      ];
      const presentTerms = allTerms.filter(t => termInCorpus(corpus, t));
      if (presentTerms.length >= Math.ceil(allTerms.length * 0.5)) {
        easyWins.push(
          `Domain context gap: your technical skills align with this role but your profile ` +
          `does not clearly position you in the ${parsedJob.domainContext.join("/")} space. ` +
          `Adding domain-specific framing (case studies, project descriptions, or a focused summary) ` +
          `would bridge this gap without new technical experience.`
        );
      }
    }
  }

  return easyWins;
}

/**
 * Build strengths from bucket scores that meet the threshold.
 *
 * @param {object} bucketScores
 * @param {object} parsedJob
 * @param {string} corpus
 * @returns {string[]}
 */
function buildStrengths(bucketScores, parsedJob, corpus) {
  const strengths = [];

  if (bucketScores.mustHaveMatch >= STRENGTH_THRESHOLD) {
    strengths.push(
      `Strong required-skills alignment: your profile evidence matches the core requirements ` +
      `(must-have match score: ${bucketScores.mustHaveMatch}/100).`
    );
  }

  if (bucketScores.seniorityOwnershipMatch >= STRENGTH_THRESHOLD) {
    strengths.push(
      `Seniority and ownership match: your experience signals align with the role's expectations ` +
      `for ${parsedJob.seniority || "expected"}-level leadership and decision-making ` +
      `(score: ${bucketScores.seniorityOwnershipMatch}/100).`
    );
  }

  if (bucketScores.proofStrength >= STRENGTH_THRESHOLD) {
    strengths.push(
      `Strong proof portfolio: your public artifacts (GitHub repos, portfolio, publications) ` +
      `substantiate the claims in your profile ` +
      `(proof strength: ${bucketScores.proofStrength}/100).`
    );
  }

  if (bucketScores.domainContextMatch >= STRENGTH_THRESHOLD) {
    strengths.push(
      `Domain alignment: your experience clearly positions you in the relevant domain context ` +
      `(domain match: ${bucketScores.domainContextMatch}/100).`
    );
  }

  if (bucketScores.presentationMatch >= STRENGTH_THRESHOLD) {
    strengths.push(
      `Strong presentation: your profile artifacts clearly surface your skills using terminology ` +
      `that aligns with the role's expectations ` +
      `(presentation match: ${bucketScores.presentationMatch}/100).`
    );
  }

  return strengths;
}

// ---------------------------------------------------------------------------
// runRoleFitAssessment — public API
// ---------------------------------------------------------------------------

/**
 * Run a deterministic role-fit assessment against a parsed job description.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {object} params.parsedJob - parsed JD from parseJobDescription()
 * @param {string} params.roleFamilySlug - slug for role-family memory grouping
 * @param {string} params.roleTitle - human-readable role title
 * @returns {{
 *   fitScore: number,
 *   bracket: string,
 *   bucketScores: object,
 *   blockers: string[],
 *   easyWins: string[],
 *   strengths: string[],
 *   confidence: string,
 *   evidenceUsed: string[],
 * }}
 */
function runRoleFitAssessment({ repos, parsedJob, roleFamilySlug, roleTitle }) {
  if (!repos) throw new Error("repos is required");
  if (!parsedJob) throw new Error("parsedJob is required");

  // 1. Retrieve profile evidence
  const context = getArtifactContext({ repos });
  const profileState = getLatestProfileState({ repos });

  // 2. Build evidence corpus for deterministic matching
  const corpus = buildEvidenceCorpus(context, profileState);

  // 3. Score each bucket deterministically and capture provenance
  const bucketDefs = {
    mustHaveMatch:         { terms: parsedJob.mustHaveSkills || [],      ruleId: "must_have_skills_match" },
    preferredMatch:        { terms: parsedJob.preferredSkills || [],     ruleId: "preferred_skills_match" },
    seniorityOwnershipMatch: { terms: parsedJob.experienceSignals || [], ruleId: "seniority_ownership_signals" },
    domainContextMatch:    { terms: parsedJob.domainContext || [],       ruleId: "domain_context_match" },
    proofStrength:         { terms: parsedJob.proofExpectations || [],   ruleId: "proof_expectations_match" },
    presentationMatch:     { terms: parsedJob.toolingTerms || [],        ruleId: "tooling_terms_match" },
  };

  const bucketScores = {};
  const bucketProvenance = {};

  for (const [bucket, def] of Object.entries(bucketDefs)) {
    const score = scoreTermList(corpus, def.terms);
    bucketScores[bucket] = score;

    // Collect evidence summary IDs that contributed to this bucket score
    const inputSummaryIds = [];
    for (const rtype of Object.keys(context)) {
      const entry = context[rtype];
      if (entry && entry.summaries) {
        for (const summary of entry.summaries) {
          if (summary.summary_id) inputSummaryIds.push(summary.summary_id);
        }
      }
    }

    // Identify matched and missing terms for provenance
    const matched = def.terms.filter((t) => termInCorpus(corpus, t));
    const missing = def.terms.filter((t) => !termInCorpus(corpus, t));

    bucketProvenance[bucket] = {
      inputs: inputSummaryIds,
      rules: [
        {
          id: def.ruleId,
          effect: score,
          reason: def.terms.length === 0
            ? `No terms expected — full score awarded (0 terms)`
            : `${matched.length}/${def.terms.length} terms matched: [${matched.slice(0, 5).join(", ")}]${missing.length > 0 ? `; missing: [${missing.slice(0, 5).join(", ")}]` : ""}`,
        },
        {
          id: "bucket_weight",
          effect: BUCKET_WEIGHTS[bucket] || 0,
          reason: `Weight ${BUCKET_WEIGHTS[bucket]} applied in fit score calculation`,
        },
      ],
      trace: def.terms.length === 0
        ? `No terms → score=100 × weight=${BUCKET_WEIGHTS[bucket]}`
        : `${matched.length}/${def.terms.length} matched → ${score}/100 × weight=${BUCKET_WEIGHTS[bucket]}`,
    };
  }

  // 4. Compute weighted fit score
  let fitScore = 0;
  const fitScoreTerms = [];
  for (const [bucket, weight] of Object.entries(BUCKET_WEIGHTS)) {
    const contribution = (bucketScores[bucket] || 0) * weight;
    fitScore += contribution;
    fitScoreTerms.push(`${bucketScores[bucket]}×${weight}`);
  }
  fitScore = Math.round(fitScore);

  // 5. Map to bracket
  const bracket = scoreToBracket(fitScore);

  // 6. Build blocker-first output partitions
  const blockers = buildBlockers(bucketScores, parsedJob, corpus);
  const easyWins = buildEasyWins(bucketScores, parsedJob, corpus);
  const strengths = buildStrengths(bucketScores, parsedJob, corpus);

  // 7. Compute confidence
  const confidence = computeConfidence(parsedJob, context, profileState);

  // 8. List evidence types used
  const evidenceUsed = [];
  for (const rtype of Object.keys(context)) {
    const entry = context[rtype];
    if (entry && entry.artifact) {
      evidenceUsed.push(rtype);
    }
  }

  // Build fitScore provenance
  const fitScoreProvenance = {
    inputs: evidenceUsed,
    rules: Object.entries(BUCKET_WEIGHTS).map(([bucket, weight]) => ({
      id: `${bucket}_weighted`,
      effect: Math.round((bucketScores[bucket] || 0) * weight * 100) / 100,
      reason: `${bucket}=${bucketScores[bucket]}/100 × weight=${weight}`,
    })),
    trace: `(${fitScoreTerms.join(" + ")}) = ${fitScore}/100`,
  };

  return {
    fitScore,
    bracket,
    bucketScores,
    bucketProvenance,
    blockers,
    easyWins,
    strengths,
    confidence,
    evidenceUsed,
    provenance: fitScoreProvenance,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Re-export history functions for test compatibility
const {
  persistRoleFitSnapshot,
  listRoleFitSnapshotsByRoleFamily,
  slugRoleFamily,
} = require("../role-fit/history.js");

module.exports = {
  runRoleFitAssessment,
  persistRoleFitSnapshot,
  listRoleFitSnapshotsByRoleFamily,
  slugRoleFamily,
  // Internal constants exported for testing
  BUCKET_WEIGHTS,
  BRACKET_THRESHOLDS,
};
