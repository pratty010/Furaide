import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDb } from "../../src/store/db.js";
import { stageCandidate } from "../../src/mine/stage.js";
import {
  insertArtifact,
  upsertWorkflowNgram,
} from "../../src/store/repo.js";
import { listPendingReview } from "../../src/cli/commands/review.js";
import { runCli } from "./cli-helper.js";
import type { Candidate } from "../../src/mine/mine.js";

const PENDING_DIR = "/tmp/idisu-review-test-pending";
const CLI_HOME = "/tmp/idisu-review-cli-test-home";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    signature: "Read>Edit>Bash",
    frequency: 3,
    successCount: 2,
    failureCount: 1,
    sampleSessions: ["sess-1", "sess-2"],
    closestSkills: [],
    ...overrides,
  };
}

function cleanup(dbPath: string) {
  rmSync(dbPath, { force: true });
  rmSync(PENDING_DIR, { force: true, recursive: true });
}

test("listPendingReview returns staged candidates with evidence pointers and outcome-split fields", () => {
  const dbPath = "/tmp/idisu-review-test-basic.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const candidateA = makeCandidate({
    signature: "Read>Edit>Bash",
    frequency: 3,
    successCount: 2,
    failureCount: 1,
    sampleSessions: ["sess-1", "sess-2"],
  });
  const candidateB = makeCandidate({
    signature: "Grep>Read>Write",
    frequency: 5,
    successCount: 4,
    failureCount: 0,
    sampleSessions: ["sess-3"],
  });

  // Mirrors the real pipeline: mine.ts#upsertWorkflowNgram runs before
  // stage.ts#stageCandidate during a dream pass, keyed on the same
  // `signature` `review.ts` joins on.
  const now = new Date().toISOString();
  for (const c of [candidateA, candidateB]) {
    upsertWorkflowNgram(db, {
      signature: c.signature,
      n: 3,
      frequency: c.frequency,
      success_count: c.successCount,
      failure_count: c.failureCount,
      sample_sessions: c.sampleSessions,
      last_seen: now,
    });
  }

  const stagedA = stageCandidate(db, candidateA, { pendingDir: PENDING_DIR });
  const stagedB = stageCandidate(db, candidateB, { pendingDir: PENDING_DIR });

  const entries = listPendingReview(db);
  expect(entries.length).toBe(2);

  const byId = new Map(entries.map((e) => [e.id, e]));
  const entryA = byId.get(stagedA.id);
  const entryB = byId.get(stagedB.id);
  expect(entryA).toBeTruthy();
  expect(entryB).toBeTruthy();

  expect(entryA?.signature).toBe("Read>Edit>Bash");
  expect(entryA?.frequency).toBe(3);
  expect(entryA?.successCount).toBe(2);
  expect(entryA?.failureCount).toBe(1);
  expect(entryA?.sampleSessions).toEqual(["sess-1", "sess-2"]);
  expect(entryA?.draftPath).toBe(stagedA.draftPath);
  expect(entryA?.evidencePath).toBe(stagedA.evidencePath);
  expect(entryA?.createdAt).toBeTruthy();

  // Evidence pointers must resolve to real files on disk — the live agent
  // Read()s them directly per the `/idisu review` flow.
  expect(existsSync(entryA!.draftPath!)).toBe(true);
  expect(existsSync(entryA!.evidencePath!)).toBe(true);
  expect(dirname(entryA!.draftPath!)).toBe(dirname(entryA!.evidencePath!));

  expect(entryB?.signature).toBe("Grep>Read>Write");
  expect(entryB?.frequency).toBe(5);
  expect(entryB?.successCount).toBe(4);
  expect(entryB?.failureCount).toBe(0);
  expect(entryB?.sampleSessions).toEqual(["sess-3"]);
  expect(existsSync(entryB!.draftPath!)).toBe(true);
  expect(existsSync(entryB!.evidencePath!)).toBe(true);

  db.close();
  cleanup(dbPath);
});

test("listPendingReview excludes non-staged artifacts", () => {
  const dbPath = "/tmp/idisu-review-test-excludes.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const candidate = makeCandidate();
  const staged = stageCandidate(db, candidate, { pendingDir: PENDING_DIR });
  db.query("UPDATE artifacts SET state='active' WHERE id=?").run(staged.id);

  const entries = listPendingReview(db);
  expect(entries.length).toBe(0);

  db.close();
  cleanup(dbPath);
});

