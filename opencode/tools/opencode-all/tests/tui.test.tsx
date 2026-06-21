import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Database } from "bun:sqlite";
import { applyKey, buildSearchOverlay, mapKey, refreshStateFromDisk, runChildSession, type ContinueRequest } from "../src/tui.tsx";
import { addActiveToIndex, addArchivedToIndex, type SessionIndex } from "../src/dashboard/session-index.ts";
import { createInitialState, currentSession, getVisibleRows, reloadState, type UiSession } from "../src/dashboard/state.ts";
import { actionChips } from "../src/dashboard/actions.ts";
import { Box, BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { buildMessagesContent, buildMetadataContent, buildSessionsContent, buildChoiceOverlay, buildConfirmOverlay, buildActionBarContent } from "../src/dashboard/render.ts";
import { dashboardLayout } from "../src/dashboard/layout.ts";

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

const archivedSessions: UiSession[] = [
  { ...sessions[0], timeArchived: 999, directory: "/repo/current" },
  { ...sessions[1], timeArchived: 998, directory: "/repo/other" },
];

const fakeDbDir = join(import.meta.dir, ".no-db");
const fakeDbPath = join(fakeDbDir, "empty.db");

function flatText(content: any): string {
  return content.chunks.map((c: any) => c.text || "").join("");
}

const savedDbPath = process.env.OPENCODE_ALL_DB_PATH;
beforeAll(() => {
  try { mkdirSync(fakeDbDir, { recursive: true }); } catch {}
  const db = new Database(fakeDbPath);
  db.run(`CREATE TABLE IF NOT EXISTS session (
    id text PRIMARY KEY, project_id text NOT NULL, parent_id text,
    slug text NOT NULL, directory text NOT NULL, title text NOT NULL,
    version text NOT NULL, share_url text, summary_additions integer,
    summary_deletions integer, summary_files integer, summary_diffs text,
    time_created integer NOT NULL, time_updated integer NOT NULL,
    time_archived integer, workspace_id text, path text, agent text,
    model text, cost real DEFAULT 0 NOT NULL, tokens_input integer DEFAULT 0 NOT NULL,
    tokens_output integer DEFAULT 0 NOT NULL, tokens_reasoning integer DEFAULT 0 NOT NULL,
    tokens_cache_read integer DEFAULT 0 NOT NULL, tokens_cache_write integer DEFAULT 0 NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS message (
    id text PRIMARY KEY, session_id text NOT NULL,
    time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS part (
    id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
    time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
  )`);
  db.close();
  process.env.OPENCODE_ALL_DB_PATH = fakeDbPath;
});
afterAll(() => { process.env.OPENCODE_ALL_DB_PATH = savedDbPath; if (!savedDbPath) delete process.env.OPENCODE_ALL_DB_PATH; });

function expandFirstFolder(state: any) {
  if (state.folders.length === 0) return state;
  const folder = state.folders[0];
  return { ...state, expandedFolders: new Set([folder.directory]) };
}

function firstSessionCursor(state: any) {
  const visible = getVisibleRows(state);
  for (let i = 0; i < visible.length; i++) {
    if ("id" in visible[i]) return { ...state, cursor: i };
  }
  return state;
}

function expandFolderWithSessions(state: any) {
  const sessionDirs = new Set(state.sessions.map((s: any) => s.directory));
  const target = state.folders.find((f: any) => sessionDirs.has(f.directory));
  if (!target) return state;
  return { ...state, expandedFolders: new Set([target.directory]) };
}

function cursorOnFirstSession(state: any) {
  let next = expandFolderWithSessions(state);
  const visible = getVisibleRows(next);
  for (let i = 0; i < visible.length; i++) {
    if ("id" in visible[i]) return { ...next, cursor: i };
  }
  return next;
}

function makeIndex(rows: UiSession[]): SessionIndex {
  const index: SessionIndex = { active: new Map(), archived: new Map(), activeByDir: new Map(), archivedByDir: new Map() };
  for (const row of rows) {
    if (row.timeArchived != null) addArchivedToIndex(index, row);
    else addActiveToIndex(index, row);
  }
  return index;
}

describe("initial state", () => {
  test("root/no-directory shows folder tree with all folders", () => {
    const state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    const visible = getVisibleRows(state);
    const folders = visible.filter((r) => !("id" in r));
    expect(folders.length).toBeGreaterThan(0);
  });

  test("cursor starts at first row", () => {
    const state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    expect(state.cursor).toBe(0);
  });
});

describe("navigation", () => {
  test("moves selection with j/k", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    expect(state.cursor).toBe(2);
    state = applyKey(state, "k");
    expect(state.cursor).toBe(1);
  });

  test("Tab switches active/archived tab, focus stays sessions", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    expect(state.tab).toBe("active");
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    expect(state.focus).toBe("sessions");
    expect(state.status).toBe("archived tab");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("active");
  });

  test("S-Tab does nothing", () => {
    const state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    const result = applyKey(state, "S-Tab");
    expect(result).toBe(state);
  });

  test("'t' returns hint status", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = applyKey(state, "t");
    expect(state.status).toBe("use Tab to switch Active/Archive");
  });

  test("Tab in search input mode does not change tab", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
    const before = state;
    const after = applyKey(state, "Tab");
    expect(after).toBe(before);
  });

  test("focused mode: Tab switches tab, focus stays sessions", () => {
    const state = createInitialState(makeIndex(sessions), { height: 18, width: 100 });
    expect(dashboardLayout(100, 18).mode).toBe("focused");
    const s1 = applyKey(state, "Tab");
    expect(s1.tab).toBe("archived");
    expect(s1.focus).toBe("sessions");
    const s2 = applyKey(s1, "Tab");
    expect(s2.tab).toBe("active");
  });

  test("sessions focus: j/k move cursor, not scroll", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    expect(state.focus).toBe("sessions");
    const beforeMessage = state.messageScroll;
    const beforeDetail = state.detailScroll;
    state = applyKey(state, "j");
    expect(state.cursor).toBeGreaterThanOrEqual(0);
    expect(state.messageScroll).toBe(beforeMessage);
    expect(state.detailScroll).toBe(beforeDetail);
  });

  test("messages focus: j/k scroll messageScroll fallback state", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = { ...state, focus: "messages" as const, messageRows: [
      { role: "user", time: 1, text: "a" },
      { role: "user", time: 2, text: "b" },
      { role: "user", time: 3, text: "c" },
    ] };
    const beforeCursor = state.cursor;
    state = applyKey(state, "j");
    expect(state.messageScroll).toBe(1);
    expect(state.cursor).toBe(beforeCursor);
    state = applyKey(state, "j");
    expect(state.messageScroll).toBe(2);
    state = applyKey(state, "k");
    expect(state.messageScroll).toBe(1);
  });

  test("metadata focus: j/k scroll detailScroll fallback state", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = { ...state, focus: "metadata" as const };
    const beforeCursor = state.cursor;
    state = applyKey(state, "j");
    expect(state.detailScroll).toBe(1);
    expect(state.cursor).toBe(beforeCursor);
    state = applyKey(state, "j");
    expect(state.detailScroll).toBe(2);
    state = applyKey(state, "k");
    expect(state.detailScroll).toBe(1);
  });

  test("messages focus: G jumps messageScroll to last row", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = { ...state, focus: "messages" as const, messageRows: [
      { role: "user", time: 1, text: "a" },
      { role: "user", time: 2, text: "b" },
      { role: "user", time: 3, text: "c" },
    ] };
    state = applyKey(state, "G");
    expect(state.messageScroll).toBe(2);
  });

  test("metadata focus: G jumps detailScroll to end", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = { ...state, focus: "metadata" as const };
    state = applyKey(state, "G");
    expect(state.detailScroll).toBeGreaterThan(0);
  });

  test("messages focus: Ctrl+D/PageDown bumps messageScroll by 5", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = { ...state, focus: "messages" as const, messageRows: [
      { role: "user", time: 1, text: "a" },
      { role: "user", time: 2, text: "b" },
      { role: "user", time: 3, text: "c" },
    ] };
    state = applyKey(state, "Ctrl+D");
    expect(state.messageScroll).toBe(2);
    state = applyKey(state, "PageDown");
    expect(state.messageScroll).toBe(2);
  });

  test("metadata focus: Ctrl+U/PageUp decrements detailScroll with floor 0", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = { ...state, focus: "metadata" as const, detailScroll: 1 };
    state = applyKey(state, "Ctrl+U");
    expect(state.detailScroll).toBe(0);
    state = applyKey(state, "PageUp");
    expect(state.detailScroll).toBe(0);
  });
});

