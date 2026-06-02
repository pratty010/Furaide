/**
 * Brand Builder Compare-and-Promote Flow
 *
 * Implements the compare-then-promote update logic per D-08 through D-13.
 * Handles update classification, provenance tracking, stale evidence marking,
 * and bounded version history.
 *
 * Module exports:
 *   - compareDigests(newDigest, previousDigest)
 *   - detectUpdateType({ repos, artifactId, newNormalizedDigest, newRawDigest })
 *   - promoteUpdate({ repos, basePath, artifactId, newContent, newFilename, updateContext, goals })
 *   - flagConflicts({ repos, artifactId, newContent })
 */

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

/**
 * Remove null-valued fields from an object for Zod compatibility.
 * Zod's .optional() means "field may be absent/missing," not "field may be null."
 * SQLite returns NULL for absent columns, which needs conversion.
 */
function stripNulls(obj) {
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== null) {
      out[key] = val;
    }
  }
  return out;
}
const {
  ingestArtifact,
  normalizeContent,
  computeDigest,
  canonicalPath,
} = require("./artifact-store.js");

// ---------------------------------------------------------------------------
// Digest comparison
// ---------------------------------------------------------------------------

/**
 * Compare two digests and report whether anything changed.
 *
 * @param {string} newDigest - SHA-256 hex digest of new content
 * @param {string} previousDigest - SHA-256 hex digest of previous content
 * @returns {{ changed: boolean, isNormalizedChange: boolean }}
 *   changed: true if digests differ
 *   isNormalizedChange: always true when changed (distinguishing
 *     between raw-only and normalized changes happens in detectUpdateType)
 */
function compareDigests(newDigest, previousDigest) {
  const changed = newDigest !== previousDigest;
  return {
    changed,
    // When comparing normalized digests, this flag tells the caller
    // that the change is in the normalized content (meaningful).
    // When comparing raw digests, the changed flag indicates any diff.
    isNormalizedChange: changed,
  };
}

// ---------------------------------------------------------------------------
// Update type detection
// ---------------------------------------------------------------------------

/**
 * Classify how a new artifact version relates to the current state.
 *
 * Returns:
 *   'new'               — no current artifact of this type exists
 *   'unchanged'          — both raw and normalized digests match
 *   'minor_update'       — raw digest differs but normalized matches
 *                          (formatting-only: line endings, whitespace)
 *   'meaningful_update'  — normalized digest differs
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {string} params.artifactId - artifact UUID
 * @param {string} params.newNormalizedDigest - SHA-256 of normalized new content
 * @param {string} [params.newRawDigest] - SHA-256 of raw new content
 *   Optional; if omitted, cannot distinguish 'unchanged' from 'minor_update'.
 * @returns {'new'|'unchanged'|'minor_update'|'meaningful_update'}
 */
function detectUpdateType({ repos, artifactId, newNormalizedDigest, newRawDigest }) {
  // Look up the current artifact
  const current = repos.artifacts.getById(artifactId);
  if (!current) {
    return "new";
  }

  // Verify it is the current artifact
  if (current.status !== "current") {
    return "new";
  }

  // Compare normalized digests
  if (newNormalizedDigest !== current.normalized_digest) {
    return "meaningful_update";
  }

  // Normalized matches — check raw digest for formatting-only changes
  if (newRawDigest && newRawDigest !== current.raw_digest) {
    return "minor_update";
  }

  // Both digests match
  return "unchanged";
}

// ---------------------------------------------------------------------------
// Core promote-update flow (D-08)
// ---------------------------------------------------------------------------

/**
 * Core compare-then-promote update flow.
 *
 * 1. Read the current artifact record
 * 2. Compute digests (raw + normalized) of new content
 * 3. Classify the change via detectUpdateType()
 * 4. Route to the appropriate action:
 *    - 'unchanged'          → return { action: 'unchanged' }
 *    - 'minor_update'       → promote file, update raw_digest, create version
 *    - 'meaningful_update'  → promote file, update digests, mark evidence stale,
 *                             create supersedes relationship, bound history
 *    - 'new'                → delegate to ingestArtifact()
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {string} params.basePath - data directory path
 * @param {string} params.artifactId - UUID of the artifact to update
 * @param {string|Buffer} params.newContent - new artifact content
 * @param {string} params.newFilename - filename for the new canonical file
 * @param {string} [params.updateContext] - user-provided context for the update (D-12)
 * @param {string} [params.goals] - user-provided goals for the update (D-12)
 * @returns {object} result object with action, artifact, version, etc.
 */
