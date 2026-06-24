/**
 * Brand Builder Intake Module
 *
 * Entry point that ties together canonical artifact storage (artifact-store)
 * and compare-then-promote update logic (compare-promote) into a unified
 * intake interface. The factory createIntakeModule({ db, basePath }) creates
 * repositories from the database and returns an orchestration surface for
 * artifact ingestion, update, comparison, and conflict detection.
 *
 * Usage:
 *   const intake = createIntakeModule({ db, basePath });
 *   const result = intake.ingest({ artifactType: 'resume', content: '...', filename: 'resume.txt' });
 *   const update = intake.update({ artifactId: '...', newContent: '...', newFilename: 'v2.txt' });
 */

const { createRepositories } = require("../memory/repository.js");
const { createTables } = require("../memory/schema.js");

const {
  ingestArtifact,
  readCanonical,
  listCurrentArtifacts,
  deleteArtifact,
  ensureArtifactDirs,
  normalizeContent,
  computeDigest,
} = require("./artifact-store.js");

const {
  detectUpdateType,
  promoteUpdate,
  flagConflicts,
} = require("./compare-promote.js");

/**
 * Create the unified intake module.
 *
 * Bootstraps the database schema if needed, creates all repository instances,
 * and returns an intake interface that delegates to artifact-store and
 * compare-promote functions.
 *
 * @param {object} params
 * @param {import('bun:sqlite').Database} params.db - open SQLite database handle
 * @param {string} params.basePath - data directory path (e.g. .opencode/brand-builder/data)
 * @returns {object} intake module interface
 */
function createIntakeModule({ db, basePath }) {
  if (!db) throw new Error("db is required");
  if (!basePath) throw new Error("basePath is required");

  // Bootstrap schema if needed (idempotent)
  createTables(db);

  // Ensure artifact directories exist
  ensureArtifactDirs(basePath);

  // Create repositories
  const repos = createRepositories(db);

  // Pre-bound delegates with repos and basePath
  return {
    /**
     * Ingest a new artifact into the system.
     */
    ingest(params) {
      return ingestArtifact({ repos, basePath, ...params });
    },

    /**
     * Update an existing artifact via compare-then-promote flow.
     */
    update(params) {
      return promoteUpdate({ repos, basePath, ...params });
    },

    /**
     * Compare new content against an existing artifact's current state.
     * Returns the detected update type without mutating anything.
     */
    compare(artifactId, newContent) {
      const normalized = normalizeContent(newContent);
      const digest = computeDigest(normalized);
      return detectUpdateType({
        repos,
        artifactId,
        newNormalizedDigest: digest,
      });
    },

    /**
     * Check for conflicts between new content and existing evidence summaries.
     */
    flagConflicts(artifactId, newContent) {
      return flagConflicts({ repos, artifactId, newContent });
    },

    /**
     * List all artifacts with status='current'.
     */
    getCurrentArtifacts() {
      return listCurrentArtifacts(repos);
    },

    /**
     * Read a canonical artifact's file content.
     */
    readArtifact(artifactId) {
      return readCanonical(repos, artifactId, basePath);
    },

    /**
     * Soft-delete an artifact (status=archived).
     */
    deleteArtifact(artifactId) {
      return deleteArtifact(repos, basePath, artifactId);
    },

    /**
     * Expose repositories for lower-level access.
     */
    repos,
  };
}

module.exports = { createIntakeModule };
