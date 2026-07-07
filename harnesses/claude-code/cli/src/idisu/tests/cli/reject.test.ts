import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import { stageCandidate } from "../../src/mine/stage.js";
import { rejectCandidate } from "../../src/cli/commands/reject.js";
import { runCli } from "./cli-helper.js";
import { insertArtifact } from "../../src/store/repo.js";
import type { Candidate } from "../../src/mine/mine.js";

const PENDING_DIR = "/tmp/idisu-reject-test-pending";
const ARCHIVE_DIR = "/tmp/idisu-reject-test-archive";
const CLI_HOME = "/tmp/idisu-reject-cli-test-home";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    signature: "Grep>Read>Edit",
    frequency: 2,
    successCount: 1,
    failureCount: 1,
    sampleSessions: ["sess-a"],
    closestSkills: [],
    ...overrides,
  };
}

function cleanup(dbPath: string) {
  rmSync(dbPath, { force: true });
  rmSync(PENDING_DIR, { force: true, recursive: true });
  rmSync(ARCHIVE_DIR, { force: true, recursive: true });
}

test("rejectCandidate moves pending/<id>/ to archive/, inserts rejected_signatures, flips state", () => {
  const dbPath = "/tmp/idisu-reject-test-basic.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const staged = stageCandidate(db, makeCandidate(), {
    pendingDir: PENDING_DIR,
  });
  expect(staged.skipped).toBe(false);

  const result = rejectCandidate(db, staged.id, "not generalizable enough", {
    pendingDir: PENDING_DIR,
    archiveDir: ARCHIVE_DIR,
  });

  const expectedArchivePath = join(ARCHIVE_DIR, staged.id);
  expect(result.archivePath).toBe(expectedArchivePath);

  // both draft.md and evidence.md preserved in the archive
  expect(existsSync(join(expectedArchivePath, "draft.md"))).toBe(true);
  expect(existsSync(join(expectedArchivePath, "evidence.md"))).toBe(true);

  // pending/<id>/ no longer exists
  expect(existsSync(join(PENDING_DIR, staged.id))).toBe(false);

  const draft = readFileSync(join(expectedArchivePath, "draft.md"), "utf8");
  expect(draft).toContain("Grep>Read>Edit");

  const artifactRow = db
    .query("SELECT * FROM artifacts WHERE id=?")
    .get(staged.id) as { state: string } | null;
  expect(artifactRow?.state).toBe("rejected");

  const rejectedRow = db
    .query("SELECT * FROM rejected_signatures WHERE signature=?")
    .get("Grep>Read>Edit") as {
    signature: string;
    reason: string;
    rejected_at: string;
  } | null;
  expect(rejectedRow?.reason).toBe("not generalizable enough");
  expect(rejectedRow?.rejected_at).toBe(result.rejectedAt);

  db.close();
  cleanup(dbPath);
});

test("rejectCandidate throws when the artifact id does not exist", () => {
  const dbPath = "/tmp/idisu-reject-test-missing.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  expect(() =>
    rejectCandidate(db, "does-not-exist", "bad", {
      pendingDir: PENDING_DIR,
      archiveDir: ARCHIVE_DIR,
    }),
  ).toThrow(/no artifact found/i);

  db.close();
  cleanup(dbPath);
});

test("rejectCandidate throws when the artifact is not in 'staged' state", () => {
  const dbPath = "/tmp/idisu-reject-test-wrongstate.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const staged = stageCandidate(db, makeCandidate(), {
    pendingDir: PENDING_DIR,
  });
  rejectCandidate(db, staged.id, "first reason", {
    pendingDir: PENDING_DIR,
    archiveDir: ARCHIVE_DIR,
  });

  expect(() =>
    rejectCandidate(db, staged.id, "second reason", {
      pendingDir: PENDING_DIR,
      archiveDir: ARCHIVE_DIR,
    }),
  ).toThrow(/not 'staged'/i);

  db.close();
  cleanup(dbPath);
});

