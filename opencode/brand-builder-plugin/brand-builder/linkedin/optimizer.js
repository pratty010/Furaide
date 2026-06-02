/**
 * Brand Builder LinkedIn Optimizer
 *
 * Deterministic LinkedIn section diagnosis and rewrite-input builder.
 *
 * Per D-02: headline=3 variants, about=2, experience=2 (bullet format),
 *           featured=2 (agent discretion), skills=1 optimized list.
 * Per D-04: brand direction first, role-family fit second.
 * Per D-05: variant labels use "Variant 1/2/3", never A/B.
 * Per D-07: experience variants are bullet-formatted.
 * Per D-17: cached evidence only — no automatic refresh.
 * Per D-19: stale evidence >30 days yields refresh recommendation.
 * Per D-20: missing LinkedIn → diagnose-only mode with empty rewrites
 *           except skills placeholder.
 *
 * Module exports:
 *   - runLinkedInOptimization({ repos, requestedSections, assessmentContext, roleFitContext })
 */

const {
  getArtifactContext,
  getStalenessReport,
} = require("../memory/retrieval.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Artifact types to retrieve for LinkedIn optimization context. */
const CONTEXT_ARTIFACT_TYPES = [
  "linkedin",
  "resume",
  "github_profile",
  "github_repo",
];

/** Section variant counts per D-02 (plus agent-discretion featured). */
const VARIANT_COUNTS = {
  headline: 3,
  about: 2,
  experience: 2,
  featured: 2,
  skills: 1,
};

/** Required section keys always present in output. */
const REQUIRED_SECTIONS = [
  "headline",
  "about",
  "experience",
  "featured",
  "skills",
];

/** Staleness threshold in milliseconds (30 days per D-19). */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/** Focus dimensions for variant rationale. */
const FOCUS_DIMENSIONS = ["signal", "discoverability", "clarity", "impact"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a date timestamp is older than the staleness threshold.
 * @param {string} isoDate - ISO 8601 date string
 * @returns {boolean}
 */
function isOlderThanThreshold(isoDate) {
  if (!isoDate) return false;
  const ageMs = Date.now() - new Date(isoDate).getTime();
  return ageMs > STALE_THRESHOLD_MS;
}

/**
 * Compute the approximate age of evidence in days.
 * @param {string} isoDate - ISO 8601 date string
 * @returns {number} age in days (rounded)
 */
function ageInDays(isoDate) {
  if (!isoDate) return 0;
  return Math.round((Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Build a variant object with the given index and section-specific content.
 * @param {number} index - 1-based variant number
 * @param {object} textContent - variant text (string or array for bullets)
 * @param {string} focus - primary improvement focus dimension
 * @param {object} assessmentContext - current-state assessment for rationale
 * @param {object} roleFitContext - role-fit context for targeting
 * @returns {object} variant
 */
function buildVariant(index, textContent, focus, assessmentContext, roleFitContext) {
  const rationaleParts = [];

  // Brand direction first (D-04)
  if (assessmentContext && assessmentContext.dominantFailureMode) {
    const dfm = assessmentContext.dominantFailureMode;
    rationaleParts.push(`Addresses ${dfm.dimension} gap (score: ${assessmentContext[dfm.dimension] || "?"}/100)`);
  }

  // Role-family fit second (D-04)
  if (roleFitContext && roleFitContext.blockers && roleFitContext.blockers.length > 0) {
    rationaleParts.push(`Targets role-fit blocker: ${roleFitContext.blockers[0].substring(0, 60)}...`);
  } else if (roleFitContext && roleFitContext.easyWins && roleFitContext.easyWins.length > 0) {
    rationaleParts.push(`Addresses easy win: ${roleFitContext.easyWins[0].substring(0, 60)}...`);
  }

  return {
    label: `Variant ${index}`,
    text: textContent,
    rationale: rationaleParts.length > 0
      ? rationaleParts.join("; ")
      : `Variant ${index} targeting ${focus} improvement`,
    focus,
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Build the headline section (3 variants per D-02).
 * Headline approach is conversation-driven (D-06), gravitating toward
 * user's profile and desired role-family.
 */
function buildHeadlineSection(artifactMissing, assessmentContext, roleFitContext) {
  const diagnosis = assessmentContext
    ? `Headline analysis: signal=${assessmentContext.signal || "?"}/100, narrative=${assessmentContext.narrative || "?"}/100`
    : "Headline section diagnosis based on available context";

  if (artifactMissing) {
    return {
      diagnosis,
      variants: [],
    };
  }

  const focuses = ["discoverability", "signal", "clarity"];
  const variants = [];
  for (let i = 0; i < VARIANT_COUNTS.headline; i++) {
    variants.push(buildVariant(
      i + 1,
      `[Headline Variant ${i + 1} — generated from profile context and role-family target]`,
      focuses[i % focuses.length],
      assessmentContext,
      roleFitContext
    ));
  }

  return { diagnosis, variants };
}

/**
 * Build the about section (2 variants per D-02).
 */
function buildAboutSection(artifactMissing, assessmentContext, roleFitContext) {
  const diagnosis = "About section analysis: narrative coherence and brand positioning assessment";

  if (artifactMissing) {
    return {
      diagnosis,
      variants: [],
    };
  }

  const focuses = ["narrative", "impact"];
  const variants = [];
  for (let i = 0; i < VARIANT_COUNTS.about; i++) {
    variants.push(buildVariant(
      i + 1,
      `[About Variant ${i + 1} — narrative-driven summary targeting role-family positioning]`,
      focuses[i % focuses.length],
      assessmentContext,
      roleFitContext
    ));
  }

  return { diagnosis, variants };
}

/**
 * Build the experience section (2 bullet-formatted variants per D-02, D-07).
 * Experience uses bullet_point format for recruiter scannability.
 */
function buildExperienceSection(artifactMissing, assessmentContext, roleFitContext) {
  const diagnosis = "Experience section analysis: quantified achievements, ownership signals, and role relevance";

  if (artifactMissing) {
    return {
      diagnosis,
      format: "bullet_points",
      variants: [],
    };
  }

  const focuses = ["impact", "clarity"];
  const variants = [];
  for (let i = 0; i < VARIANT_COUNTS.experience; i++) {
    variants.push({
      label: `Variant ${i + 1}`,
      text: [
        `• [Experience Variant ${i + 1} — Bullet 1: Lead achievement with quantified result]`,
        `• [Experience Variant ${i + 1} — Bullet 2: Ownership and decision-making signal]`,
        `• [Experience Variant ${i + 1} — Bullet 3: Technical depth and tooling expertise]`,
      ],
      rationale: `Experience Variant ${i + 1}: bullet-formatted for recruiter scannability per D-07`,
      focus: focuses[i % focuses.length],
    });
  }

  return { diagnosis, format: "bullet_points", variants };
}

/**
 * Build the featured section (2 variants per agent discretion, added for LI-01 coverage).
 */
function buildFeaturedSection(artifactMissing, assessmentContext, roleFitContext) {
  const diagnosis = "Featured section analysis: shelf content, project highlights, and media positioning";

  if (artifactMissing) {
    return {
      diagnosis,
      variants: [],
    };
  }

  const focuses = ["impact", "signal"];
  const variants = [];
  for (let i = 0; i < VARIANT_COUNTS.featured; i++) {
    variants.push(buildVariant(
      i + 1,
      `[Featured Variant ${i + 1} — recommended shelf content and media positioning]`,
      focuses[i % focuses.length],
      assessmentContext,
      roleFitContext
    ));
  }

  return { diagnosis, variants };
}

/**
 * Build the skills section (1 optimized list per D-02).
 * Skills list reorders existing skills by role-family relevance.
 * When artifactMissing, returns skills placeholder per D-20.
 */
function buildSkillsSection(artifactMissing, roleFitContext) {
  const diagnosis = "Skills section analysis: skill relevance ordering by role-family fit";

  if (artifactMissing) {
    return {
      diagnosis,
      variants: [{
        label: "Variant 1",
        text: ["[Skills placeholder — LinkedIn artifact needed for full skills optimization]"],
        rationale: "Diagnose-only mode: LinkedIn artifact is missing (D-20). Skills list placeholder provided.",
        focus: "discoverability",
      }],
    };
  }

  // Build the optimized skills list variant
  const skillsText = [
    "[Skills Optimized List — reordered by role-family relevance]",
    "[Top skills based on role-fit bucket scores and blocker analysis]",
  ];

  const variant = {
    label: "Variant 1",
    text: skillsText,
    rationale: "Skills list reordered by role-family relevance per D-02. Single optimized list output.",
    focus: "discoverability",
  };

  return { diagnosis, variants: [variant] };
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

/**
 * Determine if evidence for LinkedIn optimization is stale (>30 days per D-19).
 *
 * Checks both the staleness report and the LinkedIn artifact's evidence
 * summary timestamps. Returns a recommendation string if stale.
 *
 * @param {object} artifactContext - result from getArtifactContext()
 * @param {object[]} stalenessReport - result from getStalenessReport()
 * @returns {string|null} recommendation string or null if evidence is fresh
 */
function checkStaleness(artifactContext, stalenessReport) {
  const linkedinEntry = artifactContext.linkedin;
  if (!linkedinEntry || !linkedinEntry.artifact) {
    return null; // Missing artifact — handled separately
  }

  // Check 1: Look at evidence summary creation dates
  const allSummaries = linkedinEntry.summaries || [];
  const oldestSummary = allSummaries.reduce((oldest, s) => {
    if (!oldest || (s.created_at && s.created_at < oldest.created_at)) return s;
    return oldest;
  }, null);

  if (oldestSummary && isOlderThanThreshold(oldestSummary.created_at)) {
    const days = ageInDays(oldestSummary.created_at);
    return `Evidence for LinkedIn optimization is ${days} days old. Consider refreshing via bb-intake before proceeding for highest-quality results.`;
  }

  // Check 2: Look at supporting artifacts (resume, github) for staleness
  for (const rtype of ["resume", "github_profile", "github_repo"]) {
    const entry = artifactContext[rtype];
    if (!entry || !entry.artifact) continue;

    const summaries = entry.summaries || [];
    for (const s of summaries) {
      if (isOlderThanThreshold(s.created_at)) {
        const days = ageInDays(s.created_at);
        return `Supporting evidence (${rtype}) is ${days} days old. Refreshing may improve LinkedIn optimization accuracy.`;
      }
    }
  }

  // Check 3: Use staleness report for linkedin-specific stale summaries
  const linkedinStale = stalenessReport.find(s => s.artifactType === "linkedin");
  if (linkedinStale && linkedinStale.staleCount > 0) {
    return `Evidence for LinkedIn optimization contains ${linkedinStale.staleCount} stale evidence summary(s). Consider re-ingesting your LinkedIn profile for current results.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Next best action
// ---------------------------------------------------------------------------

/**
 * Determine the recommended next action based on optimizer state.
 *
 * @param {boolean} artifactMissing
 * @param {string|null} staleRecommendation
 * @param {object} assessmentContext
 * @param {object} roleFitContext
 * @returns {string}
 */
function determineNextBestAction(artifactMissing, staleRecommendation, assessmentContext, roleFitContext) {
  if (artifactMissing) {
    return "Upload your LinkedIn profile via bb-intake for full section-by-section optimization";
  }

  if (staleRecommendation) {
    return "Refresh your LinkedIn evidence via bb-intake to ensure optimization is based on current profile data";
  }

  // Default: proceed to specialist for variant wording
  if (roleFitContext && roleFitContext.blockers && roleFitContext.blockers.length > 0) {
    return "Proceed to LinkedIn specialist for variant wording — prioritize blocker-addressing variants";
  }

  return "Proceed to LinkedIn specialist for section-by-section variant generation and anti-voice review";
}

// ---------------------------------------------------------------------------
// Evidence used
// ---------------------------------------------------------------------------

/**
 * Collect the list of artifact types consumed by the optimizer.
 *
 * @param {object} artifactContext - result from getArtifactContext()
 * @returns {string[]}
 */
function collectEvidenceUsed(artifactContext) {
  const used = [];
  for (const rtype of CONTEXT_ARTIFACT_TYPES) {
    if (artifactContext[rtype] && artifactContext[rtype].artifact) {
      used.push(rtype);
    }
  }
  return used;
}

// ---------------------------------------------------------------------------
// runLinkedInOptimization — public API
// ---------------------------------------------------------------------------

/**
 * Run deterministic LinkedIn section diagnosis and produce structured
 * rewrite-input bundles for downstream specialist consumption.
 *
 * Per D-17: uses cached evidence only — no automatic refresh.
 * Per D-19: recommends refresh when evidence >30 days stale.
 * Per D-20: diagnose-only mode when LinkedIn artifact is missing.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {string[]} params.requestedSections - list of sections requested
 *   (e.g., ["headline", "about"]). All 5 sections are always computed;
 *   this parameter is accepted but does not gate section output.
 * @param {object} [params.assessmentContext] - Phase 3 current-state scores
 *   { signal, evidence, visibility, narrative, dominantFailureMode, improvements, confidence, nextBestAction }
 * @param {object} [params.roleFitContext] - Phase 4 role-fit assessment
 *   { fitScore, bracket, bucketScores, blockers, easyWins, strengths, confidence, evidenceUsed }
 * @returns {{
 *   workflowDomain: string,
 *   artifactMissing: boolean,
 *   staleRecommendation: string,
 *   sections: object,
 *   evidenceUsed: string[],
 *   roleFitTargets: string[],
 *   nextBestAction: string
 * }}
 */
function runLinkedInOptimization({ repos, requestedSections, assessmentContext, roleFitContext }) {
  if (!repos) {
    throw new Error("repos is required");
  }

  // 1. Retrieve artifact context (D-17: cached evidence only)
  const artifactContext = getArtifactContext({
    repos,
    artifactTypes: CONTEXT_ARTIFACT_TYPES,
  });

  // 2. Check if LinkedIn artifact exists (D-20)
  const linkedinEntry = artifactContext.linkedin;
  const artifactMissing = !linkedinEntry || !linkedinEntry.artifact;

  // 3. Check evidence staleness (D-19)
  const stalenessReport = getStalenessReport({ repos });
  const staleResult = checkStaleness(artifactContext, stalenessReport);

  // 4. Collect evidence used
  const evidenceUsed = collectEvidenceUsed(artifactContext);

  // 5. Build role-fit targets for variant rationale
  const roleFitTargets = [];
  if (roleFitContext) {
    if (roleFitContext.blockers && roleFitContext.blockers.length > 0) {
      roleFitTargets.push(...roleFitContext.blockers.map(b =>
        `Blocker: ${b.length > 80 ? b.substring(0, 77) + "..." : b}`
      ));
    }
    if (roleFitContext.easyWins && roleFitContext.easyWins.length > 0) {
      roleFitTargets.push(...roleFitContext.easyWins.map(w =>
        `Easy win: ${w.length > 80 ? w.substring(0, 77) + "..." : w}`
      ));
    }
    if (roleFitContext.strengths && roleFitContext.strengths.length > 0) {
      roleFitTargets.push(...roleFitContext.strengths.map(s =>
        `Strength: ${s.length > 80 ? s.substring(0, 77) + "..." : s}`
      ));
    }
  }

  // If no role-fit context, provide a default
  if (roleFitTargets.length === 0) {
    roleFitTargets.push("No specific role-fit targets available — general optimization mode");
  }

  // 6. Build all sections deterministically
  const sections = {};
  for (const sectionName of REQUIRED_SECTIONS) {
    switch (sectionName) {
      case "headline":
        sections.headline = buildHeadlineSection(artifactMissing, assessmentContext, roleFitContext);
        break;
      case "about":
        sections.about = buildAboutSection(artifactMissing, assessmentContext, roleFitContext);
        break;
      case "experience":
        sections.experience = buildExperienceSection(artifactMissing, assessmentContext, roleFitContext);
        break;
      case "featured":
        sections.featured = buildFeaturedSection(artifactMissing, assessmentContext, roleFitContext);
        break;
      case "skills":
        sections.skills = buildSkillsSection(artifactMissing, roleFitContext);
        break;
    }

    // Attach provenance to each section
    const section = sections[sectionName];
    if (section) {
      section.provenance = {
        inputs: evidenceUsed,
        rules: [
          {
            id: artifactMissing ? "diagnose_only_mode" : "full_section_analysis",
            effect: artifactMissing ? 0 : 1,
            reason: artifactMissing
              ? "LinkedIn artifact missing — diagnose-only mode per D-20"
              : `Section built from ${evidenceUsed.length} evidence source(s): ${evidenceUsed.join(", ")}`,
          },
          ...(assessmentContext && assessmentContext.dominantFailureMode ? [{
            id: "assessment_context_applied",
            effect: 1,
            reason: `Assessment context: ${assessmentContext.dominantFailureMode.dimension} gap (score ${assessmentContext[assessmentContext.dominantFailureMode.dimension] || "?"}\/100) informed variant rationale`,
          }] : []),
          ...(roleFitContext && roleFitContext.blockers && roleFitContext.blockers.length > 0 ? [{
            id: "role_fit_blocker_targeted",
            effect: 1,
            reason: `Role-fit blocker targeted: ${roleFitContext.blockers[0].substring(0, 80)}`,
          }] : []),
        ],
        trace: artifactMissing
          ? `diagnose-only: no LinkedIn artifact (D-20)`
          : `section="${sectionName}" built from evidence=[${evidenceUsed.join(", ")}]`,
      };
    }
  }

  // 7. Determine next best action
  const nextBestAction = determineNextBestAction(
    artifactMissing,
    staleResult,
    assessmentContext,
    roleFitContext
  );

  // 8. Return assembled output contract
  return {
    workflowDomain: "linkedin",
    artifactMissing,
    staleRecommendation: staleResult || "",
    sections,
    evidenceUsed,
    roleFitTargets,
    nextBestAction,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { runLinkedInOptimization };
