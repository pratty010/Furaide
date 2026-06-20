import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  buildSessionIndex,
  removeActiveFromIndex,
  removeArchivedFromIndex,
  addActiveToIndex,
  addArchivedToIndex,
  rowsForTab,
  directoriesForTab,
  type SessionIndex,
} from "../src/dashboard/session-index.ts";

const root = join(import.meta.dir, ".tmp-session-index");
const dbPath = join(root, "opencode.db");
const archiveRoot = join(root, "exports");

function createDb(): void {
  mkdirSync(root, { recursive: true });
  const db = new Database(dbPath);
  db.run(`CREATE TABLE session (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    parent_id text,
    slug text NOT NULL,
    directory text NOT NULL,
    title text NOT NULL,
    version text NOT NULL,
    share_url text,
    summary_additions integer,
    summary_deletions integer,
    summary_files integer,
    summary_diffs text,
    time_created integer NOT NULL,
    time_updated integer NOT NULL,
    time_archived integer,
    workspace_id text,
    path text,
    agent text,
    model text,
    cost real DEFAULT 0 NOT NULL,
    tokens_input integer DEFAULT 0 NOT NULL,
    tokens_output integer DEFAULT 0 NOT NULL,
    tokens_reasoning integer DEFAULT 0 NOT NULL,
    tokens_cache_read integer DEFAULT 0 NOT NULL,
    tokens_cache_write integer DEFAULT 0 NOT NULL
  )`);
  db.run(`INSERT INTO session VALUES
    ('ses_active_1','p',NULL,'s-a','/repo/a','Active One','v',NULL,0,0,0,NULL,1000,2000,NULL,NULL,'','build','model-a',1.5,10,20,0,0,0),
    ('ses_active_2','p',NULL,'s-b','/repo/b','Active Two','v',NULL,0,0,0,NULL,1100,2100,NULL,NULL,'','plan','model-b',2.5,30,40,0,0,0)
  `);
  db.close();
}

function writeArchive(id: string, directory: string, title = "Archived One"): void {
  mkdirSync(archiveRoot, { recursive: true });
  writeFileSync(join(archiveRoot, `${id}.json`), JSON.stringify({
    info: {
      id,
      title,
      directory,
      path: "",
      agent: "build",
      model: "model-archive",
      share: { url: "" },
      cost: 3.5,
      tokens: { input: 50, output: 60, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1200, updated: 2200 },
      summary: { files: 2, additions: 3, deletions: 4 },
    },
    messages: [
      { info: { role: "user", time: { created: 1300 } }, parts: [{ type: "text", text: "archived user text" }] },
      { info: { role: "assistant", time: { created: 1400 } }, parts: [{ type: "text", text: "archived assistant text" }] },
    ],
  }));
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  createDb();
  writeArchive("ses_archived_1", "/repo/a");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildSessionIndex", () => {
  test("loads active sessions from DB and archived sessions from export files", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    expect(index.active.has("ses_active_1")).toBe(true);
    expect(index.active.has("ses_active_2")).toBe(true);
    expect(index.archived.has("ses_archived_1")).toBe(true);
    expect(index.active.has("ses_archived_1")).toBe(false);
    expect(index.archived.has("ses_active_1")).toBe(false);
  });

  test("groups directories separately for active and archived tabs", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    expect(directoriesForTab(index, "active").map(d => d.directory)).toEqual(["/repo/a", "/repo/b"]);
    expect(directoriesForTab(index, "archived").map(d => d.directory)).toEqual(["/repo/a"]);
  });

  test("rowsForTab returns only current tab sessions", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    expect(rowsForTab(index, "active").map(s => s.id)).toEqual(["ses_active_2", "ses_active_1"]);
    expect(rowsForTab(index, "archived").map(s => s.id)).toEqual(["ses_archived_1"]);
  });
});

describe("index updates", () => {
  test("removeActiveFromIndex removes active row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    removeActiveFromIndex(index, "ses_active_1");
    expect(index.active.has("ses_active_1")).toBe(false);
    expect(index.activeByDir.get("/repo/a")?.has("ses_active_1")).toBe(false);
  });

  test("addArchivedToIndex adds archived row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    const row = index.active.get("ses_active_1");
    if (!row) throw new Error("missing test row");
    addArchivedToIndex(index, { ...row, timeArchived: 9999 });
    expect(index.archived.has("ses_active_1")).toBe(true);
    expect(index.archivedByDir.get("/repo/a")?.has("ses_active_1")).toBe(true);
  });

  test("removeArchivedFromIndex removes archived row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    removeArchivedFromIndex(index, "ses_archived_1");
    expect(index.archived.has("ses_archived_1")).toBe(false);
    expect(index.archivedByDir.get("/repo/a")?.has("ses_archived_1")).toBe(false);
  });

  test("addActiveToIndex adds active row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    const row = index.archived.get("ses_archived_1");
    if (!row) throw new Error("missing archived test row");
    addActiveToIndex(index, { ...row, timeArchived: null });
    expect(index.active.has("ses_archived_1")).toBe(true);
    expect(index.activeByDir.get("/repo/a")?.has("ses_archived_1")).toBe(true);
  });
});
