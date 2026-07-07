import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import { stageCandidate } from "../../src/mine/stage.js";
import { promoteCandidate } from "../../src/cli/commands/promote.js";
import { runCli } from "./cli-helper.js";
import { insertArtifact } from "../../src/store/repo.js";
import type { Candidate } from "../../src/mine/mine.js";

const PENDING_DIR = "/tmp/idisu-promote-test-pending";
const TO_DIR = "/tmp/idisu-promote-test-target/foo";
const CLI_HOME = "/tmp/idisu-promote-cli-test-home";
const CLI_TO_DIR = "/tmp/idisu-promote-cli-test-target/foo";

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
  rmSync(TO_DIR, { force: true, recursive: true });
}

test("promoteCandidate moves draft.md to <to>/SKILL.md and flips artifact state/surface_path/promoted_at", () => {
  const dbPath = "/tmp/idisu-promote-test-basic.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const staged = stageCandidate(db, makeCandidate(), {
    pendingDir: PENDING_DIR,
  });
  expect(staged.skipped).toBe(false);

  const result = promoteCandidate(db, staged.id, TO_DIR, {
    pendingDir: PENDING_DIR,
  });

  const expectedSurfacePath = join(TO_DIR, "SKILL.md");
  expect(result.surfacePath).toBe(expectedSurfacePath);
  expect(existsSync(expectedSurfacePath)).toBe(true);
  expect(existsSync(staged.draftPath)).toBe(false);

  const draft = readFileSync(expectedSurfacePath, "utf8");
  expect(draft).toContain("Read>Edit>Bash");

  // pending/<id>/ should be fully cleaned up post-promotion
  expect(existsSync(join(PENDING_DIR, staged.id))).toBe(false);

  const row = db.query("SELECT * FROM artifacts WHERE id=?").get(staged.id) as {
    state: string;
    surface_path: string;
    promoted_at: string | null;
  } | null;

  expect(row?.state).toBe("active");
  expect(row?.surface_path).toBe(expectedSurfacePath);
  expect(row?.promoted_at).toBe(result.promotedAt);
  expect(row?.promoted_at).toBeTruthy();

  db.close();
  cleanup(dbPath);
});

test("promoteCandidate throws when the artifact id does not exist", () => {
  const dbPath = "/tmp/idisu-promote-test-missing.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  expect(() =>
    promoteCandidate(db, "does-not-exist", TO_DIR, { pendingDir: PENDING_DIR }),
  ).toThrow(/no artifact found/i);

  db.close();
  cleanup(dbPath);
});

test("promoteCandidate throws when the artifact is not in 'staged' state", () => {
  const dbPath = "/tmp/idisu-promote-test-wrongstate.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const staged = stageCandidate(db, makeCandidate(), {
    pendingDir: PENDING_DIR,
  });
  // First promotion succeeds and flips state to 'active'.
  promoteCandidate(db, staged.id, TO_DIR, { pendingDir: PENDING_DIR });

  // Re-promoting the now-active artifact should be rejected.
  expect(() =>
    promoteCandidate(db, staged.id, TO_DIR, { pendingDir: PENDING_DIR }),
  ).toThrow(/not 'staged'/i);

  db.close();
  cleanup(dbPath);
});

// Phase 6 spec-review gap: existing tests cover the pure
// `promoteCandidate` logic but not the `cmdPromote` CLI wrapper
// (`parseArgs` → `process.exit` path → `console.log` on success). This
// smoke test exercises the real `idisu promote` CLI entry point as a
// subprocess (see `cli-helper.ts` for why subprocess: the in-process
// `IDISU_DB` constant is module-cached at first import of `paths.ts`
// and can't be redirected to a scratch home after that).
test("idisu promote CLI: success path promotes and prints one line; bogus-id path exits non-zero with an error", async () => {
  // Fresh scratch home so the subprocess sees a clean `IDISU_HOME`.
  rmSync(CLI_HOME, { force: true, recursive: true });
  mkdirSync(CLI_HOME, { recursive: true });
  rmSync(CLI_TO_DIR, { force: true, recursive: true });

  // Insert the artifacts row + write the candidate's `draft.md` and
  // `evidence.md` to the paths the subprocess's `cmdPromote` will
  // derive from `IDISU_HOME`. Direct writes use explicit paths so
  // they bypass the in-process module-cache trap.
  const id = "promote-cli-smoke-id";
  const candidateDir = `${CLI_HOME}/pending/${id}`;
  mkdirSync(candidateDir, { recursive: true });
  const draftPath = join(candidateDir, "draft.md");
  writeFileSync(draftPath, "# Read>Edit>Bash draft\n");
  writeFileSync(join(candidateDir, "evidence.md"), "# evidence\n");

  const now = new Date().toISOString();
  const db = openDb(`${CLI_HOME}/idisu.db`);
  insertArtifact(db, {
    id,
    type: "instruction_edit",
    origin: "mined",
    surface_path: draftPath,
    state: "staged",
    signature: "Read>Edit>Bash",
    created_at: now,
  });
  db.close();

  // --- success path -------------------------------------------------
  // The subprocess prints one line to stdout on success and exits 0.
  const ok = await runCli(CLI_HOME, ["promote", id, "--to", CLI_TO_DIR]);
  expect(ok.exitCode).toBe(0);
  expect(ok.stdout).toContain(id);
  const expectedSurfacePath = join(CLI_TO_DIR, "SKILL.md");
  expect(ok.stdout).toContain(expectedSurfacePath);

  // And the underlying state change actually happened: the file moved,
  // the pending dir is cleaned up, and the row is now 'active' with
  // the new surface_path.
  expect(existsSync(expectedSurfacePath)).toBe(true);
  expect(existsSync(candidateDir)).toBe(false);

  const db2 = openDb(`${CLI_HOME}/idisu.db`);
  const row = db2.query("SELECT * FROM artifacts WHERE id=?").get(id) as {
    state: string;
    surface_path: string;
  } | null;
  expect(row?.state).toBe("active");
  expect(row?.surface_path).toBe(expectedSurfacePath);
  db2.close();

  // --- error path ---------------------------------------------------
  // Bogus id: cmdPromote catches the throw from `promoteCandidate`,
  // logs the message to stderr, and exits 1.
  const bad = await runCli(CLI_HOME, ["promote", "does-not-exist", "--to", CLI_TO_DIR]);
  expect(bad.exitCode).toBe(1);
  expect(bad.stderr.toLowerCase()).toMatch(/no artifact found/);

  rmSync(CLI_HOME, { force: true, recursive: true });
  rmSync(CLI_TO_DIR, { force: true, recursive: true });
});
