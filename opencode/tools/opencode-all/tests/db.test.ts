import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { defaultArchivePath, exportSessionToFile, getSessionDetail, importSessionFromFile, isSafeSessionId, listArchivedSessionFiles, listDirectories, listSessions, readArchivedMessages, readRecentMessages, setArchived } from "../src/db.ts";

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
  db.run(`CREATE TABLE message (
    id text PRIMARY KEY,
    session_id text NOT NULL,
    time_created integer NOT NULL,
    time_updated integer NOT NULL,
    data text NOT NULL
  )`);
  db.run(`CREATE TABLE part (
    id text PRIMARY KEY,
    message_id text NOT NULL,
    session_id text NOT NULL,
    time_created integer NOT NULL,
    time_updated integer NOT NULL,
    data text NOT NULL
  )`);
  db.run(`INSERT INTO session VALUES
    ('ses_a','p',NULL,'a','/repo/current','Current newest','v',NULL,1,2,1,NULL,1000,5000,NULL,NULL,'','build','{"id":"model-a","providerID":"prov","variant":"def"}',1.5,100,200,10,300,20),
    ('ses_b','p',NULL,'b','/repo/other','Other newest','v',NULL,0,0,0,NULL,1000,6000,NULL,NULL,'','general','model-b',3.0,200,300,0,0,0),
    ('ses_c','p',NULL,'c','/repo/current/sub','Current old','v',NULL,0,0,0,NULL,1000,3000,NULL,NULL,'','build','model-a',0.2,10,20,0,0,0),
    ('ses_d','p',NULL,'d','/repo/archive','Archived','v',NULL,0,0,0,NULL,1000,2000,7000,NULL,'','build','model-c',0.1,1,2,0,0,0),
    ('ses_child','p','ses_a','child','/repo/current','Child','v',NULL,0,0,0,NULL,1000,9000,NULL,NULL,'','build','model-a',9,9,9,0,0,0)
  `);
  db.run(`INSERT INTO message VALUES
    ('msg_a','ses_a',1000,1000,'{"role":"user"}'),
    ('msg_b','ses_a',1001,1001,'{"role":"assistant"}'),
    ('msg_c','ses_c',2000,2000,'{"role":"system"}'),
    ('msg_d','ses_c',2001,2001,'{"role":"user"}'),
    ('msg_e','ses_c',2002,2002,'{"role":"assistant"}'),
    ('msg_f','ses_c',2003,2003,'{"role":"user"}'),
    ('msg_g','ses_c',2004,2004,'{"role":"assistant"}')
  `);
  db.run(`INSERT INTO part VALUES
    ('prt_1','msg_a','ses_a',1000,1000,'{"type":"text","text":"hello from user"}'),
    ('prt_2','msg_b','ses_a',1001,1001,'{"type":"text","text":"hello from assistant"}'),
    ('prt_3','msg_b','ses_a',1002,1002,'{"type":"tool","tool":"bash","state":{"status":"completed"}}'),
    ('prt_4','msg_b','ses_a',1003,1003,'{"type":"reasoning","text":"thinking"}'),
    ('prt_5','msg_c','ses_c',2000,2000,'{"type":"text","text":"system prompt"}'),
    ('prt_6','msg_d','ses_c',2001,2001,'{"type":"text","text":"first user"}'),
    ('prt_7','msg_e','ses_c',2002,2002,'{"type":"text","text":"first assistant"}'),
    ('prt_8','msg_f','ses_c',2003,2003,'{"type":"text","text":"second user"}'),
    ('prt_9','msg_g','ses_c',2004,2004,'{"type":"text","text":"second assistant"}')
  `);
  db.close();

  mkdirSync(join(root, "opencode", "storage", "session_diff"), { recursive: true });
  writeFileSync(join(root, "opencode", "storage", "session_diff", "ses_a.json"), "[]");
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
});

describe("detail and archive", () => {
  test("gets detail with message previews and tool summary", () => {
    process.env.XDG_DATA_HOME = root;
    const detail = getSessionDetail({ dbPath, id: "ses_a", cwd: "/repo/current" });
    expect(detail?.id).toBe("ses_a");
    expect(detail?.messages).toBe(2);
    expect(detail?.partCounts.text).toBe(2);
    expect(detail?.toolCounts[0]?.tool).toBe("bash");
    expect(detail?.recentText[0]?.text).toContain("hello");
    expect(detail?.diffBytes).toBe(2);
    delete process.env.XDG_DATA_HOME;
  });

  test("archives and restores a session", () => {
    setArchived({ dbPath, id: "ses_a", archivedAt: 8000 });
    expect(listSessions({ dbPath, tab: "archived", cwd: "/repo/current" }).map(row => row.id)).toContain("ses_a");
    setArchived({ dbPath, id: "ses_a", archivedAt: null });
    expect(listSessions({ dbPath, tab: "active", cwd: "/repo/current" }).map(row => row.id)).toContain("ses_a");
  });
});

describe("directories", () => {
  test("lists directories with active and archived counts", () => {
    expect(listDirectories({ dbPath, prefix: "/repo" })).toEqual([
      { directory: "/repo/archive", active: 0, archived: 1, latestUpdated: 2000 },
      { directory: "/repo/current", active: 1, archived: 0, latestUpdated: 5000 },
      { directory: "/repo/current/sub", active: 1, archived: 0, latestUpdated: 3000 },
      { directory: "/repo/other", active: 1, archived: 0, latestUpdated: 6000 },
    ]);
  });
});

