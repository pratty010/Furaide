import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import { cmdLearn, learnCandidate } from "../../src/cli/commands/learn.js";
import { runCli } from "./cli-helper.js";
import type { Database } from "bun:sqlite";

const PENDING_DIR = "/tmp/idisu-learn-test-pending";
const SOURCE_DIR = "/tmp/idisu-learn-test-src";
const SOURCE_FILE = "/tmp/idisu-learn-test-src-file";
const CLI_HOME = "/tmp/idisu-learn-cli-test-home";

function cleanup(dbPath: string) {
  rmSync(dbPath, { force: true });
  rmSync(PENDING_DIR, { force: true, recursive: true });
  rmSync(SOURCE_DIR, { force: true, recursive: true });
  rmSync(SOURCE_FILE, { force: true });
}

function makeFixtureDir() {
  rmSync(SOURCE_DIR, { force: true, recursive: true });
  mkdirSync(SOURCE_DIR, { recursive: true });
  writeFileSync(
    join(SOURCE_DIR, "sample.md"),
    "## Sample Heading\n\nThis is sample source content for testing the learn command.\n",
  );
  writeFileSync(
    join(SOURCE_DIR, "notes.md"),
    "These are notes from the second file.\n",
  );
}

// ---------------------------------------------------------------------------
// In-process tests for the pure-logic `learnCandidate` — same split as
// `promote.test.ts` (pure logic in-process, CLI wrapper via subprocess).
// ---------------------------------------------------------------------------

test("learnCandidate from a directory: writes a draft.md, registers an artifacts row (origin='learned', state='staged', type='skill'), and returns an instruction block with standards/evidence/handoff", () => {
  const dbPath = "/tmp/idisu-learn-test-basic.sqlite";
  cleanup(dbPath);
  makeFixtureDir();
  const db = openDb(dbPath);

  const result = learnCandidate(db, SOURCE_DIR, { pendingDir: PENDING_DIR });

  expect(result.skipped).toBe(false);
  expect(result.sourceKind).toBe("dir");
  expect(result.draftPath.startsWith(PENDING_DIR)).toBe(true);
  expect(existsSync(result.draftPath)).toBe(true);

  // (a) authoring standards text — block carries the standards header.
  expect(result.instructionBlock.toLowerCase()).toContain("authoring standards");
  // (b) source evidence — the fixture file contents are embedded.
  expect(result.instructionBlock).toContain("Sample Heading");
  expect(result.instructionBlock).toContain("notes from the second file");
  // (c) skill-creator handoff marker.
  expect(result.instructionBlock.toLowerCase()).toContain("skill-creator");

  // The artifacts row carries origin='learned', state='staged', type='skill',
  // and surface_path pointing at the staged draft. (Re-staged candidates
  // match the mining/staging convention — `origin` is the only place the
  // source of the row is recorded.)
  const row = db.query("SELECT * FROM artifacts WHERE id=?").get(result.id) as
    | {
        type: string;
        origin: string;
        state: string;
        surface_path: string;
        signature: string | null;
      }
    | null;
  expect(row?.type).toBe("skill");
  expect(row?.origin).toBe("learned");
  expect(row?.state).toBe("staged");
  expect(row?.surface_path).toBe(result.draftPath);
  expect(row?.signature).toBe(`learn:${SOURCE_DIR}`);

  // The on-disk draft.md is the same block learnCandidate returned.
  const onDisk = readFileSync(result.draftPath, "utf8");
  expect(onDisk).toBe(result.instructionBlock);

  db.close();
  cleanup(dbPath);
});

test("learnCandidate from a single file embeds the file contents as evidence", () => {
  const dbPath = "/tmp/idisu-learn-test-file.sqlite";
  cleanup(dbPath);
  rmSync(SOURCE_FILE, { force: true });
  writeFileSync(
    SOURCE_FILE,
    "## Single File\n\nHello from a single file source.\n",
  );
  const db = openDb(dbPath);

  const result = learnCandidate(db, SOURCE_FILE, { pendingDir: PENDING_DIR });

  expect(result.sourceKind).toBe("file");
  expect(result.instructionBlock).toContain("Hello from a single file source");
  expect(existsSync(result.draftPath)).toBe(true);

  db.close();
  cleanup(dbPath);
});

test("learnCandidate from a URL embeds the URL string in the evidence without fetching", () => {
  const dbPath = "/tmp/idisu-learn-test-url.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  const result = learnCandidate(db, "https://example.com/some-article", {
    pendingDir: PENDING_DIR,
  });

  expect(result.sourceKind).toBe("url");
  // The URL is the evidence — embedded verbatim so the live agent can fetch.
  expect(result.instructionBlock).toContain("https://example.com/some-article");
  // The block also flags that the CLI did not fetch it (only the live agent does).
  expect(result.instructionBlock.toLowerCase()).toMatch(/not fetch|not fetched/);

  db.close();
  cleanup(dbPath);
});

