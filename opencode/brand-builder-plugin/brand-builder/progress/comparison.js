const { getRecentSnapshots } = require("../memory/retrieval.js");
const { listRoleFitSnapshotsByRoleFamily } = require("../role-fit/history.js");

const DIMENSIONS = ["signal", "evidence", "visibility", "narrative"];
const MEANINGFUL_DELTA = 10;

function toArrow(delta) {
  if (Math.abs(delta) < MEANINGFUL_DELTA) return "→";
  if (delta > 0) return `↑${delta}`;
  return `↓${Math.abs(delta)}`;
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function compareDimensions(current, previous) {
  const deltas = {};
  const arrows = {};
  const meaningfulChanges = [];

  for (const dim of DIMENSIONS) {
    const delta = safeNumber(current[dim]) - safeNumber(previous[dim]);
    deltas[dim] = delta;
    arrows[dim] = toArrow(delta);
    if (Math.abs(delta) >= MEANINGFUL_DELTA) {
      meaningfulChanges.push({ dimension: dim, delta, arrow: arrows[dim] });
    }
  }

  return { deltas, arrows, meaningfulChanges };
}

function mapSnapshotForOutput(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    triggerReason: snapshot.triggerReason,
    dimensionSummary: snapshot.dimensionSummary,
    dominantFailureMode: snapshot.dominantFailureMode,
    nextRecommendedWorkflow: snapshot.nextRecommendedWorkflow,
    artifactVersionCount: snapshot.artifactVersionCount,
  };
}

function buildFailureModeChange(current, previous) {
  if (current.dominantFailureMode === previous.dominantFailureMode) return null;
  return {
    from: previous.dominantFailureMode || null,
    to: current.dominantFailureMode || null,
  };
}

function buildWorkflowChange(current, previous) {
  if (current.nextRecommendedWorkflow === previous.nextRecommendedWorkflow) return null;
  return {
    from: previous.nextRecommendedWorkflow || null,
    to: current.nextRecommendedWorkflow || null,
  };
}

function buildVersionToTypeIndex(repos) {
  const index = new Map();
  const artifactTypes = [
    "resume",
    "linkedin",
    "github_profile",
    "github_repo",
    "website",
    "job_description",
  ];

  for (const type of artifactTypes) {
    const artifacts = repos.artifacts.listByType(type) || [];
    for (const artifact of artifacts) {
      const versions = repos.versions.listByArtifact(artifact.artifact_id) || [];
      for (const version of versions) {
        index.set(version.version_id, type);
      }
    }
  }

  return index;
}

function deriveSurfaceEvents(currentSnapshot, versionToType) {
  const events = [];
  const triggerReason = currentSnapshot.triggerReason;

  if (triggerReason === "approved_rewrite") {
    events.push("Approved surface rewrite recorded");
  }
  if (triggerReason === "new_role_target") {
    events.push("Role target changed");
  }

  const versionTypes = new Set();
  for (const versionId of currentSnapshot.artifactVersionIds || []) {
    const type = versionToType.get(versionId);
    if (type) versionTypes.add(type);
  }

  if (versionTypes.has("linkedin")) {
    events.push("LinkedIn profile updated");
  }
  if (versionTypes.has("github_profile") || versionTypes.has("github_repo")) {
    events.push("GitHub proof artifact updated");
  }
  if (versionTypes.has("website")) {
    events.push("Website artifact updated");
  }

  return [...new Set(events)];
}

function resolveTrendWindow({ repos, limit }) {
  const activeBaseline = repos.baselines.getActive();
  let mode = "recent_fallback";
  let roleFamilyTarget = null;
  let trendSnapshots = [];

  if (activeBaseline && activeBaseline.role_family_target) {
    roleFamilyTarget = activeBaseline.role_family_target;
    const roleFamilySnapshots = listRoleFitSnapshotsByRoleFamily({
      repos,
      roleFamilySlug: roleFamilyTarget,
      limit,
    });

    if (roleFamilySnapshots.length > 0) {
      mode = "role_family";
      trendSnapshots = roleFamilySnapshots.map((snap) => ({
        snapshotId: snap.snapshot_id,
        createdAt: snap.created_at,
        triggerReason: snap.trigger_reason,
        dimensionSummary: {
          signal: safeNumber(snap.dimension_signal),
          evidence: safeNumber(snap.dimension_evidence),
          visibility: safeNumber(snap.dimension_visibility),
          narrative: safeNumber(snap.dimension_narrative),
        },
        dominantFailureMode: null,
        nextRecommendedWorkflow: snap.next_recommended_workflow || null,
      }));
    }
  }

  if (trendSnapshots.length === 0) {
    trendSnapshots = getRecentSnapshots({ repos, limit });
  }

  return {
    mode,
    roleFamilyTarget,
    snapshots: trendSnapshots,
  };
}

function buildNarrativeSummary({ currentSnapshot, deltas, meaningfulChanges }) {
  if (!currentSnapshot) return "No snapshots available yet for progress comparison.";
  if (meaningfulChanges.length === 0) {
    return "Recent profile dimensions are stable with no meaningful shifts above the 10-point threshold.";
  }

  const strongest = [...DIMENSIONS].sort((a, b) => Math.abs(deltas[b]) - Math.abs(deltas[a]))[0];
  const strongestDelta = deltas[strongest];
  const direction = strongestDelta > 0 ? "improved" : "declined";
  return `${strongest[0].toUpperCase()}${strongest.slice(1)} ${direction} by ${Math.abs(strongestDelta)} points versus the previous snapshot. ${meaningfulChanges.length} meaningful dimension change(s) were detected.`;
}

