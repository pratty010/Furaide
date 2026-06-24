/**
 * Brand Builder Artifact Store
 *
 * Canonical artifact file storage operations per D-01 and D-02.
 * Handles local-first artifact ingestion with digest computation,
 * path traversal protection, and version history management.
 *
 * Module exports:
 *   - ensureArtifactDirs(basePath)
 *   - canonicalPath(basePath, artifactType, filename)
 *   - ingestArtifact({ repos, basePath, artifactType, content, filename, sourceLabel })
 *   - readCanonical(repos, artifactId)
 *   - listCurrentArtifacts(repos)
 *   - deleteArtifact(repos, basePath, artifactId)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { randomUUID } = require("crypto");
const { Artifact, validateEntity } = require("../memory/types.js");

// ---------------------------------------------------------------------------
// Valid artifact types (mirrors Artifact schema enum)
// ---------------------------------------------------------------------------
const ARTIFACT_TYPES = Object.freeze([
  "resume",
  "linkedin",
  "github_profile",
  "github_repo",
  "website",
  "job_description",
]);

// ---------------------------------------------------------------------------
// Content normalization
// ---------------------------------------------------------------------------

/**
 * Normalize content for digest comparison:
 *   - Strip leading BOM (U+FEFF)
 *   - Normalize line endings to \n
 *   - Strip trailing whitespace from each line
 *   - Strip final trailing newline
 *
 * This ensures that formatting-only changes (CRLF vs LF, trailing spaces)
 * do not count as meaningful content changes.
 *
 * @param {string|Buffer} content - raw content
 * @returns {string} normalized content
 */
