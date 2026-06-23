import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { buildSessionIndex, clearSessionIndexCache } from "../src/dashboard/session-index.ts";

const root = join(import.meta.dir, ".tmp-index-cache");
const dbPath = join(root, "opencode.db");
const archiveRoot = join(root, "exports");

function seed(title: string) {
  mkdirSync(root, { recursive: true });
  mkdirSync(archiveRoot, { recursive: true });
  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS session");
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
  db.run(`INSERT INTO session VALUES ('ses_a','p',NULL,'a','/repo','${title}','v',NULL,0,0,0,NULL,1,2,NULL,NULL,'','','',0,0,0,0,0,0)`);
  db.close();
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  clearSessionIndexCache();
  seed("first");
});

describe("session index cache", () => {
  test("returns cached index when source mtimes are unchanged", () => {
    const a = buildSessionIndex({ cwd: "/repo", dbPath, archiveRoot });
    const b = buildSessionIndex({ cwd: "/repo", dbPath, archiveRoot });
    expect(a).toBe(b);
  });
});