describe("enter semantics", () => {
  test("Enter on session drives opencode continue flow (no pendingAction)", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "Enter");
    expect(state.pendingAction).toBeNull();
  });
});

describe("search mode", () => {
  test("slash enters search mode", () => {
    let state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
  });

  test("Escape exits search mode and clears query", () => {
    let state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "type:curr");
    state = applyKey(state, "Escape");
    expect(state.inputMode).toBeNull();
    expect(state.query).toBe("");
  });

  test("ArrowDown/ArrowUp in search mode update searchSelected, ArrowUp decrements at top", () => {
    let state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "ArrowDown");
    state = applyKey(state, "ArrowDown");
    expect(state.searchSelected).toBe(2);
    state = applyKey(state, "ArrowUp");
    expect(state.searchSelected).toBe(1);
    state = applyKey(state, "ArrowUp");
    state = applyKey(state, "ArrowUp");
    state = applyKey(state, "ArrowUp");
    expect(state.searchSelected).toBe(0);
  });

  test("literal j in search mode appends to query", () => {
    let state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "j");
    expect(state.query).toBe("j");
    expect(state.searchSelected).toBe(0);
  });

  test("literal k in search mode appends to query", () => {
    let state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "k");
    expect(state.query).toBe("k");
    expect(state.searchSelected).toBe(0);
  });

  test("ArrowDown in search mode updates searchScroll when selection passes visible window", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    let state = createInitialState(makeIndex(many), { height: 14, width: 100 });
    state = applyKey(state, "/");
    for (let i = 0; i < 12; i++) state = applyKey(state, "ArrowDown");
    expect(state.searchSelected).toBe(12);
    expect(state.searchScroll).toBeGreaterThan(0);
  });

  test("j in search mode does not move selection across many results", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    let state = createInitialState(makeIndex(many), { height: 14, width: 100 });
    state = applyKey(state, "/");
    for (let i = 0; i < 12; i++) state = applyKey(state, "j");
    expect(state.query.length).toBe(12);
    expect(state.searchSelected).toBe(0);
    expect(state.searchScroll).toBe(0);
  });
});