function promoteUpdate({
  repos,
  basePath,
  artifactId,
  newContent,
  newFilename,
  updateContext,
  goals,
}) {
  if (!repos || !basePath || !artifactId) {
    throw new Error("repos, basePath, and artifactId are required");
  }

  // 1. Read the current artifact record
  const currentArtifact = repos.artifacts.getById(artifactId);

  // 2. Compute new digests
  const contentBuffer =
    typeof newContent === "string" ? Buffer.from(newContent, "utf-8") : newContent;
  const newRawDigest = computeDigest(contentBuffer);
  const newNormalized = normalizeContent(newContent);
  const newNormalizedDigest = computeDigest(newNormalized);

  // 3. Classify the change
  const updateType = detectUpdateType({
    repos,
    artifactId,
    newNormalizedDigest,
    newRawDigest,
  });

  // 4. Route based on classification
  if (updateType === "new") {
    // Delegate to ingestArtifact — this creates a new artifact from scratch.
    // We need to derive the artifactType from... well, if there's no current
    // artifact, we can't infer the type. This case means the caller passed
    // an artifactId that doesn't exist. Return an error indicating this.
    return {
      action: "error",
      error: `Artifact ${artifactId} not found. Use ingestArtifact() for new artifacts.`,
    };
  }

  if (updateType === "unchanged") {
    return {
      action: "unchanged",
      artifact: currentArtifact,
      reason: "normalized content matches current — no changes detected",
    };
  }

  // 4a. Compute paths for the new version file
  const { absolutePath, relativePath } = canonicalPath(
    basePath,
    currentArtifact.artifact_type,
    newFilename
  );

  // 4b. Write the new canonical file
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, contentBuffer);

  // 4c. Compute the new version number (monotonic, not count-based)
  const allExistingVersions = repos.versions.listByArtifact(artifactId);
  const newVersionNumber =
    allExistingVersions.length > 0
      ? Math.max(...allExistingVersions.map((v) => v.version_number)) + 1
      : 1;

  // 4d. Determine the previous version for supersedes reference
  const now = new Date().toISOString();
  const versionId = randomUUID();
  let supersedesVersionId = null;

  if (newVersionNumber > 1) {
    const previousVersion = repos.versions.getByVersionNumber(
      artifactId,
      newVersionNumber - 1
    );
    if (previousVersion) {
      supersedesVersionId = previousVersion.version_id;
    }
  }

  // 4e. Create the version record with correct supersedes_version
  const versionData = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: newVersionNumber,
    canonical_path: relativePath,
    raw_digest: newRawDigest,
    normalized_digest: newNormalizedDigest,
    ingested_at: now,
    provenance: {
      source: "update_flow",
      update_context: updateContext || undefined,
      goals: goals || undefined,
    },
    supersedes_version: supersedesVersionId,
  };

  const version = repos.versions.create(versionData);

  if (updateType === "minor_update") {
    // Update only the raw_digest in the artifact record (and bump last_updated_at)
    const updatedArtifact = repos.artifacts.upsert(
      stripNulls({
        ...currentArtifact,
        raw_digest: newRawDigest,
        canonical_path: relativePath,
        last_updated_at: now,
      })
    );

    return {
      action: "minor_update",
      artifact: updatedArtifact,
      version,
      canonicalPath: absolutePath,
      reason: "formatting-only change — raw digest updated, content unchanged",
    };
  }

  // --- meaningful_update ---

  // Update the artifact record with new digests and path
  const updatedArtifact = repos.artifacts.upsert(
    stripNulls({
      ...currentArtifact,
      raw_digest: newRawDigest,
      normalized_digest: newNormalizedDigest,
      canonical_path: relativePath,
      last_updated_at: now,
    })
  );

  // Mark all evidence summaries for this artifact as stale (D-11)
  const evidenceSummaries = repos.evidence.listByArtifact(artifactId);
  let staleEvidenceCount = 0;
  for (const summary of evidenceSummaries) {
    if (!summary.stale) {
      repos.evidence.markStale(summary.summary_id, "artifact_version_superseded");
      staleEvidenceCount++;
    }
  }

  // Create supersedes_version relationship (D-10)
  if (currentArtifact) {
    const relationshipId = randomUUID();
    repos.relationships.create({
      edge_id: relationshipId,
      source_type: "artifact",
      source_id: artifactId,
      target_type: "artifact",
      target_id: artifactId, // self-referencing: new version supersedes old
      relationship_kind: "supersedes",
      weight: 1.0,
      created_at: now,
    });
  }

  // Bound version history to 5 for resume and LinkedIn (D-13)
  const boundedTypes = ["resume", "linkedin"];
  if (boundedTypes.includes(currentArtifact.artifact_type)) {
    const allVersions = repos.versions.listByArtifact(artifactId);
    // Sort by version_number ascending to identify oldest
    const sortedByVersion = [...allVersions].sort(
      (a, b) => a.version_number - b.version_number
    );

    if (sortedByVersion.length > 5) {
      const toArchive = sortedByVersion.slice(0, sortedByVersion.length - 5);
      for (const oldVersion of toArchive) {
        // Remove the old canonical file from disk
        try {
          const oldPath = path.join(basePath, oldVersion.canonical_path);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        } catch {
          // Best-effort cleanup
        }
        // Delete the version record
        repos.versions.deleteById(oldVersion.version_id);
      }
    }
  }

  return {
    action: "meaningful_update",
    artifact: updatedArtifact,
    version,
    canonicalPath: absolutePath,
    staleEvidenceCount,
    reason: "meaningful content change — normalized digest updated, evidence marked stale",
  };
}

