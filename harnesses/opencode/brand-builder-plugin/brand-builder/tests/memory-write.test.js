const { describe, it } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("crypto");

const { createRepositories } = require("../memory/repository.js");
const { createTestDb, SAMPLE_ARTIFACT, SAMPLE_ARTIFACT_VERSION, SAMPLE_EVIDENCE_SUMMARY } = require("./helpers.js");

describe("memory repository persistence", () => {
  it("writes and reads evidence summaries through repository", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const artifactId = randomUUID();
    const versionId = randomUUID();
    repos.artifacts.upsert({ ...SAMPLE_ARTIFACT, artifact_id: artifactId });
    repos.versions.create({ ...SAMPLE_ARTIFACT_VERSION, version_id: versionId, artifact_id: artifactId });

    const summaryId = randomUUID();
    repos.evidence.create({
      ...SAMPLE_EVIDENCE_SUMMARY,
      summary_id: summaryId,
      artifact_id: artifactId,
      version_id: versionId,
      workflow_domain: "assessment",
    });

    const listed = repos.evidence.listByArtifact(artifactId);
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].summary_id, summaryId);

    close();
  });

  it("marks evidence stale via repository", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const artifactId = randomUUID();
    const versionId = randomUUID();
    repos.artifacts.upsert({ ...SAMPLE_ARTIFACT, artifact_id: artifactId });
    repos.versions.create({ ...SAMPLE_ARTIFACT_VERSION, version_id: versionId, artifact_id: artifactId });

    const summaryId = randomUUID();
    repos.evidence.create({
      ...SAMPLE_EVIDENCE_SUMMARY,
      summary_id: summaryId,
      artifact_id: artifactId,
      version_id: versionId,
    });

    const updated = repos.evidence.markStale(summaryId, "artifact update");
    assert.ok(updated.stale === 1 || updated.stale === true);

    const stale = repos.evidence.listStale();
    assert.strictEqual(stale.length, 1);
    close();
  });
});