test("listPendingReview defaults outcome-split fields to zero/empty when no workflow_ngrams row exists", () => {
  const dbPath = "/tmp/idisu-review-test-nongram.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const candidate = makeCandidate({ signature: "Bash>Bash>Read" });
  const staged = stageCandidate(db, candidate, { pendingDir: PENDING_DIR });

  const entries = listPendingReview(db);
  expect(entries.length).toBe(1);
  const entry = entries[0]!;
  expect(entry.id).toBe(staged.id);
  expect(entry.frequency).toBe(0);
  expect(entry.successCount).toBe(0);
  expect(entry.failureCount).toBe(0);
  expect(entry.sampleSessions).toEqual([]);

  db.close();
  cleanup(dbPath);
});

// Phase 6 spec-review gap: plan Task 6.2 Step 2 says "Test `review --json`
// returns queue entries with evidence pointers" — the existing tests
// only call `listPendingReview` (the pure query) directly, so the CLI
// entry point `idisu review --json` has no direct coverage. This test
// exercises the real CLI as a subprocess (see `cli-helper.ts` for why
// subprocess: the in-process `IDISU_DB` constant is module-cached at
// first import of `paths.ts` and can't be redirected to a scratch
// home after that).
test("idisu review --json CLI: prints a JSON array of staged candidates with id/signature/draftPath/evidencePath and exits 0", async () => {
  // Fresh scratch home so the subprocess sees a clean `IDISU_HOME`.
  rmSync(CLI_HOME, { force: true, recursive: true });
  mkdirSync(CLI_HOME, { recursive: true });

  // Stage a candidate by writing the artifacts row + on-disk files
  // directly. Direct writes use explicit paths and bypass the
  // in-process module-cache trap (`stageCandidate` would resolve
  // `PENDING_DIR` at its first import, which is already cached).
  const id = "review-cli-smoke-id";
  const signature = "Read>Edit>Bash";
  const candidateDir = `${CLI_HOME}/pending/${id}`;
  mkdirSync(candidateDir, { recursive: true });
  const draftPath = join(candidateDir, "draft.md");
  const evidencePath = join(candidateDir, "evidence.md");
  writeFileSync(draftPath, "# Read>Edit>Bash draft\n");
  writeFileSync(evidencePath, "# Read>Edit>Bash evidence\n");

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
  upsertWorkflowNgram(db, {
    signature,
    n: 3,
    frequency: 7,
    success_count: 5,
    failure_count: 2,
    sample_sessions: ["sess-a", "sess-b", "sess-c"],
    last_seen: now,
  });
  db.close();

  // Run the real CLI as a subprocess with --json. Assert on the
  // JSON-shaped stdout the live agent parses for the conversational
  // /idisu review flow, AND on the exit code.
  const result = await runCli(CLI_HOME, ["review", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");

  const parsed = JSON.parse(result.stdout) as Array<{
    id: string;
    signature: string | null;
    frequency: number;
    successCount: number;
    failureCount: number;
    sampleSessions: string[];
    draftPath: string;
    evidencePath: string;
  }>;
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed.length).toBe(1);
  const entry = parsed[0]!;
  expect(entry.id).toBe(id);
  expect(entry.signature).toBe(signature);
  expect(entry.frequency).toBe(7);
  expect(entry.successCount).toBe(5);
  expect(entry.failureCount).toBe(2);
  expect(entry.sampleSessions).toEqual(["sess-a", "sess-b", "sess-c"]);
  // Evidence pointers come from the CLI-side `dirname` derivation
  // against `surface_path`, not the DB — assert both are populated
  // and sibling-shaped, matching the on-disk layout.
  expect(entry.draftPath).toBe(draftPath);
  expect(entry.evidencePath).toBe(evidencePath);
  expect(dirname(entry.draftPath)).toBe(dirname(entry.evidencePath));
  expect(existsSync(entry.draftPath)).toBe(true);
  expect(existsSync(entry.evidencePath)).toBe(true);

  rmSync(CLI_HOME, { force: true, recursive: true });
});
