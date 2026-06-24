/**
 * intake.test.js — MEM-01, INTAKE-01
 *
 * Type validation tests for Artifact and ArtifactVersion schemas,
 * plus integration tests for the artifact-store module (ingest,
 * canonical path, list, read, delete, path traversal protection).
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const {
  Artifact,
  ArtifactVersion,
  validateEntity,
} = require("../memory/types.js");

const { createRepositories } = require("../memory/repository.js");

const {
  canonicalPath,
  normalizeFilename,
  normalizeContent,
  computeDigest,
  ensureArtifactDirs,
  ingestArtifact,
  readCanonical,
  listCurrentArtifacts,
  deleteArtifact,
  ARTIFACT_TYPES,
} = require("../intake/artifact-store.js");

const {
  createTestDb,
  createTestDirectory,
  SAMPLE_ARTIFACT,
  SAMPLE_ARTIFACT_VERSION,
} = require("./helpers.js");

// ============================================================================
// PART 1: Type validation (existing tests from Plan 01)
// ============================================================================

describe("Artifact Intake — Type Validation", () => {
  it("validates a new artifact with all required fields", () => {
    const result = validateEntity("Artifact", SAMPLE_ARTIFACT);
    assert.strictEqual(result.artifact_type, "resume");
    assert.strictEqual(result.status, "current");
  });

  it("validates all artifact_type enum values", () => {
    const types = ["resume", "linkedin", "github_profile", "github_repo", "website", "job_description"];
    for (const t of types) {
      const a = { ...SAMPLE_ARTIFACT, artifact_type: t };
      const result = validateEntity("Artifact", a);
      assert.strictEqual(result.artifact_type, t);
    }
  });

  it("rejects artifact with missing required fields", () => {
    assert.throws(
      () => validateEntity("Artifact", {}),
      /artifact_id/
    );
  });

  it("accepts artifact with optional source_label", () => {
    const a = { ...SAMPLE_ARTIFACT, source_label: "Latest resume" };
    const result = validateEntity("Artifact", a);
    assert.strictEqual(result.source_label, "Latest resume");
  });

  it("accepts artifact without optional source_label", () => {
    const { source_label, ...withoutLabel } = SAMPLE_ARTIFACT;
    const result = validateEntity("Artifact", withoutLabel);
    assert.strictEqual(result.source_label, undefined);
  });

  it("rejects artifact with invalid status", () => {
    assert.throws(
      () => validateEntity("Artifact", { ...SAMPLE_ARTIFACT, status: "deleted" }),
      /status/
    );
  });
});

describe("ArtifactVersion Intake — Type Validation", () => {
  it("validates a new version with provenance", () => {
    const result = validateEntity("ArtifactVersion", SAMPLE_ARTIFACT_VERSION);
    assert.strictEqual(result.version_number, 1);
    assert.strictEqual(result.provenance.source, "user_upload");
    assert.strictEqual(result.supersedes_version, null);
  });

  it("validates all provenance source enum values", () => {
    const sources = ["user_upload", "user_paste", "update_flow", "enrichment"];
    for (const s of sources) {
      const v = {
        ...SAMPLE_ARTIFACT_VERSION,
        provenance: { ...SAMPLE_ARTIFACT_VERSION.provenance, source: s },
      };
      const result = validateEntity("ArtifactVersion", v);
      assert.strictEqual(result.provenance.source, s);
    }
  });

  it("rejects version_number zero", () => {
    assert.throws(
      () =>
        validateEntity("ArtifactVersion", {
          ...SAMPLE_ARTIFACT_VERSION,
          version_number: 0,
        }),
      /version_number/
    );
  });

  it("rejects version_number negative", () => {
    assert.throws(
      () =>
        validateEntity("ArtifactVersion", {
          ...SAMPLE_ARTIFACT_VERSION,
          version_number: -1,
        }),
      /version_number/
    );
  });

  it("validates supersedes_version as valid UUID", () => {
    const v = {
      ...SAMPLE_ARTIFACT_VERSION,
      version_id: "b0000001-0001-4000-8000-000000000002",
      version_number: 2,
      supersedes_version: "b0000001-0001-4000-8000-000000000001",
    };
    const result = validateEntity("ArtifactVersion", v);
    assert.strictEqual(result.supersedes_version, "b0000001-0001-4000-8000-000000000001");
  });

  it("accepts optional provenance fields", () => {
    const v = {
      ...SAMPLE_ARTIFACT_VERSION,
      provenance: { source: "user_upload" },
    };
    const result = validateEntity("ArtifactVersion", v);
    assert.strictEqual(result.provenance.update_context, undefined);
    assert.strictEqual(result.provenance.goals, undefined);
  });
});

describe("Schema Independence", () => {
  it("Artifact schema does not accept ArtifactVersion fields", () => {
    assert.throws(
      () => validateEntity("Artifact", SAMPLE_ARTIFACT_VERSION),
      /artifact_type|first_ingested_at|status/
    );
  });

  it("ArtifactVersion schema does not accept bare Artifact", () => {
    assert.throws(
      () => validateEntity("ArtifactVersion", SAMPLE_ARTIFACT),
      /version_id|version_number|provenance/
    );
  });
});

// ============================================================================
// PART 2: Artifact-store integration tests (Plan 02 new)
// ============================================================================

describe("Artifact Store — Path Safety", () => {
  it("canonicalPath returns correct structure", () => {
    const result = canonicalPath("/tmp/data", "resume", "my-resume.pdf");
    assert.ok(result.absolutePath.includes("/artifacts/resume/"));
    assert.ok(result.absolutePath.endsWith("my-resume.pdf"));
    assert.strictEqual(result.relativePath, path.join("artifacts", "resume", "my-resume.pdf"));
  });

  it("canonicalPath rejects unknown artifact type", () => {
    assert.throws(
      () => canonicalPath("/tmp/data", "unknown_type", "file.txt"),
      /Unknown artifact type/
    );
  });

  it("canonicalPath rejects '../' traversal attempt", () => {
    assert.throws(
      () => canonicalPath("/tmp/data", "resume", "../etc/passwd"),
      /Unsafe filename/
    );
  });

  it("canonicalPath rejects 'foo/bar' traversal attempt", () => {
    assert.throws(
      () => canonicalPath("/tmp/data", "resume", "foo/bar"),
      /Unsafe filename/
    );
  });

  it("canonicalPath rejects backslash traversal attempt", () => {
    assert.throws(
      () => canonicalPath("/tmp/data", "resume", "foo\\bar"),
      /Unsafe filename/
    );
  });

  it("canonicalPath rejects '..' anywhere in filename", () => {
    assert.throws(
      () => canonicalPath("/tmp/data", "resume", "file..name"),
      /Unsafe filename/
    );
  });

  it("normalizeFilename strips unsafe characters", () => {
    const result = canonicalPath("/tmp/data", "resume", "my file (1).txt");
    assert.ok(result.absolutePath.includes("my_file__1_.txt"));
  });

  it("normalizeFilename rejects empty-after-normalization", () => {
    // "." is a single dot — no ".." traversal pattern, but after
    // stripping leading dots the result is empty
    assert.throws(
      () => canonicalPath("/tmp/data", "resume", "."),
      /empty after normalization/
    );
  });
});

describe("Artifact Store — Hash and Normalization", () => {
  it("computeDigest produces 64-char hex string", () => {
    const digest = computeDigest("hello world");
    assert.strictEqual(digest.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(digest));
  });

  it("computeDigest is deterministic", () => {
    const a = computeDigest("same content");
    const b = computeDigest("same content");
    assert.strictEqual(a, b);
  });

  it("computeDigest differs for different content", () => {
    const a = computeDigest("content A");
    const b = computeDigest("content B");
    assert.notStrictEqual(a, b);
  });

  it("normalizeContent strips BOM", () => {
    const withBom = "\uFEFFHello World";
    const result = normalizeContent(withBom);
    assert.strictEqual(result, "Hello World");
  });

  it("normalizeContent normalizes CRLF to LF", () => {
    const crlf = "line1\r\nline2\r\nline3";
    const result = normalizeContent(crlf);
    assert.strictEqual(result, "line1\nline2\nline3");
  });

  it("normalizeContent strips trailing whitespace", () => {
    const withTrailing = "line1   \nline2\t\nline3";
    const result = normalizeContent(withTrailing);
    assert.strictEqual(result, "line1\nline2\nline3");
  });

  it("normalizeContent strips trailing newlines", () => {
    const withNewlines = "hello world\n\n\n";
    const result = normalizeContent(withNewlines);
    assert.strictEqual(result, "hello world");
  });

  it("normalizeContent produces same digest for formatting-only diffs", () => {
    const unix = "Name: Jane Doe\nSkills: TypeScript, Node.js\n";
    const dos = "Name: Jane Doe\r\nSkills: TypeScript, Node.js\r\n";
    const d1 = computeDigest(normalizeContent(unix));
    const d2 = computeDigest(normalizeContent(dos));
    assert.strictEqual(d1, d2);
  });
});

describe("Artifact Store — Integration", () => {
  let db;
  let harness;
  let repos;
  let basePath;

  before(() => {
    harness = createTestDb();
    db = harness.db;
    repos = createRepositories(db);
    basePath = createTestDirectory();
  });

  after(() => {
    harness.close();
  });

  it("ensureArtifactDirs creates all type directories", () => {
    ensureArtifactDirs(basePath);
    const artifactsDir = path.join(basePath, "artifacts");
    assert.ok(fs.existsSync(artifactsDir));
    for (const type of ARTIFACT_TYPES) {
      const typeDir = path.join(artifactsDir, type);
      assert.ok(fs.existsSync(typeDir), `Expected directory: ${typeDir}`);
    }
  });

  it("ingestArtifact creates artifact + version + file", () => {
    const content = "Name: Jane Doe\nTitle: Senior Engineer\nYears: 8";
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content,
      filename: "jane-resume.txt",
      sourceLabel: "My current resume",
    });

    // Check artifact record
    assert.ok(result.artifact);
    assert.strictEqual(result.artifact.artifact_type, "resume");
    assert.strictEqual(result.artifact.status, "current");
    assert.strictEqual(result.artifact.source_label, "My current resume");
    assert.ok(result.artifact.raw_digest.length === 64);
    assert.ok(result.artifact.normalized_digest.length === 64);

    // Check version record
    assert.ok(result.version);
    assert.strictEqual(result.version.version_number, 1);
    assert.strictEqual(result.version.provenance_source, "user_upload");

    // Check file exists on disk
    assert.ok(fs.existsSync(result.canonicalPath));
    const fileContent = fs.readFileSync(result.canonicalPath, "utf-8");
    assert.strictEqual(fileContent, content);

    // Check artifact is retrievable
    const fetched = repos.artifacts.getById(result.artifact.artifact_id);
    assert.ok(fetched);
    assert.strictEqual(fetched.status, "current");
  });

  it("ingestArtifact archives previous current of same type", () => {
    // First ingestion
    const first = ingestArtifact({
      repos,
      basePath,
      artifactType: "linkedin",
      content: "LinkedIn profile v1",
      filename: "linkedin-v1.txt",
      sourceLabel: "First LinkedIn",
    });

    assert.strictEqual(first.artifact.status, "current");

    // Second ingestion of same type
    const second = ingestArtifact({
      repos,
      basePath,
      artifactType: "linkedin",
      content: "LinkedIn profile v2",
      filename: "linkedin-v2.txt",
      sourceLabel: "Updated LinkedIn",
    });

    assert.strictEqual(second.artifact.status, "current");
    assert.strictEqual(second.version.version_number, 1); // new artifact ID = fresh version count

    // Previous artifact should now be archived
    const previous = repos.artifacts.getById(first.artifact.artifact_id);
    assert.ok(previous);
    assert.strictEqual(previous.status, "archived");

    // Only one current LinkedIn
    const current = repos.artifacts.getCurrentByType("linkedin");
    assert.ok(current);
    assert.strictEqual(current.artifact_id, second.artifact.artifact_id);
    assert.strictEqual(current.status, "current");
  });

  it("ingestArtifact handles different types independently", () => {
    const resume = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content: "Resume content",
      filename: "resume-2.txt",
    });

    const website = ingestArtifact({
      repos,
      basePath,
      artifactType: "website",
      content: "Website content",
      filename: "website.txt",
    });

    assert.strictEqual(resume.artifact.status, "current");
    assert.strictEqual(website.artifact.status, "current");
    assert.notStrictEqual(resume.artifact.artifact_id, website.artifact.artifact_id);

    const resumeCurrent = repos.artifacts.getCurrentByType("resume");
    const websiteCurrent = repos.artifacts.getCurrentByType("website");
    assert.ok(resumeCurrent);
    assert.ok(websiteCurrent);
    assert.strictEqual(resumeCurrent.status, "current");
    assert.strictEqual(websiteCurrent.status, "current");
  });

  it("ingestArtifact records correct provenance", () => {
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "job_description",
      content: "Job: Senior Fullstack Developer",
      filename: "jd-senior.txt",
      sourceLabel: "Pasted from LinkedIn",
      provenanceSource: "user_paste",
    });

    assert.strictEqual(result.artifact.source_label, "Pasted from LinkedIn");
    assert.strictEqual(result.version.provenance_source, "user_paste");
  });

  it("listCurrentArtifacts returns only current-status artifacts", () => {
    // Ingest one artifact and verify it appears
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "github_profile",
      content: "GitHub: janedoe",
      filename: "github-profile.txt",
    });

    const current = listCurrentArtifacts(repos);
    assert.ok(current.length >= 1);

    const found = current.find((a) => a.artifact_id === result.artifact.artifact_id);
    assert.ok(found);
    assert.strictEqual(found.status, "current");
  });

  it("readCanonical returns artifact and file content", () => {
    const content = "Read canonical test content";
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content,
      filename: "read-test.txt",
    });

    const read = readCanonical(repos, result.artifact.artifact_id, basePath);
    assert.ok(read);
    assert.ok(read.artifact);
    assert.strictEqual(read.content, content);
  });

  it("readCanonical returns null for non-existent artifact", () => {
    const result = readCanonical(repos, "00000000-0000-0000-0000-000000000000", basePath);
    assert.strictEqual(result, null);
  });

  it("readCanonical returns content:null when file missing", () => {
    // Ingest, then delete the file manually
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "website",
      content: "Website content for deletion test",
      filename: "website-delete-test.txt",
    });

    // Remove the file from disk
    fs.unlinkSync(result.canonicalPath);

    const read = readCanonical(repos, result.artifact.artifact_id, basePath);
    assert.ok(read);
    assert.ok(read.artifact);
    assert.strictEqual(read.content, null);
  });

  it("deleteArtifact soft-deletes (status=archived)", () => {
    const content = "Artifact to be soft-deleted";
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "job_description",
      content,
      filename: "delete-test.txt",
    });

    // Verify file exists
    assert.ok(fs.existsSync(result.canonicalPath));

    // Soft delete
    const updated = deleteArtifact(repos, basePath, result.artifact.artifact_id);
    assert.ok(updated);
    assert.strictEqual(updated.status, "archived");

    // File should still exist (per D-09: provenance)
    assert.ok(
      fs.existsSync(result.canonicalPath),
      "Canonical file must be preserved after soft-delete (D-09)"
    );

    // Artifact should be archived
    const fetched = repos.artifacts.getById(result.artifact.artifact_id);
    assert.strictEqual(fetched.status, "archived");
  });

  it("deleteArtifact returns null for non-existent artifact", () => {
    const result = deleteArtifact(repos, basePath, "00000000-0000-0000-0000-000000000000");
    assert.strictEqual(result, null);
  });

  it("ingestArtifact throws for invalid artifact type", () => {
    assert.throws(
      () =>
        ingestArtifact({
          repos,
          basePath,
          artifactType: "invalid_type",
          content: "test",
          filename: "test.txt",
        }),
      /Unknown artifact type/
    );
  });

  it("ingestArtifact stores correct canonical_path (relative)", () => {
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content: "Canonical path test",
      filename: "canonical-test.txt",
    });

    const expectedRelative = path.join("artifacts", "resume", "canonical-test.txt");
    assert.strictEqual(result.artifact.canonical_path, expectedRelative);
  });
});
