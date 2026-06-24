/**
 * Brand Builder Brand Strategy Engine
 *
 * Deterministic brand strategy runtime that produces a narrative-first
 * website/content brief without crossing into implementation.
 *
 * Per BRAND-01: advisory mode assesses whether a dedicated website is
 *               needed based on existing surface coverage.
 * Per BRAND-02: active website mode produces a concrete website/content brief
 *               suitable for builder handoff.
 *
 * Module exports:
 *   - runBrandStrategy({ repos, websiteMode, websiteGoal, brandDirection,
 *                        assessmentContext, roleFitContext,
 *                        linkedinContext, githubContext })
 */

const {
  getArtifactContext,
  getLatestProfileState,
  getStalenessReport,
} = require("../memory/retrieval.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Artifact types to retrieve for brand strategy context. */
const CONTEXT_ARTIFACT_TYPES = [
  "resume",
  "linkedin",
  "github_profile",
  "github_repo",
  "website",
];

/** Thresholds for advisory mode recommendation. */
const NARRATIVE_THRESHOLD = 50;
const VISIBILITY_THRESHOLD = 45;
const MIN_EXISTING_SURFACES = 2;

/** Known surface types (existing surfaces the user might already have). */
const SURFACE_TYPES = ["linkedin", "github_profile", "website", "resume"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a website is recommended in advisory mode.
 *
 * A site is recommended when:
 *   - Narrative score is below threshold
 *   - Visibility score is below threshold
 *   - Fewer than MIN_EXISTING_SURFACES evidence surfaces exist
 *   - No existing website artifact
 *
 * @param {object} assessmentContext
 * @param {object} linkedinContext
 * @param {object} githubContext
 * @param {object} artifactContext
 * @returns {boolean}
 */
function shouldRecommendSite(assessmentContext, linkedinContext, githubContext, artifactContext) {
  // Count existing surfaces with evidence
  let surfaceCount = 0;

  if (artifactContext.linkedin && artifactContext.linkedin.artifact) surfaceCount++;
  if (artifactContext.github_profile && artifactContext.github_profile.artifact) surfaceCount++;
  if (artifactContext.website && artifactContext.website.artifact) surfaceCount++;
  if (artifactContext.resume && artifactContext.resume.artifact) surfaceCount++;

  const narrative = assessmentContext ? (assessmentContext.narrative || 50) : 50;
  const visibility = assessmentContext ? (assessmentContext.visibility || 50) : 50;

  // Weak narrative or visibility → recommend site
  if (narrative < NARRATIVE_THRESHOLD) return true;
  if (visibility < VISIBILITY_THRESHOLD) return true;

  // Insufficient surface count → recommend site
  if (surfaceCount < MIN_EXISTING_SURFACES) return true;

  // No existing website → recommend if LinkedIn/GitHub are the only surfaces
  const hasWebsite = artifactContext.website && artifactContext.website.artifact;
  if (!hasWebsite && surfaceCount <= 2) return true;

  // Strong narrative and visibility with diverse surfaces → no site needed
  return false;
}

/**
 * Build the website job statement.
 *
 * @param {string} websiteMode - "advisory" or "active"
 * @param {string} websiteGoal - user's explicit website goal
 * @param {string} brandDirection - user's brand direction
 * @param {object} assessmentContext
 * @param {object} roleFitContext
 * @returns {string}
 */
function buildSiteJob(websiteMode, websiteGoal, brandDirection, assessmentContext, roleFitContext) {
  if (websiteGoal && websiteGoal.trim().length > 0) {
    return websiteGoal.trim();
  }

  if (brandDirection && brandDirection.trim().length > 0) {
    return `Personal website showcasing ${brandDirection.trim()}`;
  }

  // Build a default site job from assessment/role-fit context
  const parts = [];
  if (assessmentContext && assessmentContext.dominantFailureMode) {
    const dfm = assessmentContext.dominantFailureMode;
    parts.push(`Address ${dfm.dimension} gap in professional presentation`);
  }

  if (roleFitContext && roleFitContext.blockers && roleFitContext.blockers.length > 0) {
    parts.push(`Demonstrate capability in: ${roleFitContext.blockers[0].substring(0, 60)}`);
  } else if (roleFitContext && roleFitContext.strengths && roleFitContext.strengths.length > 0) {
    parts.push(`Showcase strengths: ${roleFitContext.strengths[0].substring(0, 60)}`);
  }

  if (parts.length === 0) {
    parts.push("Professional portfolio and narrative site");
  }

  return parts.join(". ");
}

/**
 * Build the site structure (sections/pages).
 *
 * @param {boolean} siteRecommended
 * @param {object} assessmentContext
 * @param {object} linkedinContext
 * @param {object} githubContext
 * @returns {object[]}
 */
function buildSiteStructure(siteRecommended, assessmentContext, linkedinContext, githubContext) {
  if (!siteRecommended) {
    return [{ name: "Home", purpose: "Minimal landing page — full site not recommended at this time" }];
  }

  const sections = [
    {
      name: "Home / Hero",
      purpose: "First-impression narrative positioning — who you are and what you do",
      content: "Bold headline, professional summary, primary call-to-action",
    },
    {
      name: "About",
      purpose: "Extended narrative — career story, values, and professional philosophy",
      content: "Narrative-driven bio anchored in LinkedIn and GitHub evidence",
    },
  ];

  // Add Work/Experience section if LinkedIn context exists
  if (linkedinContext && linkedinContext.present) {
    sections.push({
      name: "Work & Experience",
      purpose: "Career timeline with quantified achievements",
      content: "Experience summaries sourced from LinkedIn, expanded with proof context",
    });
  }

  // Add Proof/Projects section if GitHub context exists
  if (githubContext && githubContext.repos && githubContext.repos.length > 0) {
    sections.push({
      name: "Projects & Proof",
      purpose: "Selected portfolio work demonstrating engineering capability",
      content: "Project summaries with on-site descriptions and off-site GitHub links",
    });
  }

  // Add Writing/Insights section for narrative depth
  sections.push({
    name: "Writing & Insights",
    purpose: "Thought leadership and perspective pieces",
    content: "Optional section for articles, talks, and professional insights",
  });

  // Add Contact section
  sections.push({
    name: "Contact",
    purpose: "Professional contact surface",
    content: "LinkedIn link, email, and relevant professional profiles",
  });

  return sections;
}

/**
 * Build the proof shelf — which evidence lives on-site vs off-site.
 *
 * @param {boolean} siteRecommended
 * @param {object} githubContext
 * @param {object} linkedinContext
 * @param {object} assessmentContext
 * @returns {object}
 */
function buildProofShelf(siteRecommended, githubContext, linkedinContext, assessmentContext) {
  if (!siteRecommended) {
    return { onSite: [], offSite: [], recommendation: "No website recommended — proof surfaced via LinkedIn and GitHub" };
  }

  const onSite = [];
  const offSite = [];

  // GitHub repos → off-site with on-site summaries
  if (githubContext && githubContext.repos && githubContext.repos.length > 0) {
    for (const repo of githubContext.repos) {
      offSite.push({
        source: "github",
        name: repo.name || "Repository",
        disposition: repo.disposition || "Reference",
        guidance: repo.disposition === "Highlight" ? "Feature on-site with summary" : "Link off-site only",
      });

      if (repo.disposition === "Highlight") {
        onSite.push({
          type: "project_summary",
          name: repo.name,
          source: "github",
          summary: `Summary of ${repo.name} — key contributions and technical decisions`,
        });
      }
    }
  }

  // LinkedIn context → off-site reference
  if (linkedinContext && linkedinContext.present) {
    offSite.push({
      source: "linkedin",
      name: "LinkedIn Profile",
      guidance: "Primary professional network surface — link prominently",
    });
  }

  return {
    onSite,
    offSite,
    recommendation: "Keep summaries on-site, depth off-site. On-site content should give enough to demonstrate capability; off-site links provide full evidence depth.",
  };
}

/**
 * Build the cross-surface alignment checklist.
 *
 * @param {boolean} siteRecommended
 * @param {object} linkedinContext
 * @param {object} githubContext
 * @param {object} assessmentContext
 * @returns {string[]}
 */
function buildAlignmentChecklist(siteRecommended, linkedinContext, githubContext, assessmentContext) {
  const items = [];

  items.push("Ensure website headline aligns with LinkedIn headline positioning");

  if (linkedinContext && linkedinContext.present) {
    items.push("Sync LinkedIn 'About' section narrative with website About page");
    items.push("Cross-link LinkedIn profile from website contact section");
  }

  if (githubContext && githubContext.repos && githubContext.repos.length > 0) {
    items.push("Ensure highlighted GitHub repos are linked from website Projects section");
    items.push("Align GitHub profile README with website narrative direction");
  }

  if (assessmentContext && assessmentContext.dominantFailureMode) {
    const dfm = assessmentContext.dominantFailureMode;
    items.push(`Address ${dfm.dimension} gap consistently across LinkedIn, GitHub, and website`);
  }

  items.push("Review all surfaces for consistent professional title and branding");
  items.push("Ensure off-site proof links are working and point to current versions");

  return items;
}

/**
 * Build the website/content brief — the concrete handoff artifact for BRAND-02.
 *
 * Per spec: must include site job, audience, section map, proof shelf,
 * off-site proof links, voice notes, content priorities, and builder handoff notes.
 * Must NOT include implementation, deployment, or hosting instructions.
 *
 * @param {object} params
 * @returns {object}
 */
function buildWebsiteBrief({
  siteRecommended,
  siteJob,
  siteStructure,
  proofShelf,
  websiteGoal,
  brandDirection,
  assessmentContext,
  roleFitContext,
  linkedinContext,
  githubContext,
}) {
  if (!siteRecommended) {
    return {
      status: "not_recommended",
      reason: "Existing surfaces (LinkedIn, GitHub, resume) sufficiently cover narrative and visibility needs. A dedicated website would provide marginal benefit at this time.",
      alternativeGuidance: "Focus on optimizing existing LinkedIn and GitHub surfaces for maximum impact.",
    };
  }

  // Determine audience from role-fit context
  const audience = [];
  if (roleFitContext && roleFitContext.bucketScores) {
    audience.push("Hiring managers and technical recruiters");
    audience.push("Engineering peers and collaborators");
    audience.push("Conference and speaking organizers");
  } else {
    audience.push("Professional network and potential employers");
  }

  // Voice notes from brand direction
  const voiceNotes = brandDirection
    ? [`Brand direction: ${brandDirection}`, "Maintain authentic professional voice — no corporate-speak", "Evidence-anchored claims only — every assertion traceable to artifacts"]
    : ["Keep voice authentic and evidence-grounded", "Prefer concrete achievements over generic descriptors"];

  // Content priorities
  const contentPriorities = [];
  if (assessmentContext && assessmentContext.dominantFailureMode) {
    contentPriorities.push(`Priority 1: Address ${assessmentContext.dominantFailureMode.dimension} gap — ${assessmentContext.dominantFailureMode.reason || "improve presentation"}`);
  }
  if (roleFitContext && roleFitContext.blockers && roleFitContext.blockers.length > 0) {
    contentPriorities.push(`Priority 2: Target role-fit blockers through proof content`);
  }
  contentPriorities.push("Priority 3: Narrative coherence across all pages and surfaces");

  // Section content map
  const sectionContentMap = siteStructure.map((section) => ({
    section: section.name,
    purpose: section.purpose,
    contentGuidance: section.content,
  }));

  // Builder handoff notes — strictly advisory, no implementation steps
  const builderHandoff = {
    mode: "advisory",
    boundary: "This brief is a build-ready specification. The builder workflow (future phase) will handle implementation.",
    constraints: [
      "Local-first implementation only",
      "No automated deployment or hosting configuration",
      "Keep summaries on-site, depth off-site via links",
      "Preserve narrative-first philosophy — not a template site",
    ],
    visualGuidance: "Visual exploration support available but deferred to builder workflow. Brand direction should inform design choices.",
  };

  return {
    status: "recommended",
    siteJob,
    audience,
    onSiteContent: sectionContentMap,
    sectionMap: sectionContentMap,
    proofShelf: proofShelf.onSite.map((p) => p.name),
    offSiteProofLinks: proofShelf.offSite.map((p) => ({ source: p.source, name: p.name, guidance: p.guidance })),
    voiceNotes,
    contentPriorities,
    builderHandoff,
  };
}

// ---------------------------------------------------------------------------
// Staleness check (brand-specific)
// ---------------------------------------------------------------------------

/** Staleness threshold in milliseconds (30 days). */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Calculate age in days from an ISO date string.
 */
function ageInDays(isoDate) {
  if (!isoDate) return 0;
  return Math.round((Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Check if an ISO date is older than the staleness threshold.
 */
function isOlderThanThreshold(isoDate) {
  if (!isoDate) return false;
  const ageMs = Date.now() - new Date(isoDate).getTime();
  return ageMs > STALE_THRESHOLD_MS;
}

/**
 * Check if evidence for brand strategy is stale (>30 days).
 *
 * Checks both the staleness report (marked-stale records) and evidence
 * summary creation dates for brand-relevant artifact types.
 *
 * @param {object} artifactContext
 * @param {object[]} stalenessReport
 * @returns {string}
 */
function checkBrandStaleness(artifactContext, stalenessReport) {
  const relevantTypes = ["linkedin", "github_profile", "website", "resume"];

  // Check 1: Look at evidence summary creation dates for brand-relevant artifacts
  for (const rtype of relevantTypes) {
    const entry = artifactContext[rtype];
    if (!entry || !entry.artifact) continue;

    const summaries = entry.summaries || [];
    for (const s of summaries) {
      if (isOlderThanThreshold(s.created_at)) {
        const days = ageInDays(s.created_at);
        const typeName = rtype.replace("_", " ");
        return `Evidence for ${typeName} is ${days} days old. Consider refreshing via bb-intake for current brand strategy results.`;
      }
    }
  }

  // Check 2: Use staleness report for marked-stale records
  for (const entry of stalenessReport) {
    if (relevantTypes.includes(entry.artifactType) && entry.staleCount > 0) {
      const typeName = entry.artifactType.replace("_", " ");
      return `Evidence for ${typeName} is stale (${entry.staleCount} stale summaries). Consider refreshing via bb-intake for current brand strategy results.`;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Evidence used
// ---------------------------------------------------------------------------

/**
 * Collect the list of artifact types consumed by the brand strategy engine.
 *
 * @param {object} artifactContext
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
// Recommended next action
// ---------------------------------------------------------------------------

/**
 * Determine the recommended next action.
 *
 * @param {boolean} siteRecommended
 * @param {string} websiteMode
 * @param {string} staleRecommendation
 * @returns {string}
 */
function determineNextAction(siteRecommended, websiteMode, staleRecommendation) {
  if (staleRecommendation) {
    return "Refresh profile evidence via bb-intake before proceeding with brand strategy";
  }

  if (!siteRecommended) {
    return "Maintain and optimize existing LinkedIn and GitHub surfaces. Revisit website decision after significant profile changes.";
  }

  if (websiteMode === "active") {
    return "Review and refine the website brief with the brand specialist. When ready, hand off to the builder workflow for local implementation.";
  }

  return "Review website recommendation with brand specialist to define specific website goal and brand direction. Then re-run in active website workflow mode.";
}

// ---------------------------------------------------------------------------
// runBrandStrategy — public API
// ---------------------------------------------------------------------------

/**
 * Run deterministic brand strategy analysis and produce a narrative-first
 * website/content brief.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {string} params.websiteMode - "advisory" or "active"
 * @param {string} [params.websiteGoal] - explicit user website goal (active mode)
 * @param {string} [params.brandDirection] - user's brand positioning direction
 * @param {object} [params.assessmentContext] - Phase 3 current-state assessment
 * @param {object} [params.roleFitContext] - Phase 4 role-fit assessment
 * @param {object} [params.linkedinContext] - LinkedIn surface context
 * @param {object} [params.githubContext] - GitHub surface context
 * @returns {{
 *   workflowDomain: string,
 *   siteRecommended: boolean,
 *   siteJob: string,
 *   siteStructure: object[],
 *   proofShelf: object,
 *   alignmentChecklist: string[],
 *   staleRecommendation: string,
 *   evidenceUsed: string[],
 *   websiteBrief: object,
 *   recommendedNextAction: string
 * }}
 */
function runBrandStrategy({
  repos,
  websiteMode = "advisory",
  websiteGoal = "",
  brandDirection = "",
  assessmentContext = null,
  roleFitContext = null,
  linkedinContext = null,
  githubContext = null,
}) {
  if (!repos) {
    throw new Error("repos is required");
  }

  // 1. Retrieve artifact context
  const artifactContext = getArtifactContext({
    repos,
    artifactTypes: CONTEXT_ARTIFACT_TYPES,
  });

  // 2. Check evidence staleness
  const stalenessReport = getStalenessReport({ repos });
  const staleResult = checkBrandStaleness(artifactContext, stalenessReport);

  // 3. Collect evidence used
  const evidenceUsed = collectEvidenceUsed(artifactContext);

  // 4. Determine site recommendation
  const isActiveMode = websiteMode === "active";
  const siteRecommended = isActiveMode
    ? true
    : shouldRecommendSite(assessmentContext, linkedinContext, githubContext, artifactContext);

  // 5. Build site job
  const siteJob = buildSiteJob(websiteMode, websiteGoal, brandDirection, assessmentContext, roleFitContext);

  // 6. Build site structure
  const siteStructure = buildSiteStructure(siteRecommended, assessmentContext, linkedinContext, githubContext);

  // 7. Build proof shelf
  const proofShelf = buildProofShelf(siteRecommended, githubContext, linkedinContext, assessmentContext);

  // 8. Build alignment checklist
  const alignmentChecklist = buildAlignmentChecklist(siteRecommended, linkedinContext, githubContext, assessmentContext);

  // 9. Build website brief
  const websiteBrief = buildWebsiteBrief({
    siteRecommended,
    siteJob,
    siteStructure,
    proofShelf,
    websiteGoal,
    brandDirection,
    assessmentContext,
    roleFitContext,
    linkedinContext,
    githubContext,
  });

  // 10. Determine recommended next action
  const recommendedNextAction = determineNextAction(siteRecommended, websiteMode, staleResult);

  // 11. Build provenance for brand direction and advisory outputs
  const provenanceRules = [
    {
      id: "evidence_surfaces_used",
      effect: evidenceUsed.length,
      reason: `${evidenceUsed.length} artifact surface(s) consulted: [${evidenceUsed.join(", ")}]`,
    },
    {
      id: "site_recommendation_rule",
      effect: siteRecommended ? 1 : 0,
      reason: siteRecommended
        ? `Website recommended: narrative=${assessmentContext?.narrative ?? "?"}, visibility=${assessmentContext?.visibility ?? "?"} below thresholds or insufficient surfaces`
        : `Website not recommended: sufficient narrative/visibility coverage across existing surfaces`,
    },
  ];

  if (assessmentContext && assessmentContext.dominantFailureMode) {
    provenanceRules.push({
      id: "dominant_failure_mode_applied",
      effect: 1,
      reason: `Dominant failure mode "${assessmentContext.dominantFailureMode.dimension}" informed content priorities`,
    });
  }

  if (staleResult) {
    provenanceRules.push({
      id: "stale_evidence_detected",
      effect: -1,
      reason: `Stale evidence detected: ${staleResult.substring(0, 100)}`,
    });
  }

  const strategyProvenance = {
    inputs: evidenceUsed,
    rules: provenanceRules,
    trace: `evidence=[${evidenceUsed.join(", ")}], siteRecommended=${siteRecommended}, websiteMode=${websiteMode}`,
  };

  // 12. Return assembled output contract
  return {
    workflowDomain: "brand",
    siteRecommended,
    siteJob,
    siteStructure,
    proofShelf,
    alignmentChecklist,
    staleRecommendation: staleResult || "",
    evidenceUsed,
    websiteBrief,
    recommendedNextAction,
    provenance: strategyProvenance,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { runBrandStrategy };
