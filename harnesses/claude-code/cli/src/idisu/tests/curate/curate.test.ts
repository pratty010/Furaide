import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { runCurate } from "../../src/curate/curate.js";
import { openDb } from "../../src/store/db.js";
import {
  type ArtifactRow,
  type EventRow,
  getArtifactById,
  insertArtifact,
  insertEvent,
  upsertEvidenceLedger,
} from "../../src/store/repo.js";
import { makeTypedEvent } from "../../src/types/events.js";

// Phase 6 (Approve/Promote/Track/Curate, Task 6.4) — Curate stage tests.
// Curate is a *proposals-only* stage: it surfaces stale/deprecate/overlap
// proposals into the review queue (mirroring how `mine/stage.ts` stages
// mined candidates) and moves already-rejected/deprecated artifacts to
// `archive/`. NOTHING is hard-deleted.

const dbPath = "/tmp/idisu-curate-test.sqlite";
const pendingDir = "/tmp/idisu-curate-test-pending";
const archiveDir = "/tmp/idisu-curate-test-archive";

function toRow(ev: ReturnType<typeof makeTypedEvent>): EventRow {
  return {
    event_id: ev.event_id,
    schema_version: ev.schema_version,
    source_id: ev.source_id,
    source_position: ev.source_position,
    observed_at: ev.observed_at,
    ingested_at: ev.ingested_at,
    harness: ev.harness,
    event_type: ev.event_type,
    payload_version: ev.payload_version,
    payload: ev.payload,
  };
}

function cleanup() {
  rmSync(dbPath, { force: true });
  rmSync(pendingDir, { force: true, recursive: true });
  rmSync(archiveDir, { force: true, recursive: true });
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
}

beforeEach(cleanup);
afterEach(cleanup);

function countProposals(db: ReturnType<typeof openDb>): number {
  return (
    db
      .query(
        "SELECT COUNT(*) c FROM artifacts WHERE type='instruction_edit' AND state='staged'",
      )
      .get() as { c: number }
  ).c;
}

test("evidence_ledger score <= 0 on an active artifact -> deprecation proposal staged; original artifact untouched", () => {
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  insertArtifact(db, {
    id: "loser-skill",
    type: "skill",
    origin: "preexisting",
    surface_path: "/tmp/never-mind/skill.md",
    state: "active",
    signature: null,
    created_at: now,
  });
  // score=-5: heavily net-negative ledger. Plan threshold is `score <= 0`.
  upsertEvidenceLedger(
    db,
    "loser-skill",
    { applied: 5, win: 1, loss: 6, score: -5 },
    now,
  );

  const result = runCurate(db, { pendingDir, archiveDir });
  expect(result.deprecationProposals).toBe(1);
  expect(result.staleProposals).toBe(0);
  expect(result.mergeProposals).toBe(0);
  expect(result.archived).toBe(0);

  // Original artifact unchanged: still active, still not deprecated.
  const orig = getArtifactById(db, "loser-skill");
  expect(orig?.state).toBe("active");
  expect(orig?.deprecated_at).toBeNull();

  // A proposal was staged as a new artifacts row.
  expect(countProposals(db)).toBe(1);
  const proposal = db
    .query(
      "SELECT * FROM artifacts WHERE type='instruction_edit' AND state='staged'",
    )
    .get() as ArtifactRow;
  expect(proposal.signature).toBe("curate:deprecate:loser-skill");
  expect(proposal.origin).toBe("mined");
  expect(proposal.surface_path).toBeTruthy();
  expect(existsSync(proposal.surface_path!)).toBe(true);

  // The draft describes the target + reason so a reviewer can decide.
  const draft = readFileSync(proposal.surface_path!, "utf8");
  expect(draft).toContain("loser-skill");
  expect(draft.toLowerCase()).toContain("deprecat");
  expect(draft).toContain("-5");

  db.close();
});

