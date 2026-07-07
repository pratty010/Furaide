import { test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { openDb } from "../../src/store/db.js";
import { insertEvent, upsertOutcomeLabel } from "../../src/store/repo.js";
import { mineNgrams, generateCandidates } from "../../src/mine/mine.js";

// Fixture: three sessions each run the same 3-tool sequence once, giving the
// n-gram "Read>Edit>Bash" frequency=3 (one occurrence per session) and
// sessionCount=3. Two sessions are labeled success, one failure — Task 5.1
// Step 1's "one workflow_ngrams row with frequency=3, success_count=2,
// failure_count=1" fixture.
function seedFixture(dbPath: string) {
  rmSync(dbPath, { force: true });
  const db = openDb(dbPath);

  const sessions = ["sess-1", "sess-2", "sess-3"];
  const tools = ["Read", "Edit", "Bash"];

  sessions.forEach((sessionId, si) => {
    tools.forEach((toolName, ti) => {
      const ts = `2026-07-06T10:0${si}:0${ti}.000Z`;
      insertEvent(db, {
        event_id: `${sessionId}-${ti}`,
        schema_version: 1,
        source_id: `cc:proj/${sessionId}`,
        source_position: ti,
        observed_at: ts,
        ingested_at: ts,
        harness: "claude_code",
        event_type: "tool.called",
        payload_version: 1,
        payload: {
          session_id: sessionId,
          turn_index: ti,
          tool_name: toolName,
          tool_use_id: `${sessionId}-toolu-${ti}`,
          args_present: true,
          ts,
        },
      });
    });
  });

  upsertOutcomeLabel(db, {
    session_id: "sess-1",
    segment_key: "session",
    label: "success",
    tier: "deterministic",
  });
  upsertOutcomeLabel(db, {
    session_id: "sess-2",
    segment_key: "session",
    label: "success",
    tier: "deterministic",
  });
  upsertOutcomeLabel(db, {
    session_id: "sess-3",
    segment_key: "session",
    label: "failure",
    tier: "deterministic",
  });

  return db;
}

test("mineNgrams persists a workflow_ngrams row with frequency/success/failure split", () => {
  const dbPath = "/tmp/idisu-mine-test-basic.sqlite";
  const db = seedFixture(dbPath);

  const result = mineNgrams(db, { min: 2, n: 3 });
  expect(result.ngramsPersisted).toBeGreaterThan(0);

  const row = db
    .query("SELECT * FROM workflow_ngrams WHERE signature=?")
    .get("Read>Edit>Bash") as {
    signature: string;
    n: number;
    frequency: number;
    success_count: number;
    failure_count: number;
    sample_sessions: string;
    last_seen: string;
  } | null;

  expect(row).toBeTruthy();
  expect(row?.n).toBe(3);
  expect(row?.frequency).toBe(3);
  expect(row?.success_count).toBe(2);
  expect(row?.failure_count).toBe(1);
  expect(JSON.parse(row?.sample_sessions ?? "[]").length).toBeGreaterThan(0);
  expect(row?.last_seen).toBeTruthy();

  db.close();
  rmSync(dbPath, { force: true });
});

test("mineNgrams does not count unknown/abandoned sessions toward success or failure", () => {
  const dbPath = "/tmp/idisu-mine-test-unknown.sqlite";
  rmSync(dbPath, { force: true });
  const db = openDb(dbPath);

  const sessions = ["sess-x", "sess-y"];
  const tools = ["Grep", "Read"];
  sessions.forEach((sessionId, si) => {
    tools.forEach((toolName, ti) => {
      const ts = `2026-07-06T11:0${si}:0${ti}.000Z`;
      insertEvent(db, {
        event_id: `${sessionId}-${ti}`,
        schema_version: 1,
        source_id: `cc:proj/${sessionId}`,
        source_position: ti,
        observed_at: ts,
        ingested_at: ts,
        harness: "claude_code",
        event_type: "tool.called",
        payload_version: 1,
        payload: {
          session_id: sessionId,
          turn_index: ti,
          tool_name: toolName,
          tool_use_id: `${sessionId}-toolu-${ti}`,
          args_present: true,
          ts,
        },
      });
    });
  });

  upsertOutcomeLabel(db, {
    session_id: "sess-x",
    segment_key: "session",
    label: "unknown",
    tier: "deterministic",
  });
  upsertOutcomeLabel(db, {
    session_id: "sess-y",
    segment_key: "session",
    label: "abandoned",
    tier: "deterministic",
  });

  mineNgrams(db, { min: 2, n: 2 });

  const row = db
    .query("SELECT * FROM workflow_ngrams WHERE signature=?")
    .get("Grep>Read") as {
    frequency: number;
    success_count: number;
    failure_count: number;
  } | null;

  expect(row).toBeTruthy();
  expect(row?.frequency).toBe(2);
  expect(row?.success_count).toBe(0);
  expect(row?.failure_count).toBe(0);

  db.close();
  rmSync(dbPath, { force: true });
});

// Task 5.2 — candidate generation + FTS overlap suppression

test("generateCandidates emits one candidate for an n-gram clearing all thresholds", () => {
  const dbPath = "/tmp/idisu-mine-test-candidate-basic.sqlite";
  const db = seedFixture(dbPath);

  mineNgrams(db, { min: 2, n: 3 });
  // Fixture gives "Read>Edit>Bash" frequency=3, 3 sessions, success_count=2 —
  // clears the default thresholds (frequency>=3, >=2 sessions, >=1 success).
  const candidates = generateCandidates(db, {
    minRepetition: 3,
    minSessions: 2,
    minSuccesses: 1,
  });

  expect(candidates.length).toBe(1);
  const candidate = candidates[0]!;
  expect(candidate.signature).toBe("Read>Edit>Bash");
  expect(candidate.frequency).toBe(3);
  expect(candidate.successCount).toBe(2);
  expect(candidate.failureCount).toBe(1);
  expect(candidate.sampleSessions.length).toBeGreaterThanOrEqual(2);
  expect(candidate.closestSkills).toEqual([]);

  db.close();
  rmSync(dbPath, { force: true });
});

test("generateCandidates yields zero candidates when the signature is already rejected", () => {
  const dbPath = "/tmp/idisu-mine-test-candidate-rejected.sqlite";
  const db = seedFixture(dbPath);

  mineNgrams(db, { min: 2, n: 3 });
  db.query(
    `INSERT INTO rejected_signatures (signature, reason, rejected_at) VALUES (?, ?, ?)`,
  ).run("Read>Edit>Bash", "not useful", new Date().toISOString());

  const candidates = generateCandidates(db, {
    minRepetition: 3,
    minSessions: 2,
    minSuccesses: 1,
  });

  expect(candidates.length).toBe(0);

  db.close();
  rmSync(dbPath, { force: true });
});

test("generateCandidates suppresses a candidate whose FTS overlap with an existing artifact is above threshold", () => {
  const dbPath = "/tmp/idisu-mine-test-candidate-overlap.sqlite";
  const db = seedFixture(dbPath);

  mineNgrams(db, { min: 2, n: 3 });

  // Manually insert a fake pre-existing artifact whose indexed text closely
  // matches the candidate's signature tokens — Phase 6 (not yet built) is
  // what would populate `artifacts`/`artifacts_fts` for real; this fixture
  // exercises the suppression path against a synthetic row.
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO artifacts (id, type, origin, surface_path, state, signature, created_at)
     VALUES (?, 'skill', 'preexisting', ?, 'active', ?, ?)`,
  ).run("artifact-1", "skills/read-edit-bash.md", "Read>Edit>Bash", now);
  db.query(`INSERT INTO artifacts_fts (artifact_id, text) VALUES (?, ?)`).run(
    "artifact-1",
    "Read Edit Bash workflow for editing files",
  );

  const candidates = generateCandidates(db, {
    minRepetition: 3,
    minSessions: 2,
    minSuccesses: 1,
    // A generous ceiling guarantees the close synthetic match above trips
    // suppression regardless of the exact bm25 score sqlite computes.
    overlapBm25Max: 100,
  });

  expect(candidates.length).toBe(0);

  db.close();
  rmSync(dbPath, { force: true });
});

test("generateCandidates keeps below-threshold FTS matches as informational closestSkills", () => {
  const dbPath = "/tmp/idisu-mine-test-candidate-closest.sqlite";
  const db = seedFixture(dbPath);

  mineNgrams(db, { min: 2, n: 3 });

  const now = new Date().toISOString();
  db.query(
    `INSERT INTO artifacts (id, type, origin, surface_path, state, signature, created_at)
     VALUES (?, 'skill', 'preexisting', ?, 'active', ?, ?)`,
  ).run("artifact-2", "skills/read-edit-bash.md", "Read>Edit>Bash", now);
  db.query(`INSERT INTO artifacts_fts (artifact_id, text) VALUES (?, ?)`).run(
    "artifact-2",
    "Read Edit Bash workflow for editing files",
  );

  // A near-zero ceiling means the synthetic match never crosses the
  // suppression threshold, so it should surface as an informational hint.
  const candidates = generateCandidates(db, {
    minRepetition: 3,
    minSessions: 2,
    minSuccesses: 1,
    overlapBm25Max: -1000,
  });

  expect(candidates.length).toBe(1);
  expect(candidates[0]!.closestSkills).toContain("skills/read-edit-bash.md");

  db.close();
  rmSync(dbPath, { force: true });
});