function normalizeContent(content) {
  let text = typeof content === "string" ? content : content.toString("utf-8");
  // Strip leading BOM
  if (text.codePointAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  // Normalize line endings: \r\n → \n, \r → \n
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Strip trailing whitespace from each line
  text = text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
  // Strip final trailing newlines
  text = text.replace(/\n+$/, "");
  return text;
}

/**
 * Compute SHA-256 hex digest of content.
 *
 * @param {string|Buffer} content
 * @returns {string} 64-char hex digest
 */
function computeDigest(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Path manipulation
// ---------------------------------------------------------------------------

/**
 * Create artifact type subdirectories under the data directory.
 * Idempotent — safe to call on existing directories.
 *
 * Directory structure (per D-01):
 *   {basePath}/artifacts/
 *     resume/
 *     linkedin/
 *     github_profile/
 *     github_repo/
 *     website/
 *     job_description/
 *
 * @param {string} basePath - path to the data directory (e.g. .opencode/brand-builder/data)
 */
function ensureArtifactDirs(basePath) {
  const artifactsDir = path.join(basePath, "artifacts");
  for (const type of ARTIFACT_TYPES) {
    const typeDir = path.join(artifactsDir, type);
    fs.mkdirSync(typeDir, { recursive: true });
  }
}

/**
 * Safe filename normalization for path traversal prevention (T-02-01).
 *
 * Rules:
 *   - Reject filenames containing null bytes, path separators, or parent refs
 *   - Keep only alphanumeric, dash, underscore, and dot characters
 *   - Remove leading dots (prevent hidden files)
 *   - Ensure filename is not empty after normalization
 *
 * @param {string} rawFilename - user-provided filename
 * @returns {string} normalized safe filename
 * @throws {Error} if filename contains unsafe characters or is empty after normalization
 */
function normalizeFilename(rawFilename) {
  // Reject null bytes — path traversal vector
  if (rawFilename.includes("\0") || rawFilename.includes("\x00")) {
    throw new Error("Filename must not contain null bytes");
  }
  // Reject traversal sequences
  if (rawFilename.includes("..") || rawFilename.includes("/") || rawFilename.includes("\\")) {
    throw new Error(
      `Unsafe filename "${rawFilename}": must not contain "..", "/", or "\\"`
    );
  }
  // Keep only safe characters: alphanumeric, dash, underscore, dot
  const safe = rawFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Remove leading dots (prevent hidden files)
  const stripped = safe.replace(/^\.+/, "");
  if (stripped.length === 0) {
    throw new Error(`Filename "${rawFilename}" is empty after normalization`);
  }
  return stripped;
}

/**
 * Compute the deterministic canonical path for an artifact file.
 *
 * Format: {basePath}/artifacts/{artifactType}/{safeFilename}
 *
 * The artifactType is validated against the known enum (not user input),
 * so it cannot be used for path traversal. The filename is normalized
 * via normalizeFilename().
 *
 * @param {string} basePath - data directory path
 * @param {string} artifactType - validated artifact type
 * @param {string} filename - user-provided filename (will be normalized)
 * @returns {{ absolutePath: string, relativePath: string }}
 *   absolutePath: full filesystem path for writing
 *   relativePath: path relative to basePath for DB storage
 */
function canonicalPath(basePath, artifactType, filename) {
  if (!ARTIFACT_TYPES.includes(artifactType)) {
    throw new Error(
      `Unknown artifact type "${artifactType}". Expected one of: ${ARTIFACT_TYPES.join(", ")}`
    );
  }
  const safeName = normalizeFilename(filename);
  const absolutePath = path.join(basePath, "artifacts", artifactType, safeName);
  const relativePath = path.join("artifacts", artifactType, safeName);
  return { absolutePath, relativePath };
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * End-to-end artifact ingestion (D-01, D-02).
 *
 * Flow:
 *   1. Validate artifactType against enum
 *   2. Normalize filename (path traversal protection)
 *   3. Compute raw_digest (SHA-256 of raw content)
 *   4. Compute normalized_digest (SHA-256 of normalized content)
 *   5. Write canonical file to disk
 *   6. Upsert artifact record (status=current)
 *   7. Create initial version (provenance.source = user_upload or user_paste)
 *   8. Archive previous current artifact of same type (if exists)
 *   9. Return { artifact, version, canonicalPath }
 *
 * @param {object} params
 * @param {object} params.repos - repository instances from createRepositories()
 * @param {string} params.basePath - data directory path
 * @param {string} params.artifactType - one of the valid artifact type enum values
 * @param {string|Buffer} params.content - raw artifact content
 * @param {string} params.filename - user-provided filename (will be normalized)
 * @param {string} [params.sourceLabel] - optional human label
 * @param {string} [params.provenanceSource] - 'user_upload' or 'user_paste' (default: 'user_upload')
 * @returns {{ artifact: object, version: object, canonicalPath: string }}
 */
function ingestArtifact({
  repos,
  basePath,
  artifactType,
  content,
  filename,
  sourceLabel,
  provenanceSource = "user_upload",
}) {
  if (!repos || !basePath) {
    throw new Error("repos and basePath are required");
  }

  // 1. Validate artifactType
  if (!ARTIFACT_TYPES.includes(artifactType)) {
    throw new Error(
      `Unknown artifact type "${artifactType}". Expected one of: ${ARTIFACT_TYPES.join(", ")}`
    );
  }

  // 2. Compute paths (normalizes filename)
  const { absolutePath, relativePath } = canonicalPath(basePath, artifactType, filename);

  // 3. Ensure content is a Buffer for file writing
  const contentBuffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;

  // 4. Compute digests
  const rawDigest = computeDigest(contentBuffer);
  const normalizedContent = normalizeContent(content);
  const normalizedDigest = computeDigest(normalizedContent);

  // 5. Write canonical file to disk
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, contentBuffer);

  // 6. Build artifact record
  const now = new Date().toISOString();
  const artifactId = randomUUID();

  const artifactData = {
    artifact_id: artifactId,
    artifact_type: artifactType,
    canonical_path: relativePath,
    raw_digest: rawDigest,
    normalized_digest: normalizedDigest,
    first_ingested_at: now,
    last_updated_at: now,
    status: "current",
    source_label: sourceLabel || undefined,
  };

  // 7. Archive previous current artifact of the same type
  const previousCurrent = repos.artifacts.getCurrentByType(artifactType);
  if (previousCurrent && previousCurrent.artifact_id !== artifactId) {
    repos.artifacts.updateStatus(previousCurrent.artifact_id, "archived");
  }

  // 8. Upsert artifact record
  const artifact = repos.artifacts.upsert(artifactData);

  // 9. Determine version number
  const existingVersions = repos.versions.countByArtifact(artifactId);
  const versionNumber = existingVersions + 1;

  // 10. Create initial version
  const versionId = randomUUID();
  const versionData = {
    version_id: versionId,
    artifact_id: artifactId,
    version_number: versionNumber,
    canonical_path: relativePath,
    raw_digest: rawDigest,
    normalized_digest: normalizedDigest,
    ingested_at: now,
    provenance: {
      source: provenanceSource,
      update_context: sourceLabel || undefined,
      goals: undefined,
    },
    supersedes_version: null,
  };

  const version = repos.versions.create(versionData);

  return {
    artifact,
    version,
    canonicalPath: absolutePath,
  };
}

/**
 * Read the canonical file content for an artifact.
 *
 * Looks up the artifact record by ID, then reads the canonical file
 * from disk using the stored canonical_path (relative to basePath).
 * Note: This uses absolute path resolution from the artifact record's
 * canonical_path which is relative; the caller must ensure basePath
 * resolution is correct.
 *
 * @param {object} repos - repository instances
 * @param {string} artifactId - artifact UUID
 * @param {string} [basePath] - optional base path to resolve canonical_path;
 *   if not provided, attempts to read from the stored canonical_path directly
 * @returns {{ artifact: object, content: string } | null}
 */
function readCanonical(repos, artifactId, basePath) {
  const artifact = repos.artifacts.getById(artifactId);
  if (!artifact) {
    return null;
  }

  let filePath;
  if (basePath) {
    filePath = path.join(basePath, artifact.canonical_path);
  } else {
    filePath = artifact.canonical_path;
  }

  if (!fs.existsSync(filePath)) {
    return { artifact, content: null };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return { artifact, content };
}

/**
 * List all artifacts with status='current'.
 *
 * @param {object} repos - repository instances
 * @returns {object[]} array of current artifact records
 */
function listCurrentArtifacts(repos) {
  // Query all types and filter for current status.
  // The repository does not have a "list all current" method, so we
  // query by type and filter.
  const allCurrent = [];
  for (const type of ARTIFACT_TYPES) {
    const current = repos.artifacts.getCurrentByType(type);
    if (current) {
      allCurrent.push(current);
    }
  }
  return allCurrent;
}

/**
 * Soft-delete an artifact by marking it as archived.
 *
 * Does NOT remove the canonical file from disk (per D-09: provenance).
 * The file remains on disk for provenance and recovery.
 *
 * @param {object} repos - repository instances
 * @param {string} basePath - data directory (unused, reserved for future use)
 * @param {string} artifactId - artifact UUID to soft-delete
 * @returns {object|null} the updated artifact record, or null if not found
 */
function deleteArtifact(repos, basePath, artifactId) {
  const artifact = repos.artifacts.getById(artifactId);
  if (!artifact) {
    return null;
  }
  return repos.artifacts.updateStatus(artifactId, "archived");
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  ensureArtifactDirs,
  canonicalPath,
  normalizeFilename,
  normalizeContent,
  computeDigest,
  ingestArtifact,
  readCanonical,
  listCurrentArtifacts,
  deleteArtifact,
  ARTIFACT_TYPES,
};
