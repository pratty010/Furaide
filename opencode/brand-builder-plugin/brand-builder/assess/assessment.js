/**
 * Brand Builder Current-State Assessment Engine
 *
 * Deterministic scoring module that turns Phase 2 memory evidence into the
 * four required dimension scores (Signal, Evidence, Visibility, Narrative),
 * sufficiency-aware confidence, dominant failure mode, and ranked improvements.
 *
 * Per D-01 through D-11 from 03-CONTEXT.md. No LLM calls — pure computation.
 *
 * Module exports:
 *   - runAssessment({ repos, artifactTypes })
 */

const {
  getArtifactContext,
  getLatestProfileState,
  ALL_ARTIFACT_TYPES,
} = require("../memory/retrieval.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All expected artifact types (max 6). */
const EXPECTED_ARTIFACT_TYPES = ALL_ARTIFACT_TYPES; // ["resume", "linkedin", "github_profile", "github_repo", "website", "job_description"]

/** Required dimensions. */
const DIMENSIONS = ["signal", "evidence", "visibility", "narrative"];

/** Tie-breaking priority order (D-06). */
const TIE_BREAK_PRIORITY = ["signal", "evidence", "visibility", "narrative"];

/** Confidence thresholds (D-10). */
const CONFIDENCE_HIGH = 0.7;
const CONFIDENCE_MEDIUM = 0.35;

/** Recency window in days for confidence calculation (D-09). */
const RECENCY_WINDOW_DAYS = 90;

/** Maximum number of improvements to return (D-07). */
const MAX_IMPROVEMENTS = 3;

/** Staleness window for improvement candidate detection (D-08). */
const STALE_CANDIDATE_DAYS = 90;

/** Low-score threshold — dimensions below this are high-impact candidates. */
const LOW_SCORE_THRESHOLD = 70;

/**
 * Next-best-action routing table keyed on dominant failure mode dimension.
 * Maps dimension → workflow token.
 */
const NEXT_ACTION_MAP = {
  signal: "current_state_assessment",
  evidence: "artifact_intake_update",
  visibility: "linkedin_optimization",
  narrative: "brand_strategy",
  default: "current_state_assessment",
};

// ---------------------------------------------------------------------------
// Evidence-to-dimension mapping
// ---------------------------------------------------------------------------

/**
 * Map evidence summary_type to which dimensions it contributes to.
 * Each summary type contributes evidence to specific dimensions.
 */
const SUMMARY_TYPE_DIMENSIONS = {
  field_extraction: ["signal", "evidence", "visibility", "narrative"],
  signal_assessment: ["signal", "evidence"],
  surface_snapshot: ["visibility", "narrative"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the maximum possible evidence "depth" for a dimension.
 * Each artifact type can contribute at most 1 fully-evidenced dimension unit.
 * With 6 artifact types, the max per dimension is 6.
 */
const MAX_DIMENSION_DEPTH = 6;

/**
 * Compute a base dimension score from evidence summaries.
 *
 * For each available artifact, count how many non-stale summaries contribute
 * to the given dimension. Normalize against the maximum possible.
 *
 * @param {object} context — result from getArtifactContext()
 * @param {string} dim — dimension name
 * @returns {number} base score before penalty (0-100)
 */
function computeBaseDimensionScore(context, dim) {
  let totalContribution = 0;
  let artifactCount = 0;

  for (const rtype of EXPECTED_ARTIFACT_TYPES) {
    const entry = context[rtype];
    if (!entry || !entry.artifact) continue;
    artifactCount++;

    // Count non-stale summaries that contribute to this dimension
    let dimSummaries = 0;
    for (const summary of entry.summaries) {
      const dims = SUMMARY_TYPE_DIMENSIONS[summary.summary_type] || [];
      if (dims.includes(dim)) {
        dimSummaries++;
      }
    }

    // Each artifact can contribute up to 1 unit per dimension
    // Contribution is min(1, dimSummaries / 2) to prevent over-scoring
    const contribution = Math.min(1, dimSummaries / 2);
    totalContribution += contribution;
  }

  // Normalize: base = (totalContribution / maxPossible) * 100
  // maxPossible = artifactCount (each artifact can contribute up to 1)
  if (artifactCount === 0) return 0;

  const rawScore = (totalContribution / artifactCount) * 100;
  return Math.min(100, Math.max(0, rawScore));
}

/**
 * Apply the proportional artifact sufficiency penalty (D-03).
 *
 * penalty = missing_artifact_types / total_expected_artifact_types
 * Missing means: no "current" artifact for that type.
 *
 * @param {number} score — pre-penalty score (0-100)
 * @param {number} availableCount — number of artifact types present
 * @returns {number} penalized score
 */
function applySufficiencyPenalty(score, availableCount) {
  const totalExpected = EXPECTED_ARTIFACT_TYPES.length; // 6
  const missing = totalExpected - availableCount;
  const penalty = missing / totalExpected;
  return score * (1 - penalty);
}

/**
 * Round a score to the nearest 10, clamped to 0-100 (D-02, D-04).
 *
 * @param {number} score
 * @returns {number} integer multiple of 10
 */
function roundToNearest10(score) {
  return Math.min(100, Math.max(0, Math.round(score / 10) * 10));
}

/**
 * Derive improvement candidates deterministically from evidence context.
 *
 * Three derivation rules:
 *   1. Dimensions scoring below LOW_SCORE_THRESHOLD → impact "high" (value 8)
 *   2. Missing artifact types (not in context) → impact "high" (value 9)
 *   3. Stale evidence (>90 days old) → impact "medium" (value 5)
 *
 * @param {object} context — result from getArtifactContext()
 * @param {object} finalScores — { signal, evidence, visibility, narrative }
 * @returns {object[]} candidates with { action, impact, ease }
 */
function deriveImprovementCandidates(context, finalScores) {
  const candidates = [];
  const now = Date.now();

  // Rule 1: Dimensions below threshold → high-impact candidates
  for (const dim of DIMENSIONS) {
    if (finalScores[dim] < LOW_SCORE_THRESHOLD) {
      const actionMap = {
        signal: "Strengthen professional signal with concrete achievements and quantified outcomes",
        evidence: "Add more supporting evidence artifacts to improve coverage",
        visibility: "Increase public-surface visibility via LinkedIn or GitHub optimization",
        narrative: "Improve cross-surface narrative coherence and brand positioning",
      };
      candidates.push({
        action: actionMap[dim],
        impact: 8,
        ease: 6,
        _source: `low_score_${dim}`,
      });
    }
  }

  // Rule 2: Missing artifact types → high-impact candidates
  for (const rtype of EXPECTED_ARTIFACT_TYPES) {
    const entry = context[rtype];
    if (!entry || !entry.artifact) {
      const artActionMap = {
        resume: "Upload a resume to provide signal and evidence across all dimensions",
        linkedin: "Add LinkedIn profile to improve visibility and narrative scores",
        github_profile: "Add GitHub profile to demonstrate evidence and proof strength",
        github_repo: "Add GitHub repositories to provide concrete engineering proof",
        website: "Add a personal website to improve narrative coherence and visibility",
        job_description: "Add a target job description to enable role-fit scoring",
      };
      candidates.push({
        action: artActionMap[rtype] || `Add ${rtype} artifact to improve coverage`,
        impact: 9,
        ease: 7,
        _source: `missing_artifact_${rtype}`,
      });
    }
  }

  // Rule 3: Stale evidence (>90 days) → medium-impact candidates
  const staleTypes = new Set();
  for (const rtype of EXPECTED_ARTIFACT_TYPES) {
    const entry = context[rtype];
    if (!entry || !entry.artifact) continue;
    for (const summary of entry.summaries || []) {
      if (summary.created_at) {
        const ageDays = (now - new Date(summary.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > STALE_CANDIDATE_DAYS && !staleTypes.has(rtype)) {
          staleTypes.add(rtype);
          candidates.push({
            action: `Refresh stale ${rtype} evidence (>${STALE_CANDIDATE_DAYS} days old) via re-ingestion`,
            impact: 5,
            ease: 8,
            _source: `stale_evidence_${rtype}`,
          });
          break;
        }
      }
    }
  }

  return candidates;
}

/**
 * Detect the dominant failure mode as the lowest-scoring dimension (D-05).
 * Resolve ties using D-06 priority: Signal > Evidence > Visibility > Narrative.
 *
 * @param {object} scores — { signal, evidence, visibility, narrative }
 * @returns {{ dimension: string, reason: string }}
 */
function detectDominantFailureMode(scores) {
  let lowestDim = DIMENSIONS[0];
  let lowestScore = scores[lowestDim];

  for (const dim of DIMENSIONS) {
    const score = scores[dim];
    if (score < lowestScore) {
      lowestScore = score;
      lowestDim = dim;
    } else if (score === lowestScore) {
      // D-06 tie-breaking: prefer the dim with higher priority (lower index)
      const currentPriority = TIE_BREAK_PRIORITY.indexOf(dim);
      const bestPriority = TIE_BREAK_PRIORITY.indexOf(lowestDim);
      if (currentPriority < bestPriority) {
        lowestDim = dim;
      }
    }
  }

  const reasonMap = {
    signal: `Signal score is ${lowestScore}/100 — professional signal indicators are weak or missing`,
    evidence: `Evidence score is ${lowestScore}/100 — supporting evidence is thin or not available`,
    visibility: `Visibility score is ${lowestScore}/100 — public-surface presence is limited`,
    narrative: `Narrative score is ${lowestScore}/100 — cross-surface story is not cohesive`,
  };

  return {
    dimension: lowestDim,
    reason: reasonMap[lowestDim] || `Lowest score is ${lowestDim} at ${lowestScore}/100`,
  };
}

/**
 * Rank improvement candidates by ROI (impact / ease) and assign priorities (D-07, D-08).
 *
 * If fewer than MAX_IMPROVEMENTS candidates, derive fillers from lowest-scoring dimensions.
 *
 * @param {object[]} candidates — [{ action, impact, ease }]
 * @param {object} scores — { signal, evidence, visibility, narrative }
 * @returns {object[]} top 3 with { action, impact, ease, priority }
 */
function rankImprovements(candidates, scores) {
  const ranked = [];

  if (candidates && candidates.length > 0) {
    // Sort by ROI descending
    const sorted = [...candidates].sort((a, b) => {
      const roiA = (a.impact || 0) / (a.ease || 1);
      const roiB = (b.impact || 0) / (b.ease || 1);
      return roiB - roiA;
    });

    for (let i = 0; i < Math.min(sorted.length, MAX_IMPROVEMENTS); i++) {
      ranked.push({
        action: sorted[i].action || `Improvement #${i + 1}`,
        impact: sorted[i].impact || 5,
        ease: sorted[i].ease || 5,
        priority: i + 1,
      });
    }
  }


  // Derive fillers from lowest-scoring dimensions if we need more
  if (ranked.length < MAX_IMPROVEMENTS) {
    const dimsByScore = [...DIMENSIONS].sort((a, b) => scores[a] - scores[b]);

    for (let i = ranked.length; i < MAX_IMPROVEMENTS; i++) {
      const dimIdx = i - ranked.length;
      const dim = dimsByScore[dimIdx] || dimsByScore[0];
      const fillerActions = {
        signal: `Strengthen professional signal with concrete achievements for ${dim}`,
        evidence: `Add more supporting evidence across artifacts for ${dim}`,
        visibility: `Increase public-surface visibility for ${dim}`,
        narrative: `Improve cross-surface narrative coherence for ${dim}`,
      };
      ranked.push({
        action: fillerActions[dim] || `Improve ${dim} dimension`,
        impact: 6 - i,
        ease: 5 - i,
        priority: i + 1,
      });
    }
  }

  return ranked;
}

/**
 * Compute the 3-component confidence score (D-09) and map to level (D-10).
 *
 * Components (equal weight, ⅓ each):
 *   1. Artifact count ratio: available / total_expected (max 6)
 *   2. Evidence quality ratio: non-stale summaries / expected per dimension
 *   3. Recency ratio: max(0, 1 - daysSinceLastSnapshot / 90)
 *
 * @param {object} context — getArtifactContext result
 * @param {object|null} profileState — getLatestProfileState result
 * @returns {{ level: string, reason: string, artifactsAvailable: string[] }}
 */
function computeConfidence(context, profileState) {
  // 1. Artifact count ratio
  let availableCount = 0;
  const artifactsAvailable = [];
  for (const rtype of EXPECTED_ARTIFACT_TYPES) {
    if (context[rtype] && context[rtype].artifact) {
      availableCount++;
      artifactsAvailable.push(rtype);
    }
  }
  const artifactRatio = availableCount / EXPECTED_ARTIFACT_TYPES.length;

  // 2. Evidence quality ratio
  let totalNonStaleSummaries = 0;
  const maxExpectedSummaries = availableCount * 2; // 2 summaries per artifact is "rich"
  for (const rtype of EXPECTED_ARTIFACT_TYPES) {
    const entry = context[rtype];
    if (entry) {
      totalNonStaleSummaries += (entry.summaries || []).length;
    }
  }
  const evidenceQualityRatio = maxExpectedSummaries > 0
    ? Math.min(1, totalNonStaleSummaries / maxExpectedSummaries)
    : 0;

  // 3. Recency ratio
  let recencyRatio = 0;
  if (profileState && profileState.createdAt) {
    const lastSnapshotDate = new Date(profileState.createdAt);
    const daysSince = (Date.now() - lastSnapshotDate.getTime()) / (1000 * 60 * 60 * 24);
    recencyRatio = Math.max(0, 1 - daysSince / RECENCY_WINDOW_DAYS);
  }

  // Combined score (equal weight)
  const combined = (artifactRatio + evidenceQualityRatio + recencyRatio) / 3;

  // D-10 thresholds
  let level, reason;
  if (combined >= CONFIDENCE_HIGH) {
    level = "high";
    reason = `Strong evidence across ${availableCount} artifact type(s) with good recency`;
  } else if (combined >= CONFIDENCE_MEDIUM) {
    level = "medium";
    reason = `Moderate evidence — ${availableCount} artifact type(s) available; ${
      availableCount < 3 ? "ingest more artifacts to increase confidence" : "consider refreshing stale evidence"
    }`;
  } else {
    level = "low";
    reason = `Limited evidence — only ${availableCount} artifact type(s); assessment may not reflect full profile`;
  }

  return { level, reason, artifactsAvailable };
}

/**
 * Determine the next best action (D-11).
 *
 * Derives from the dominant failure mode using the NEXT_ACTION_MAP routing table.
 * Returns the workflow token mapped to the dominant dimension.
 *
 * @param {object} dominantFailureMode — { dimension, reason }
 * @param {string} confidenceLevel
 * @returns {string}
 */
function determineNextBestAction(dominantFailureMode, confidenceLevel) {
  if (confidenceLevel === "low") {
    return NEXT_ACTION_MAP.evidence; // insufficient evidence → intake more
  }

  const dim = dominantFailureMode ? dominantFailureMode.dimension : null;
  return NEXT_ACTION_MAP[dim] ?? NEXT_ACTION_MAP.default;
}

// ---------------------------------------------------------------------------
// runAssessment — public API
// ---------------------------------------------------------------------------

/**
 * Run a current-state assessment from available evidence.
 *
 * Per D-01: scores each of the 4 dimensions from evidence summaries retrieved
 * via getArtifactContext(). Scoring is deterministic — no LLM calls.
 *
 * improvementCandidates and nextBestAction are now derived INTERNALLY from
 * evidence — they are no longer accepted as external (LLM-supplied) inputs.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {string[]} [params.artifactTypes] - artifact types to include (default: all 6)
 * @returns {{
 *   signal: number,
 *   evidence: number,
 *   visibility: number,
 *   narrative: number,
 *   dominantFailureMode: { dimension: string, reason: string },
 *   improvements: { action: string, impact: number, ease: number, priority: number }[],
 *   confidence: { level: string, reason: string, artifactsAvailable: string[] },
 *   nextBestAction: string,
 *   dimensions: {
 *     signal: { score: number, provenance: object },
 *     evidence: { score: number, provenance: object },
 *     visibility: { score: number, provenance: object },
 *     narrative: { score: number, provenance: object }
 *   }
 * }}
 */
function runAssessment({ repos, artifactTypes }) {
  // Defensive validation
  if (!repos) {
    throw new Error("repos is required");
  }

  // 1. Retrieve evidence context (D-01)
  const context = getArtifactContext({
    repos,
    artifactTypes: artifactTypes && artifactTypes.length > 0 ? artifactTypes : undefined,
  });

  // 2. Retrieve latest profile state for recency
  const profileState = getLatestProfileState({ repos });

  // 3. Score each dimension from evidence summaries (D-01, D-02)
  const baseScores = {};
  for (const dim of DIMENSIONS) {
    baseScores[dim] = computeBaseDimensionScore(context, dim);
  }

  // 4. Count available artifact types for penalty calculation
  let availableCount = 0;
  for (const rtype of EXPECTED_ARTIFACT_TYPES) {
    const entry = context[rtype];
    if (entry && entry.artifact) {
      availableCount++;
    }
  }

  // 5. Apply artifact sufficiency penalty (D-03) and round to nearest 10 (D-04)
  const finalScores = {};
  for (const dim of DIMENSIONS) {
    const penalized = applySufficiencyPenalty(baseScores[dim], availableCount);
    finalScores[dim] = roundToNearest10(penalized);
  }

  // 6. Detect dominant failure mode (D-05, D-06)
  const dominantFailureMode = detectDominantFailureMode(finalScores);

  // 7. Derive improvement candidates INTERNALLY from evidence (D-07)
  const derivedCandidates = deriveImprovementCandidates(context, finalScores);

  // 8. Rank improvements (D-07, D-08)
  const improvements = rankImprovements(derivedCandidates, finalScores);

  // 9. Calculate confidence (D-09, D-10)
  const confidence = computeConfidence(context, profileState);

  // 10. Determine next best action from dominant failure mode (D-11)
  const finalNextBestAction = determineNextBestAction(dominantFailureMode, confidence.level);

  // 11. Build per-dimension provenance
  const dimensions = {};
  for (const dim of DIMENSIONS) {
    // Collect evidence IDs contributing to this dimension
    const inputIds = [];
    const rules = [];

    for (const rtype of EXPECTED_ARTIFACT_TYPES) {
      const entry = context[rtype];
      if (!entry || !entry.artifact) continue;
      for (const summary of entry.summaries || []) {
        const dims = SUMMARY_TYPE_DIMENSIONS[summary.summary_type] || [];
        if (dims.includes(dim) && summary.summary_id) {
          inputIds.push(summary.summary_id);
        }
      }
    }

    // Record the scoring rules that fired
    const base = Math.round(baseScores[dim] * 100) / 100;
    const totalExpected = EXPECTED_ARTIFACT_TYPES.length;
    const missing = totalExpected - availableCount;
    const penaltyFraction = missing / totalExpected;
    const penalized = Math.round(base * (1 - penaltyFraction) * 100) / 100;

    rules.push({
      id: "base_evidence_score",
      effect: base,
      reason: `${availableCount} artifact(s) with contributing summaries, base score ${base.toFixed(1)}`,
    });

    if (penaltyFraction > 0) {
      rules.push({
        id: "sufficiency_penalty",
        effect: -(Math.round((base - penalized) * 100) / 100),
        reason: `${missing} of ${totalExpected} expected artifact types missing (penalty: ${Math.round(penaltyFraction * 100)}%)`,
      });
    }

    rules.push({
      id: "round_to_nearest_10",
      effect: finalScores[dim] - Math.round(penalized),
      reason: `Rounded ${penalized.toFixed(1)} → ${finalScores[dim]}`,
    });

    dimensions[dim] = {
      score: finalScores[dim],
      provenance: {
        inputs: inputIds,
        rules,
        trace: penaltyFraction > 0
          ? `${base.toFixed(1)} × (1 − ${Math.round(penaltyFraction * 100)}%) = ${penalized.toFixed(1)} → rounded to ${finalScores[dim]}`
          : `${base.toFixed(1)} → rounded to ${finalScores[dim]}`,
      },
    };
  }

  // 12. Return assembled result
  return {
    signal: finalScores.signal,
    evidence: finalScores.evidence,
    visibility: finalScores.visibility,
    narrative: finalScores.narrative,
    dominantFailureMode,
    improvements,
    confidence,
    nextBestAction: finalNextBestAction,
    dimensions,
  };
}

// ---------------------------------------------------------------------------
// persistAssessmentSnapshot — snapshot persistence
// ---------------------------------------------------------------------------

const { createSnapshot } = require("../snapshots/persist.js");

/**
 * Persist a compact assessment snapshot for later progress and memory reuse.
 *
 * Per T-03-07: builds snapshot payload from validated assessment results and
 * REQUIRED_DIMENSIONS. Rejects empty goal/next-action payloads before calling
 * createSnapshot.
 *
 * Per T-03-08: persists artifactVersionIds and triggerReason so later workflows
 * can trace exactly which artifacts produced the assessment.
 *
 * Snapshot creation is opt-in at the module boundary — runAssessment does not
 * automatically write to storage.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {object} params.assessmentResult - result from runAssessment()
 * @param {string[]} params.artifactVersionIds - version IDs of assessed artifacts
 * @param {string} params.triggerReason - why snapshot was created
 *   (one of: manual_request, artifact_update, periodic_check, etc.)
 * @param {object} [params.goalContext] - optional { primary_goal, timeline }
 * @param {string} [params.nextRecommendedWorkflow] - next workflow token
 *   (defaults to "bb-role-fit" for completed assessments)
 * @returns {object} The created snapshot record.
 */
function persistAssessmentSnapshot({
  repos,
  assessmentResult,
  artifactVersionIds,
  triggerReason,
  goalContext,
  nextRecommendedWorkflow,
}) {
  if (!repos) throw new Error("repos is required");
  if (!assessmentResult) throw new Error("assessmentResult is required");
  if (!triggerReason) throw new Error("triggerReason is required");

  // Build compact profileState from goal context and recommendation themes
  const topThemes = (assessmentResult.improvements || [])
    .slice(0, 3)
    .map((imp) => imp.action);

  const profileStateObj = {
    artifact_sufficiency_tier: assessmentResult.confidence.level,
    top_recommendation_themes: topThemes.slice(0, 3),
    ...(goalContext?.primary_goal && { primary_goal: goalContext.primary_goal }),
    ...(goalContext?.timeline && { timeline: goalContext.timeline }),
    assessed_at: new Date().toISOString(),
  };

  const profileState = JSON.stringify(profileStateObj);

  // Build dimension summary from assessment scores
  const dimensionSummary = {
    signal: assessmentResult.signal,
    evidence: assessmentResult.evidence,
    visibility: assessmentResult.visibility,
    narrative: assessmentResult.narrative,
  };

  // Determine next recommended workflow
  const defaultNextWorkflow = "bb-role-fit";
  const nextWorkflow = nextRecommendedWorkflow || defaultNextWorkflow;

  // Determine failure mode string
  let dominantFailureModeStr = undefined;
  if (assessmentResult.dominantFailureMode) {
    dominantFailureModeStr = `${assessmentResult.dominantFailureMode.dimension}: ${assessmentResult.dominantFailureMode.reason}`;
  }

  // Create the snapshot via Phase 2 persistence
  const snapshot = createSnapshot({
    repos,
    triggerReason,
    profileState,
    dimensionSummary,
    confidence: assessmentResult.confidence.level,
    dominantFailureMode: dominantFailureModeStr,
    nextRecommendedWorkflow: nextWorkflow,
    artifactVersionIds,
  });

  return snapshot;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { runAssessment, persistAssessmentSnapshot };