test("learnCandidate from session:<id> reads events for that session from idisu.db as evidence", () => {
  const dbPath = "/tmp/idisu-learn-test-session.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  // Insert a few events sharing the same session_id so the session-source
  // branch has something to summarize.
  const now = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    db.query(
      `INSERT INTO events
        (event_id,schema_version,source_id,source_position,observed_at,ingested_at,harness,event_type,payload_version,payload)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      `ev-learn-${i}`,
      1,
      "cc:p/sess-learn",
      i,
      now,
      now,
      "claude_code",
      "tool.invoked",
      1,
      JSON.stringify({ session_id: "sess-learn" }),
    );
  }

  const result = learnCandidate(db, "session:sess-learn", {
    pendingDir: PENDING_DIR,
  });

  expect(result.sourceKind).toBe("session");
  expect(result.instructionBlock).toContain("sess-learn");
  // 3 events for the session should be visible in the evidence summary.
  expect(result.instructionBlock).toMatch(/Events for this session: 3\b/);

  db.close();
  cleanup(dbPath);
});

test("learnCandidate is idempotent on signature: a second call for the same source returns skipped=true and does not re-write the draft", () => {
  const dbPath = "/tmp/idisu-learn-test-idempotent.sqlite";
  cleanup(dbPath);
  makeFixtureDir();
  const db = openDb(dbPath);

  const first = learnCandidate(db, SOURCE_DIR, { pendingDir: PENDING_DIR });
  const firstDraftContent = readFileSync(first.draftPath, "utf8");

  const second = learnCandidate(db, SOURCE_DIR, { pendingDir: PENDING_DIR });
  expect(second.skipped).toBe(true);
  expect(second.id).toBe(first.id);
  expect(second.draftPath).toBe(first.draftPath);
  // The on-disk draft was not re-written — the bytes are identical.
  expect(readFileSync(second.draftPath, "utf8")).toBe(firstDraftContent);

  // And there is exactly one artifacts row for this signature, not two.
  const count = (
    db
      .query("SELECT COUNT(*) AS c FROM artifacts WHERE signature=?")
      .get(`learn:${SOURCE_DIR}`) as { c: number }
  ).c;
  expect(count).toBe(1);

  db.close();
  cleanup(dbPath);
});

test("learnCandidate throws for an unrecognized source kind", () => {
  const dbPath = "/tmp/idisu-learn-test-badsrc.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  // Neither a path, nor a URL, nor a session: prefix.
  expect(() =>
    learnCandidate(db, "not-a-real-source", { pendingDir: PENDING_DIR }),
  ).toThrow(/unrecognized source/i);

  db.close();
  cleanup(dbPath);
});

test("learnCandidate throws when the source path does not exist", () => {
  const dbPath = "/tmp/idisu-learn-test-missing.sqlite";
  cleanup(dbPath);
  const db = openDb(dbPath);

  expect(() =>
    learnCandidate(db, "/tmp/idisu-learn-test-does-not-exist", {
      pendingDir: PENDING_DIR,
    }),
  ).toThrow(/not found|does not exist/i);

  db.close();
  cleanup(dbPath);
});

// ---------------------------------------------------------------------------
// cmdLearn wrapper — in-process arg-parsing test only. The full CLI path is
// exercised by the subprocess smoke test below; calling cmdLearn with a
// valid --source in-process would try to open the real IDISU_DB (module-
// cached at first import, see cli-helper.ts header) and the test process
// would inherit that DB. parseArgs fires before openDb, so the error case
// can be asserted cleanly in-process.
// ---------------------------------------------------------------------------
test("cmdLearn throws an actionable error when --source is missing", () => {
  expect(() => cmdLearn([])).toThrow(/usage|--source/);
});

// ---------------------------------------------------------------------------
// Subprocess smoke test for the real `idisu learn` CLI — matches
// `promote.test.ts` / `reject.test.ts` pattern (subprocess via
// cli-helper.ts#runCli with a custom IDISU_HOME).
// ---------------------------------------------------------------------------
test("idisu learn CLI: success path prints the instruction block and exits 0; missing --source path exits 1 with a usage message", async () => {
  rmSync(CLI_HOME, { force: true, recursive: true });
  mkdirSync(CLI_HOME, { recursive: true });

  // Fixture source dir the CLI can read.
  const sourceDir = `${CLI_HOME}/src`;
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, "sample.md"),
    "## CLI Smoke Sample\n\nA test source file for the learn CLI.\n",
  );

  // --- success path -----------------------------------------------------
  const ok = await runCli(CLI_HOME, ["learn", "--source", sourceDir]);
  expect(ok.exitCode).toBe(0);
  // The instruction block is on stdout — the live agent parses this.
  expect(ok.stdout.toLowerCase()).toContain("authoring standards");
  expect(ok.stdout).toContain("CLI Smoke Sample");
  expect(ok.stdout.toLowerCase()).toContain("skill-creator");

  // The artifacts row was actually created in the CLI's idisu.db.
  const db = openDb(`${CLI_HOME}/idisu.db`) as unknown as Database;
  const row = db
    .query("SELECT * FROM artifacts WHERE origin='learned'")
    .get() as
    | {
        type: string;
        origin: string;
        state: string;
        surface_path: string;
      }
    | null;
  expect(row?.type).toBe("skill");
  expect(row?.origin).toBe("learned");
  expect(row?.state).toBe("staged");
  expect(row?.surface_path).toBeTruthy();
  if (row?.surface_path) {
    expect(existsSync(row.surface_path)).toBe(true);
  }
  db.close();

  // --- error path: missing --source -------------------------------------
  const bad = await runCli(CLI_HOME, ["learn"]);
  expect(bad.exitCode).toBe(1);
  expect(bad.stderr.toLowerCase()).toMatch(/usage|--source/);

  rmSync(CLI_HOME, { force: true, recursive: true });
});
