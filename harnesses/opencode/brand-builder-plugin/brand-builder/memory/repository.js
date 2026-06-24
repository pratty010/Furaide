/**
 * Brand Builder Memory Repository
 *
 * Exports createRepositories(db) — a factory that returns typed repository
 * instances for all 7 entity tables.  Every repository method:
 *   - Validates input against the corresponding Zod schema before writing
 *   - Uses db.prepare() with parameterized queries (T-02-02)
 *   - Returns plain objects matching the Zod schema shape
 *
 * Per RESEARCH.md Pattern 3: "Policy in Specialist, IO in Modules" —
 * repository methods are deterministic IO; policy judgment stays with the
 * bb-knowledge-steward and orchestrator.
 *
 * NOTE: Bun's SQLite requires named-parameter object keys to include the
 * prefix that appears in the SQL ($name in SQL → { '$name': val }).
 * The $p() helper below handles this transparently.
 */

const {
  Artifact,
  ArtifactVersion,
  EvidenceSummary,
  Relationship,
  Snapshot,
  EnrichmentApproval,
  ProfileBaseline,
  validateEntity,
} = require("./types.js");

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** JSON serialise for TEXT columns */
const toJson = (v) => (v != null ? JSON.stringify(v) : null);

/**
 * Prefix every key in `obj` with `$` so the object works as a named-parameter
 * bag for Bun's SQLite (which expects `{ '$col': val }` when the SQL uses
 * `$col` placeholders).
 */
function $p(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    out["$" + k] = obj[k];
  }
  return out;
}

// ---------------------------------------------------------------------------
// ArtifactRepo
// ---------------------------------------------------------------------------
function createArtifactRepo(db) {
  const upsertStmt = db.prepare(`
    INSERT INTO artifacts (
      artifact_id, artifact_type, canonical_path, raw_digest,
      normalized_digest, first_ingested_at, last_updated_at,
      status, source_label
    ) VALUES (
      $artifact_id, $artifact_type, $canonical_path, $raw_digest,
      $normalized_digest, $first_ingested_at, $last_updated_at,
      $status, $source_label
    ) ON CONFLICT(artifact_id) DO UPDATE SET
      canonical_path    = excluded.canonical_path,
      raw_digest        = excluded.raw_digest,
      normalized_digest = excluded.normalized_digest,
      last_updated_at   = excluded.last_updated_at,
      status            = excluded.status,
      source_label      = excluded.source_label,
      updated_at        = datetime('now')
  `);

  const getByIdStmt = db.prepare(
    "SELECT * FROM artifacts WHERE artifact_id = $id"
  );
  const getCurrentByTypeStmt = db.prepare(
    "SELECT * FROM artifacts WHERE artifact_type = $type AND status = 'current' LIMIT 1"
  );
  const listByTypeStmt = db.prepare(
    "SELECT * FROM artifacts WHERE artifact_type = $type ORDER BY last_updated_at DESC"
  );
  const updateStatusStmt = db.prepare(
    "UPDATE artifacts SET status = $status, updated_at = datetime('now') WHERE artifact_id = $id"
  );
  const deleteByIdStmt = db.prepare(
    "DELETE FROM artifacts WHERE artifact_id = $id"
  );

  return {
    upsert(artifact) {
      const data = validateEntity("Artifact", artifact);
      upsertStmt.run($p(data));
      return getByIdStmt.get($p({ id: data.artifact_id }));
    },

    getById(id) {
      return getByIdStmt.get($p({ id })) || null;
    },

    getCurrentByType(type) {
      return getCurrentByTypeStmt.get($p({ type })) || null;
    },

    listByType(type) {
      return listByTypeStmt.all($p({ type }));
    },

    updateStatus(id, status) {
      updateStatusStmt.run($p({ id, status }));
      return getByIdStmt.get($p({ id })) || null;
    },

    deleteById(id) {
      deleteByIdStmt.run($p({ id }));
    },
  };
}

