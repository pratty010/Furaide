const { describe, it } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("crypto");

const { createRepositories } = require("../memory/repository.js");
const { createSnapshot, getSnapshotHistory, getLatestSnapshot } = require("../snapshots/persist.js");
const { createTestDb, SAMPLE_ARTIFACT, SAMPLE_ARTIFACT_VERSION } = require("./helpers.js");

describe("snapshot persistence", () => {
  it("creates snapshot and retrieves latest", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const artifactId = randomUUID();
    const versionId = randomUUID();
    repos.artifacts.upsert({ ...SAMPLE_ARTIFACT, artifact_id: artifactId });
    repos.versions.create({ ...SAMPLE_ARTIFACT_VERSION, version_id: versionId, artifact_id: artifactId });

    const created = createSnapshot({
      repos,
      triggerReason: "manual_request",
      profileState: JSON.stringify({ note: "baseline" }),
      dimensionSummary: { signal: 60, evidence: 50, visibility: 40, narrative: 70 },
      confidence: "medium",
      artifactVersionIds: [versionId],
    });

    const latest = getLatestSnapshot({ repos });
    assert.ok(latest);
    assert.strictEqual(latest.snapshot_id, created.snapshot_id);
    close();
  });

  it("returns bounded history with artifact version count", () => {
    const { db, close } = createTestDb();
    const repos = createRepositories(db);

    const artifactId = randomUUID();
    repos.artifacts.upsert({ ...SAMPLE_ARTIFACT, artifact_id: artifactId });

    const versions = [randomUUID(), randomUUID(), randomUUID()];
    versions.forEach((versionId, idx) => {
      repos.versions.create({ ...SAMPLE_ARTIFACT_VERSION, version_id: versionId, artifact_id: artifactId, version_number: idx + 1 });
      createSnapshot({
        repos,
        triggerReason: "artifact_update",
        profileState: JSON.stringify({ idx }),
        dimensionSummary: { signal: 50 + idx, evidence: 50, visibility: 50, narrative: 50 },
        confidence: "medium",
        artifactVersionIds: [versionId],
      });
    });

    const history = getSnapshotHistory({ repos, limit: 2 });
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].artifact_version_count, 1);
    close();
  });
});
