import { describe, expect, test } from "bun:test";
import {
  applyKey,
  buildSearchOverlay,
  contextHints,
  createInitialState,
  currentSession,
  getVisibleRows,
  type UiSession,
} from "../src/tui.tsx";

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

function flatText(content: any): string {
  return content.chunks.map((c: any) => c.text || "").join("");
}

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

describe("initial state", () => {
  test("root/no-directory shows folder tree with all folders", () => {
    const state = createInitialState(sessions, { height: 20, width: 100 });
    const visible = getVisibleRows(state);
    const folders = visible.filter((r) => !("id" in r));
    expect(folders.length).toBeGreaterThan(0);
  });

  test("cursor starts at first row", () => {
    const state = createInitialState(sessions, { height: 20, width: 100 });
    expect(state.cursor).toBe(0);
  });
});

describe("navigation", () => {
  test("moves selection with j/k", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    expect(state.cursor).toBe(2);
    state = applyKey(state, "k");
    expect(state.cursor).toBe(1);
  });

  test("tab cycles active -> archived -> active", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    expect(state.tab).toBe("active");
    state = applyKey(state, "Tab");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    state = applyKey(state, "Tab");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("active");
  });
});

describe("enter semantics", () => {
  test("Enter on session drives opencode continue flow (no pendingAction)", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "Enter");
    expect(state.pendingAction).toBeNull();
  });
});

describe("search mode", () => {
  test("slash enters search mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
  });

  test("Escape exits search mode and clears query", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "type:curr");
    state = applyKey(state, "Escape");
    expect(state.inputMode).toBeNull();
    expect(state.query).toBe("");
  });
});

describe("Esc as universal back/close", () => {
  test("Esc at root gives already at root", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "Escape");
    expect(state.status).toBe("already at root");
  });

  test("Esc cancels pending action", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    state = applyKey(state, "Escape");
    expect(state.pendingAction).toBeNull();
    expect(state.status).toBe("cancelled");
  });
});

describe("confirmation workflow semantics", () => {
  test("active session: a -> archive confirmation", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
  });

  test("active session: d -> archive_and_delete confirmation", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "d");
    expect(state.pendingAction).toBe("archive_and_delete");
  });

  test("archived session: i -> import confirmation", () => {
    let state = createInitialState(archivedSessions, { height: 10, width: 100 });
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "i");
    expect(next.pendingAction).toBe("import");
  });

  test("archived session: d -> delete confirmation (permanent)", () => {
    let state = createInitialState(archivedSessions, { height: 10, width: 100 });
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "d");
    expect(next.pendingAction).toBe("delete");
  });

  test("folder rows only show folders that have sessions", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
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
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = applyKey(state, "j");
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("bulk_archive");
  });

  test("active sessions reject restore", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "r");
    expect(state.status).toBe("restore only applies to archived sessions");
  });

  test("archived sessions reject archive", () => {
    let state = createInitialState(archivedSessions, { height: 10, width: 100 });
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "a");
    expect(next.status).toBe("archive only applies to active sessions");
  });
});

describe("removed workflow keys", () => {
  test("context hints do not expose c/C/E/m", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const hints = contextHints(state);
    expect(hints).not.toMatch(/\bc\b/);
    expect(hints).not.toMatch(/\bC\b/);
    expect(hints).not.toMatch(/\bE\b/);
    expect(hints).not.toMatch(/\bm\b/);
  });
});

describe("render helpers", () => {
  test("search overlay footer shows Enter open", () => {
    const state = createInitialState(sessions, { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "furaide";
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("Enter open");
  });

  test("search row contains both title and directory", () => {
    const state = createInitialState(sessions, { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "Session 0";
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("Session 0");
    expect(text).toContain("/repo/current");
  });

  test("context hints show Esc back for active session", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const folder = state.folders[0];
    const next = { ...state, expandedFolders: new Set([folder.directory]), cursor: 1 };
    expect(contextHints(next)).toContain("Esc back");
  });

  test("context hints show import hint for archived session", () => {
    const archived = sessions.map((s) => ({ ...s, timeArchived: 100 }));
    let state = createInitialState(archived, { height: 10, width: 100 });
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    expect(contextHints(state)).toContain("i import");
  });
});