// ---------------------------------------------------------------------------
// VersionRepo
// ---------------------------------------------------------------------------
function createVersionRepo(db) {
  const createStmt = db.prepare(`
    INSERT INTO artifact_versions (
      version_id, artifact_id, version_number, canonical_path,
      raw_digest, normalized_digest, ingested_at,
      provenance_source, provenance_update_context, provenance_goals,
      supersedes_version
    ) VALUES (
      $version_id, $artifact_id, $version_number, $canonical_path,
      $raw_digest, $normalized_digest, $ingested_at,
      $provenance_source, $provenance_update_context, $provenance_goals,
      $supersedes_version
    )
  `);

  const getByVersionNumberStmt = db.prepare(
    "SELECT * FROM artifact_versions WHERE artifact_id = $artifactId AND version_number = $versionNumber"
  );
  const listByArtifactStmt = db.prepare(
    "SELECT * FROM artifact_versions WHERE artifact_id = $artifactId ORDER BY version_number DESC"
  );
  const getLatestStmt = db.prepare(
    "SELECT * FROM artifact_versions WHERE artifact_id = $artifactId ORDER BY version_number DESC LIMIT 1"
  );
  const countByArtifactStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = $artifactId"
  );
  const deleteByIdStmtVer = db.prepare(
    "DELETE FROM artifact_versions WHERE version_id = $id"
  );

  return {
    create(version) {
      const data = validateEntity("ArtifactVersion", version);
      const params = {
        ...data,
        provenance_source: data.provenance.source,
        provenance_update_context: data.provenance.update_context ?? null,
        provenance_goals: data.provenance.goals ?? null,
        supersedes_version: data.supersedes_version ?? null,
      };
      createStmt.run($p(params));
      return getByVersionNumberStmt.get(
        $p({ artifactId: data.artifact_id, versionNumber: data.version_number })
      );
    },

    getByVersionNumber(artifactId, versionNumber) {
      return (
        getByVersionNumberStmt.get($p({ artifactId, versionNumber })) || null
      );
    },

    listByArtifact(artifactId) {
      return listByArtifactStmt.all($p({ artifactId }));
    },

    getLatest(artifactId) {
      return getLatestStmt.get($p({ artifactId })) || null;
    },

    countByArtifact(artifactId) {
      const row = countByArtifactStmt.get($p({ artifactId }));
      return row ? row.count : 0;
    },

    deleteById(id) {
      deleteByIdStmtVer.run($p({ id }));
    },
  };
}

// ---------------------------------------------------------------------------
// EvidenceRepo
// ---------------------------------------------------------------------------
function createEvidenceRepo(db) {
  const createStmt = db.prepare(`
    INSERT INTO evidence_summaries (
      summary_id, artifact_id, version_id, summary_type,
      content, source_references, stale, stale_reason,
      workflow_domain, created_at
    ) VALUES (
      $summary_id, $artifact_id, $version_id, $summary_type,
      $content, $source_references, $stale, $stale_reason,
      $workflow_domain, $created_at
    )
  `);

  const getByIdStmt = db.prepare(
    "SELECT * FROM evidence_summaries WHERE summary_id = $id"
  );
  const listByArtifactStmt = db.prepare(
    "SELECT * FROM evidence_summaries WHERE artifact_id = $artifactId ORDER BY created_at DESC"
  );
  const listByArtifactAndTypeStmt = db.prepare(
    "SELECT * FROM evidence_summaries WHERE artifact_id = $artifactId AND summary_type = $type ORDER BY created_at DESC"
  );
  const listByArtifactAndDomainStmt = db.prepare(
    "SELECT * FROM evidence_summaries WHERE artifact_id = $artifactId AND workflow_domain = $domain ORDER BY created_at DESC"
  );
  const listByDomainStmt = db.prepare(
    "SELECT * FROM evidence_summaries WHERE workflow_domain = $domain ORDER BY created_at DESC"
  );
  const markStaleStmt = db.prepare(
    "UPDATE evidence_summaries SET stale = 1, stale_reason = $reason, updated_at = datetime('now') WHERE summary_id = $id"
  );
  const listStaleStmt = db.prepare(
    "SELECT * FROM evidence_summaries WHERE stale = 1 ORDER BY created_at DESC"
  );
  const deleteByIdStmt = db.prepare(
    "DELETE FROM evidence_summaries WHERE summary_id = $id"
  );

  return {
    create(summary) {
      const data = validateEntity("EvidenceSummary", summary);
      const params = {
        ...data,
        stale: data.stale ? 1 : 0,
        stale_reason: data.stale_reason ?? null,
        source_references: toJson(data.source_references),
        workflow_domain: data.workflow_domain || "assessment",
      };
      createStmt.run($p(params));
      return getByIdStmt.get($p({ id: data.summary_id }));
    },

    getById(id) {
      return getByIdStmt.get($p({ id })) || null;
    },

    listByArtifact(artifactId) {
      return listByArtifactStmt.all($p({ artifactId }));
    },

    listByArtifactAndType(artifactId, type) {
      return listByArtifactAndTypeStmt.all($p({ artifactId, type }));
    },

    listByArtifactAndDomain(artifactId, domain) {
      return listByArtifactAndDomainStmt.all($p({ artifactId, domain }));
    },

    listByDomain(domain) {
      return listByDomainStmt.all($p({ domain }));
    },

    markStale(id, reason) {
      markStaleStmt.run($p({ id, reason: reason ?? null }));
      return getByIdStmt.get($p({ id })) || null;
    },

    listStale() {
      return listStaleStmt.all();
    },

    deleteById(id) {
      deleteByIdStmt.run($p({ id }));
    },
  };
}

