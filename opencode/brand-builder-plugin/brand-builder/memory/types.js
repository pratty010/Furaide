/**
 * Brand Builder Memory Types
 *
 * Zod-validated type definitions for ALL memory entities.
 * This is the interface-first contract that all downstream plans implement against.
 *
 * Entities:
 *   1. Artifact          — canonical source-of-truth artifact per surface
 *   2. ArtifactVersion    — versioned history of an artifact
 *   3. EvidenceSummary    — compact derived evidence from artifact analysis
 *   4. Relationship       — typed edges between graph entities
 *   5. Snapshot           — compact profile state capture on meaningful change
 *   6. EnrichmentApproval — remembered permission for expensive enrichment
 *   7. ProfileBaseline    — single working profile baseline
 */

const { z } = require("zod");

// ---------------------------------------------------------------------------
// 1. Artifact
// ---------------------------------------------------------------------------
const Artifact = z
  .object({
    artifact_id: z.string().uuid().describe("Unique artifact identifier (UUID v4)"),
    artifact_type: z
      .enum([
        "resume",
        "linkedin",
        "github_profile",
        "github_repo",
        "website",
        "job_description",
      ])
      .describe("Artifact surface type"),
    canonical_path: z
      .string()
      .describe("Relative path under data/ where the canonical file lives"),
    raw_digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("SHA-256 hex digest of raw file content"),
    normalized_digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("SHA-256 hex digest of normalized content"),
    first_ingested_at: z.string().datetime().describe("ISO 8601 datetime of first ingestion"),
    last_updated_at: z.string().datetime().describe("ISO 8601 datetime of last update"),
    status: z
      .enum(["current", "archived", "superseded"])
      .describe("Liveness status of the artifact record"),
    source_label: z
      .string()
      .optional()
      .describe("Optional human label, e.g., 'My updated resume'"),
  })
  .describe("Canonical source-of-truth artifact per surface (D-01)");

// ---------------------------------------------------------------------------
// 2. ArtifactVersion
// ---------------------------------------------------------------------------
const ArtifactVersion = z
  .object({
    version_id: z.string().uuid().describe("Unique version identifier (UUID v4)"),
    artifact_id: z.string().uuid().describe("References Artifact.artifact_id"),
    version_number: z
      .number()
      .int()
      .positive()
      .describe("Monotonic version number, starting at 1"),
    canonical_path: z
      .string()
      .describe("Path to the canonical file at this version"),
    raw_digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("SHA-256 hex digest of raw file content"),
    normalized_digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("SHA-256 hex digest of normalized content"),
    ingested_at: z.string().datetime().describe("ISO 8601 datetime of ingestion"),
    provenance: z
      .object({
        source: z
          .enum(["user_upload", "user_paste", "update_flow", "enrichment"])
          .describe("How this version was ingested"),
        update_context: z
          .string()
          .optional()
          .describe("Optional user-provided context for the update (D-12)"),
        goals: z
          .string()
          .optional()
          .describe("Optional user-provided goals for the update (D-12)"),
      })
      .describe("Provenance metadata for this version (D-09)"),
    supersedes_version: z
      .string()
      .uuid()
      .nullable()
      .describe("UUID of the version this one supersedes, or null"),
  })
  .describe("Versioned history of an artifact (D-08, D-10, D-13)");

// ---------------------------------------------------------------------------
// 3. EvidenceSummary
// ---------------------------------------------------------------------------
const EvidenceSummary = z
  .object({
    summary_id: z.string().uuid().describe("Unique summary identifier (UUID v4)"),
    artifact_id: z.string().uuid().describe("References Artifact.artifact_id"),
    version_id: z.string().uuid().describe("References ArtifactVersion.version_id"),
    summary_type: z
      .enum(["field_extraction", "signal_assessment", "surface_snapshot"])
      .describe("Category of evidence captured"),
    content: z
      .string()
      .describe("Compact summary text (not a full report — Pitfall 2)"),
    source_references: z
      .array(z.string())
      .describe("Pointer IDs to source material or evidence graph edges"),
    stale: z
      .boolean()
      .default(false)
      .describe("True when upstream artifact changes invalidate this summary (D-11)"),
    stale_reason: z
      .string()
      .optional()
      .describe("Explanation for why the summary was marked stale"),
    workflow_domain: z
      .enum(["assessment", "role_fit", "linkedin", "github"])
      .default("assessment")
      .describe("Workflow domain this evidence belongs to (D-21: cross-domain evidence segregation)"),
    created_at: z.string().datetime().describe("ISO 8601 datetime of creation"),
  })
  .describe("Compact derived evidence from artifact analysis (D-02, D-04, D-11, D-21)");

