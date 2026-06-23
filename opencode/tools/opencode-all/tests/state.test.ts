import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import {
  addActiveToIndex,
  addArchivedToIndex,
  type SessionIndex,
} from "../src/dashboard/session-index.ts";
import {
  clampCursor,
  createInitialState,
  currentSession,
  getVisibleRows,
  loadSelectedMessages,
  reloadState,
  reloadStateFast,
} from "../src/dashboard/state.ts";
import type { UiSession, UiState } from "../src/dashboard/state.ts";

const TEST_DB = "/tmp/opencode-all-state-test.db";

const sessions: UiSession[] = Array.from({ length: 6 }, (_, index) => ({
  id: `ses_${index}`,
  title: `Session ${index}`,
  directory: index < 3 ? "/repo/current" : "/repo/other",
  path: "",
  agent: index % 2 === 0 ? "build" : "plan",
  model: `model-${index}`,
  shareUrl: "",
  cost: index,
  tokensInput: index * 10,
  tokensOutput: index * 5,
  timeCreated: index,
  timeUpdated: 100 - index,
  timeArchived: index === 5 ? 999 : null,
  isCurrent: index < 3,
  suspicious: false,
}));

const vp = { height: 20, width: 100 };

function makeIndex(rows: UiSession[]): SessionIndex {
  const index: SessionIndex = {
    active: new Map(),
    archived: new Map(),
    activeByDir: new Map(),
    archivedByDir: new Map(),
  };
  for (const row of rows) {
    if (row.timeArchived != null) {
      addArchivedToIndex(index, row);
    } else {
      addActiveToIndex(index, row);
    }
  }
  return index;
}

function makeState(rows: UiSession[] = sessions): UiState {
  return createInitialState(makeIndex(rows), vp);
}

function createDb(): void {
  const db = new Database(TEST_DB);
  db.run(`CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    title TEXT,
    directory TEXT,
    path TEXT,
    agent TEXT,
    model TEXT,
    share_url TEXT,
    cost REAL,
    tokens_input INTEGER,
    tokens_output INTEGER,
    time_created INTEGER,
    time_updated INTEGER,
    time_archived INTEGER,
    parent_id TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS part (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL
  )`);
  db.run(`INSERT OR REPLACE INTO session VALUES
    ('ses_0','Session 0','/repo/current','','build','model-0','',0,0,0,0,0,NULL,NULL),
    ('ses_5','Session 5','/repo/other','','plan','model-5','',0,0,0,0,0,999,NULL)
  `);
  db.run(`INSERT OR REPLACE INTO message VALUES
    ('msg_active_user','ses_0',1000,1000,'{"role":"user"}'),
    ('msg_active_assistant','ses_0',1001,1001,'{"role":"assistant"}')
  `);
  db.run(`INSERT OR REPLACE INTO part VALUES
    ('part_active_user','msg_active_user','ses_0',1000,1000,'{"type":"text","text":"active user message"}'),
    ('part_active_assistant','msg_active_assistant','ses_0',1001,1001,'{"type":"text","text":"active assistant message"}')
  `);
  db.close();
}

beforeAll(() => {
  process.env.OPENCODE_ALL_DB_PATH = TEST_DB;
  process.env.OPENCODE_ALL_CWD = "/test/cwd";
  createDb();
});

afterAll(() => {
  delete process.env.OPENCODE_ALL_DB_PATH;
  delete process.env.OPENCODE_ALL_CWD;
  try {
    unlinkSync(TEST_DB);
  } catch {}
});

function expandFolderWithSessions(state: UiState): UiState {
  const sessionDirs = new Set(state.sessions.map(s => s.directory));
  const target = state.folders.find(f => sessionDirs.has(f.directory));
  if (!target) return state;
  return { ...state, expandedFolders: new Set([target.directory]) };
}

describe("initial state", () => {
  test("initial focus is sessions", () => {
    const state = makeState();
    expect(state.focus).toBe("sessions");
  });
});

describe("visible rows", () => {
  test("visible rows include folders and expanded sessions when expanded", () => {
    const state = makeState();
    const expanded = expandFolderWithSessions(state);
    const visible = getVisibleRows(expanded);
    const folders = visible.filter(r => !("id" in r));
    const sessionRows = visible.filter(r => "id" in r);
    expect(folders.length).toBeGreaterThan(0);
    expect(sessionRows.length).toBeGreaterThan(0);
  });
});

describe("currentSession", () => {
  test("currentSession undefined on folder rows", () => {
    const state = makeState();
    expect(currentSession(state)).toBeUndefined();
  });
});

describe("clampCursor", () => {
  test("clampCursor bounds cursor within visible rows", () => {
    const state = makeState();
    const total = getVisibleRows(state).length;

    const beyond = clampCursor({ ...state, cursor: 999 });
    expect(beyond.cursor).toBe(total - 1);

    const below = clampCursor({ ...state, cursor: -5 });
    expect(below.cursor).toBe(0);

    const within = clampCursor({ ...state, cursor: 0 });
    expect(within.cursor).toBe(0);
  });
});

describe("reloadState", () => {
  test("reloadState loads active messages for selected active session", () => {
    const state = makeState();
    const expanded = expandFolderWithSessions(state);
    const visible = getVisibleRows(expanded);
    const cursor = visible.findIndex(row => "id" in row && row.id === "ses_0");
    const result = reloadState({ ...expanded, cursor, messageRows: [] });
    expect(result.messageRows.map(row => row.text)).toEqual(["active user message", "active assistant message"]);
  });

  test("reloadState clears messages on folder rows", () => {
    const state = makeState();
    const result = reloadState({ ...state, cursor: 0, messageRows: [{ role: "user", time: 100, text: "stale" }] });
    expect(result.messageRows).toEqual([]);
  });

  test("reloadState loads archived messages for archived tab session", () => {
    const state = makeState();
    const dummy = [{ role: "user" as const, time: 100, text: "hello" }];
    const withMessages = { ...state, messageRows: dummy, tab: "archived" as const };
    const result = reloadState(withMessages);
    expect(result.messageRows).not.toEqual(dummy);
    expect(Array.isArray(result.messageRows)).toBe(true);
  });
});

describe("debounced metadata helpers", () => {
  test("reloadStateFast does not load messages", () => {
    const state = makeState();
    const expanded = expandFolderWithSessions(state);
    const visible = getVisibleRows(expanded);
    const cursor = visible.findIndex(row => "id" in row && row.id === "ses_0");
    const result = reloadStateFast({ ...expanded, cursor, messageRows: [] });
    expect(result.messageRows).toEqual([]);
  });

  test("loadSelectedMessages loads messages for selected session", () => {
    const state = makeState();
    const expanded = expandFolderWithSessions(state);
    const visible = getVisibleRows(expanded);
    const cursor = visible.findIndex(row => "id" in row && row.id === "ses_0");
    const result = loadSelectedMessages({ ...expanded, cursor, messageRows: [] });
    expect(result.messageRows.map(row => row.text)).toEqual(["active user message", "active assistant message"]);
  });
});