test("active artifact with zero capability.invoked hits -> stale proposal staged; original artifact untouched", () => {
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  insertArtifact(db, {
    id: "unused-skill",
    type: "skill",
    origin: "preexisting",
    surface_path: "/tmp/never-mind/unused.md",
    state: "active",
    signature: null,
    created_at: now,
  });
  // No events inserted, no ledger row — "never invoked" case.

  const result = runCurate(db, { pendingDir, archiveDir });
  expect(result.staleProposals).toBe(1);
  expect(result.deprecationProposals).toBe(0);

  const orig = getArtifactById(db, "unused-skill");
  expect(orig?.state).toBe("active");
  expect(orig?.deprecated_at).toBeNull();

  expect(countProposals(db)).toBe(1);
  const proposal = db
    .query(
      "SELECT * FROM artifacts WHERE type='instruction_edit' AND state='staged'",
    )
    .get() as ArtifactRow;
  expect(proposal.signature).toBe("curate:stale:unused-skill");
  const draft = readFileSync(proposal.surface_path!, "utf8");
  expect(draft).toContain("unused-skill");
  expect(draft.toLowerCase()).toContain("stale");

  db.close();
});

test("active artifact with capability.invoked hits where trigger != 'chain' still counts as 'no chain hits' for staleness", () => {
  // The ExpeL evidence-ledger wiring only consumes chain-triggered
  // `capability.invoked` events (see track/ledger.ts#updateEvidenceLedger);
  // curate's staleness check uses the same definition of "hit" so a
  // user-triggered or model-triggered invocation alone is NOT enough to
  // count an artifact as "in active use" for the propose-deprecate decision.
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  insertArtifact(db, {
    id: "user-only-skill",
    type: "skill",
    origin: "preexisting",
    surface_path: "/tmp/never-mind/user-only.md",
    state: "active",
    signature: null,
    created_at: now,
  });
  // Non-chain invocation: shouldn't count.
  const userTriggered = makeTypedEvent(
    "capability.invoked",
    "cc:p/sx",
    "0:attribution",
    "claude_code",
    {
      session_id: "sx",
      turn_index: 0,
      capability_id: "user-only-skill",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "user",
      observability_level: "observed",
      confidence: 1.0,
    },
  );
  insertEvent(db, toRow(userTriggered));

  const result = runCurate(db, { pendingDir, archiveDir });
  expect(result.staleProposals).toBe(1);

  db.close();
});

