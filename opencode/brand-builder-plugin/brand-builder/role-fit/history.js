/**
 * Brand Builder Role-Family History Helpers
 *
 * Per D-09: role-family memory helpers that reuse the existing snapshot and
 * relationship infrastructure without adding new database tables.
 *
 * Module exports:
 *   - slugRoleFamily({ roleTitle, seniority, domainContext })
 *   - persistRoleFitSnapshot({ repos, assessmentResult, parsedJob, artifactVersionIds })
 *   - listRoleFitSnapshotsByRoleFamily({ repos, roleFamilySlug, limit })
 */

const {
  createSnapshot,
} = require("../snapshots/persist.js");

const {
  getArtifactContext,
} = require("../memory/retrieval.js");

const { randomUUID } = require("crypto");

// ---------------------------------------------------------------------------
// slugRoleFamily
// ---------------------------------------------------------------------------

/**
 * Generate a stable, lowercase role-family slug from role metadata.
 *
 * Format: {seniority}-{normalized-role-title}[-{top-domains}]
 * Example: "senior-frontend-engineer" or "staff-backend-engineer-distributed-systems"
 *
 * Deterministic — same inputs always produce the same slug.
 * Normalizes whitespace, casing, and special characters.
 *
 * Per T-04-06 threat mitigation: normalized before persistence to prevent
 * injection or inconsistent lookup.
 *
 * @param {object} params
 * @param {string} params.roleTitle
 * @param {string} params.seniority
 * @param {string[]} params.domainContext
 * @returns {string}
 */