// ---------------------------------------------------------------------------
// 4. Relationship
// ---------------------------------------------------------------------------
const Relationship = z
  .object({
    edge_id: z.string().uuid().describe("Unique edge identifier (UUID v4)"),
    source_type: z
      .enum(["artifact", "evidence", "snapshot", "role_family"])
      .describe("Entity type of the source node"),
    source_id: z.string().describe("ID of the source node"),
    target_type: z
      .enum(["artifact", "evidence", "snapshot", "role_family"])
      .describe("Entity type of the target node"),
    target_id: z.string().describe("ID of the target node"),
    relationship_kind: z
      .enum([
        "derived_from",
        "supersedes",
        "contradicts",
        "supports",
        "belongs_to_role_family",
        "stale_due_to",
      ])
      .describe("Semantic relationship type"),
    weight: z
      .number()
      .min(0)
      .max(1)
      .default(1.0)
      .describe("Edge weight, 0-1"),
    created_at: z.string().datetime().describe("ISO 8601 datetime of creation"),
  })
  .describe("Typed edge linking two graph entities (D-02, D-04)");

// ---------------------------------------------------------------------------
// 5. Snapshot
// ---------------------------------------------------------------------------
const Snapshot = z
  .object({
    snapshot_id: z.string().uuid().describe("Unique snapshot identifier (UUID v4)"),
    trigger_reason: z
      .enum([
        "artifact_update",
        "new_role_target",
        "approved_rewrite",
        "periodic_check",
        "manual_request",
        "enrichment_update",
      ])
      .describe("What caused this snapshot to be taken (D-14)"),
    profile_state: z
      .string()
      .describe("JSON-serialized compact profile state"),
    dimension_summary: z
      .object({
        signal: z.number().describe("Signal dimension score"),
        evidence: z.number().describe("Evidence dimension score"),
        visibility: z.number().describe("Visibility dimension score"),
        narrative: z.number().describe("Narrative dimension score"),
      })
      .describe("Dimension-level summary scores"),
    confidence: z
      .enum(["high", "medium", "low"])
      .describe("Overall snapshot confidence"),
    dominant_failure_mode: z
      .string()
      .optional()
      .describe("Most significant failure mode at this point, if any"),
    next_recommended_workflow: z
      .string()
      .optional()
      .describe("The workflow recommended to run next (D-17)"),
    artifact_version_ids: z
      .array(z.string())
      .describe("Artifact version IDs this snapshot covers"),
    created_at: z.string().datetime().describe("ISO 8601 datetime of creation"),
  })
  .describe("Compact profile state capture on meaningful change (D-14 through D-19)");

// ---------------------------------------------------------------------------
// 6. EnrichmentApproval
// ---------------------------------------------------------------------------
const EnrichmentApproval = z
  .object({
    approval_id: z.string().uuid().describe("Unique approval identifier (UUID v4)"),
    scope: z
      .enum(["repo_graphification", "deep_analysis", "external_fetch"])
      .describe("Category of enrichment being gated (D-25)"),
    scope_key: z
      .string()
      .describe("Specific identifier within the scope, e.g. repo URL"),
    approved: z
      .boolean()
      .describe("Whether the user approved this enrichment"),
    reason_given: z
      .string()
      .optional()
      .describe("Cost/benefit explanation shown to the user (D-21)"),
    conditions_snapshot: z
      .string()
      .describe("JSON snapshot of conditions when approval was requested (D-24)"),
    stale: z
      .boolean()
      .default(false)
      .describe("True when conditions changed materially since approval (D-24)"),
    decided_at: z.string().datetime().describe("ISO 8601 datetime of decision"),
  })
  .describe("Remembered permission for expensive optional enrichment (D-20 through D-25)");

// ---------------------------------------------------------------------------
// 7. ProfileBaseline
// ---------------------------------------------------------------------------
const ProfileBaseline = z
  .object({
    baseline_id: z.string().uuid().describe("Unique baseline identifier (UUID v4)"),
    primary_artifact_ids: z
      .array(z.string().uuid())
      .describe("IDs of the artifacts that form this baseline"),
    role_family_target: z
      .string()
      .optional()
      .describe("Target role family for this baseline"),
    status: z
      .enum(["active", "superseded"])
      .describe("Whether this is the current active baseline (D-05)"),
    created_at: z.string().datetime().describe("ISO 8601 datetime of creation"),
    superseded_at: z
      .string()
      .datetime()
      .nullable()
      .describe("When this baseline was superseded, or null if still active"),
  })
  .describe("Single working profile baseline (D-05)");

// ---------------------------------------------------------------------------
// Schema name → schema map
// ---------------------------------------------------------------------------
const SCHEMAS = {
  Artifact,
  ArtifactVersion,
  EvidenceSummary,
  Relationship,
  Snapshot,
  EnrichmentApproval,
  ProfileBaseline,
};

/**
 * Validate an object against a named entity schema.
 *
 * @param {string} typeName - one of the SCHEMAS keys (e.g. "Artifact")
 * @param {unknown} data   - the object to validate
 * @returns {object}       - the parsed (and default-filled) value on success
 * @throws {z.ZodError}    - descriptive error on mismatch
 */
function validateEntity(typeName, data) {
  const schema = SCHEMAS[typeName];
  if (!schema) {
    throw new Error(
      `Unknown entity type "${typeName}". Expected one of: ${Object.keys(SCHEMAS).join(", ")}`
    );
  }
  return schema.parse(data);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  Artifact,
  ArtifactVersion,
  EvidenceSummary,
  Relationship,
  Snapshot,
  EnrichmentApproval,
  ProfileBaseline,
  SCHEMAS,
  validateEntity,
};