// ---------------------------------------------------------------------------
// RelationshipRepo
// ---------------------------------------------------------------------------
function createRelationshipRepo(db) {
  const createStmt = db.prepare(`
    INSERT INTO relationships (
      edge_id, source_type, source_id, target_type, target_id,
      relationship_kind, weight, created_at
    ) VALUES (
      $edge_id, $source_type, $source_id, $target_type, $target_id,
      $relationship_kind, $weight, $created_at
    )
  `);

  const listBySourceStmt = db.prepare(
    "SELECT * FROM relationships WHERE source_type = $type AND source_id = $id ORDER BY created_at DESC"
  );
  const listByTargetStmt = db.prepare(
    "SELECT * FROM relationships WHERE target_type = $type AND target_id = $id ORDER BY created_at DESC"
  );
  const deleteByIdStmt = db.prepare(
    "DELETE FROM relationships WHERE edge_id = $id"
  );
  const deleteBySourceStmt = db.prepare(
    "DELETE FROM relationships WHERE source_type = $type AND source_id = $id"
  );

  return {
    create(edge) {
      const data = validateEntity("Relationship", edge);
      createStmt.run($p(data));
      return data;
    },

    listBySource(type, id) {
      return listBySourceStmt.all($p({ type, id }));
    },

    listByTarget(type, id) {
      return listByTargetStmt.all($p({ type, id }));
    },

    deleteById(id) {
      deleteByIdStmt.run($p({ id }));
    },

    deleteBySource(type, id) {
      deleteBySourceStmt.run($p({ type, id }));
    },
  };
}

// ---------------------------------------------------------------------------
// SnapshotRepo
// ---------------------------------------------------------------------------
function createSnapshotRepo(db) {
  const createStmt = db.prepare(`
    INSERT INTO snapshots (
      snapshot_id, trigger_reason, profile_state,
      dimension_signal, dimension_evidence, dimension_visibility, dimension_narrative,
      confidence, dominant_failure_mode, next_recommended_workflow,
      artifact_version_ids, created_at
    ) VALUES (
      $snapshot_id, $trigger_reason, $profile_state,
      $dimension_signal, $dimension_evidence, $dimension_visibility, $dimension_narrative,
      $confidence, $dominant_failure_mode, $next_recommended_workflow,
      $artifact_version_ids, $created_at
    )
  `);

  const getByIdStmt = db.prepare(
    "SELECT * FROM snapshots WHERE snapshot_id = $id"
  );
  const listRecentStmt = db.prepare(
    "SELECT * FROM snapshots ORDER BY created_at DESC LIMIT $limit"
  );
  const listByTriggerStmt = db.prepare(
    "SELECT * FROM snapshots WHERE trigger_reason = $reason ORDER BY created_at DESC"
  );
  const deleteByIdStmt = db.prepare(
    "DELETE FROM snapshots WHERE snapshot_id = $id"
  );

  return {
    create(snapshot) {
      const data = validateEntity("Snapshot", snapshot);
      const params = {
        ...data,
        dimension_signal: data.dimension_summary.signal,
        dimension_evidence: data.dimension_summary.evidence,
        dimension_visibility: data.dimension_summary.visibility,
        dimension_narrative: data.dimension_summary.narrative,
        dominant_failure_mode: data.dominant_failure_mode ?? null,
        next_recommended_workflow:
          data.next_recommended_workflow ?? null,
        artifact_version_ids: toJson(data.artifact_version_ids),
      };
      createStmt.run($p(params));
      return getByIdStmt.get($p({ id: data.snapshot_id }));
    },

    getById(id) {
      return getByIdStmt.get($p({ id })) || null;
    },

    listRecent(limit) {
      return listRecentStmt.all($p({ limit }));
    },

    listByTrigger(reason) {
      return listByTriggerStmt.all($p({ reason }));
    },

    deleteById(id) {
      deleteByIdStmt.run($p({ id }));
    },
  };
}

