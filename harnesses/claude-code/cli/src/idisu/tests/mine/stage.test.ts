import { test, expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { openDb } from "../../src/store/db.js";
import { stageCandidate } from "../../src/mine/stage.js";
import type { Candidate } from "../../src/mine/mine.js";

const PENDING_DIR = "/tmp/idisu-stage-test-pending";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    signature: "Read>Edit>Bash",
    frequency: 3,
    successCount: 2,
    failureCount: 1,
    sampleSessions: ["sess-1", "sess-2", "sess-3"],
    closestSkills: [],
    ...overrides,
  };
}

test("stageCandidate writes draft.md and evidence.md and registers an artifacts row", () => {
  const dbPath = "/tmp/idisu-stage-test-basic.sqlite";
  rmSync(dbPath, { force: true });
  rmSync(PENDING_DIR, { force: true, recursive: true });
  const db = openDb(dbPath);

  const candidate = makeCandidate();
  const result = stageCandidate(db, candidate, { pendingDir: PENDING_DIR });

  expect(result.skipped).toBe(false);
  expect(existsSync(result.draftPath)).toBe(true);
  expect(existsSync(result.evidencePath)).toBe(true);

  const draft = readFileSync(result.draftPath, "utf8");
  expect(draft).toContain("Read>Edit>Bash");
  expect(draft).toContain("UNAUTHORED");

  const evidence = readFileSync(result.evidencePath, "utf8");
  expect(evidence).toContain("Successes: 2");
  expect(evidence).toContain("Failures: 1");
  expect(evidence).toContain("sess-1");
  expect(evidence).toContain("sess-2");
  expect(evidence).toContain("sess-3");

  const artifactRow = db
    .query("SELECT * FROM artifacts WHERE signature=?")
    .get("Read>Edit>Bash") as {
    id: string;
    state: string;
    origin: string;
    surface_path: string;
  } | null;

  expect(artifactRow).toBeTruthy();
  expect(artifactRow?.state).toBe("staged");
  expect(artifactRow?.origin).toBe("mined");
  expect(artifactRow?.id).toBe(result.id);
  expect(artifactRow?.surface_path).toBe(result.draftPath);

  const nodeRow = db
    .query("SELECT * FROM nodes WHERE id=?")
    .get(result.id) as { type: string } | null;
  expect(nodeRow?.type).toBe("artifact");

  const sessionNodes = db
    .query("SELECT COUNT(*) c FROM nodes WHERE type='session'")
    .get() as { c: number };
  expect(sessionNodes.c).toBe(3);

  const edges = db
    .query("SELECT * FROM edges WHERE src=?")
    .all(result.id) as Array<{ dst: string; type: string }>;
  expect(edges.length).toBe(3);
  expect(edges.every((e) => e.type === "evidenced_by")).toBe(true);

  db.close();
  rmSync(dbPath, { force: true });
  rmSync(PENDING_DIR, { force: true, recursive: true });
});

test("stageCandidate skips re-staging a signature that already has an active artifact", () => {
  const dbPath = "/tmp/idisu-stage-test-duplicate.sqlite";
  rmSync(dbPath, { force: true });
  rmSync(PENDING_DIR, { force: true, recursive: true });
  const db = openDb(dbPath);

  const candidate = makeCandidate();
  const first = stageCandidate(db, candidate, { pendingDir: PENDING_DIR });
  expect(first.skipped).toBe(false);

  const second = stageCandidate(db, candidate, { pendingDir: PENDING_DIR });
  expect(second.skipped).toBe(true);
  expect(second.id).toBe(first.id);

  const count = (
    db.query("SELECT COUNT(*) c FROM artifacts WHERE signature=?").get(
      "Read>Edit>Bash",
    ) as { c: number }
  ).c;
  expect(count).toBe(1);

  db.close();
  rmSync(dbPath, { force: true });
  rmSync(PENDING_DIR, { force: true, recursive: true });
});