test("two active artifacts with high token overlap -> merge proposal staged; both originals untouched", () => {
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  // Two near-duplicate SKILL.md files. Jaccard token overlap is high.
  const pathA = "/tmp/idisu-curate-test-skill-a.md";
  const pathB = "/tmp/idisu-curate-test-skill-b.md";
  const textA =
    "When reviewing code, read the file first then identify the diff hunks and check each hunk for correctness against the surrounding context.";
  const textB =
    "When reviewing code, read the file first then identify the diff hunks and check each hunk for correctness against the surrounding patterns.";
  writeFileSync(pathA, textA);
  writeFileSync(pathB, textB);
  insertArtifact(db, {
    id: "review-a",
    type: "skill",
    origin: "preexisting",
    surface_path: pathA,
    state: "active",
    signature: null,
    created_at: now,
  });
  insertArtifact(db, {
    id: "review-b",
    type: "skill",
    origin: "preexisting",
    surface_path: pathB,
    state: "active",
    signature: null,
    created_at: now,
  });

  // Give each artifact at least one chain-triggered capability.invoked
  // hit, so the staleness pass leaves them alone — we want to test the
  // merge pass in isolation, not coupled with the staleness one.
  for (const id of ["review-a", "review-b"]) {
    const ev = makeTypedEvent(
      "capability.invoked",
      `cc:p/seed-${id}`,
      "0:attribution",
      "claude_code",
      {
        session_id: `seed-${id}`,
        turn_index: 0,
        capability_id: id,
        capability_type: "skill",
        harness: "claude_code",
        trigger: "chain",
        observability_level: "observed",
        confidence: 1.0,
      },
    );
    insertEvent(db, toRow(ev));
  }

  const result = runCurate(db, {
    pendingDir,
    archiveDir,
    mergeOverlapThreshold: 0.6,
  });
  expect(result.mergeProposals).toBe(1);
  expect(result.deprecationProposals).toBe(0);
  expect(result.staleProposals).toBe(0);

  // Both originals untouched.
  expect(getArtifactById(db, "review-a")?.state).toBe("active");
  expect(getArtifactById(db, "review-b")?.state).toBe("active");

  // Exactly one merge proposal.
  expect(countProposals(db)).toBe(1);
  const proposal = db
    .query(
      "SELECT * FROM artifacts WHERE type='instruction_edit' AND state='staged'",
    )
    .get() as ArtifactRow;
  // Signature includes both ids, sorted deterministically so re-runs (and
  // pair iteration order) don't fragment the dedup key. Format is
  // `curate:merge:<idA>:<idB>` (all-`:` separator; matches
  // `curate:deprecate:<id>` / `curate:stale:<id>` and avoids a
  // within-id `+` ambiguity).
  expect(proposal.signature).toBe("curate:merge:review-a:review-b");
  const draft = readFileSync(proposal.surface_path!, "utf8");
  expect(draft).toContain("review-a");
  expect(draft).toContain("review-b");
  // The actual measured ratio should be in the draft for the reviewer.
  expect(draft).toMatch(/overlap[^\n]*=\s*`?0?\.\d+/i);

  db.close();
});

test("two active artifacts with low token overlap -> no merge proposal", () => {
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  const pathA = "/tmp/idisu-curate-test-low-a.md";
  const pathB = "/tmp/idisu-curate-test-low-b.md";
  writeFileSync(pathA, "alpha bravo charlie delta echo foxtrot golf hotel india");
  writeFileSync(pathB, "juliet kilo lima mike november oscar papa quebec romeo");
  insertArtifact(db, {
    id: "low-a",
    type: "skill",
    origin: "preexisting",
    surface_path: pathA,
    state: "active",
    signature: null,
    created_at: now,
  });
  insertArtifact(db, {
    id: "low-b",
    type: "skill",
    origin: "preexisting",
    surface_path: pathB,
    state: "active",
    signature: null,
    created_at: now,
  });

  const result = runCurate(db, {
    pendingDir,
    archiveDir,
    mergeOverlapThreshold: 0.6,
  });
  expect(result.mergeProposals).toBe(0);

  db.close();
});

test("re-run is idempotent: proposals are not duplicated", () => {
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  insertArtifact(db, {
    id: "loser-skill",
    type: "skill",
    origin: "preexisting",
    surface_path: "/tmp/never-mind/skill.md",
    state: "active",
    signature: null,
    created_at: now,
  });
  upsertEvidenceLedger(
    db,
    "loser-skill",
    { applied: 5, win: 1, loss: 6, score: -5 },
    now,
  );

  const first = runCurate(db, { pendingDir, archiveDir });
  expect(first.deprecationProposals).toBe(1);
  expect(countProposals(db)).toBe(1);

  const second = runCurate(db, { pendingDir, archiveDir });
  expect(second.deprecationProposals).toBe(0);
  expect(countProposals(db)).toBe(1);

  db.close();
});

test("an artifact that qualifies for both deprecation AND staleness only emits the deprecation proposal (severity ordering)", () => {
  // score<=0 + zero hits: deprecation is the more urgent signal. The
  // reviewer doesn't need a second stale flag to make the call.
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  insertArtifact(db, {
    id: "doomed",
    type: "skill",
    origin: "preexisting",
    surface_path: "/tmp/never-mind/doomed.md",
    state: "active",
    signature: null,
    created_at: now,
  });
  upsertEvidenceLedger(
    db,
    "doomed",
    { applied: 3, win: 0, loss: 3, score: -3 },
    now,
  );

  const result = runCurate(db, { pendingDir, archiveDir });
  expect(result.deprecationProposals).toBe(1);
  expect(result.staleProposals).toBe(0);
  expect(countProposals(db)).toBe(1);

  const proposal = db
    .query(
      "SELECT * FROM artifacts WHERE type='instruction_edit' AND state='staged'",
    )
    .get() as ArtifactRow;
  expect(proposal.signature).toBe("curate:deprecate:doomed");

  db.close();
});

test("rejected artifact with surface_path still in pending/ -> moved to archive/, surface_path updated, no files deleted", () => {
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  const id = "rejected-skill";
  const origDir = join(pendingDir, id);
  mkdirSync(origDir, { recursive: true });
  const origDraft = join(origDir, "draft.md");
  writeFileSync(origDraft, "# rejected draft content\n");

  insertArtifact(db, {
    id,
    type: "skill",
    origin: "mined",
    surface_path: origDraft,
    state: "rejected",
    signature: "Read>Edit>Bash",
    created_at: now,
  });

  const result = runCurate(db, { pendingDir, archiveDir });
  expect(result.archived).toBe(1);

  // Old location is gone.
  expect(existsSync(origDraft)).toBe(false);
  expect(existsSync(origDir)).toBe(false);

  // New location exists in archive/, content preserved verbatim.
  const archivedDraft = join(archiveDir, id, "draft.md");
  expect(existsSync(archivedDraft)).toBe(true);
  expect(readFileSync(archivedDraft, "utf8")).toContain(
    "rejected draft content",
  );

  // surface_path is rewritten to point at the archived copy; the row is
  // preserved (no delete) — same "invalidate-never-delete" guarantee as
  // cli/commands/reject.ts.
  const row = getArtifactById(db, id);
  expect(row?.surface_path).toBe(archivedDraft);
  expect(row?.state).toBe("rejected");

  db.close();
});

test("rejected artifact whose surface_path is already under archive/ is not moved again", () => {
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  const id = "already-archived";
  const archivedDir = join(archiveDir, id);
  mkdirSync(archivedDir, { recursive: true });
  const archivedDraft = join(archivedDir, "draft.md");
  writeFileSync(archivedDraft, "# already in archive\n");

  insertArtifact(db, {
    id,
    type: "skill",
    origin: "mined",
    surface_path: archivedDraft,
    state: "rejected",
    signature: "Read>Edit>Bash",
    created_at: now,
  });

  const result = runCurate(db, { pendingDir, archiveDir });
  expect(result.archived).toBe(0);
  expect(existsSync(archivedDraft)).toBe(true);
  expect(getArtifactById(db, id)?.surface_path).toBe(archivedDraft);

  db.close();
});

test("deprecation proposal signature collides with findActiveArtifactBySignature dedup (matches stage.ts convention)", () => {
  // Sanity check: the proposal signature is shaped the same as
  // `stage.ts#stageCandidate`'s `signature` column contract, so a future
  // `findActiveArtifactBySignature('curate:deprecate:<id>')` lookup is the
  // same idempotency guard mine uses. Asserting the literal signature
  // format here documents the contract for anyone wiring the next step.
  const db = openDb(dbPath);
  const now = new Date().toISOString();

  insertArtifact(db, {
    id: "loser-skill",
    type: "skill",
    origin: "preexisting",
    surface_path: "/tmp/never-mind/skill.md",
    state: "active",
    signature: null,
    created_at: now,
  });
  upsertEvidenceLedger(
    db,
    "loser-skill",
    { applied: 1, win: 0, loss: 1, score: -1 },
    now,
  );

  runCurate(db, { pendingDir, archiveDir });

  const proposal = db
    .query(
      "SELECT * FROM artifacts WHERE type='instruction_edit' AND state='staged'",
    )
    .get() as ArtifactRow;
  expect(proposal.signature).toMatch(/^curate:(deprecate|stale|merge):/);

  db.close();
});