describe("Esc as universal back/close", () => {
  test("Esc at root gives already at root", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = applyKey(state, "Escape");
    expect(state.status).toBe("already at root");
  });

  test("Esc cancels pending action", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "D");
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    state = applyKey(state, "Escape");
    expect(state.pendingAction).toBeNull();
    expect(state.status).toBe("cancelled");
  });
});

describe("confirmation workflow semantics", () => {
  test("active session: a no longer triggers direct archive", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "a");
    expect(next.pendingAction).toBeNull();
    expect(next.pendingChoice).toBeNull();
    expect(next.status).toBe("use D to archive or delete this session");
  });

  test("active session: D -> choice, then a -> archive confirmation", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "D");
    expect(state.pendingChoice).toBe("archive_or_delete");
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    expect(state.pendingChoice).toBeNull();
  });

  test("active session: D/D/Delete sets pendingChoice archive_or_delete", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "D");
    expect(state.pendingChoice).toBe("archive_or_delete");
  });

  test("archived session: r is no longer bound (legacy restore removed)", () => {
    let state = createInitialState(makeIndex(archivedSessions), { height: 10, width: 100 });
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "r");
    expect(next.pendingAction).toBeNull();
    expect(next).toBe(state);
  });

  test("archived session: D sets pendingAction delete (no choice overlay)", () => {
    let state = createInitialState(makeIndex(archivedSessions), { height: 10, width: 100 });
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "D");
    expect(next.pendingAction).toBe("delete");
    expect(next.pendingChoice).toBeNull();
  });

  test("folder rows only show folders that have sessions", () => {
    const state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    const visible = getVisibleRows(state);
    for (const row of visible) {
      if (!("id" in row)) {
        const dir = (row as any).directory;
        const inState = state.sessions.some((s: any) => s.directory === dir);
        const inDb = state.folders.some((f: any) => f.directory === dir && f.active + f.archived > 0);
        expect(inState || inDb).toBe(true);
      }
    }
  });

  test("folder rows accept bulk archive when active sessions exist", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = { ...state, pendingChoice: "archive_or_delete", pendingDirectory: "/repo/current", pendingCount: 3 };
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("bulk_archive");
  });

  test("active sessions reject restore", () => {
    let state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "r");
    expect(state.status).toBe("import only applies to archived sessions");
  });

  test("archived sessions reject archive", () => {
    let state = createInitialState(makeIndex(archivedSessions), { height: 10, width: 100 });
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "a");
    expect(next.status).toBe("archive only applies to active sessions");
  });
});

