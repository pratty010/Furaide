/**
 * Brand Builder Memory Retrieval
 *
 * Implements memory read/reuse paths for downstream workflow consumption
 * per MEM-04 and D-07 (user-facing defaults vs. full internal context).
 *
 * Per D-07: user-facing views default to latest artifacts + key summaries,
 * while internal workflows have access to full graph/vector internals.
 *
 * Per D-19: snapshots are available as visible summary history, not
 * internal-only memory.
 *
 * Module exports:
 *   - getArtifactContext({ repos, artifactTypes })
 *   - getFullContext({ repos, artifactId, includeStale })
 *   - getLatestProfileState({ repos })
 *   - getEvidenceGraph({ repos, artifactId, depth })
 *   - getRecentSnapshots({ repos, limit })
 *   - getStalenessReport({ repos })
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid artifact types (from Artifact schema). */
const ALL_ARTIFACT_TYPES = [
  "resume",
  "linkedin",
  "github_profile",
  "github_repo",
  "website",
  "job_description",
];

/** Artifact types with bounded version history (D-13: last 5 versions). */
const BOUNDED_HISTORY_TYPES = new Set(["resume", "linkedin"]);

/** Maximum versions to return for bounded-history artifacts. */
const MAX_BOUNDED_VERSIONS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON TEXT column into an array, defaulting to [] on failure.
 */
function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Check if a summary record is stale (SQLite stores stale as 0 or 1 integer).
 */
function isStale(summary) {
  return summary.stale === 1 || summary.stale === true;
}

/**
 * Check if an enrichment approval record is stale.
 */
function isApprovalStale(approval) {
  return approval.stale === 1 || approval.stale === true;
}

// ---------------------------------------------------------------------------
// getArtifactContext (D-07: user-facing default view)
// ---------------------------------------------------------------------------

/**
 * Return user-facing artifact context combining the latest current artifacts
 * with their key evidence summaries.
 *
 * Per D-07: this is the user-facing default view — latest artifacts plus
 * key summaries, non-stale only.
 *
 * For each artifact type:
 *   1. Retrieve the current artifact via getCurrentByType
 *   2. Retrieve its latest version via getLatest
 *   3. Retrieve non-stale evidence summaries
 *   4. Package into { artifact, latestVersion, summaries }
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {string[]} [params.artifactTypes] - Optional list of artifact types
 *   to include. Defaults to all 6 types.
 * @returns {object} Object keyed by artifact type, each value is
 *   { artifact, latestVersion, summaries[] } or null if no current artifact.
 */