// Phase 6 spec-review gap: existing tests cover the pure
// `rejectCandidate` logic but not the `cmdReject` CLI wrapper
// (`parseArgs` → `process.exit` path → `console.log` on success). This
// smoke test exercises the real `idisu reject` CLI entry point as a
// subprocess (see `cli-helper.ts` for why subprocess: the in-process
// `IDISU_DB` constant is module-cached at first import of `paths.ts`
// and can't be redirected to a scratch home after that).
test("idisu reject CLI: success path archives and prints one line; bogus-id path exits non-zero with an error", async () => {
  // Fresh scratch home so the subprocess sees a clean `IDISU_HOME`.
  rmSync(CLI_HOME, { force: true, recursive: true });
  mkdirSync(CLI_HOME, { recursive: true });
  // The CLI flow resolves ARCHIVE_DIR from IDISU_HOME/archive/ —
  // clean any leftover from a previous run.
  rmSync(join(CLI_HOME, "archive"), { force: true, recursive: true });

  // Insert the artifacts row + write the candidate's `draft.md` and
  // `evidence.md` to the paths the subprocess's `cmdReject` will
  // derive from `IDISU_HOME`. Direct writes use explicit paths so
  // they bypass the in-process module-cache trap.
  const id = "reject-cli-smoke-id";
  const signature = "Grep>Read>Edit";
  const candidateDir = `${CLI_HOME}/pending/${id}`;
  mkdirSync(candidateDir, { recursive: true });
  const draftPath = join(candidateDir, "draft.md");
  writeFileSync(draftPath, "# Grep>Read>Edit draft\n");
  writeFileSync(join(candidateDir, "evidence.md"), "# evidence\n");

  const now = new Date().toISOString();
  const db = openDb(`${CLI_HOME}/idisu.db`);
  insertArtifact(db, {
    id,
    type: "instruction_edit",
    origin: "mined",
    surface_path: draftPath,
    state: "staged",
    signature,
    created_at: now,
  });
  db.close();

  // --- success path -------------------------------------------------
  // The subprocess prints one line to stdout on success and exits 0.
  const ok = await runCli(CLI_HOME, [
    "reject",
    id,
    "--reason",
    "duplicate pattern",
  ]);
  expect(ok.exitCode).toBe(0);
  expect(ok.stdout).toContain(id);
  const expectedArchivePath = join(CLI_HOME, "archive", id);
  expect(ok.stdout).toContain(expectedArchivePath);

  // And the underlying state change actually happened: both draft.md
  // and evidence.md were moved into archive/<id>/, the artifacts
  // row flipped to 'rejected', and a rejected_signatures row was
  // inserted.
  expect(existsSync(join(expectedArchivePath, "draft.md"))).toBe(true);
  expect(existsSync(join(expectedArchivePath, "evidence.md"))).toBe(true);
  expect(existsSync(candidateDir)).toBe(false);

  const db2 = openDb(`${CLI_HOME}/idisu.db`);
  const row = db2
    .query("SELECT * FROM artifacts WHERE id=?")
    .get(id) as { state: string } | null;
  expect(row?.state).toBe("rejected");
  const rejectedRow = db2
    .query("SELECT * FROM rejected_signatures WHERE signature=?")
    .get(signature) as { reason: string } | null;
  expect(rejectedRow?.reason).toBe("duplicate pattern");
  db2.close();

  // --- error path ---------------------------------------------------
  // Bogus id: cmdReject catches the throw from `rejectCandidate`,
  // logs the message to stderr, and exits 1.
  const bad = await runCli(CLI_HOME, [
    "reject",
    "does-not-exist",
    "--reason",
    "bogus",
  ]);
  expect(bad.exitCode).toBe(1);
  expect(bad.stderr.toLowerCase()).toMatch(/no artifact found/);

  rmSync(CLI_HOME, { force: true, recursive: true });
});
