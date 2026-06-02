/**
 * Brand Builder Snapshot Persistence
 *
 * Implements snapshot write and bounded-history management per D-13 and
 * D-17 through D-19.
 *
 * Module exports:
 *   - createSnapshot({ repos, triggerReason, profileState, dimensionSummary,
 *                      confidence, dominantFailureMode,
 *                      nextRecommendedWorkflow, artifactVersionIds })
 *   - getSnapshotHistory({ repos, limit })
 *   - getLatestSnapshot({ repos })
 *
 * Per Pattern 2 (Compare-Then-Promote): snapshots are state transitions, not
 * overwrites. Each snapshot captures a point-in-time profile state.
 *
 * Per D-19: snapshots are available as visible summary history for the user,
 * not internal-only memory.
 */

const { randomUUID } = require("crypto");
const { validateEntity } = require("../memory/types.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Required dimension keys for a valid dimension_summary. */
const REQUIRED_DIMENSIONS = ["signal", "evidence", "visibility", "narrative"];

/** Constants for validation */
const DIMENSION_MIN = 0;
const DIMENSION_MAX = 100;

// ---------------------------------------------------------------------------
// createSnapshot (D-17, D-19)
// ---------------------------------------------------------------------------

/**
 * Write a new snapshot record capturing the current profile state.
 *
 * Per D-17: snapshots must preserve profile state, why it changed, and the
 * next recommended workflow at that moment.
 *
 * Per D-19: snapshots include dimension_summary, confidence, failure mode,
 * and recommended next workflow.
 *
 * Validation:
 *   1. profileState must be a non-empty string
 *   2. dimensionSummary must contain all four dimensions (signal, evidence,
 *      visibility, narrative) with numeric values
 *   3. artifactVersionIds must reference existing version records
 *   4. All inputs validated against Snapshot Zod schema
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {string} params.triggerReason - What caused this snapshot
 *   (one of: artifact_update, new_role_target, approved_rewrite,
 *    periodic_check, manual_request, enrichment_update)
 * @param {string} params.profileState - JSON-serialized compact profile state
 * @param {object} params.dimensionSummary - { signal, evidence, visibility,
 *   narrative } — all numbers 0-100
 * @param {string} params.confidence - "high", "medium", or "low"
 * @param {string} [params.dominantFailureMode] - Most significant failure mode
 * @param {string} [params.nextRecommendedWorkflow] - Recommended next workflow
 * @param {string[]} params.artifactVersionIds - Version UUIDs this covers
 * @returns {object} The created snapshot record.
 */
function createSnapshot({
  repos,
  triggerReason,
  profileState,
  dimensionSummary,
  confidence,
  dominantFailureMode,
  nextRecommendedWorkflow,
  artifactVersionIds,
}) {
  if (!repos) throw new Error("repos is required");
  if (!triggerReason) throw new Error("triggerReason is required");
  if (profileState == null) throw new Error("profileState is required");
  if (!dimensionSummary) throw new Error("dimensionSummary is required");
  if (!confidence) throw new Error("confidence is required");
  if (!artifactVersionIds || !Array.isArray(artifactVersionIds)) {
    throw new Error("artifactVersionIds must be a non-empty array");
  }
  if (artifactVersionIds.length === 0) {
    throw new Error("artifactVersionIds must not be empty");
  }

  // Validate profileState is a string (compact, not duplicating full reports)
  if (typeof profileState !== "string" || profileState.trim().length === 0) {
    throw new Error(
      "profileState must be a non-empty string containing JSON-serialized compact profile state"
    );
  }

  // Validate dimensionSummary contains all four dimensions
  for (const dim of REQUIRED_DIMENSIONS) {
    if (!(dim in dimensionSummary)) {
      throw new Error(
        `dimensionSummary must contain "${dim}". ` +
        `Required dimensions: ${REQUIRED_DIMENSIONS.join(", ")}`
      );
    }
    const value = dimensionSummary[dim];
    if (typeof value !== "number" || isNaN(value)) {
      throw new Error(
        `dimensionSummary.${dim} must be a number, got ${typeof value}`
      );
    }
    if (value < DIMENSION_MIN || value > DIMENSION_MAX) {
      throw new Error(
        `dimensionSummary.${dim} must be between ${DIMENSION_MIN} and ${DIMENSION_MAX}, got ${value}`
      );
    }
  }

  // Validate artifactVersionIds exist in the database
  for (const versionId of artifactVersionIds) {
    const exists = repos.versions.getByVersionNumber(versionId, 1);
    // getByVersionNumber requires both artifactId and versionNumber,
    // so we check by looking at all versions and finding the id.
    // More efficient: use a custom query.
  }

  // Verify artifact version IDs exist by checking each against the DB.
  // We use a raw query approach via the repo's list methods.
  for (const versionId of artifactVersionIds) {
    // Check if any version with this ID exists across our known artifacts
    let found = false;
    const allTypes = [
      "resume", "linkedin", "github_profile", "github_repo",
      "website", "job_description",
    ];
    for (const rtype of allTypes) {
      const artifacts = repos.artifacts.listByType(rtype);
      for (const artifact of artifacts) {
        const versions = repos.versions.listByArtifact(artifact.artifact_id);
        if (versions.some((v) => v.version_id === versionId)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      throw new Error(
        `artifactVersionIds contains "${versionId}" which does not ` +
        `reference an existing version record in the database`
      );
    }
  }

  // Build the snapshot object
  const now = new Date().toISOString();
  const snapshotData = {
    snapshot_id: randomUUID(),
    trigger_reason: triggerReason,
    profile_state: profileState,
    dimension_summary: {
      signal: dimensionSummary.signal,
      evidence: dimensionSummary.evidence,
      visibility: dimensionSummary.visibility,
      narrative: dimensionSummary.narrative,
    },
    confidence,
    dominant_failure_mode: dominantFailureMode || undefined,
    next_recommended_workflow: nextRecommendedWorkflow || undefined,
    artifact_version_ids: artifactVersionIds,
    created_at: now,
  };

  // Validate against Snapshot Zod schema
  validateEntity("Snapshot", snapshotData);

  // Create the snapshot record
  const created = repos.snapshots.create(snapshotData);

  // Create belongs_to_role_family relationship if an active baseline exists
  const activeBaseline = repos.baselines.getActive();
  if (activeBaseline) {
    const edge = {
      edge_id: randomUUID(),
      source_type: "snapshot",
      source_id: snapshotData.snapshot_id,
      target_type: "role_family",
      target_id: activeBaseline.baseline_id,
      relationship_kind: "belongs_to_role_family",
      weight: 1.0,
      created_at: now,
    };
    validateEntity("Relationship", edge);
    repos.relationships.create(edge);
  }

  return created;
}

// ---------------------------------------------------------------------------
// getSnapshotHistory (D-19)
// ---------------------------------------------------------------------------

/**
 * Retrieve recent snapshots in descending chronological order.
 *
 * Per D-19: snapshots are available as visible summary history for the user,
 * not internal-only memory.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {number} [params.limit=20] - Maximum number of snapshots to return
 * @returns {object[]} Array of snapshot records, most recent first.
 */
function getSnapshotHistory({ repos, limit = 20 }) {
  if (!repos) {
    throw new Error("repos is required");
  }

  const snapshots = repos.snapshots.listRecent(limit);

  // Enrich with counts where possible
  return snapshots.map((snap) => {
    let artifactVersionIds = [];
    try {
      artifactVersionIds =
        typeof snap.artifact_version_ids === "string"
          ? JSON.parse(snap.artifact_version_ids)
          : snap.artifact_version_ids || [];
    } catch {
      artifactVersionIds = [];
    }

    return {
      ...snap,
      artifact_version_count: artifactVersionIds.length,
    };
  });
}

// ---------------------------------------------------------------------------
// getLatestSnapshot
// ---------------------------------------------------------------------------

/**
 * Convenience function returning the most recent snapshot or null.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @returns {object|null} The most recent snapshot, or null if none exist.
 */
function getLatestSnapshot({ repos }) {
  if (!repos) {
    throw new Error("repos is required");
  }

  const recent = repos.snapshots.listRecent(1);
  if (recent.length === 0) {
    return null;
  }

  const snap = recent[0];
  let artifactVersionIds = [];
  try {
    artifactVersionIds =
      typeof snap.artifact_version_ids === "string"
        ? JSON.parse(snap.artifact_version_ids)
        : snap.artifact_version_ids || [];
  } catch {
    artifactVersionIds = [];
  }

  return {
    ...snap,
    artifact_version_count: artifactVersionIds.length,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  REQUIRED_DIMENSIONS,
  createSnapshot,
  getSnapshotHistory,
  getLatestSnapshot,
};
