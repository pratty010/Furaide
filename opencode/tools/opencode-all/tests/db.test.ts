import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { getSessionDetail, listDirectories, listSessions, setArchived } from "../src/db.ts";

const root = join(import.meta.dir, ".tmp-db");
const dbPath = join(root, "opencode.db");

function seed() {
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
    time_created integer NOT NULL,
    time_updated integer NOT NULL,
    time_archived integer,
    workspace_id text,
    path text,
    agent text,
    model text,
    cost real DEFAULT 0 NOT NULL,
    tokens_input integer DEFAULT 0 NOT NULL,
    tokens_output integer DEFAULT 0 NOT NULL
  )`);
  db.run(`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer, data text)`);
  db.run(`INSERT INTO session VALUES
    ('ses_a','p',NULL,'a','/repo/current','Current newest','v',NULL,1,2,1,1000,5000,NULL,NULL,'','build','model-a',1.5,100,200),
    ('ses_b','p',NULL,'b','/repo/other','Other newest','v',NULL,0,0,0,1000,6000,NULL,NULL,'','general','model-b',3.0,200,300),
    ('ses_c','p',NULL,'c','/repo/current/sub','Current old','v',NULL,0,0,0,1000,3000,NULL,NULL,'','build','model-a',0.2,10,20),
    ('ses_d','p',NULL,'d','/repo/archive','Archived','v',NULL,0,0,0,1000,2000,7000,NULL,'','build','model-c',0.1,1,2),
    ('ses_child','p','ses_a','child','/repo/current','Child','v',NULL,0,0,0,1000,9000,NULL,NULL,'','build','model-a',9,9,9)
  `);
  db.run(`INSERT INTO message VALUES ('msg_a','ses_a',1000,'{}'), ('msg_b','ses_a',1001,'{}')`);
  db.close();
}

beforeEach(seed);
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("listSessions", () => {
  test("lists active parent sessions with cwd boost", () => {
    const rows = listSessions({ dbPath, tab: "active", cwd: "/repo/current" });
    expect(rows.map(row => row.id)).toEqual(["ses_a", "ses_c", "ses_b"]);
  });

  test("lists archived sessions by archive recency", () => {
    const rows = listSessions({ dbPath, tab: "archived", cwd: "/repo/current" });
    expect(rows.map(row => row.id)).toEqual(["ses_d"]);
  });

  test("filters by substring across title directory agent and model", () => {
    expect(listSessions({ dbPath, tab: "all", cwd: "/none", query: "current" }).map(row => row.id)).toEqual(["ses_a", "ses_c"]);
    expect(listSessions({ dbPath, tab: "all", cwd: "/none", query: "model-b" }).map(row => row.id)).toEqual(["ses_b"]);
  });
});

describe("detail and archive", () => {
  test("gets detail with message count", () => {
    const detail = getSessionDetail({ dbPath, id: "ses_a" });
    expect(detail?.id).toBe("ses_a");
    expect(detail?.messages).toBe(2);
  });

  test("archives and restores a session", () => {
    setArchived({ dbPath, id: "ses_a", archivedAt: 8000 });
    expect(listSessions({ dbPath, tab: "archived", cwd: "/repo/current" }).map(row => row.id)).toContain("ses_a");
    setArchived({ dbPath, id: "ses_a", archivedAt: null });
    expect(listSessions({ dbPath, tab: "active", cwd: "/repo/current" }).map(row => row.id)).toContain("ses_a");
  });
});

describe("directories", () => {
  test("lists unique directories with counts", () => {
    expect(listDirectories({ dbPath, prefix: "/repo" })).toEqual([
      { directory: "/repo/archive", count: 1 },
      { directory: "/repo/current", count: 1 },
      { directory: "/repo/current/sub", count: 1 },
      { directory: "/repo/other", count: 1 },
    ]);
  });
});