describe("readRecentMessages", () => {
  test("returns user/assistant only, ascending, no system", () => {
    const rows = readRecentMessages("ses_c", 200, dbPath);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ role: "user", time: 2001, text: "first user" });
    expect(rows[1]).toEqual({ role: "assistant", time: 2002, text: "first assistant" });
    expect(rows[2]).toEqual({ role: "user", time: 2003, text: "second user" });
    expect(rows[3]).toEqual({ role: "assistant", time: 2004, text: "second assistant" });
  });

  test("respects maxMessages cap", () => {
    const rows = readRecentMessages("ses_c", 2, dbPath);
    expect(rows).toHaveLength(2);
    expect(rows[1].text).toBe("first assistant");
  });

  test("returns empty array for missing session", () => {
    expect(readRecentMessages("nonexistent", 200, dbPath)).toEqual([]);
  });

  test("returns empty array for session with no user/assistant messages", () => {
    expect(readRecentMessages("ses_d", 200, dbPath)).toEqual([]);
  });
});

describe("archive path and archived messages", () => {
  test("rejects path traversal session ids", () => {
    expect(isSafeSessionId("ses_safe-123")).toBe(true);
    expect(isSafeSessionId("../bad")).toBe(false);
    expect(isSafeSessionId("-bad")).toBe(false);
    expect(() => defaultArchivePath("../bad")).toThrow("invalid session id");
  });

  test("readArchivedMessages sanitizes archived text", () => {
    process.env.XDG_DATA_HOME = root;
    const file = defaultArchivePath("ses_a");
    mkdirSync(join(root, "opencode", "tools", "opencode-all", "exports"), { recursive: true });
    writeFileSync(file, JSON.stringify({
      messages: [
        { info: { role: "user", time: { created: 123 } }, parts: [{ type: "text", text: "hello\u001b[2Jworld" }] },
      ],
    }));
    const rows = readArchivedMessages("ses_a");
    expect(rows[0]).toEqual({ role: "user", time: 123, text: "helloworld" });
    delete process.env.XDG_DATA_HOME;
  });

  test("listArchivedSessionFiles skips files where filename and inner id mismatch", () => {
    process.env.XDG_DATA_HOME = root;
    const exportsDir = join(root, "opencode", "tools", "opencode-all", "exports");
    mkdirSync(exportsDir, { recursive: true });
    writeFileSync(join(exportsDir, "ses_safe.json"), JSON.stringify({
      info: { id: "different_id", title: "Mismatched", directory: "/repo" },
      messages: [],
    }));
    const rows = listArchivedSessionFiles({ archiveRoot: exportsDir, cwd: "/repo" });
    expect(rows).toHaveLength(0);
    delete process.env.XDG_DATA_HOME;
  });
});

describe("hard archive CLI helpers", () => {
  test("exportSessionToFile calls top-level opencode export and writes stdout to archive file", () => {
    process.env.XDG_DATA_HOME = root;
    const bin = join(root, "fake-opencode-export.sh");
    writeFileSync(bin, `#!/usr/bin/env bash\nif [ "$1" != "export" ]; then echo "bad command: $*" >&2; exit 9; fi\nif [ "$2" != "ses_safe" ]; then echo "bad id: $2" >&2; exit 8; fi\nprintf '{"info":{"id":"ses_safe","title":"Safe","directory":"/repo"},"messages":[]}'\n`, { mode: 0o755 });
    process.env.OPENCODE_ALL_OPENCODE_BIN = bin;

    const res = exportSessionToFile("ses_safe");
    expect(res.ok).toBe(true);
    expect(readFileSync(defaultArchivePath("ses_safe"), "utf8")).toContain('"id":"ses_safe"');

    delete process.env.OPENCODE_ALL_OPENCODE_BIN;
    delete process.env.XDG_DATA_HOME;
  });

  test("importSessionFromFile calls top-level opencode import", () => {
    process.env.XDG_DATA_HOME = root;
    const file = defaultArchivePath("ses_safe");
    mkdirSync(join(root, "opencode", "tools", "opencode-all", "exports"), { recursive: true });
    writeFileSync(file, JSON.stringify({ info: { id: "ses_safe" }, messages: [] }));
    const bin = join(root, "fake-opencode-import.sh");
    writeFileSync(bin, `#!/usr/bin/env bash\nif [ "$1" != "import" ]; then echo "bad command: $*" >&2; exit 9; fi\nif [ "$2" != "${file}" ]; then echo "bad file: $2" >&2; exit 8; fi\nexit 0\n`, { mode: 0o755 });
    process.env.OPENCODE_ALL_OPENCODE_BIN = bin;

    const res = importSessionFromFile("ses_safe");
    expect(res.ok).toBe(true);

    delete process.env.OPENCODE_ALL_OPENCODE_BIN;
    delete process.env.XDG_DATA_HOME;
  });

  test("exportSessionToFile returns error code -3 when opencode bin is missing", () => {
    process.env.XDG_DATA_HOME = root;
    process.env.OPENCODE_ALL_OPENCODE_BIN = "/nonexistent/path/opencode-binary-that-does-not-exist";
    const res = exportSessionToFile("ses_safe");
    expect(res.ok).toBe(false);
    expect(res.code).toBe(-3);
    expect(res.stderr).toContain("opencode CLI not found");
    delete process.env.OPENCODE_ALL_OPENCODE_BIN;
    delete process.env.XDG_DATA_HOME;
  });
});