function slugRoleFamily({ roleTitle, seniority, domainContext }) {
  const parts = [];

  // Normalize role title first
  let normalizedTitle = "";
  if (roleTitle) {
    normalizedTitle = roleTitle
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  // Add seniority (normalized) — but skip if the role title already starts with it
  if (seniority) {
    const seniorityNorm = seniority.toLowerCase().trim();
    // Only add seniority as separate token if not already leading the title
    if (!normalizedTitle.startsWith(seniorityNorm + "-") && normalizedTitle !== seniorityNorm) {
      parts.push(seniorityNorm);
    }
  }

  // Add the role title
  if (normalizedTitle.length > 0) {
    parts.push(normalizedTitle);
  }

  // Add primary domain context (first 2, normalized)
  if (domainContext && domainContext.length > 0) {
    const domains = domainContext
      .slice(0, 2)
      .map(d => d.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
      .filter(d => d.length > 0);
    parts.push(...domains);
  }

  // Join and clean: collapse repeated hyphens, trim edges
  return parts
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// persistRoleFitSnapshot
// ---------------------------------------------------------------------------

/**
 * Persist a role-fit assessment result as a compact snapshot with role-family
 * metadata in profile_state and a belongs_to_role_family relationship edge.
 *
 * Per D-09 and Pattern 4 from 04-RESEARCH.md:
 *   - Uses createSnapshot with triggerReason "new_role_target"
 *   - Writes role_family_slug, role_title, fit_score, fit_bracket, and top
 *     blocker labels into snapshot profile_state
 *   - Writes a belongs_to_role_family relationship edge to enable
 *     longitudinal queries
 *   - Does NOT add a new SQL table or change schema.js
 *
 * Next recommended workflow defaults to "bb-linkedin" unless blockers exist
 * without easy wins, in which case it recommends "bb-current-state".
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {object} params.assessmentResult - result from runRoleFitAssessment()
 * @param {object} params.parsedJob - parsed JD from parseJobDescription()
 * @param {string[]} params.artifactVersionIds - version UUIDs this covers
 * @returns {object} The created snapshot record.
 */
function persistRoleFitSnapshot({
  repos,
  assessmentResult,
  parsedJob,
  artifactVersionIds,
}) {
  if (!repos) throw new Error("repos is required");
  if (!assessmentResult) throw new Error("assessmentResult is required");

  const roleFamilySlug = slugRoleFamily({
    roleTitle: parsedJob.roleTitle || "unknown",
    seniority: parsedJob.seniority || "mid",
    domainContext: parsedJob.domainContext || [],
  });

  // Build compact profile_state with role-family metadata
  const profileStateObj = {
    role_family_slug: roleFamilySlug,
    role_title: parsedJob.roleTitle || "unknown",
    fit_score: assessmentResult.fitScore,
    fit_bracket: assessmentResult.bracket,
    top_blocker_labels: (assessmentResult.blockers || [])
      .slice(0, 3)
      .map(b => b.substring(0, 100)),
    assessed_at: new Date().toISOString(),
  };
  const profileState = JSON.stringify(profileStateObj);

  // Determine next recommended workflow based on blockers/easy wins ratio
  let nextRecommendedWorkflow = "bb-linkedin";
  if (
    (assessmentResult.blockers && assessmentResult.blockers.length > 0) &&
    (!assessmentResult.easyWins || assessmentResult.easyWins.length === 0)
  ) {
    nextRecommendedWorkflow = "bb-current-state";
  }

  // Build dimension summary from role-fit scores
  // Role-fit doesn't use the 4-dimension model, so we map fit dimensions
  const dimensionSummary = {
    signal: Math.min(100, assessmentResult.fitScore),
    evidence: Math.min(100,
      (assessmentResult.bucketScores && assessmentResult.bucketScores.proofStrength) || 50),
    visibility: Math.min(100,
      (assessmentResult.bucketScores && assessmentResult.bucketScores.presentationMatch) || 50),
    narrative: Math.min(100,
      (assessmentResult.bucketScores && assessmentResult.bucketScores.presentationMatch) || 50),
  };

  // Build dominant failure mode from top blocker
  let dominantFailureMode = undefined;
  if (assessmentResult.blockers && assessmentResult.blockers.length > 0) {
    const topBlocker = assessmentResult.blockers[0];
    dominantFailureMode = `role-fit-blocker: ${topBlocker.substring(0, 150)}`;
  }

  // Ensure we have valid artifact version IDs
  let versionIds = artifactVersionIds;
  if (!versionIds || versionIds.length === 0) {
    const context = getArtifactContext({ repos });
    versionIds = [];
    for (const rtype of Object.keys(context)) {
      const entry = context[rtype];
      if (entry && entry.latestVersion) {
        versionIds.push(entry.latestVersion.version_id);
      }
    }
  }

  // If still no version IDs, we can't create a valid snapshot
  if (!versionIds || versionIds.length === 0) {
    throw new Error(
      "artifactVersionIds must not be empty — no artifact versions found in profile. " +
      "Seed artifacts before persisting a role-fit snapshot."
    );
  }

  // Create the snapshot via Phase 2 persistence
  const snapshot = createSnapshot({
    repos,
    triggerReason: "new_role_target",
    profileState,
    dimensionSummary,
    confidence: assessmentResult.confidence || "medium",
    dominantFailureMode,
    nextRecommendedWorkflow,
    artifactVersionIds: versionIds,
  });

  // Write belongs_to_role_family relationship edge
  // persist.js automatically creates this when an active baseline exists.
  // For cases without a baseline, we write the edge directly.
  const activeBaseline = repos.baselines.getActive();
  if (!activeBaseline) {
    try {
      const { validateEntity } = require("../memory/types.js");
      const edge = {
        edge_id: randomUUID(),
        source_type: "snapshot",
        source_id: snapshot.snapshot_id,
        target_type: "role_family",
        target_id: `role-family:${roleFamilySlug}`,
        relationship_kind: "belongs_to_role_family",
        weight: 1.0,
        created_at: new Date().toISOString(),
      };
      validateEntity("Relationship", edge);
      repos.relationships.create(edge);
    } catch (err) {
      // Relationship edge creation is best-effort — do not fail the snapshot
      // if the edge write fails (e.g., duplicate or constraint issue).
      // The profile_state still carries the role_family_slug for queries.
    }
  }

  return snapshot;
}

// ---------------------------------------------------------------------------
// listRoleFitSnapshotsByRoleFamily
// ---------------------------------------------------------------------------

/**
 * List recent role-fit snapshots matching a role family slug.
 *
 * Scans snapshots with trigger_reason "new_role_target", parses their
 * profile_state JSON, and filters by role_family_slug. Returns results
 * sorted by created_at descending (most recent first).
 *
 * Per T-04-06 threat mitigation: filters by parsed snapshot metadata rather
 * than unvalidated input, using the stable slug token stored at persist time.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {string} params.roleFamilySlug - role family slug to filter by
 * @param {number} [params.limit=3] - maximum snapshots to return
 * @returns {object[]} Matching snapshot records, most recent first.
 */
function listRoleFitSnapshotsByRoleFamily({ repos, roleFamilySlug, limit = 3 }) {
  if (!repos) throw new Error("repos is required");
  if (!roleFamilySlug) throw new Error("roleFamilySlug is required");

  // Get all new_role_target snapshots (already sorted by created_at DESC)
  const allRoleSnaps = repos.snapshots.listByTrigger("new_role_target");

  const matching = [];

  for (const snap of allRoleSnaps) {
    try {
      const profileState = JSON.parse(snap.profile_state || "{}");
      if (profileState.role_family_slug === roleFamilySlug) {
        matching.push({
          snapshot_id: snap.snapshot_id,
          trigger_reason: snap.trigger_reason,
          profile_state: snap.profile_state,
          role_family_slug: profileState.role_family_slug,
          role_title: profileState.role_title,
          fit_score: profileState.fit_score,
          fit_bracket: profileState.fit_bracket,
          created_at: snap.created_at,
          dimension_signal: snap.dimension_signal,
          dimension_evidence: snap.dimension_evidence,
          dimension_visibility: snap.dimension_visibility,
          dimension_narrative: snap.dimension_narrative,
          confidence: snap.confidence,
          next_recommended_workflow: snap.next_recommended_workflow,
        });
      }
    } catch {
      // Skip malformed profile_state entries — do not crash on bad data
    }
  }

  // Already sorted by created_at DESC from listByTrigger
  return matching.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  slugRoleFamily,
  persistRoleFitSnapshot,
  listRoleFitSnapshotsByRoleFamily,
};