function getArtifactContext({ repos, artifactTypes }) {
  if (!repos) {
    throw new Error("repos is required");
  }

  const types = (artifactTypes && artifactTypes.length > 0)
    ? artifactTypes
    : ALL_ARTIFACT_TYPES;

  const result = {};

  for (const rtype of types) {
    const artifact = repos.artifacts.getCurrentByType(rtype);
    if (!artifact) {
      result[rtype] = null;
      continue;
    }

    const latestVersion = repos.versions.getLatest(artifact.artifact_id);
    const allSummaries = repos.evidence.listByArtifact(artifact.artifact_id);
    const summaries = allSummaries.filter((s) => !isStale(s));

    result[rtype] = {
      artifact,
      latestVersion: latestVersion || null,
      summaries,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// getFullContext (D-07: full internal context for workflows)
// ---------------------------------------------------------------------------

/**
 * Return full internal context for downstream workflows.
 *
 * Per D-07: internal workflows have access to full graph/vector internals.
 *
 * Includes:
 *   1. The artifact record
 *   2. All versions (bounded to last 5 for resume/LinkedIn per D-13)
 *   3. All evidence summaries (optionally including stale)
 *   4. All relationships where this artifact is source or target
 *   5. The most recent snapshot that includes this artifact's version
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {string} params.artifactId - UUID of the artifact
 * @param {boolean} [params.includeStale=false] - Whether to include stale
 *   evidence summaries in results.
 * @returns {{ artifact: object, versions: object[], summaries: object[],
 *             relationships: object[], latestSnapshot: object|null }}
 */
function getFullContext({ repos, artifactId, includeStale = false }) {
  if (!repos) {
    throw new Error("repos is required");
  }
  if (!artifactId) {
    throw new Error("artifactId is required");
  }

  // 1. Get the artifact record
  const artifact = repos.artifacts.getById(artifactId);
  if (!artifact) {
    return {
      artifact: null,
      versions: [],
      summaries: [],
      relationships: [],
      latestSnapshot: null,
    };
  }

  // 2. Get versions — bounded for resume/LinkedIn per D-13
  let versions = repos.versions.listByArtifact(artifactId);
  if (BOUNDED_HISTORY_TYPES.has(artifact.artifact_type)) {
    versions = versions.slice(0, MAX_BOUNDED_VERSIONS);
  }

  // 3. Get evidence summaries
  const allSummaries = repos.evidence.listByArtifact(artifactId);
  const summaries = includeStale
    ? allSummaries
    : allSummaries.filter((s) => !isStale(s));

  // 4. Get relationships (both directions)
  const sourceEdges = repos.relationships.listBySource("artifact", artifactId);
  const targetEdges = repos.relationships.listByTarget("artifact", artifactId);
  const relationships = [...sourceEdges, ...targetEdges];

  // 5. Find the most recent snapshot containing any of this artifact's versions
  const versionIds = new Set(versions.map((v) => v.version_id));
  let latestSnapshot = null;

  // Scan recent snapshots to find one containing any of our version IDs
  const recentSnapshots = repos.snapshots.listRecent(50);
  for (const snap of recentSnapshots) {
    const snapVersionIds = parseJsonArray(snap.artifact_version_ids);
    if (snapVersionIds.some((vid) => versionIds.has(vid))) {
      latestSnapshot = snap;
      break;
    }
  }

  return {
    artifact,
    versions,
    summaries,
    relationships,
    latestSnapshot,
  };
}

// ---------------------------------------------------------------------------
// getLatestProfileState
// ---------------------------------------------------------------------------

/**
 * Convenience function returning the most recent snapshot's profile_state
 * and dimension_summary.
 *
 * Per D-19: snapshots include profile state and next recommended workflow.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @returns {{ profileState: string, dimensionSummary: object,
 *             createdAt: string, triggerReason: string } | null}
 *   The most recent snapshot's state, or null if no snapshots exist.
 */
function getLatestProfileState({ repos }) {
  if (!repos) {
    throw new Error("repos is required");
  }

  const recent = repos.snapshots.listRecent(1);
  if (recent.length === 0) {
    return null;
  }

  const snap = recent[0];

  // Reconstruct dimension_summary object from flattened columns
  const dimensionSummary = {
    signal: snap.dimension_signal,
    evidence: snap.dimension_evidence,
    visibility: snap.dimension_visibility,
    narrative: snap.dimension_narrative,
  };

  return {
    profileState: snap.profile_state,
    dimensionSummary,
    createdAt: snap.created_at,
    triggerReason: snap.trigger_reason,
    snapshotId: snap.snapshot_id,
  };
}

// ---------------------------------------------------------------------------
// getEvidenceGraph (configurable traversal depth)
// ---------------------------------------------------------------------------

/**
 * Retrieve the evidence and relationship graph for an artifact with
 * configurable traversal depth.
 *
 * At depth 1: returns direct evidence summaries and relationships.
 * At depth 2+: follows relationship edges to connected entities.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {string} params.artifactId - UUID of the artifact
 * @param {number} [params.depth=1] - Traversal depth (1 = direct only)
 * @returns {{ summaries: object[], edges: object[] }}
 */
function getEvidenceGraph({ repos, artifactId, depth = 1 }) {
  if (!repos) {
    throw new Error("repos is required");
  }
  if (!artifactId) {
    throw new Error("artifactId is required");
  }

  const summaries = repos.evidence.listByArtifact(artifactId);
  const sourceEdges = repos.relationships.listBySource("artifact", artifactId);
  const targetEdges = repos.relationships.listByTarget("artifact", artifactId);
  let edges = [...sourceEdges, ...targetEdges];

  // At depth 2+, follow relationship edges to connected entities
  if (depth >= 2) {
    const visitedNodes = new Set();
    visitedNodes.add(artifactId); // Don't revisit the root artifact

    // Collect all connected node IDs (both as source and target)
    const connectedIds = new Set();
    for (const edge of edges) {
      if (edge.source_type !== "artifact" || edge.source_id !== artifactId) {
        connectedIds.add(edge.source_id);
      }
      if (edge.target_type !== "artifact" || edge.target_id !== artifactId) {
        connectedIds.add(edge.target_id);
      }
    }

    // For each connected node, fetch its outgoing edges
    for (const nodeId of connectedIds) {
      if (visitedNodes.has(nodeId)) continue;
      visitedNodes.add(nodeId);

      // Determine the entity type by checking which repo it belongs to
      // Check if it's an evidence summary
      const evidenceSummary = repos.evidence.getById(nodeId);
      if (evidenceSummary) {
        const nodeEdges = repos.relationships.listBySource("evidence", nodeId);
        edges = edges.concat(nodeEdges);
      }
    }
  }

  return { summaries, edges };
}

// ---------------------------------------------------------------------------
// getRecentSnapshots (D-19: visible summary history)
// ---------------------------------------------------------------------------

/**
 * Return recent snapshots with their metadata.
 *
 * Per D-19: available as visible summary history, not internal-only memory.
 * Wraps repos.snapshots.listRecent(limit) and enriches with parsed version IDs.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {number} [params.limit=10] - Maximum number of snapshots to return
 * @returns {object[]} Array of snapshot records, most recent first.
 */
function getRecentSnapshots({ repos, limit = 10 }) {
  if (!repos) {
    throw new Error("repos is required");
  }

  const snapshots = repos.snapshots.listRecent(limit);

  return snapshots.map((snap) => {
    const artifactVersionIds = parseJsonArray(snap.artifact_version_ids);

    // Reconstruct dimension_summary object
    const dimensionSummary = {
      signal: snap.dimension_signal,
      evidence: snap.dimension_evidence,
      visibility: snap.dimension_visibility,
      narrative: snap.dimension_narrative,
    };

    return {
      snapshotId: snap.snapshot_id,
      triggerReason: snap.trigger_reason,
      profileState: snap.profile_state,
      dimensionSummary,
      confidence: snap.confidence,
      dominantFailureMode: snap.dominant_failure_mode || null,
      nextRecommendedWorkflow: snap.next_recommended_workflow || null,
      artifactVersionIds,
      artifactVersionCount: artifactVersionIds.length,
      createdAt: snap.created_at,
    };
  });
}

// ---------------------------------------------------------------------------
// getStalenessReport
// ---------------------------------------------------------------------------

/**
 * Return a report of all stale evidence summaries, grouped by artifact,
 * with their stale reasons.
 *
 * Useful for determining which evidence needs refreshing before running
 * a workflow.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @returns {object[]} Array of { artifactId, artifactType, staleCount,
 *   staleSummaries: [{ summaryId, summaryType, staleReason, createdAt }] }
 */
function getStalenessReport({ repos }) {
  if (!repos) {
    throw new Error("repos is required");
  }

  const allStale = repos.evidence.listStale();

  // Group by artifact_id
  const grouped = {};
  for (const summary of allStale) {
    const artifactId = summary.artifact_id;
    if (!grouped[artifactId]) {
      grouped[artifactId] = {
        artifactId,
        staleCount: 0,
        staleSummaries: [],
      };
    }

    grouped[artifactId].staleCount++;
    grouped[artifactId].staleSummaries.push({
      summaryId: summary.summary_id,
      summaryType: summary.summary_type,
      staleReason: summary.stale_reason || "Unknown",
      versionId: summary.version_id,
      createdAt: summary.created_at,
    });
  }

  // Enrich with artifact type
  const result = [];
  for (const [artifactId, group] of Object.entries(grouped)) {
    const artifact = repos.artifacts.getById(artifactId);
    result.push({
      artifactId,
      artifactType: artifact ? artifact.artifact_type : "unknown",
      staleCount: group.staleCount,
      staleSummaries: group.staleSummaries,
    });
  }

  // Sort by stale count descending (most stale first)
  result.sort((a, b) => b.staleCount - a.staleCount);

  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ALL_ARTIFACT_TYPES,
  getArtifactContext,
  getFullContext,
  getLatestProfileState,
  getEvidenceGraph,
  getRecentSnapshots,
  getStalenessReport,
};