// ---------------------------------------------------------------------------
// EnrichmentApprovalRepo
// ---------------------------------------------------------------------------
function createEnrichmentApprovalRepo(db) {
  const upsertStmt = db.prepare(`
    INSERT INTO enrichment_approvals (
      approval_id, scope, scope_key, approved, reason_given,
      conditions_snapshot, stale, decided_at
    ) VALUES (
      $approval_id, $scope, $scope_key, $approved, $reason_given,
      $conditions_snapshot, $stale, $decided_at
    ) ON CONFLICT(approval_id) DO UPDATE SET
      approved            = excluded.approved,
      reason_given        = excluded.reason_given,
      conditions_snapshot = excluded.conditions_snapshot,
      stale               = excluded.stale,
      updated_at          = datetime('now')
  `);

  const getByScopeAndKeyStmt = db.prepare(
    "SELECT * FROM enrichment_approvals WHERE scope = $scope AND scope_key = $key ORDER BY decided_at DESC"
  );
  const listByScopeStmt = db.prepare(
    "SELECT * FROM enrichment_approvals WHERE scope = $scope ORDER BY decided_at DESC"
  );
  const markStaleStmt = db.prepare(
    "UPDATE enrichment_approvals SET stale = 1, updated_at = datetime('now') WHERE approval_id = $id"
  );
  const deleteByIdStmt = db.prepare(
    "DELETE FROM enrichment_approvals WHERE approval_id = $id"
  );
  const getByIdStmt = db.prepare(
    "SELECT * FROM enrichment_approvals WHERE approval_id = $id"
  );

  return {
    upsert(approval) {
      const data = validateEntity("EnrichmentApproval", approval);
      const params = {
        ...data,
        approved: data.approved ? 1 : 0,
        stale: data.stale ? 1 : 0,
        reason_given: data.reason_given ?? null,
      };
      upsertStmt.run($p(params));
      return getByScopeAndKeyStmt.get(
        $p({ scope: data.scope, key: data.scope_key })
      );
    },

    getByScopeAndKey(scope, key) {
      return getByScopeAndKeyStmt.get($p({ scope, key })) || null;
    },

    listByScope(scope) {
      return listByScopeStmt.all($p({ scope }));
    },

    markStale(id) {
      markStaleStmt.run($p({ id }));
      return getByIdStmt.get($p({ id })) || null;
    },

    deleteById(id) {
      deleteByIdStmt.run($p({ id }));
    },
  };
}

// ---------------------------------------------------------------------------
// BaselineRepo
// ---------------------------------------------------------------------------
function createBaselineRepo(db) {
  const createStmt = db.prepare(`
    INSERT INTO profile_baselines (
      baseline_id, primary_artifact_ids, role_family_target,
      status, created_at, superseded_at
    ) VALUES (
      $baseline_id, $primary_artifact_ids, $role_family_target,
      $status, $created_at, $superseded_at
    )
  `);

  const getByIdStmt = db.prepare(
    "SELECT * FROM profile_baselines WHERE baseline_id = $id"
  );
  const getActiveStmt = db.prepare(
    "SELECT * FROM profile_baselines WHERE status = 'active' LIMIT 1"
  );
  const supersedeStmt = db.prepare(
    "UPDATE profile_baselines SET status = 'superseded', superseded_at = datetime('now'), updated_at = datetime('now') WHERE baseline_id = $id"
  );
  const deleteByIdStmt = db.prepare(
    "DELETE FROM profile_baselines WHERE baseline_id = $id"
  );

  return {
    create(baseline) {
      const data = validateEntity("ProfileBaseline", baseline);
      const params = {
        ...data,
        primary_artifact_ids: toJson(data.primary_artifact_ids),
        role_family_target: data.role_family_target ?? null,
        superseded_at: data.superseded_at ?? null,
      };
      createStmt.run($p(params));
      return getByIdStmt.get($p({ id: data.baseline_id }));
    },

    getActive() {
      return getActiveStmt.get() || null;
    },

    supersedeBaseline(id) {
      supersedeStmt.run($p({ id }));
      return getByIdStmt.get($p({ id })) || null;
    },

    deleteById(id) {
      deleteByIdStmt.run($p({ id }));
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create all typed repository instances against the provided database.
 *
 * @param {import('bun:sqlite').Database} db - an open SQLite database handle
 *   with all tables already bootstrapped via createTables().
 * @returns {{
 *   artifacts: ReturnType<typeof createArtifactRepo>,
 *   versions: ReturnType<typeof createVersionRepo>,
 *   evidence: ReturnType<typeof createEvidenceRepo>,
 *   relationships: ReturnType<typeof createRelationshipRepo>,
 *   snapshots: ReturnType<typeof createSnapshotRepo>,
 *   approvals: ReturnType<typeof createEnrichmentApprovalRepo>,
 *   baselines: ReturnType<typeof createBaselineRepo>,
 * }}
 */
function createRepositories(db) {
  return {
    artifacts: createArtifactRepo(db),
    versions: createVersionRepo(db),
    evidence: createEvidenceRepo(db),
    relationships: createRelationshipRepo(db),
    snapshots: createSnapshotRepo(db),
    approvals: createEnrichmentApprovalRepo(db),
    baselines: createBaselineRepo(db),
  };
}

module.exports = { createRepositories };