function deriveConfidence(trendCount) {
  if (trendCount >= 3) return "high";
  if (trendCount >= 2) return "medium";
  return "low";
}

function runProgressComparison({ repos, limit = 6 }) {
  if (!repos) throw new Error("repos is required");

  const recentSnapshots = getRecentSnapshots({ repos, limit: Math.max(limit, 2) });
  const currentSnapshot = recentSnapshots[0] || null;
  const previousSnapshot = recentSnapshots[1] || null;

  const trendWindow = resolveTrendWindow({ repos, limit });
  const trend = trendWindow.snapshots.map((snapshot) => ({
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    triggerReason: snapshot.triggerReason,
    dimensionSummary: snapshot.dimensionSummary,
  }));

  if (!currentSnapshot || !previousSnapshot) {
    return {
      currentSnapshot: currentSnapshot ? mapSnapshotForOutput(currentSnapshot) : null,
      previousSnapshot: previousSnapshot ? mapSnapshotForOutput(previousSnapshot) : null,
      comparisonWindow: {
        mode: trendWindow.mode,
        roleFamilyTarget: trendWindow.roleFamilyTarget,
        snapshotCount: trend.length,
      },
      deltas: { signal: 0, evidence: 0, visibility: 0, narrative: 0 },
      arrows: { signal: "→", evidence: "→", visibility: "→", narrative: "→" },
      meaningfulChanges: [],
      failureModeChange: null,
      workflowChange: null,
      surfaceEvents: [],
      trend,
      narrativeSummary: "Not enough snapshot history to compute current-vs-previous progress yet.",
      recommendedNextWorkflow: currentSnapshot ? currentSnapshot.nextRecommendedWorkflow : null,
      confidence: deriveConfidence(trend.length),
      provenance: {
        inputs: currentSnapshot ? [currentSnapshot.snapshotId] : [],
        rules: [{
          id: "insufficient_snapshots",
          effect: 0,
          reason: `Only ${recentSnapshots.length} snapshot(s) available — need at least 2 for comparison`,
        }],
        trace: `snapshots=${recentSnapshots.length} — comparison not possible`,
      },
    };
  }

  const { deltas, arrows, meaningfulChanges } = compareDimensions(
    currentSnapshot.dimensionSummary,
    previousSnapshot.dimensionSummary
  );

  const versionToType = buildVersionToTypeIndex(repos);
  const surfaceEvents = deriveSurfaceEvents(currentSnapshot, versionToType);

  // Build per-delta provenance
  const deltaRules = DIMENSIONS.map((dim) => ({
    id: `${dim}_delta`,
    effect: deltas[dim],
    reason: `${dim}: ${previousSnapshot.dimensionSummary[dim] ?? 0} → ${currentSnapshot.dimensionSummary[dim] ?? 0} (Δ${deltas[dim] >= 0 ? "+" : ""}${deltas[dim]})`,
  }));

  const comparisonProvenance = {
    inputs: [currentSnapshot.snapshotId, previousSnapshot.snapshotId].filter(Boolean),
    rules: [
      {
        id: "snapshot_comparison",
        effect: meaningfulChanges.length,
        reason: `Compared snapshot "${currentSnapshot.snapshotId}" vs "${previousSnapshot.snapshotId}"; ${meaningfulChanges.length} dimension(s) changed by ≥${MEANINGFUL_DELTA} points`,
      },
      ...deltaRules,
    ],
    trace: `current="${currentSnapshot.snapshotId}" vs previous="${previousSnapshot.snapshotId}": signal Δ${deltas.signal >= 0 ? "+" : ""}${deltas.signal}, evidence Δ${deltas.evidence >= 0 ? "+" : ""}${deltas.evidence}, visibility Δ${deltas.visibility >= 0 ? "+" : ""}${deltas.visibility}, narrative Δ${deltas.narrative >= 0 ? "+" : ""}${deltas.narrative}`,
  };

  return {
    currentSnapshot: mapSnapshotForOutput(currentSnapshot),
    previousSnapshot: mapSnapshotForOutput(previousSnapshot),
    comparisonWindow: {
      mode: trendWindow.mode,
      roleFamilyTarget: trendWindow.roleFamilyTarget,
      snapshotCount: trend.length,
    },
    deltas,
    arrows,
    meaningfulChanges,
    failureModeChange: buildFailureModeChange(currentSnapshot, previousSnapshot),
    workflowChange: buildWorkflowChange(currentSnapshot, previousSnapshot),
    surfaceEvents,
    trend,
    narrativeSummary: buildNarrativeSummary({ currentSnapshot, deltas, meaningfulChanges }),
    recommendedNextWorkflow: currentSnapshot.nextRecommendedWorkflow || null,
    confidence: deriveConfidence(trend.length),
    provenance: comparisonProvenance,
  };
}

module.exports = { runProgressComparison };
