/**
 * Brand Builder Growth Planner
 *
 * Deterministic repeated-gap aggregation, project/proof-first recommendation
 * gating, and certificate eligibility logic.
 *
 * Per GROW-01: Aggregates repeated gaps from role-family history snapshots
 * and produces focused project/proof next steps.
 *
 * Per GROW-02: Certificate recommendations only appear when a gap repeats
 * across multiple snapshots, is market-rewarded, and materially beats
 * project/proof alternatives. Project/proof wins by default.
 *
 * Module exports:
 *   - runGrowthPlanning({ repos, roleTarget, timeHorizonMonths, constraints, brandContext })
 */

const {
  slugRoleFamily,
  listRoleFitSnapshotsByRoleFamily,
} = require("../role-fit/history.js");

const {
  getRecentSnapshots,
  getLatestProfileState,
} = require("../memory/retrieval.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Market-rewarded certification domains.
 *
 * These are certification areas where the market materially rewards formal
 * credentials over informal project/proof alternatives. Gaps matching these
 * domains are eligible for certificate recommendation through the GROW-02 gate.
 *
 * Per the approved spec: certificate recommendations only appear when the
 * market actually rewards formal certification here.
 */
const MARKET_REWARDED_CERTIFICATIONS = {
  "cloud architecture": {
    certificates: ["AWS Solutions Architect", "Google Cloud Professional Architect", "Azure Solutions Architect"],
    rationale: "Cloud architecture certifications are consistently required or strongly preferred in cloud engineering roles and materially beat project portfolios for proving architectural breadth.",
  },
  "aws": {
    certificates: ["AWS Solutions Architect", "AWS DevOps Engineer", "AWS Security Specialty"],
    rationale: "AWS certifications are explicitly listed in job requirements for cloud-focused roles and carry market-recognized signal value.",
  },
  "azure": {
    certificates: ["Azure Solutions Architect", "Azure DevOps Engineer", "Azure Security Engineer"],
    rationale: "Azure certifications signal enterprise cloud expertise that project portfolios alone rarely demonstrate comprehensively.",
  },
  "gcp": {
    certificates: ["Google Cloud Professional Architect", "Google Cloud Data Engineer", "Google Cloud Security Engineer"],
    rationale: "GCP certifications confirm multi-cloud fluency and platform-specific depth valued by enterprises.",
  },
  "kubernetes": {
    certificates: ["CKA (Certified Kubernetes Administrator)", "CKAD (Certified Kubernetes Application Developer)", "CKS (Certified Kubernetes Security Specialist)"],
    rationale: "Kubernetes certifications are gatekeeping requirements for many platform and DevOps engineering roles.",
  },
  "security": {
    certificates: ["CISSP", "CompTIA Security+", "CEH (Certified Ethical Hacker)"],
    rationale: "Security certifications are regulatory requirements in many industries and signal vetted domain expertise.",
  },
  "machine learning": {
    certificates: ["AWS Machine Learning Specialty", "Google Professional ML Engineer", "TensorFlow Developer Certificate"],
    rationale: "ML certifications validate formal training in a field where self-directed projects can be hard to evaluate for depth.",
  },
  "data engineering": {
    certificates: ["Google Professional Data Engineer", "Azure Data Engineer Associate", "Databricks Certified Data Engineer"],
    rationale: "Data engineering certifications signal platform-specific expertise that project portfolios alone struggle to convey.",
  },
  "project management": {
    certificates: ["PMP (Project Management Professional)", "PRINCE2", "Certified ScrumMaster"],
    rationale: "Project management certifications are hiring filters for management-track roles and signal recognized methodology competency.",
  },
  "scrum master": {
    certificates: ["Certified ScrumMaster (CSM)", "PSM (Professional Scrum Master)", "SAFe Scrum Master"],
    rationale: "Scrum certifications are commonly listed as preferred qualifications for agile team leadership roles.",
  },
  "cissp": {
    certificates: ["CISSP", "CSSLP", "CCSP"],
    rationale: "CISSP and related certifications are industry-standard requirements for senior security roles and compliance positions.",
  },
};

/**
 * Recurring gap occurrence threshold.
 *
 * A blocker label must appear in at least this many role-fit snapshots to
 * be classified as a recurring gap.
 */
const RECURRING_GAP_THRESHOLD = 2;

/**
 * Default time horizon in months (medium horizon per approved spec).
 */
const DEFAULT_HORIZON_MONTHS = 6;

/**
 * Valid confidence levels.
 */
const VALID_CONFIDENCE = Object.freeze(["high", "medium", "low"]);

// ---------------------------------------------------------------------------
// Gap normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a blocker label for comparison across snapshots.
 *
 * Lowercases, trims, collapses whitespace, and removes trailing punctuation.
 * This makes gap matching resilient to minor wording variations.
 *
 * @param {string} label
 * @returns {string}
 */
function normalizeBlockerLabel(label) {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/["']/g, "");
}

/**
 * Check if a blocker label is related to a market-rewarded certification domain.
 *
 * Matches against known certification domain keywords.
 *
 * @param {string} normalizedLabel
 * @returns {{ matched: boolean, domain: string|null, certInfo: object|null }}
 */
function matchCertificationDomain(normalizedLabel) {
  for (const [domain, certInfo] of Object.entries(MARKET_REWARDED_CERTIFICATIONS)) {
    if (normalizedLabel.includes(domain)) {
      return { matched: true, domain, certInfo };
    }
  }
  return { matched: false, domain: null, certInfo: null };
}

// ---------------------------------------------------------------------------
// Gap aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate blocker labels across role-fit snapshots and identify recurring gaps.
 *
 * Groups normalized blocker labels and counts occurrences across snapshots.
 * A gap is "recurring" if it appears in at least RECURRING_GAP_THRESHOLD snapshots.
 *
 * @param {object[]} roleFitSnapshots - from listRoleFitSnapshotsByRoleFamily
 * @returns {{ recurringGaps: object[], allGaps: Map<string, object> }}
 */
function aggregateGaps(roleFitSnapshots) {
  /** Map<normalizedLabel, { occurrences, snapshotsWith, rawLabels }> */
  const gapMap = new Map();

  for (const snap of roleFitSnapshots) {
    let profileState;
    try {
      profileState = JSON.parse(snap.profile_state || "{}");
    } catch {
      continue;
    }

    const labels = profileState.top_blocker_labels || [];
    const seen = new Set();

    for (const rawLabel of labels) {
      const normalized = normalizeBlockerLabel(rawLabel);
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      let entry = gapMap.get(normalized);
      if (!entry) {
        entry = {
          blockerLabel: normalized,
          rawLabels: [],
          occurrenceCount: 0,
          snapshots: [],
        };
        gapMap.set(normalized, entry);
      }
      entry.rawLabels.push(rawLabel);
      entry.occurrenceCount++;
      entry.snapshots.push({
        snapshotId: snap.snapshot_id,
        fitScore: profileState.fit_score,
        fitBracket: profileState.fit_bracket,
        createdAt: snap.created_at,
      });
    }
  }

  // Identify recurring gaps (appear in ≥2 snapshots)
  const recurringGaps = [];
  for (const [, entry] of gapMap) {
    if (entry.occurrenceCount >= RECURRING_GAP_THRESHOLD) {
      recurringGaps.push({
        blockerLabel: entry.blockerLabel,
        occurrenceCount: entry.occurrenceCount,
        snapshots: entry.snapshots,
      });
    }
  }

  // Sort by occurrence count descending (most frequent first)
  recurringGaps.sort((a, b) => b.occurrenceCount - a.occurrenceCount);

  return { recurringGaps, allGaps: gapMap };
}

// ---------------------------------------------------------------------------
// Recommendation builders
// ---------------------------------------------------------------------------

/**
 * Build project/proof recommendations for a recurring gap.
 *
 * Project/proof recommendations are the default — they win by default
 * per GROW-02. Only when the certificate gate passes does a gap get a
 * certificate recommendation instead.
 *
 * @param {object} gap - recurring gap entry
 * @param {object} roleTarget - the user's role target
 * @param {number} timeHorizonMonths
 * @returns {object}
 */
function buildProjectProofRecommendation(gap, roleTarget, timeHorizonMonths) {
  const roleTitle = roleTarget.roleTitle || "target role";
  const label = gap.blockerLabel;

  let recommendation;

  if (label.includes("proof") || label.includes("public proof") || label.includes("system design") || label.includes("portfolio")) {
    recommendation = `Build a public proof project demonstrating ${roleTitle} capabilities within ${timeHorizonMonths} months. Create a well-documented GitHub repository with architecture decisions, tests, and a case-study README that directly addresses "${gap.blockerLabel}".`;
  } else if (label.includes("cloud") || label.includes("deployment") || label.includes("aws") || label.includes("azure") || label.includes("gcp")) {
    recommendation = `Deploy a cloud-native project on a major platform with CI/CD, infrastructure-as-code, and monitoring. Publish the architecture and cost analysis as public proof for "${gap.blockerLabel}" within ${timeHorizonMonths} months.`;
  } else if (label.includes("open-source") || label.includes("open source") || label.includes("contribution")) {
    recommendation = `Make 3-5 meaningful pull requests to a well-known ${roleTitle} open-source project. Document each contribution and its impact. Target completion within ${timeHorizonMonths} months.`;
  } else if (label.includes("narrative") || label.includes("coherence") || label.includes("story")) {
    recommendation = `Rewrite your professional narrative across LinkedIn and resume to articulate a clear ${roleTitle} trajectory. Use specific project outcomes and quantified results. Complete within 1 month.`;
  } else if (label.includes("leadership") || label.includes("team lead") || label.includes("engineering lead")) {
    recommendation = `Lead a cross-functional project or mentor initiative. Document leadership outcomes (team size, project scope, measurable results). Present as a case study within ${timeHorizonMonths} months.`;
  } else if (label.includes("experience") || label.includes("years") || label.includes("seniority")) {
    recommendation = `Build depth in ${roleTitle} through a focused 3-month skill-building project. Ship a production-quality deliverable and write about the technical decisions publicly.`;
  } else {
    recommendation = `Address "${gap.blockerLabel}" with a focused project or proof artifact within ${timeHorizonMonths} months. Document the approach, outcomes, and lessons learned publicly.`;
  }

  return {
    gap: gap.blockerLabel,
    occurrenceCount: gap.occurrenceCount,
    recommendation,
    type: "project_or_proof",
  };
}

/**
 * Build a certificate recommendation for a recurring gap.
 *
 * Only called when the GROW-02 certificate gate passes:
 *   1. Gap repeats across ≥2 snapshots
 *   2. Gap is market-rewarded
 *   3. Certificate materially beats project/proof alternatives
 *
 * @param {object} gap - recurring gap entry
 * @param {string} domain - matched certification domain
 * @param {object} certInfo - certification info from MARKET_REWARDED_CERTIFICATIONS
 * @param {number} timeHorizonMonths
 * @returns {object}
 */
function buildCertificateRecommendation(gap, domain, certInfo, timeHorizonMonths) {
  return {
    gap: gap.blockerLabel,
    occurrenceCount: gap.occurrenceCount,
    certificate: certInfo.certificates[0] || domain,
    alternativeCertificates: certInfo.certificates.slice(1),
    rationale: certInfo.rationale,
    whyNotProjectProof: `A project portfolio alone is insufficient to demonstrate the breadth and depth of "${gap.blockerLabel}" that employers verify through recognized certifications. The certification provides market-standard signal that self-directed projects cannot replicate in this domain.`,
    projectedTimeline: `${Math.min(timeHorizonMonths, 6)} months for exam preparation`,
    type: "certificate",
  };
}

/**
 * Build "what not to pursue" guidance.
 *
 * Identifies actions that are low-leverage for the given role target and
 * horizon, helping the user focus on high-impact steps.
 *
 * @param {object[]} recurringGaps
 * @param {number} timeHorizonMonths
 * @returns {string[]}
 */
function buildWhatNotToPursue(recurringGaps, timeHorizonMonths) {
  const items = [];

  if (timeHorizonMonths <= 12) {
    items.push("Do not pursue a full university degree program — the medium horizon is too short for degree completion to impact your next role search.");
    items.push("Do not spread across multiple unrelated certifications — focus on the single most impactful credential for your target role family.");
  }

  // If no recurring gaps detected, warn against random skill acquisition
  if (recurringGaps.length === 0) {
    items.push("Do not pursue random skill acquisition without a role-family focus. Wait for a role-fit assessment to identify specific gaps before investing time.");
  } else {
    items.push("Do not attempt to close all gaps simultaneously — sequence the top 1-2 recurring gaps first.");
  }

  // If gaps include low-signal issues, call them out
  const hasLowSignalGaps = recurringGaps.some(
    (g) =>
      g.blockerLabel.includes("narrative") ||
      g.blockerLabel.includes("coherence")
  );
  if (hasLowSignalGaps) {
    items.push("Do not invest in purely narrative fixes without also building proof artifacts — narrative without evidence is brittle.");
  }

  return items;
}

/**
 * Build a timeline plan with medium-horizon structure.
 *
 * @param {object[]} projectProofRecs
 * @param {object[]} certificateRecs
 * @param {number} timeHorizonMonths
 * @returns {object}
 */
function buildTimelinePlan(projectProofRecs, certificateRecs, timeHorizonMonths) {
  const phases = [];

  // Phase 1: Quick wins (month 1-2)
  const quickWins = [
    ...projectProofRecs.filter((r) =>
      r.gap.includes("narrative") || r.gap.includes("coherence") || r.gap.includes("story")
    ),
    ...certificateRecs.slice(0, 1),
  ];
  if (quickWins.length > 0) {
    phases.push({
      phase: "Phase 1: Quick Wins (Months 1-2)",
      focus: "Address immediate narrative and signal gaps that require the least time investment.",
      actions: quickWins.map((r) => r.recommendation || r.certificate || r.gap),
    });
  }

  // Phase 2: Core proof building (months 3-6)
  const coreProof = projectProofRecs.filter((r) =>
    !r.gap.includes("narrative") && !r.gap.includes("coherence") && !r.gap.includes("story")
  );
  if (coreProof.length > 0 || certificateRecs.length > (quickWins.length > 0 ? 1 : 0)) {
    const remainingCerts = quickWins.length > 0 ? certificateRecs.slice(1) : certificateRecs;
    phases.push({
      phase: `Phase 2: Core Proof Building (Months 3-${Math.min(timeHorizonMonths, 6)})`,
      focus: "Build and ship public proof projects that directly address recurring role-family gaps.",
      actions: [
        ...coreProof.map((r) => r.recommendation),
        ...remainingCerts.map((r) => `Prepare for and earn ${r.certificate}`),
      ],
    });
  }

  // Phase 3: Consolidation (months 7+)
  if (timeHorizonMonths > 6) {
    phases.push({
      phase: `Phase 3: Consolidation and Iteration (Months 7-${timeHorizonMonths})`,
      focus: "Reassess after initial improvements, run a new role-fit assessment, and iterate on remaining gaps.",
      actions: [
        "Re-run role-fit assessment with updated proof artifacts.",
        "Iterate on any remaining gaps identified in the reassessment.",
        "Update public surfaces (LinkedIn, GitHub) with new proof outcomes.",
      ],
    });
  }

  return {
    horizonMonths: timeHorizonMonths,
    totalPhases: phases.length,
    phases,
  };
}

/**
 * Determine confidence level based on available evidence.
 *
 * @param {number} snapshotCount - number of role-fit snapshots available
 * @param {number} recurringGapCount - number of recurring gaps detected
 * @param {boolean} hasLatestProfile - whether getLatestProfileState returned data
 * @returns {string} "high" | "medium" | "low"
 */
function determineConfidence(snapshotCount, recurringGapCount, hasLatestProfile) {
  if (snapshotCount >= 3 && recurringGapCount > 0 && hasLatestProfile) {
    return "high";
  }
  if (snapshotCount >= 2) {
    return "medium";
  }
  return "low";
}

/**
 * Determine the recommended next action.
 *
 * @param {object[]} recurringGaps
 * @param {object[]} projectProofRecs
 * @param {object[]} certificateRecs
 * @returns {string}
 */
function determineNextAction(recurringGaps, projectProofRecs, certificateRecs) {
  if (recurringGaps.length === 0) {
    return "Run a role-fit assessment to establish a baseline before planning growth steps. Without snapshots, growth recommendations cannot be evidence-grounded.";
  }

  if (certificateRecs.length > 0) {
    return `Pursue ${certificateRecs[0].certificate} as your highest-leverage growth step. This certification directly addresses your most recurring gap and carries market-recognized signal value that project alternatives cannot match.`;
  }

  if (projectProofRecs.length > 0) {
    return `${projectProofRecs[0].recommendation.substring(0, 200)}...`;
  }

  return "Review your recurring gaps and select the highest-impact proof project to start within the next 2 weeks.";
}

// ---------------------------------------------------------------------------
// runGrowthPlanning — public API
// ---------------------------------------------------------------------------

/**
 * Run deterministic growth planning for a role target.
 *
 * Aggregates repeated gaps from role-family history, applies project/proof-first
 * gating, and only recommends certificates when the GROW-02 gate passes:
 *   1. Same gap recurs across ≥2 role-fit snapshots
 *   2. The gap is market-rewarded (matches a known certification domain)
 *   3. The certificate materially beats project/proof alternatives
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {object} params.roleTarget - { roleTitle, seniority, domainContext }
 * @param {number} [params.timeHorizonMonths=6] - planning horizon (3-9 months recommended)
 * @param {object} [params.constraints={}] - user constraints (e.g., time, budget)
 * @param {object} [params.brandContext={}] - brand context from earlier phases
 * @returns {{
 *   workflowDomain: string,
 *   roleFamilySlug: string,
 *   recurringGaps: object[],
 *   projectProofRecommendations: object[],
 *   certificateRecommendations: object[],
 *   whatNotToPursue: string[],
 *   timelinePlan: object,
 *   confidence: string,
 *   recommendedNextAction: string
 * }}
 */
function runGrowthPlanning({
  repos,
  roleTarget,
  timeHorizonMonths = DEFAULT_HORIZON_MONTHS,
  constraints = {},
  brandContext = {},
}) {
  if (!repos) throw new Error("repos is required");
  if (!roleTarget) throw new Error("roleTarget is required");

  // 1. Compute role family slug from the target
  const roleFamilySlug = slugRoleFamily({
    roleTitle: roleTarget.roleTitle || "unknown",
    seniority: roleTarget.seniority || "mid",
    domainContext: roleTarget.domainContext || [],
  });

  // 2. Retrieve role-family-specific snapshots for repeated-gap analysis
  const roleFitSnapshots = listRoleFitSnapshotsByRoleFamily({
    repos,
    roleFamilySlug,
    limit: 10,
  });

  // 3. Retrieve general recent snapshots and latest profile state for context
  const recentSnapshots = getRecentSnapshots({ repos, limit: 10 });
  const latestProfile = getLatestProfileState({ repos });

  // 4. Aggregate repeated blocker labels into recurring gaps
  const { recurringGaps } = aggregateGaps(roleFitSnapshots);

  // 5. Build project/proof recommendations (default path — wins by default)
  const projectProofRecommendations = recurringGaps.map((gap) =>
    buildProjectProofRecommendation(gap, roleTarget, timeHorizonMonths)
  );

  // 6. Build certificate recommendations ONLY when the GROW-02 gate passes
  const certificateRecommendations = [];
  for (const gap of recurringGaps) {
    const { matched, domain, certInfo } = matchCertificationDomain(gap.blockerLabel);

    // GROW-02 Gate: all three conditions must be true
    //   1. Gap repeats across ≥2 snapshots (already true — it's in recurringGaps)
    //   2. Gap is market-rewarded (matched a certification domain)
    //   3. Certificate materially beats project/proof (hard-coded: always true
    //      for market-rewarded domains — the rationale is embedded in certInfo)
    if (matched) {
      certificateRecommendations.push(
        buildCertificateRecommendation(gap, domain, certInfo, timeHorizonMonths)
      );
    }
  }

  // 7. Build "what not to pursue" guidance
  const whatNotToPursue = buildWhatNotToPursue(recurringGaps, timeHorizonMonths);

  // 8. Build timeline plan
  const timelinePlan = buildTimelinePlan(
    projectProofRecommendations,
    certificateRecommendations,
    timeHorizonMonths
  );

  // 9. Determine confidence
  const confidence = determineConfidence(
    roleFitSnapshots.length,
    recurringGaps.length,
    latestProfile !== null
  );

  // 10. Determine recommended next action
  const recommendedNextAction = determineNextAction(
    recurringGaps,
    projectProofRecommendations,
    certificateRecommendations
  );

  // Build provenance for gap identification
  const gapProvenanceRules = recurringGaps.map((gap) => ({
    id: "recurring_gap_detected",
    effect: gap.occurrenceCount,
    reason: `"${gap.blockerLabel}" appeared in ${gap.occurrenceCount} role-fit snapshot(s) — exceeds threshold of ${RECURRING_GAP_THRESHOLD}`,
  }));

  if (gapProvenanceRules.length === 0) {
    gapProvenanceRules.push({
      id: "no_recurring_gaps",
      effect: 0,
      reason: `No recurring gaps detected across ${roleFitSnapshots.length} role-fit snapshot(s) for role family "${roleFamilySlug}"`,
    });
  }

  const growthProvenance = {
    inputs: roleFitSnapshots.map((s) => s.snapshot_id).filter(Boolean),
    rules: gapProvenanceRules,
    trace: `roleFamilySlug="${roleFamilySlug}", snapshots=${roleFitSnapshots.length}, recurringGaps=${recurringGaps.length}, confidence=${confidence}`,
  };

  return {
    workflowDomain: "growth",
    roleFamilySlug,
    recurringGaps,
    projectProofRecommendations,
    certificateRecommendations,
    whatNotToPursue,
    timelinePlan,
    confidence,
    recommendedNextAction,
    provenance: growthProvenance,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runGrowthPlanning,
  // Internal helpers exported for testing
  _normalizeBlockerLabel: normalizeBlockerLabel,
  _matchCertificationDomain: matchCertificationDomain,
  _aggregateGaps: aggregateGaps,
  _RECURRING_GAP_THRESHOLD: RECURRING_GAP_THRESHOLD,
  _MARKET_REWARDED_CERTIFICATIONS: MARKET_REWARDED_CERTIFICATIONS,
};