// ---------------------------------------------------------------------------
// Conflict detection (D-10)
// ---------------------------------------------------------------------------

/**
 * Detect conflicts between new artifact content and stored evidence summaries.
 *
 * When a new artifact version is about to be ingested, this checks whether
 * any non-stale evidence summaries reference the current artifact version
 * and would therefore become stale or contradictory.
 *
 * @param {object} params
 * @param {object} params.repos - repository instances
 * @param {string} params.artifactId - artifact UUID
 * @param {string|Buffer} params.newContent - proposed new content
 * @returns {{
 *   hasConflict: boolean,
 *   conflictingSummaries: object[],
 *   suggestion: string
 * }}
 */
function flagConflicts({ repos, artifactId, newContent }) {
  const currentArtifact = repos.artifacts.getById(artifactId);
  if (!currentArtifact) {
    return {
      hasConflict: false,
      conflictingSummaries: [],
      suggestion: "Artifact not found — no conflicts to flag",
    };
  }

  // Find all non-stale evidence summaries for this artifact
  const allSummaries = repos.evidence.listByArtifact(artifactId);
  const nonStaleSummaries = allSummaries.filter((s) => !s.stale);

  if (nonStaleSummaries.length === 0) {
    return {
      hasConflict: false,
      conflictingSummaries: [],
      suggestion:
        "No active evidence summaries reference this artifact — safe to update",
    };
  }

  // Compute new normalized digest to check if content actually differs
  const newNormalized = normalizeContent(newContent);
  const newDigest = computeDigest(newNormalized);

  const hasContentChange = newDigest !== currentArtifact.normalized_digest;

  if (!hasContentChange) {
    return {
      hasConflict: false,
      conflictingSummaries: [],
      suggestion:
        "New content matches current normalized version — no conflicts expected",
    };
  }

  // Content differs and there are active summaries — flag conflict
  return {
    hasConflict: true,
    conflictingSummaries: nonStaleSummaries.map((s) => ({
      summary_id: s.summary_id,
      summary_type: s.summary_type,
      content_preview: s.content.substring(0, 100),
    })),
    suggestion: `${nonStaleSummaries.length} active evidence summary(s) reference this artifact version. Updating will mark them stale (D-11). User should be informed before proceeding.`,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  compareDigests,
  detectUpdateType,
  promoteUpdate,
  flagConflicts,
};
