/**
 * intake-update.test.js — INTAKE-01, MEM-01
 *
 * Integration tests for the compare-then-promote update flow:
 * digest comparison, update type detection, promoteUpdate,
 * stale evidence marking, bounded version history, conflict detection,
 * and the unified createIntakeModule interface.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const { createTestDb, createTestDirectory } = require("./helpers.js");
const { createRepositories } = require("../memory/repository.js");
const { randomUUID } = require("crypto");

const {
  ingestArtifact,
  ensureArtifactDirs,
  normalizeContent,
  computeDigest,
} = require("../intake/artifact-store.js");

const {
  compareDigests,
  detectUpdateType,
  promoteUpdate,
  flagConflicts,
} = require("../intake/compare-promote.js");

const { createIntakeModule } = require("../intake/index.js");

// ============================================================================
// compareDigests
// ============================================================================

describe("compareDigests", () => {
  it("returns changed:true when digests differ", () => {
    const result = compareDigests(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.isNormalizedChange, true);
  });

  it("returns changed:false when digests match", () => {
    const same = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const result = compareDigests(same, same);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.isNormalizedChange, false);
  });
});

// ============================================================================
// detectUpdateType
// ============================================================================

describe("detectUpdateType", () => {
  let harness, repos, basePath;
  let artifactId;
  const contentV1 = "Name: Jane Doe\nTitle: Senior Engineer\nYears: 8";

  before(() => {
    harness = createTestDb();
    repos = createRepositories(harness.db);
    basePath = createTestDirectory();
    ensureArtifactDirs(basePath);

    // Ingest initial artifact for comparison tests
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content: contentV1,
      filename: "detect-test-v1.txt",
      sourceLabel: "v1",
    });
    artifactId = result.artifact.artifact_id;
  });

  after(() => {
    harness.close();
  });

  it("returns 'new' for non-existent artifact ID", () => {
    const type = detectUpdateType({
      repos,
      artifactId: "00000000-0000-0000-0000-000000000000",
      newNormalizedDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    assert.strictEqual(type, "new");
  });

  it("returns 'unchanged' when normalized content is identical", () => {
    const normalized = normalizeContent(contentV1);
    const digest = computeDigest(normalized);

    const type = detectUpdateType({
      repos,
      artifactId,
      newNormalizedDigest: digest,
      newRawDigest: computeDigest(contentV1),
    });
    assert.strictEqual(type, "unchanged");
  });

  it("returns 'meaningful_update' when normalized content differs", () => {
    const newContent = "Name: Jane Doe\nTitle: Staff Engineer\nYears: 10";
    const normalized = normalizeContent(newContent);
    const digest = computeDigest(normalized);

    const type = detectUpdateType({
      repos,
      artifactId,
      newNormalizedDigest: digest,
    });
    assert.strictEqual(type, "meaningful_update");
  });

  it("returns 'minor_update' when only raw digest differs (formatting)", () => {
    // Same semantic content, different formatting (trailing spaces)
    const formattedContent = "Name: Jane Doe  \nTitle: Senior Engineer  \nYears: 8  ";
    const normalized = normalizeContent(formattedContent);
    const normalizedDigest = computeDigest(normalized);
    const rawDigest = computeDigest(formattedContent);

    const type = detectUpdateType({
      repos,
      artifactId,
      newNormalizedDigest: normalizedDigest,
      newRawDigest: rawDigest,
    });
    assert.strictEqual(type, "minor_update");
  });
});

// ============================================================================
// promoteUpdate — core flow
// ============================================================================

describe("promoteUpdate", () => {
  let harness, repos, basePath;

  before(() => {
    harness = createTestDb();
    repos = createRepositories(harness.db);
    basePath = createTestDirectory();
    ensureArtifactDirs(basePath);
  });

  after(() => {
    harness.close();
  });

  it("returns action:'unchanged' for identical content", () => {
    const content = "Static content no change";
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "website",
      content,
      filename: "unchanged-test.txt",
    });

    const update = promoteUpdate({
      repos,
      basePath,
      artifactId: result.artifact.artifact_id,
      newContent: content,
      newFilename: "unchanged-test.txt",
    });

    assert.strictEqual(update.action, "unchanged");
    assert.ok(update.reason.includes("normalized content matches"));
    assert.strictEqual(update.artifact.artifact_id, result.artifact.artifact_id);
  });

  it("promotes minor update (formatting-only change)", () => {
    const contentV1 = "Name: John Smith\nRole: Developer";
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "job_description",
      content: contentV1,
      filename: "minor-v1.txt",
    });

    // Same content with trailing spaces — formatting-only change
    const contentV2 = "Name: John Smith  \nRole: Developer  ";

    const update = promoteUpdate({
      repos,
      basePath,
      artifactId: result.artifact.artifact_id,
      newContent: contentV2,
      newFilename: "minor-v2.txt",
    });

    assert.strictEqual(update.action, "minor_update");
    assert.strictEqual(update.version.version_number, 2);
    assert.strictEqual(update.version.provenance_source, "update_flow");

    // Raw digest should differ
    assert.notStrictEqual(update.artifact.raw_digest, result.artifact.raw_digest);
    // Normalized digest should match
    assert.strictEqual(
      update.artifact.normalized_digest,
      result.artifact.normalized_digest
    );
  });

  it("promotes meaningful update — creates version, marks evidence stale", () => {
    const contentV1 = "Profile: Alice\nSkills: Python, SQL";
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content: contentV1,
      filename: "meaningful-v1.txt",
      sourceLabel: "Initial resume",
    });

    // Create an evidence summary linked to this artifact
    const evidenceId = randomUUID();
    const versionId = result.version.version_id;
    repos.evidence.create({
      summary_id: evidenceId,
      artifact_id: result.artifact.artifact_id,
      version_id: versionId,
      summary_type: "field_extraction",
      content: "Extracted: name=Alice, skills=Python, SQL",
      source_references: ["ref-1"],
      stale: false,
      created_at: new Date().toISOString(),
    });

    // Meaningful update
    const contentV2 = "Profile: Alice Chen\nSkills: Python, Rust, TypeScript";
    const update = promoteUpdate({
      repos,
      basePath,
      artifactId: result.artifact.artifact_id,
      newContent: contentV2,
      newFilename: "meaningful-v2.txt",
      updateContext: "Updated skills and added full name",
      goals: "Target senior backend roles",
    });

    assert.strictEqual(update.action, "meaningful_update");
    assert.strictEqual(update.version.version_number, 2);
    assert.strictEqual(update.version.provenance_source, "update_flow");
    assert.strictEqual(
      update.version.provenance_update_context,
      "Updated skills and added full name"
    );
    assert.strictEqual(update.version.provenance_goals, "Target senior backend roles");

    // Evidence should be marked stale
    const populatedSummary = repos.evidence.getById(evidenceId);
    assert.ok(populatedSummary);
    assert.strictEqual(populatedSummary.stale, 1);
    assert.strictEqual(populatedSummary.stale_reason, "artifact_version_superseded");
    assert.strictEqual(update.staleEvidenceCount, 1);
  });

  it("promotes meaningful update — supersedes previous version", () => {
    const contentV1 = "Project: Alpha";
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "github_profile",
      content: contentV1,
      filename: "supersedes-v1.txt",
    });

    const contentV2 = "Project: Beta";
    const update = promoteUpdate({
      repos,
      basePath,
      artifactId: result.artifact.artifact_id,
      newContent: contentV2,
      newFilename: "supersedes-v2.txt",
    });

    assert.strictEqual(update.action, "meaningful_update");
    assert.strictEqual(update.version.version_number, 2);

    // Version 2 should supersede version 1
    const v1 = repos.versions.getByVersionNumber(
      result.artifact.artifact_id,
      1
    );
    const v2 = repos.versions.getByVersionNumber(
      result.artifact.artifact_id,
      2
    );
    assert.ok(v2);
    // supersedes_version should reference the previous version
    assert.strictEqual(v2.supersedes_version, v1.version_id);
  });
});

// ============================================================================
// promoteUpdate — bounded version history (D-13)
// ============================================================================

describe("promoteUpdate — bounded version history", () => {
  let harness, repos, basePath;

  before(() => {
    harness = createTestDb();
    repos = createRepositories(harness.db);
    basePath = createTestDirectory();
    ensureArtifactDirs(basePath);
  });

  after(() => {
    harness.close();
  });

  it("archives versions beyond 5 for resume type", () => {
    // Ingest a resume
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content: "Resume v1",
      filename: "bounded-v1.txt",
    });

    const artId = result.artifact.artifact_id;

    // Create 7 versions total (6 more updates = 7 total)
    for (let i = 2; i <= 7; i++) {
      promoteUpdate({
        repos,
        basePath,
        artifactId: artId,
        newContent: `Resume v${i} — meaningful change`,
        newFilename: `bounded-v${i}.txt`,
      });
    }

    // Should have at most 5 versions remaining
    const allVersions = repos.versions.listByArtifact(artId);
    assert.ok(
      allVersions.length <= 5,
      `Expected <=5 versions, got ${allVersions.length}`
    );

    // The oldest versions (1, 2) should be deleted
    const v1 = repos.versions.getByVersionNumber(artId, 1);
    const v2 = repos.versions.getByVersionNumber(artId, 2);
    assert.strictEqual(v1, null, "Version 1 should be deleted (bounded history)");
    assert.strictEqual(v2, null, "Version 2 should be deleted (bounded history)");

    // Recent versions should still exist
    const v6 = repos.versions.getByVersionNumber(artId, 6);
    const v7 = repos.versions.getByVersionNumber(artId, 7);
    assert.ok(v6, "Version 6 should exist");
    assert.ok(v7, "Version 7 should exist");
  });

  it("does NOT bound versions for non-bounded types (website)", () => {
    const result = ingestArtifact({
      repos,
      basePath,
      artifactType: "website",
      content: "Website v1",
      filename: "website-nobound-v1.txt",
    });

    const artId = result.artifact.artifact_id;

    // Create 7 versions total
    for (let i = 2; i <= 7; i++) {
      promoteUpdate({
        repos,
        basePath,
        artifactId: artId,
        newContent: `Website v${i} — meaningful change`,
        newFilename: `website-nobound-v${i}.txt`,
      });
    }

    // Should keep all 7 versions (not bounded for website type)
    const allVersions = repos.versions.listByArtifact(artId);
    assert.strictEqual(
      allVersions.length,
      7,
      `Expected 7 versions for website (not bounded), got ${allVersions.length}`
    );
  });
});

// ============================================================================
// flagConflicts (D-10)
// ============================================================================

describe("flagConflicts", () => {
  let harness, repos, basePath;

  before(() => {
    harness = createTestDb();
    repos = createRepositories(harness.db);
    basePath = createTestDirectory();
    ensureArtifactDirs(basePath);
  });

  after(() => {
    harness.close();
  });

  it("returns no conflict for non-existent artifact", () => {
    const result = flagConflicts({
      repos,
      artifactId: "00000000-0000-0000-0000-000000000000",
      newContent: "anything",
    });
    assert.strictEqual(result.hasConflict, false);
  });

  it("returns no conflict when no evidence summaries exist", () => {
    const ingest = ingestArtifact({
      repos,
      basePath,
      artifactType: "job_description",
      content: "Job: CTO",
      filename: "conflict-none.txt",
    });

    const result = flagConflicts({
      repos,
      artifactId: ingest.artifact.artifact_id,
      newContent: "Job: VP Engineering",
    });
    assert.strictEqual(result.hasConflict, false);
    assert.ok(result.suggestion.includes("No active evidence summaries"));
  });

  it("returns no conflict when content is unchanged", () => {
    const content = "Same content for test";
    const ingest = ingestArtifact({
      repos,
      basePath,
      artifactType: "resume",
      content,
      filename: "conflict-same.txt",
    });

    // Create an evidence summary
    repos.evidence.create({
      summary_id: randomUUID(),
      artifact_id: ingest.artifact.artifact_id,
      version_id: ingest.version.version_id,
      summary_type: "signal_assessment",
      content: "Signal assessment: strong",
      source_references: ["ref-1"],
      stale: false,
      created_at: new Date().toISOString(),
    });

    const result = flagConflicts({
      repos,
      artifactId: ingest.artifact.artifact_id,
      newContent: content, // Same content
    });
    assert.strictEqual(result.hasConflict, false);
  });

  it("detects conflicts with non-stale evidence summaries", () => {
    const contentV1 = "Profile: Bob";
    const ingest = ingestArtifact({
      repos,
      basePath,
      artifactType: "linkedin",
      content: contentV1,
      filename: "conflict-yes.txt",
    });

    // Create fresh evidence summary
    repos.evidence.create({
      summary_id: randomUUID(),
      artifact_id: ingest.artifact.artifact_id,
      version_id: ingest.version.version_id,
      summary_type: "field_extraction",
      content: "Extracted: name=Bob",
      source_references: ["ref-1"],
      stale: false,
      created_at: new Date().toISOString(),
    });

    // Different content
    const result = flagConflicts({
      repos,
      artifactId: ingest.artifact.artifact_id,
      newContent: "Profile: Bob Smith",
    });

    assert.strictEqual(result.hasConflict, true);
    assert.ok(result.conflictingSummaries.length >= 1);
    assert.ok(result.suggestion.includes("active evidence summary"));
  });
});

// ============================================================================
// createIntakeModule — unified interface
// ============================================================================

describe("createIntakeModule", () => {
  let harness;

  after(() => {
    if (harness) harness.close();
  });

  it("returns expected unified interface", () => {
    harness = createTestDb();
    const basePath = createTestDirectory();

    const intake = createIntakeModule({
      db: harness.db,
      basePath,
    });

    // Check all expected methods exist
    assert.strictEqual(typeof intake.ingest, "function");
    assert.strictEqual(typeof intake.update, "function");
    assert.strictEqual(typeof intake.compare, "function");
    assert.strictEqual(typeof intake.flagConflicts, "function");
    assert.strictEqual(typeof intake.getCurrentArtifacts, "function");
    assert.strictEqual(typeof intake.readArtifact, "function");
    assert.strictEqual(typeof intake.deleteArtifact, "function");
    assert.ok(intake.repos);
    assert.ok(intake.repos.artifacts);
    assert.ok(intake.repos.versions);
    assert.ok(intake.repos.evidence);
    assert.ok(intake.repos.relationships);
  });

  it("can ingest and update via the unified interface", () => {
    harness = createTestDb();
    const basePath = createTestDirectory();
    const intake = createIntakeModule({ db: harness.db, basePath });

    // Ingest
    const ingested = intake.ingest({
      artifactType: "resume",
      content: "Resume via intake module",
      filename: "module-test.txt",
      sourceLabel: "Test ingestion",
    });

    assert.ok(ingested.artifact);
    assert.strictEqual(ingested.artifact.artifact_type, "resume");
    assert.strictEqual(ingested.version.version_number, 1);

    // Update
    const updated = intake.update({
      artifactId: ingested.artifact.artifact_id,
      newContent: "Resume via intake module — updated",
      newFilename: "module-test-v2.txt",
      updateContext: "Added details",
    });

    assert.strictEqual(updated.action, "meaningful_update");
    assert.strictEqual(updated.version.version_number, 2);

    // List current artifacts
    const current = intake.getCurrentArtifacts();
    assert.ok(current.length >= 1);

    // Read artifact
    const read = intake.readArtifact(ingested.artifact.artifact_id);
    assert.ok(read);
    assert.ok(read.artifact);

    // Compare
    const compareResult = intake.compare(
      ingested.artifact.artifact_id,
      "Resume via intake module — updated"
    );
    assert.strictEqual(compareResult, "unchanged");
  });

  it("throws when db is missing", () => {
    assert.throws(
      () => createIntakeModule({ db: null, basePath: "/tmp" }),
      /db is required/
    );
  });

  it("throws when basePath is missing", () => {
    harness = createTestDb();
    assert.throws(
      () => createIntakeModule({ db: harness.db, basePath: null }),
      /basePath is required/
    );
  });
});