describe("removed workflow keys", () => {
  test("action chips do not expose c/C/E/m keys", () => {
    const state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    const chips = actionChips(state);
    const allKeys = chips.flatMap(c => (c.key || "").split("|")).filter(Boolean);
    for (const banned of ["c", "C", "E", "m"]) {
      expect(allKeys).not.toContain(banned);
    }
  });
});

describe("render helpers", () => {
  test("search overlay footer shows Enter open", () => {
    const state = createInitialState(makeIndex(sessions), { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "furaide";
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("Enter open");
  });

  test("search row contains both title and directory", () => {
    const state = createInitialState(makeIndex(sessions), { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "Session 0";
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("Session 0");
    expect(text).toContain("/repo/current");
  });

  test("action chips show Esc back for active session", () => {
    const state = createInitialState(makeIndex(sessions), { height: 10, width: 100 });
    const folder = state.folders[0];
    const next = { ...state, expandedFolders: new Set([folder.directory]), cursor: 1 };
    const labels = actionChips(next).map(c => c.label);
    expect(labels).toContain("Esc back");
  });

  test("action chips show import hint for archived session", () => {
    const archived = sessions.map((s) => ({ ...s, timeArchived: 100 }));
    let state = createInitialState(makeIndex(archived), { height: 10, width: 100 });
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const labels = actionChips(state).map(c => c.label);
    expect(labels).toContain("I import");
  });

  test("search overlay shows position indicator when more results than visible window", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    const state = createInitialState(makeIndex(many), { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "Session";
    state.searchSelected = 15;
    state.searchScroll = 10;
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("\u2191\u2193");
    expect(text).toContain("Enter open");
    expect(text).toContain("Esc cancel");
  });

  test("search overlay at scroll 0 shows first result title", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    const state = createInitialState(makeIndex(many), { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "Session";
    state.searchSelected = 0;
    state.searchScroll = 0;
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("Session 0");
  });

  test("choice overlay renders and toggles visibility based on pendingChoice", () => {
    const state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    const overlay = buildChoiceOverlay(state);
    const text = String(overlay.chunks.map(c => c.text || "").join(""));
    expect(text).toBe("");

    const withChoice = { ...state, pendingChoice: "archive_or_delete" as const };
    const overlay2 = buildChoiceOverlay(withChoice);
    const text2 = String(overlay2.chunks.map(c => c.text || "").join(""));
    expect(text2).toContain("Archive or Delete");
    expect(text2).toContain("[A]");
    expect(text2).toContain("[D]");
  });

  test("search overlay with scroll advanced shows higher-numbered title", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    const state = createInitialState(makeIndex(many), { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "Session";
    state.searchSelected = 12;
    state.searchScroll = 5;
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("Session 5");
    expect(text).toContain("Session 12");
  });
});

describe("scrollable layout tree (ScrollBoxRenderable)", () => {
  test("wide layout assembles messages+metadata top row and sessions row with action bar", async () => {
    const setup = await createTestRenderer({ width: 120, height: 30 });
    try {
      const { renderer } = setup;
      const state = createInitialState(makeIndex(sessions), { width: 120, height: 30 });
      const layout = dashboardLayout(120, 30);
      expect(layout.mode).toBe("wide");

      const messagesText = new TextRenderable(renderer, { id: "messages-text", wrapMode: "word", content: buildMessagesContent(state) });
      const messagesScroll = new ScrollBoxRenderable(renderer, { id: "messages-scroll", scrollY: true });
      messagesScroll.add(messagesText);

      const metadataText = new TextRenderable(renderer, { id: "metadata-text", wrapMode: "word", content: buildMetadataContent(state) });
      const metadataScroll = new ScrollBoxRenderable(renderer, { id: "metadata-scroll", scrollY: true });
      metadataScroll.add(metadataText);

      const sessionsText = new TextRenderable(renderer, { id: "sessions-text", wrapMode: "word", content: buildSessionsContent(state) });
      const sessionsScroll = new ScrollBoxRenderable(renderer, { id: "sessions-scroll", scrollY: true });
      sessionsScroll.add(sessionsText);

      expect(messagesScroll.getChildren().map(c => c.id)).toEqual(["messages-text"]);
      expect(metadataScroll.getChildren().map(c => c.id)).toEqual(["metadata-text"]);
      expect(sessionsScroll.getChildren().map(c => c.id)).toEqual(["sessions-text"]);

      const actionBarText = new TextRenderable(renderer, { id: "action-bar-text", height: layout.actionRows, wrapMode: "word", truncate: true, content: buildActionBarContent(state) });
      const actionBar = new BoxRenderable(renderer, { id: "action-bar", width: "100%", height: layout.actionRows, flexDirection: "row", backgroundColor: "#000000" });
      actionBar.add(actionBarText);
      expect(actionBar.getChildren().map(c => c.id)).toEqual(["action-bar-text"]);

      const topRow = Box({ flexDirection: "row", flexGrow: layout.topPercent },
        Box({ flexDirection: "column", flexGrow: 1 }, messagesScroll),
        Box({ flexDirection: "column", flexGrow: 1 }, metadataScroll),
      );
      const sessionsRow = Box({ flexDirection: "column", flexGrow: layout.sessionsPercent }, sessionsScroll);
      const bodyArea = new BoxRenderable(renderer, { id: "body-area", flexDirection: "column", flexGrow: 1 });
      bodyArea.add(topRow);
      bodyArea.add(sessionsRow);
      const rootColumn = Box({ flexDirection: "column", width: "100%", height: "100%" }, bodyArea, actionBar);
      renderer.root.add(rootColumn);

      const bodyChildren = bodyArea.getChildren();
      expect(bodyChildren.length).toBe(2);
      expect(actionBar.id).toBe("action-bar");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("focused layout shows a single pane filling the body when state.focus is set", async () => {
    const setup = await createTestRenderer({ width: 50, height: 15 });
    try {
      const { renderer } = setup;
      const state: any = { ...createInitialState(makeIndex(sessions), { width: 50, height: 15 }), focus: "metadata" };
      const layout = dashboardLayout(50, 15);
      expect(layout.mode).toBe("focused");

      const metadataText = new TextRenderable(renderer, { id: "metadata-text", wrapMode: "word", content: buildMetadataContent(state) });
      const metadataScroll = new ScrollBoxRenderable(renderer, { id: "metadata-scroll", scrollY: true });
      metadataScroll.add(metadataText);

      const messagesText = new TextRenderable(renderer, { id: "messages-text", wrapMode: "word", content: buildMessagesContent(state) });
      const messagesScroll = new ScrollBoxRenderable(renderer, { id: "messages-scroll", scrollY: true });
      messagesScroll.add(messagesText);

      const sessionsText = new TextRenderable(renderer, { id: "sessions-text", wrapMode: "word", content: buildSessionsContent(state) });
      const sessionsScroll = new ScrollBoxRenderable(renderer, { id: "sessions-scroll", scrollY: true });
      sessionsScroll.add(sessionsText);

      const focusPane = state.focus === "messages" ? messagesScroll
        : state.focus === "metadata" ? metadataScroll
        : sessionsScroll;
      expect(focusPane.id).toBe("metadata-scroll");

      const bodyArea = new BoxRenderable(renderer, { id: "body-area", flexDirection: "column", flexGrow: 1 });
      bodyArea.add(focusPane);
      expect(bodyArea.getChildren().map(c => c.id)).toEqual(["metadata-scroll"]);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("overlays are BoxRenderable modals containing TextRenderable content", async () => {
    const setup = await createTestRenderer({ width: 120, height: 30 });
    try {
      const { renderer } = setup;
      const state = createInitialState(makeIndex(sessions), { width: 120, height: 30 });

      const searchText = new TextRenderable(renderer, { id: "search-overlay-text", content: buildSearchOverlay({ ...state, inputMode: "search" }) });
      const searchBox = new BoxRenderable(renderer, { id: "search-overlay", position: "absolute", top: "20%", left: "10%", right: "10%", bottom: "20%", zIndex: 100, visible: false, flexDirection: "column", border: true, borderColor: "#555555", backgroundColor: "#222222" });
      searchBox.add(searchText);
      expect(searchBox.getChildren().map(c => c.id)).toEqual(["search-overlay-text"]);

      const confirmText = new TextRenderable(renderer, { id: "confirm-overlay-text", content: buildConfirmOverlay(state) });
      const confirmBox = new BoxRenderable(renderer, { id: "confirm-overlay", position: "absolute", top: "35%", left: "15%", right: "15%", bottom: "35%", zIndex: 110, visible: false, flexDirection: "column", border: true, borderColor: "#555555", backgroundColor: "#222222" });
      confirmBox.add(confirmText);
      expect(confirmBox.getChildren().map(c => c.id)).toEqual(["confirm-overlay-text"]);

      const choiceText = new TextRenderable(renderer, { id: "choice-overlay-text", content: buildChoiceOverlay(state) });
      const choiceBox = new BoxRenderable(renderer, { id: "choice-overlay", position: "absolute", top: "32%", left: "15%", right: "15%", bottom: "32%", zIndex: 105, visible: false, flexDirection: "column", border: true, borderColor: "#555555", backgroundColor: "#222222" });
      choiceBox.add(choiceText);
      expect(choiceBox.getChildren().map(c => c.id)).toEqual(["choice-overlay-text"]);

      renderer.root.add(searchBox);
      renderer.root.add(confirmBox);
      renderer.root.add(choiceBox);
      expect(searchBox.id).toBe("search-overlay");
      expect(confirmBox.id).toBe("confirm-overlay");
      expect(choiceBox.id).toBe("choice-overlay");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("ScrollBoxRenderable accepts onMouseDown and onMouseScroll options", async () => {
    const setup = await createTestRenderer({ width: 100, height: 30 });
    try {
      const { renderer } = setup;
      let downCount = 0;
      let scrollCount = 0;
      const text = new TextRenderable(renderer, { id: "t", wrapMode: "word", content: "x" });
      const scrollBox = new ScrollBoxRenderable(renderer, {
        id: "sb",
        scrollY: true,
        onMouseDown: () => { downCount += 1; },
        onMouseScroll: () => { scrollCount += 1; },
      });
      scrollBox.add(text);

      const frame = setup.captureCharFrame();
      expect(typeof frame).toBe("string");
      expect(scrollBox.getChildren().map(c => c.id)).toEqual(["t"]);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("TextRenderable content can be reassigned with fresh StyledText from render builders", async () => {
    const setup = await createTestRenderer({ width: 100, height: 30 });
    try {
      const { renderer } = setup;
      const baseState = createInitialState(makeIndex(sessions), { width: 100, height: 30 });
      const withCursor = cursorOnFirstSession(baseState);
      const text = new TextRenderable(renderer, { id: "messages-text", wrapMode: "word", content: buildMessagesContent(withCursor) });
      const initial = String(text.content.chunks.map(c => c.text || "").join(""));
      text.content = buildMessagesContent({ ...withCursor, cursor: withCursor.cursor + 1 });
      const after = String(text.content.chunks.map(c => c.text || "").join(""));
      expect(text.content).toBeInstanceOf(Object);
      expect(typeof initial).toBe("string");
      expect(typeof after).toBe("string");
    } finally {
      setup.renderer.destroy();
    }
  });
});

describe("runChildSession", () => {
  test("suspends renderer during child session and resumes after exit", async () => {
    const calls: string[] = [];
    const renderer = {
      suspend: () => { calls.push("suspend"); },
      resume: () => { calls.push("resume"); },
      requestRender: () => { calls.push("render"); },
    };
    const audits: Array<{ action: string; sessionId: string; status: string }> = [];
    const child = new EventEmitter() as any;
    const spawnImpl = (_bin: string, args: string[], _opts: any) => {
      expect(args).toEqual(["--session", "ses_1"]);
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    };
    await runChildSession(renderer as any, { id: "ses_1", fork: false } as ContinueRequest, spawnImpl as any, (action, sessionId, status) => {
      audits.push({ action, sessionId, status });
    });
    expect(calls).toEqual(["suspend", "resume"]);
    expect(audits).toEqual([
      { action: "open_session", sessionId: "ses_1", status: "started" },
      { action: "open_session", sessionId: "ses_1", status: "exit 0" },
    ]);
  });

  test("records child error and still resumes renderer", async () => {
    const calls: string[] = [];
    const renderer = {
      suspend: () => { calls.push("suspend"); },
      resume: () => { calls.push("resume"); },
      requestRender: () => { calls.push("render"); },
    };
    const audits: Array<{ action: string; sessionId: string; status: string }> = [];
    const child = new EventEmitter() as any;
    const spawnImpl = (_bin: string, _args: string[], _opts: any) => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("boom"), { code: "ENOENT" })));
      return child;
    };
    await runChildSession(renderer as any, { id: "ses_2", fork: false } as ContinueRequest, spawnImpl as any, (action, sessionId, status) => {
      audits.push({ action, sessionId, status });
    });
    expect(calls).toEqual(["suspend", "resume"]);
    expect(audits[0]).toEqual({ action: "open_session", sessionId: "ses_2", status: "started" });
    expect(audits[1].action).toBe("open_session");
    expect(audits[1].sessionId).toBe("ses_2");
    expect(audits[1].status).toContain("opencode CLI not found");
  });

  test("refresh-after-child returns renderer to ready for next request", async () => {
    const calls: string[] = [];
    const renderer = {
      suspend: () => { calls.push("suspend"); },
      resume: () => { calls.push("resume"); },
      requestRender: () => { calls.push("render"); },
    };
    const child = new EventEmitter() as any;
    const spawnImpl = (_bin: string, _args: string[], _opts: any) => {
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    };
    await runChildSession(renderer as any, { id: "ses_3", fork: false } as ContinueRequest, spawnImpl as any, () => {});
    expect(calls).toEqual(["suspend", "resume"]);
  });
});

describe("mapKey", () => {
  test("down arrow maps to ArrowDown", () => {
    expect(mapKey({ name: "down" })).toBe("ArrowDown");
  });

  test("up arrow maps to ArrowUp", () => {
    expect(mapKey({ name: "up" })).toBe("ArrowUp");
  });

  test("mapKey does not map down to j or up to k", () => {
    expect(mapKey({ name: "down" })).not.toBe("j");
    expect(mapKey({ name: "up" })).not.toBe("k");
  });

  test("mapKey supports other named keys", () => {
    expect(mapKey({ name: "escape" })).toBe("Escape");
    expect(mapKey({ name: "return" })).toBe("Enter");
    expect(mapKey({ name: "backspace" })).toBe("Backspace");
    expect(mapKey({ name: "tab" })).toBe("Tab");
  });

  test("mapKey ctrl+d maps to Ctrl+D", () => {
    expect(mapKey({ ctrl: true, name: "d" })).toBe("Ctrl+D");
  });

  test("mapKey ctrl+c maps to q", () => {
    expect(mapKey({ ctrl: true, name: "c" })).toBe("q");
  });
});

describe("refreshStateFromDisk", () => {
  function seedDb(rows: UiSession[]): void {
    const db = new Database(fakeDbPath);
    db.run("DELETE FROM session");
    for (const row of rows) {
      if (row.timeArchived != null) continue;
      db.run(
        `INSERT OR REPLACE INTO session
        (id, project_id, parent_id, slug, directory, title, version, share_url,
         summary_additions, summary_deletions, summary_files, summary_diffs,
         time_created, time_updated, time_archived, workspace_id, path, agent,
         model, cost, tokens_input, tokens_output, tokens_reasoning,
         tokens_cache_read, tokens_cache_write)
        VALUES (?, ?, NULL, ?, ?, ?, ?, '', 0, 0, 0, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
        [
          row.id,
          "p",
          `s-${row.id}`,
          row.directory,
          row.title,
          "v",
          row.timeCreated,
          row.timeUpdated,
          row.path || "",
          row.agent || "",
          row.model || "",
          row.cost,
          row.tokensInput,
          row.tokensOutput,
        ],
      );
    }
    db.close();
  }

  test("preserves selected session by id after rebuild", () => {
    const active = sessions.filter(s => s.timeArchived == null);
    seedDb(active);
    let state = createInitialState(makeIndex(active), { height: 20, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    const before = currentSession(state);
    expect(before?.id).toBe("ses_0");
    const after = refreshStateFromDisk(state, "index refreshed");
    expect(after.status).toBe("index refreshed");
    const sel = currentSession(after);
    expect(sel?.id).toBe("ses_0");
  });

  test("falls back to clamp when selected id disappears", () => {
    const active = sessions.filter(s => s.timeArchived == null);
    seedDb(active);
    let state = createInitialState(makeIndex(active), { height: 20, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    const before = currentSession(state);
    expect(before?.id).toBe("ses_0");
    const reduced: UiSession[] = active.filter(s => s.directory !== "/repo/current");
    seedDb(reduced);
    const candidate: any = { ...state, index: makeIndex(reduced) };
    const after = refreshStateFromDisk(candidate, "back from session");
    expect(after.status).toBe("back from session");
    const sel = currentSession(after);
    if (sel) expect(reduced.some(s => s.id === sel.id)).toBe(true);
  });

  test("preserves focus and tab on refresh", () => {
    seedDb(sessions);
    let state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    state = { ...state, focus: "metadata" as const, tab: "archived" as const };
    const after = refreshStateFromDisk(state, "index refreshed");
    expect(after.focus).toBe("metadata");
    expect(after.tab).toBe("archived");
  });

  test("clears stale opening status with new status", () => {
    seedDb(sessions);
    let state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    state = { ...state, status: "opening ses_0" };
    const after = refreshStateFromDisk(state, "back from session");
    expect(after.status).toBe("back from session");
  });
});
