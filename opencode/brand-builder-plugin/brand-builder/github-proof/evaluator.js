/**
 * Brand Builder GitHub Proof Evaluator
 *
 * Deterministic repo scoring, disposition mapping, and proof-gap detection.
 *
 * Per D-08/D-12: only user-selected repos are evaluated.
 * Per D-09: evaluation order is portfolio value -> proof quality -> engineering quality.
 * Per D-10: four approved disposition labels.
 * Per D-11: large-repo defaults to sampled paths with fullAnalysisAvailable flag.
 * Per D-17: cached evidence only — no automatic refresh.
 * Per D-19: stale evidence >30 days yields refresh recommendation.
 *
 * Module exports:
 *   - evaluateGitHubProof({ repos, selectedRepos, assessmentContext, roleFitContext })
 */

const {
  getArtifactContext,
  getStalenessReport,
} = require("../memory/retrieval.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default sampled paths for large repos per D-11. */
const DEFAULT_SAMPLED_PATHS = [
  "README.md",
  "package.json",
  "src/",
  "lib/",
  "components/",
];

/** Disposition thresholds per D-09/D-10. */
const HIGHLIGHT_PORTFOLIO_MIN = 80;
const HIGHLIGHT_PROOF_MIN = 70;
const IMPROVE_PORTFOLIO_MIN = 60;
const KEEP_ENGINEERING_MIN = 30;
const HIDE_PORTFOLIO_MAX = 40;

/** Staleness threshold in milliseconds (30 days per D-19). */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute portfolio value score (0-100) for a repo.
 *
 * Portfolio value reflects how well the repo supports the role-family fit.
 * Combines role-fit proof importance, assessment signal strength, and
 * evidence relevance to produce a stable portfolio-value score.
 *
 * D-09: portfolio value is the first (most important) scoring dimension.
 *
 * @param {object} assessmentContext
 * @param {object} roleFitContext
 * @param {object} repoEvidence - evidence summaries for this repo
 * @returns {number}
 */
function computePortfolioValue(assessmentContext, roleFitContext, repoEvidence) {
  const dims = assessmentContext.dimensions || {};
  const buckets = roleFitContext.bucketScores || {};

  // Primary: role-fit proof strength (how much does this role value proof?)
  const proofStrength = buckets.proofStrength || 0;

  // Secondary: assessment signal strength (overall profile signal)
  const signal = dims.signal || 0;

  // Tertiary: must-have match (how well does profile match role requirements)
  const mustHave = buckets.mustHaveMatch || 0;

  // Evidence modulation: presence of evidence is positive (0-10)
  const summaryCount = (repoEvidence || []).length;
  const evidenceMod = summaryCount > 0 ? Math.min(10, summaryCount * 5) : 0;

  const score = (proofStrength * 0.40) + (signal * 0.35) + (mustHave * 0.25) + evidenceMod;

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Compute proof quality score (0-100) for a repo.
 *
 * Proof quality reflects how strong the evidence is for this repo.
 * Driven by assessment dimensions and evidence content signals.
 *
 * D-09: proof quality is the second scoring dimension (after portfolio value).
 *
 * @param {object} assessmentContext
 * @param {object} repoEvidence - evidence summaries for this repo
 * @returns {number}
 */
function computeProofQuality(assessmentContext, repoEvidence) {
  const dims = assessmentContext.dimensions || {};

  // Primary: assessment evidence dimension (0-40)
  const evidence = dims.evidence || 0;

  // Secondary: assessment visibility dimension (0-30)
  const visibility = dims.visibility || 0;

  // Content signal from evidence text (0-20)
  const evidenceText = buildEvidenceText(repoEvidence);
  let contentMod = 0;
  if (evidenceText) {
    contentMod = Math.round(computeContentSignal(evidenceText) * 0.20);
  }

  // Evidence presence bonus (0-10)
  const summaryCount = (repoEvidence || []).length;
  const presenceMod = summaryCount > 0 ? Math.min(10, summaryCount * 5) : 0;

  const score = (evidence * 0.40) + (visibility * 0.30) + contentMod + presenceMod;

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Compute engineering quality score (0-100) for a repo.
 *
 * Engineering quality reflects code/engineering quality indicators.
 * Driven by assessment dimensions and engineering signal keywords in evidence.
 *
 * D-09: engineering quality is the third scoring dimension.
 *
 * @param {object} assessmentContext
 * @param {object} repoEvidence - evidence summaries for this repo
 * @returns {number}
 */
function computeEngineeringQuality(assessmentContext, repoEvidence) {
  const dims = assessmentContext.dimensions || {};

  // Primary: assessment visibility dimension (0-35)
  const visibility = dims.visibility || 0;

  // Secondary: assessment narrative dimension (0-35)
  const narrative = dims.narrative || 0;

  // Engineering signals from evidence text (0-20)
  const evidenceText = buildEvidenceText(repoEvidence);
  let engMod = 0;
  if (evidenceText) {
    engMod = Math.round(computeEngineeringSignal(evidenceText) * 0.20);
  }

  // Evidence presence bonus (0-10)
  const summaryCount = (repoEvidence || []).length;
  const presenceMod = summaryCount > 0 ? Math.min(10, summaryCount * 5) : 0;

  const score = (visibility * 0.35) + (narrative * 0.35) + engMod + presenceMod;

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Build evidence text from evidence summaries.
 *
 * @param {object[]} evidence - array of evidence summary objects
 * @returns {string}
 */
function buildEvidenceText(evidence) {
  if (!evidence || evidence.length === 0) return "";
  return evidence
    .map((e) => (e.content || ""))
    .join(" ")
    .toLowerCase();
}

/**
 * Compute relevance score from evidence content against role-fit context.
 *
 * @param {string} evidenceText
 * @param {object} roleFitContext
 * @returns {number} 0-35
 */
function computeRelevanceScore(evidenceText, roleFitContext) {
  if (!evidenceText) return 0;

  const roleSlug = (roleFitContext.roleFamilySlug || "").toLowerCase();
  const roleTokens = roleSlug.split(/[-_]/).filter(Boolean);

  if (roleTokens.length === 0) return 10; // neutral baseline

  let matched = 0;
  for (const token of roleTokens) {
    if (token.length > 1 && evidenceText.includes(token)) {
      matched++;
    }
  }

  const ratio = roleTokens.length > 0 ? matched / roleTokens.length : 0;
  return Math.round(ratio * 35);
}

/**
 * Compute content signal strength from evidence text.
 *
 * @param {string} evidenceText
 * @returns {number} 0-100
 */
function computeContentSignal(evidenceText) {
  if (!evidenceText) return 0;

  // Signal keywords: documentation, tests, usage, contributions
  const signalKeywords = [
    "documentation", "docs", "readme", "tests", "ci/cd", "ci", "cd",
    "contributing", "changelog", "examples", "demo", "deployed",
    "stars", "forks", "contributors", "issues", "pull request",
    "production", "used in", "dependency", "api", "sdk",
  ];

  let matched = 0;
  for (const keyword of signalKeywords) {
    if (evidenceText.includes(keyword)) {
      matched++;
    }
  }

  return Math.round((matched / signalKeywords.length) * 100);
}

/**
 * Compute engineering signal from evidence text.
 *
 * @param {string} evidenceText
 * @returns {number} 0-40
 */
function computeEngineeringSignal(evidenceText) {
  if (!evidenceText) return 0;

  // Engineering quality keywords
  const engKeywords = [
    "typescript", "type-safe", "testing", "coverage", "linting",
    "lint", "types", "architecture", "clean", "structured",
    "well-documented", "maintainable", "modular", "tested",
    "best practices", "patterns", "solid", "dry",
  ];

  let matched = 0;
  for (const keyword of engKeywords) {
    if (evidenceText.includes(keyword)) {
      matched++;
    }
  }

  return Math.round((matched / engKeywords.length) * 40);
}

/**
 * Determine disposition per D-09 ordering and D-10 thresholds.
 *
 * Order: portfolioValue -> proofQuality -> engineeringQuality
 *
 * @param {number} portfolioValue
 * @param {number} proofQuality
 * @param {number} engineeringQuality
 * @returns {string}
 */
function determineDisposition(portfolioValue, proofQuality, engineeringQuality) {
  // D-09: Portfolio value first
  if (portfolioValue < HIDE_PORTFOLIO_MAX) {
    return "Do not surface";
  }

  // Highlight: strong portfolio + strong proof
  if (portfolioValue >= HIGHLIGHT_PORTFOLIO_MIN && proofQuality >= HIGHLIGHT_PROOF_MIN) {
    return "Highlight";
  }

  // Improve soon: decent portfolio with room to improve
  if (portfolioValue >= IMPROVE_PORTFOLIO_MIN) {
    const isMidTier =
      (proofQuality >= 40 && proofQuality < HIGHLIGHT_PROOF_MIN) ||
      (engineeringQuality >= 40 && engineeringQuality < 70);
    if (isMidTier) {
      return "Improve soon";
    }
    // Decent portfolio but weak proof/engineering → still Keep
    if (engineeringQuality >= KEEP_ENGINEERING_MIN) {
      return "Keep but de-emphasize";
    }
  }

  // Keep but de-emphasize: acceptable engineering but low portfolio value
  if (portfolioValue < HIDE_PORTFOLIO_MAX + 20 && engineeringQuality >= KEEP_ENGINEERING_MIN) {
    return "Keep but de-emphasize";
  }

  // Default: Do not surface for weak portfolio
  if (portfolioValue < IMPROVE_PORTFOLIO_MIN) {
    return "Do not surface";
  }

  // Fallback
  return "Keep but de-emphasize";
}

/**
 * Generate proof improvement suggestions for a repo.
 *
 * @param {number} portfolioValue
 * @param {number} proofQuality
 * @param {number} engineeringQuality
 * @param {string} disposition
 * @param {string} repoName
 * @returns {string[]}
 */
function generateProofImprovements(portfolioValue, proofQuality, engineeringQuality, disposition, repoName) {
  const improvements = [];

  if (proofQuality < 50) {
    improvements.push(`Add a comprehensive README with project goals, setup instructions, and usage examples for ${repoName}.`);
    improvements.push(`Include badges for CI/CD status, test coverage, and npm version to signal project health.`);
  }

  if (proofQuality < 70 && proofQuality >= 50) {
    improvements.push(`Enhance ${repoName}'s documentation with architecture decisions and contribution guidelines.`);
    improvements.push(`Add inline code documentation and a CHANGELOG to demonstrate maintenance discipline.`);
  }

  if (engineeringQuality < 50) {
    improvements.push(`Add tests (unit and integration) to ${repoName} to signal code quality and reliability.`);
    improvements.push(`Set up linting, type checking, and automated CI for ${repoName} to show engineering rigor.`);
  }

  if (portfolioValue < 60) {
    improvements.push(`Reposition ${repoName} in README to highlight skills relevant to your target role family.`);
    improvements.push(`Add a section connecting ${repoName}'s technical decisions to industry problems it solves.`);
  }

  if (disposition === "Highlight" && proofQuality >= 70) {
    improvements.push(`Pin ${repoName} on your GitHub profile and feature it prominently in your portfolio.`);
    improvements.push(`Write a blog post or case study about ${repoName} to maximize its proof value.`);
  }

  // Ensure at least one improvement exists
  if (improvements.length === 0) {
    improvements.push(`Review ${repoName} for opportunities to add a LICENSE, CONTRIBUTING guide, or CODE_OF_CONDUCT.`);
  }

  return improvements;
}

/**
 * Generate next-project signals based on proof gaps.
 *
 * @param {number} portfolioValue
 * @param {number} proofQuality
 * @param {number} engineeringQuality
 * @param {string} disposition
 * @param {object} roleFitContext
 * @returns {string[]}
 */
function generateNextProjectSignals(portfolioValue, proofQuality, engineeringQuality, disposition, roleFitContext) {
  const signals = [];
  const blockers = roleFitContext.blockers || [];
  const roleSlug = (roleFitContext.roleFamilySlug || "").replace(/-/g, " ");

  if (disposition === "Do not surface" || portfolioValue < 60) {
    signals.push(`Consider creating a new project that demonstrates core ${roleSlug || "target role"} skills.`);
  }

  if (proofQuality < 50) {
    signals.push(`Build a demonstration project with comprehensive documentation, tests, and CI/CD to fill proof gaps.`);
  }

  if (blockers.length > 0) {
    signals.push(`Address profile blockers (${blockers.length}) with a targeted proof project.`);
  }

  if (engineeringQuality < 50) {
    signals.push(`Create a showcase project using modern engineering practices (TypeScript, testing, CI/CD) to demonstrate quality standards.`);
  }

  if (disposition === "Improve soon") {
    signals.push(`Add a companion project that shows depth — for example, a library, plugin, or CLI tool that complements existing work.`);
  }

  if (signals.length === 0) {
    signals.push(`Consider an open-source contribution to a relevant project to build community proof.`);
  }

  return signals;
}

/**
 * Generate diagnosis text for a repo based on its scores and disposition.
 *
 * @param {string} repoName
 * @param {string} disposition
 * @param {number} portfolioValue
 * @param {number} proofQuality
 * @param {number} engineeringQuality
 * @returns {string}
 */
function generateDiagnosis(repoName, disposition, portfolioValue, proofQuality, engineeringQuality) {
  const parts = [
    `${repoName} scored portfolio=${portfolioValue}, proof=${proofQuality}, engineering=${engineeringQuality}.`,
  ];

  switch (disposition) {
    case "Highlight":
      parts.push(
        "Strong portfolio value and proof quality. This repo effectively demonstrates skills aligned with your role family."
      );
      break;
    case "Improve soon":
      parts.push(
        "Decent portfolio alignment but proof quality or engineering signals need improvement before this repo becomes a strong asset."
      );
      break;
    case "Keep but de-emphasize":
      parts.push(
        "The repo shows acceptable engineering quality but has low portfolio value for your target role. Keep it available but don't lead with it."
      );
      break;
    case "Do not surface":
      parts.push(
        "This repo has low portfolio value for your target role family. Consider archiving or keeping private to maintain a focused public profile."
      );
      break;
    default:
      parts.push("Disposition could not be determined definitively.");
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// evaluateGitHubProof — public API
// ---------------------------------------------------------------------------

/**
 * Evaluate GitHub proof for user-selected repositories.
 *
 * Produces deterministic repo scoring, disposition mapping, and proof-gap
 * recommendations using cached evidence and the locked D-09 evaluation order.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {string[]} params.selectedRepos - user-selected repo names/identifiers
 * @param {object} params.assessmentContext - Phase 3 current-state assessment
 * @param {object} params.roleFitContext - Phase 4 role-fit assessment context
 * @returns {{
 *   workflowDomain: string,
 *   profileSurface: object,
 *   repos: object[],
 *   missingProof: object[],
 *   nextProjectIdeas: string[],
 *   staleRecommendation: string|null,
 *   evidenceUsed: string[],
 *   nextBestAction: string
 * }}
 */
function evaluateGitHubProof({ repos, selectedRepos, assessmentContext, roleFitContext }) {
  if (!repos) throw new Error("repos is required");
  if (!selectedRepos) throw new Error("selectedRepos is required");
  if (!Array.isArray(selectedRepos)) throw new Error("selectedRepos must be an array");

  // 1. Get evidence context for all artifacts
  const context = getArtifactContext({
    repos,
    artifactTypes: ["github_repo", "github_profile"],
  });

  // 2. Check staleness
  const stalenessReport = getStalenessReport({ repos });
  let staleRecommendation = null;
  const staleAges = [];

  for (const group of stalenessReport) {
    for (const summary of group.staleSummaries) {
      if (summary.createdAt) {
        const age = Date.now() - new Date(summary.createdAt).getTime();
        if (age > STALE_THRESHOLD_MS) {
          staleAges.push(Math.round(age / (24 * 60 * 60 * 1000)));
        }
      }
    }
  }

  if (staleAges.length > 0) {
    const maxStaleDays = Math.max(...staleAges);
    staleRecommendation =
      `Some repo evidence is up to ${maxStaleDays} days old (threshold: 30 days). ` +
      `Recommend refreshing evidence via bb-intake before relying on these proof scores.`;
  }

  // 3. Collect all github_repo artifacts (not just the single current one)
  const selectedSet = new Set(selectedRepos.map((r) => r.toLowerCase()));

  // Build a lookup: clean repo name → evidence
  const repoEvidenceMap = {};

  // Use listByType to get all github_repo artifacts
  const allRepoArtifacts = repos.artifacts.listByType("github_repo") || [];

  for (const artifact of allRepoArtifacts) {
    const label = (artifact.source_label || "").toLowerCase();
    const cleanLabel = label.replace(/^github repo:\s*/i, "").trim();
    const pathMatch = (artifact.canonical_path || "").toLowerCase();

    // Check if this artifact matches any selected repo name
    let matchedName = null;
    for (const selectedRepo of selectedRepos) {
      const name = selectedRepo.toLowerCase();
      if (cleanLabel === name || pathMatch.startsWith(name + "/") || pathMatch === name) {
        matchedName = name;
        break;
      }
    }

    if (matchedName) {
      // Fetch evidence summaries for this artifact
      const summaries = repos.evidence.listByArtifact(artifact.artifact_id) || [];
      const version = repos.versions.getLatest(artifact.artifact_id);

      repoEvidenceMap[matchedName] = {
        artifact,
        version,
        summaries: summaries.filter((s) => !s.stale || s.stale === 0),
      };
    }
  }

  // 5. Evaluate each selected repo
  const repoResults = [];

  for (const selectedRepo of selectedRepos) {
    const evidence = repoEvidenceMap[selectedRepo.toLowerCase()] || {
      artifact: null,
      version: null,
      summaries: [],
    };

    // Compute scores using D-09 ordering
    const portfolioValueScore = computePortfolioValue(
      assessmentContext || {},
      roleFitContext || {},
      evidence.summaries
    );
    const proofQualityScore = computeProofQuality(
      assessmentContext || {},
      evidence.summaries
    );
    const engineeringQualityScore = computeEngineeringQuality(
      assessmentContext || {},
      evidence.summaries
    );

    // Determine disposition using D-09/D-10 rules
    const disposition = determineDisposition(
      portfolioValueScore,
      proofQualityScore,
      engineeringQualityScore
    );

    // Generate diagnosis
    const diagnosis = generateDiagnosis(
      selectedRepo,
      disposition,
      portfolioValueScore,
      proofQualityScore,
      engineeringQualityScore
    );

    // Generate proof improvements
    const proofImprovements = generateProofImprovements(
      portfolioValueScore,
      proofQualityScore,
      engineeringQualityScore,
      disposition,
      selectedRepo
    );

    // Generate next project signals
    const nextProjectSignals = generateNextProjectSignals(
      portfolioValueScore,
      proofQualityScore,
      engineeringQualityScore,
      disposition,
      roleFitContext || {}
    );

    // Build per-repo provenance
    const repoEvidenceIds = (evidence.summaries || [])
      .filter((s) => s.summary_id)
      .map((s) => s.summary_id);

    const repoProvenance = {
      inputs: repoEvidenceIds,
      rules: [
        {
          id: "portfolio_value_score",
          effect: portfolioValueScore,
          reason: `portfolioValue=${portfolioValueScore}: proofStrength=${(roleFitContext || {}).bucketScores?.proofStrength || 0}, signal=${(assessmentContext || {}).dimensions?.signal?.score || (assessmentContext || {}).signal || 0}, mustHave=${(roleFitContext || {}).bucketScores?.mustHaveMatch || 0}`,
        },
        {
          id: "proof_quality_score",
          effect: proofQualityScore,
          reason: `proofQuality=${proofQualityScore}: evidence dimension, content signal, summary count=${evidence.summaries.length}`,
        },
        {
          id: "engineering_quality_score",
          effect: engineeringQualityScore,
          reason: `engineeringQuality=${engineeringQualityScore}: visibility and narrative dimensions, engineering signal keywords`,
        },
        {
          id: "disposition_rule",
          effect: 0,
          reason: `disposition="${disposition}" per D-09/D-10 threshold rules`,
        },
      ],
      trace: `portfolioValue=${portfolioValueScore}, proofQuality=${proofQualityScore}, engineeringQuality=${engineeringQualityScore} → disposition="${disposition}"`,
    };

    repoResults.push({
      repoName: selectedRepo,
      sampledPaths: DEFAULT_SAMPLED_PATHS,
      portfolioValueScore,
      proofQualityScore,
      engineeringQualityScore,
      disposition,
      diagnosis,
      proofImprovements,
      nextProjectSignals,
      fullAnalysisAvailable: true,
      provenance: repoProvenance,
    });
  }

  // 6. Compile missing proof gaps
  const missingProof = [];
  for (const repo of repoResults) {
    if (repo.proofQualityScore < 50 || repo.portfolioValueScore < 50) {
      missingProof.push({
        repoName: repo.repoName,
        gapDescription: `Portfolio value (${repo.portfolioValueScore}) and proof quality (${repo.proofQualityScore}) are below the recommended threshold for this repo to serve as strong role-family proof.`,
        projectedImpact: "Low — this repo does not materially strengthen your public proof surface for the target role.",
      });
    }
  }

  // If no specific repo gaps, check overall proof coverage
  if (missingProof.length === 0) {
    const proofStrength = (roleFitContext.bucketScores || {}).proofStrength || 0;
    if (proofStrength < 50) {
      missingProof.push({
        repoName: "overall",
        gapDescription: `Role-fit proof strength is ${proofStrength}/100. Even with your strongest repos, there may be evidence gaps relative to role expectations.`,
        projectedImpact: "Medium — combined repo proof may still leave gaps in some role-family dimensions.",
      });
    }
  }

  // 7. Compile next project ideas
  const nextProjectIdeas = [];
  const allSignals = repoResults.flatMap((r) => r.nextProjectSignals);
  const uniqueSignals = [...new Set(allSignals)];

  for (const signal of uniqueSignals.slice(0, 5)) {
    nextProjectIdeas.push(signal);
  }

  // If no next project ideas, add a default
  if (nextProjectIdeas.length === 0) {
    nextProjectIdeas.push(
      "Your current repos provide decent proof coverage. Consider deepening with a specialized project that targets a specific role-family strength area."
    );
  }

  // 8. Compile evidence used
  const evidenceUsed = [];
  if (context.github_profile && context.github_profile.artifact) {
    evidenceUsed.push("github_profile");
  }
  if (context.github_repo && context.github_repo.artifact) {
    evidenceUsed.push("github_repo");
  }
  for (const repo of repoResults) {
    const ev = repoEvidenceMap[repo.repoName.toLowerCase()];
    if (ev && ev.summaries.length > 0) {
      for (const s of ev.summaries) {
        if (s.summary_id && !evidenceUsed.includes(s.summary_id)) {
          evidenceUsed.push(s.summary_id);
        }
      }
    }
  }

  // 9. Determine next best action
  let nextBestAction;
  const highlightCount = repoResults.filter((r) => r.disposition === "Highlight").length;
  const improveCount = repoResults.filter((r) => r.disposition === "Improve soon").length;
  const hideCount = repoResults.filter((r) => r.disposition === "Do not surface").length;

  if (staleRecommendation) {
    nextBestAction = "Refresh stale evidence via bb-intake before trusting proof scores.";
  } else if (highlightCount > 0 && hideCount === 0) {
    nextBestAction = "Your selected repos provide strong proof. Consider pinning highlighted repos and creating case studies.";
  } else if (improveCount > 0) {
    nextBestAction = "Focus on improving repos marked 'Improve soon' — add documentation, tests, or clearer role-family positioning.";
  } else if (hideCount > 0) {
    nextBestAction = "Archive or de-emphasize low-value repos and invest in new proof projects aligned with your target role.";
  } else {
    nextBestAction = "Review repo dispositions and choose your next proof-building step.";
  }

  // 10. Profile surface summary
  const profileSurface = {
    totalReposEvaluated: repoResults.length,
    selectedRepoCount: selectedRepos.length,
    dispositionBreakdown: {
      highlight: highlightCount,
      improveSoon: improveCount,
      keep: repoResults.filter((r) => r.disposition === "Keep but de-emphasize").length,
      doNotSurface: hideCount,
    },
    proofGaps: missingProof.length,
    refreshRecommended: staleRecommendation !== null,
  };

  return {
    workflowDomain: "github",
    profileSurface,
    repos: repoResults,
    missingProof,
    nextProjectIdeas,
    staleRecommendation,
    evidenceUsed,
    nextBestAction,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  evaluateGitHubProof,
  // Internal helpers exported for testing
  _defaultSampledPaths: DEFAULT_SAMPLED_PATHS,
};
