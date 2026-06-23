import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  addActiveToIndex,
  addArchivedToIndex,
  type SessionIndex,
} from "../src/dashboard/session-index.ts";
import { createInitialState, getVisibleRows, reloadState, type PaneFocus, type UiSession, type UiState } from "../src/dashboard/state.ts";
import {
  confirmOverlayText,
  actionContext,
  actionChips,
  applyKey,
  clearActionMemo,
  executePendingAction,
  searchResultsFor,
  type ActionChip,
} from "../src/dashboard/actions.ts";

const existingDir = import.meta.dir;
const otherDir = join(import.meta.dir, "..", "src");
const TEST_DB_PATH = "/tmp/opencode-all-actions-test-empty.db";

let savedDbPath: string | undefined;
beforeAll(() => {
  savedDbPath = process.env.OPENCODE_ALL_DB_PATH;
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  const db = new Database(TEST_DB_PATH);
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
  db.close();
  process.env.OPENCODE_ALL_DB_PATH = TEST_DB_PATH;
});
afterAll(() => {
  if (savedDbPath) process.env.OPENCODE_ALL_DB_PATH = savedDbPath;
  else delete process.env.OPENCODE_ALL_DB_PATH;
});

const sessions: UiSession[] = Array.from({ length: 6 }, (_, index) => ({
  id: `ses_${index}`,
  title: `Session ${index}`,
  directory: index < 3 ? existingDir : otherDir,
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
  { ...sessions[0], timeArchived: 999, directory: existingDir },
  { ...sessions[1], timeArchived: 998, directory: otherDir },
];

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

function expandFolderWithSessions(state: any): any {
  const sessionDirs = new Set(state.sessions.map((s: any) => s.directory));
  const target = state.folders.find((f: any) => sessionDirs.has(f.directory));
  if (!target) return state;
  return { ...state, expandedFolders: new Set([target.directory]) };
}

function cursorOnFirstSession(state: any): any {
  let next = expandFolderWithSessions(state);
  const visible = getVisibleRows(next);
  for (let i = 0; i < visible.length; i++) {
    if ("id" in visible[i]) return { ...next, cursor: i };
  }
  return next;
}

function cursorOnFirstFolder(state: any): any {
  const visible = getVisibleRows(state);
  for (let i = 0; i < visible.length; i++) {
    if (!("id" in visible[i])) return { ...state, cursor: i };
  }
  return state;
}

function chipIds(chips: ActionChip[]): string[] {
  return chips.map(c => c.id);
}

function chipLabels(chips: ActionChip[]): string[] {
  return chips.map(c => c.label);
}

describe("confirmOverlayText", () => {
  test("returns empty string when no pending action", () => {
    const state = makeState();
    expect(confirmOverlayText(state)).toBe("");
  });

  test("archive", () => {
    const state = cursorOnFirstSession(makeState());
    const text = confirmOverlayText({ ...state, pendingAction: "archive" });
    expect(text).toContain("Archive session");
  });

  test("import", () => {
    const state = cursorOnFirstSession(makeState(archivedSessions));
    const text = confirmOverlayText({ ...state, pendingAction: "import" });
    expect(text).toContain("Import archived session");
  });

  test("delete", () => {
    const state = cursorOnFirstSession(makeState());
    const text = confirmOverlayText({ ...state, pendingAction: "delete" });
    expect(text).toContain("Delete");
    expect(text).toContain("permanently");
  });

  test("bulk_archive", () => {
    const state = makeState();
    const text = confirmOverlayText({ ...state, pendingAction: "bulk_archive", pendingDirectory: "/repo", pendingCount: 3 });
    expect(text).toContain("Bulk archive");
    expect(text).toContain("/repo");
  });

  test("bulk_restore", () => {
    const state = makeState();
    const text = confirmOverlayText({ ...state, pendingAction: "bulk_restore", pendingDirectory: "/repo", pendingCount: 2 });
    expect(text).toContain("Bulk restore");
    expect(text).toContain("/repo");
  });

  test("bulk_delete", () => {
    const state = makeState();
    const text = confirmOverlayText({ ...state, pendingAction: "bulk_delete", pendingDirectory: "/repo", pendingCount: 5 });
    expect(text).toContain("Bulk delete");
    expect(text).toContain("/repo");
  });
});

describe("actionContext", () => {
  test("folder row returns isFolder", () => {
    const state = cursorOnFirstFolder(makeState());
    const ctx = actionContext(state);
    expect(ctx.isFolder).toBe(true);
    expect(ctx.isSession).toBe(false);
    expect(ctx.isArchived).toBe(false);
  });

  test("active session row returns isSession not isArchived", () => {
    const state = cursorOnFirstSession(makeState());
    const ctx = actionContext(state);
    expect(ctx.isFolder).toBe(false);
    expect(ctx.isSession).toBe(true);
    expect(ctx.isArchived).toBe(false);
  });

  test("archived session row returns isSession and isArchived", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const ctx = actionContext(state);
    expect(ctx.isFolder).toBe(false);
    expect(ctx.isSession).toBe(true);
    expect(ctx.isArchived).toBe(true);
  });
});

describe("actionChips", () => {
  test("pending action returns confirm/cancel chips", () => {
    const state = { ...makeState(), pendingAction: "archive" as const };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["confirm", "cancel"]);
    expect(chipLabels(chips)).toEqual(["[y/Enter] confirm", "[n/Esc] cancel"]);
  });

  test("search mode returns search-only chips", () => {
    const state = { ...makeState(), inputMode: "search" as const, query: "" };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["open", "wheel", "cancel"]);
    expect(chipLabels(chips)).toEqual(["Enter open", "wheel scroll", "Esc cancel"]);
  });

  test("metadata focus returns generic focus chips", () => {
    const state = { ...makeState(), focus: "metadata" as const };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["tab-switch", "back", "quit", "wheel"]);
  });

  test("messages focus returns generic focus chips", () => {
    const state = { ...makeState(), focus: "messages" as const };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["tab-switch", "back", "quit", "wheel"]);
  });

  test("action chips do not advertise unsupported mouse click actions", () => {
    const contexts = [
      { ...makeState(), pendingAction: "archive" as const },
      { ...makeState(), inputMode: "search" as const },
      { ...makeState(), focus: "metadata" as const },
      { ...makeState(), focus: "messages" as const },
      cursorOnFirstFolder(makeState()),
      cursorOnFirstSession(makeState()),
    ];
    for (const state of contexts) {
      const labels = chipLabels(actionChips(state));
      expect(labels.some(label => label.includes("click") || label.includes("double-click"))).toBe(false);
    }
  });

  test("metadata focus hides all destructive actions (delete, archive, import)", () => {
    const state = { ...makeState(), focus: "metadata" as const };
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("import");
    expect(ids).not.toContain("expand");
    expect(ids).not.toContain("open");
  });

  test("messages focus hides all destructive actions (delete, archive, import)", () => {
    const state = { ...makeState(), focus: "messages" as const };
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("import");
    expect(ids).not.toContain("expand");
    expect(ids).not.toContain("open");
  });

  test("metadata focus has no danger chips", () => {
    const state = { ...makeState(), focus: "metadata" as const };
    const chips = actionChips(state);
    expect(chips.some(c => c.danger)).toBe(false);
  });

  test("messages focus has no danger chips", () => {
    const state = { ...makeState(), focus: "messages" as const };
    const chips = actionChips(state);
    expect(chips.some(c => c.danger)).toBe(false);
  });

  test("active session chips include tab-switch not tab-focus", () => {
    const state = cursorOnFirstSession(makeState());
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("tab-switch");
    expect(chipIds(chips)).not.toContain("tab");
  });

  test("archived session chips include tab-switch not tab-focus", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("tab-switch");
    expect(chipIds(chips)).not.toContain("tab");
  });

  test("folder row in sessions focus includes tab-switch not tab", () => {
    const state = cursorOnFirstFolder(makeState());
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("tab-switch");
    expect(chipIds(chips)).not.toContain("tab");
  });

  test("folder row returns chip set with expand/toggle/delete/search/switch/back/quit (active tab)", () => {
    const state = cursorOnFirstFolder(makeState());
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("expand");
    expect(chipIds(chips)).toContain("toggle-all");
    expect(chipIds(chips)).toContain("delete");
    expect(chipIds(chips)).toContain("search");
    expect(chipIds(chips)).toContain("tab-switch");
    expect(chipIds(chips)).toContain("back");
    expect(chipIds(chips)).toContain("quit");
    expect(chipIds(chips)).not.toContain("archive");
  });

  test("active session row returns chip set with open/delete/search/switch/back/quit", () => {
    const state = cursorOnFirstSession(makeState());
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("open");
    expect(chipIds(chips)).toContain("delete");
    expect(chipIds(chips)).toContain("search");
    expect(chipIds(chips)).toContain("tab-switch");
    expect(chipIds(chips)).toContain("back");
    expect(chipIds(chips)).toContain("quit");
    expect(chipIds(chips)).not.toContain("archive");
    expect(chipIds(chips)).not.toContain("import");
  });

  test("archived session row returns chip set with import/delete/search/switch/back/quit", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("import");
    expect(chipIds(chips)).toContain("delete");
    expect(chipIds(chips)).toContain("search");
    expect(chipIds(chips)).toContain("tab-switch");
    expect(chipIds(chips)).toContain("back");
    expect(chipIds(chips)).toContain("quit");
    expect(chipIds(chips)).not.toContain("open");
    expect(chipIds(chips)).not.toContain("archive");
  });

  test("invalid actions not shown for active session", () => {
    const state = cursorOnFirstSession(makeState());
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("import");
  });

  test("invalid actions not shown for archived session", () => {
    const state = cursorOnFirstSession(makeState(archivedSessions));
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("open");
  });

  test("folder row in sessions focus exposes wheel scroll only", () => {
    const state = cursorOnFirstFolder(makeState());
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("wheel");
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(ids.some(id => id.startsWith("mouse"))).toBe(false);
  });

  test("active session row in sessions focus exposes wheel scroll only", () => {
    const state = cursorOnFirstSession(makeState());
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("wheel");
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(ids.some(id => id.startsWith("mouse"))).toBe(false);
  });

  test("archived session row in sessions focus exposes wheel scroll only", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("wheel");
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(ids.some(id => id.startsWith("mouse"))).toBe(false);
  });

  test("metadata focus exposes wheel scroll without click chips", () => {
    const state = { ...makeState(), focus: "metadata" as const };
    const chips = actionChips(state);
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(chipLabels(chips).some(label => label.includes("click"))).toBe(false);
  });

  test("messages focus exposes wheel scroll without click chips", () => {
    const state = { ...makeState(), focus: "messages" as const };
    const chips = actionChips(state);
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(chipLabels(chips).some(label => label.includes("click"))).toBe(false);
  });
});

describe("search/confirm action bar focus", () => {
  test("search action bar shows only search actions (no quit, no destructive)", () => {
    const state = { ...makeState(), inputMode: "search" as const, query: "" };
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("open");
    expect(ids).toContain("cancel");
    expect(ids).toContain("wheel");
    expect(ids).not.toContain("quit");
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("tab-switch");
    expect(ids).not.toContain("back");
  });

  test("confirm action bar shows only confirm/cancel (no quit, no tab/back)", () => {
    const state = cursorOnFirstSession(makeState());
    const chips = actionChips({ ...state, pendingAction: "archive" as const });
    const ids = chipIds(chips);
    expect(ids).toEqual(["confirm", "cancel"]);
    expect(ids).not.toContain("quit");
    expect(ids).not.toContain("tab-switch");
    expect(ids).not.toContain("back");
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
  });

  test("confirm action bar for delete still shows only confirm/cancel", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    const chips = actionChips({ ...state, pendingAction: "delete" as const });
    const ids = chipIds(chips);
    expect(ids).toEqual(["confirm", "cancel"]);
  });
});

describe("executePendingAction", () => {
  test("no pendingAction returns cancelled with status", () => {
    const state = makeState();
    const result = executePendingAction(state);
    expect(result.pendingAction).toBeNull();
    expect(result.status).toBe("cancelled");
  });

  test("no selected session returns no session selected", () => {
    const state = makeState();
    const result = executePendingAction({ ...state, pendingAction: "delete" as const });
    expect(result.pendingAction).toBeNull();
    expect(result.status).toBe("no session selected");
  });

  test("continue calls onContinue callback and clears pendingAction", () => {
    const state = cursorOnFirstSession(makeState());
    let continueCalled = false;
    let continueId = "";
    const result = executePendingAction(
      { ...state, pendingAction: "continue" as const },
      (id, fork) => { continueCalled = true; continueId = id; },
    );
    expect(continueCalled).toBe(true);
    expect(continueId).toBe("ses_0");
    expect(result.pendingAction).toBeNull();
    expect(result.status).toContain("continuing");
  });
});

describe("applyKey: Tab, t, and navigation keys", () => {
  test("Tab switches active -> archived tab with focus on sessions", () => {
    let state = makeState();
    expect(state.tab).toBe("active");
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    expect(state.focus).toBe("sessions");
    expect(state.status).toBe("archived tab");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("active");
    expect(state.focus).toBe("sessions");
    expect(state.status).toBe("active tab");
  });

  test("S-Tab does nothing", () => {
    const state = makeState();
    const result = applyKey(state, "S-Tab");
    expect(result).toBe(state);
  });

  test("t returns hint status", () => {
    let state = makeState();
    state = applyKey(state, "t");
    expect(state.status).toBe("use Tab to switch Active/Archive");
  });

  test("Tab in search input mode does not change tab", () => {
    let state = makeState();
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
    const before = state;
    const after = applyKey(state, "Tab");
    expect(after).toBe(before);
  });

  test("Tab in pending action mode does not change state", () => {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "D");
    expect(state.pendingChoice).toBe("archive_or_delete");
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    const before = state;
    const after = applyKey(state, "Tab");
    expect(after).toBe(before);
  });

  test("E expands all folders", () => {
    let state = makeState();
    expect(state.expandedFolders.size).toBe(0);
    state = applyKey(state, "E");
    expect(state.expandedFolders.size).toBeGreaterThan(0);
    expect(state.status).toBe("expanded all");
  });

  test("D on active session sets pendingChoice archive_or_delete", () => {
    let state = expandFolderWithSessions(makeState());
    state = cursorOnFirstSession(state);
    state = applyKey(state, "D");
    expect(state.pendingChoice).toBe("archive_or_delete");
  });

  test("D on archived session sets pendingAction delete (no choice overlay)", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    state = applyKey(state, "D");
    expect(state.pendingAction).toBe("delete");
    expect(state.pendingChoice).toBeNull();
  });

  test("I on archived session sets pendingAction import", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    state = applyKey(state, "I");
    expect(state.pendingAction).toBe("import");
  });

  test("Enter on archived session returns blocked status", () => {
    let state = makeState(archivedSessions);
    state = reloadState({ ...state, tab: "archived" as const });
    state = cursorOnFirstSession(state);
    state = applyKey(state, "Enter");
    expect(state.status).toBe("Archived sessions can't be opened directly. Press I to import first.");
  });

  test("Backspace in normal mode calls back", () => {
    const state = makeState();
    const result = applyKey(state, "Backspace");
    expect(result.status).toBe("already at root");
  });

  test("Backspace in search mode edits query", () => {
    let state = makeState();
    state = applyKey(state, "/");
    state = applyKey(state, "h");
    expect(state.query).toBe("h");
    state = applyKey(state, "Backspace");
    expect(state.query).toBe("");
  });
});

describe("applyKey: focus-aware scrolling", () => {
  function makeMessagesState(focus: PaneFocus) {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    return {
      ...state,
      focus,
      messageRows: [
        { role: "user", time: 1, text: "a" },
        { role: "user", time: 2, text: "b" },
        { role: "user", time: 3, text: "c" },
        { role: "user", time: 4, text: "d" },
        { role: "user", time: 5, text: "e" },
        { role: "user", time: 6, text: "f" },
      ] as any,
    };
  }

  test("messages focus: j increments messageScroll bounded by row count", () => {
    let state = makeMessagesState("messages");
    const beforeCursor = state.cursor;
    state = applyKey(state, "j");
    expect(state.messageScroll).toBe(1);
    expect(state.cursor).toBe(beforeCursor);
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    expect(state.messageScroll).toBe(5);
  });

  test("messages focus: k decrements messageScroll floored at 0", () => {
    let state = makeMessagesState("messages");
    state = { ...state, messageScroll: 2 };
    state = applyKey(state, "k");
    expect(state.messageScroll).toBe(1);
    state = applyKey(state, "k");
    state = applyKey(state, "k");
    state = applyKey(state, "k");
    expect(state.messageScroll).toBe(0);
  });

  test("metadata focus: j increments detailScroll", () => {
    let state = makeMessagesState("metadata");
    const beforeCursor = state.cursor;
    state = applyKey(state, "j");
    expect(state.detailScroll).toBe(1);
    expect(state.cursor).toBe(beforeCursor);
  });

  test("metadata focus: k decrements detailScroll floored at 0", () => {
    let state = makeMessagesState("metadata");
    state = { ...state, detailScroll: 1 };
    state = applyKey(state, "k");
    expect(state.detailScroll).toBe(0);
    state = applyKey(state, "k");
    expect(state.detailScroll).toBe(0);
  });

  test("sessions focus: j moves cursor, leaves messageScroll/detailScroll untouched", () => {
    let state = makeMessagesState("sessions");
    const beforeMessage = state.messageScroll;
    const beforeDetail = state.detailScroll;
    state = applyKey(state, "j");
    expect(state.cursor).toBeGreaterThanOrEqual(0);
    expect(state.messageScroll).toBe(beforeMessage);
    expect(state.detailScroll).toBe(beforeDetail);
  });

  test("messages focus ignores system rows when clamping messageScroll", () => {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = {
      ...state,
      focus: "messages" as const,
      messageRows: [
        { role: "system", time: 1, text: "sys-1" },
        { role: "user", time: 2, text: "u-1" },
        { role: "assistant", time: 3, text: "a-1" },
        { role: "system", time: 4, text: "sys-2" },
      ] as any,
    };
    state = applyKey(state, "G");
    // Only 2 visible rows (user + assistant), so max scroll is 1
    expect(state.messageScroll).toBe(1);
    state = applyKey(state, "j");
    expect(state.messageScroll).toBe(1);
  });
});

describe("search - unified search results", () => {
  test("search returns active and archived session metadata matches", () => {
    const state = makeState(sessions);
    const searchState = { ...state, inputMode: "search" as const, query: "Session" };
    const results = searchResultsFor(searchState);
    const activeResults = results.filter(r => r.tab === "active");
    const archivedResults = results.filter(r => r.tab === "archived");
    expect(activeResults.length).toBeGreaterThan(0);
    expect(archivedResults.length).toBeGreaterThan(0);
    expect(activeResults.every(r => r.session.timeArchived == null)).toBe(true);
    expect(archivedResults.every(r => r.session.timeArchived != null)).toBe(true);
  });

  test("Enter on archived search result is blocked", () => {
    const state = makeState(sessions);
    const searchState = { ...state, inputMode: "search" as const, query: "Session" };
    const results = searchResultsFor(searchState);
    const archivedIdx = results.findIndex(r => r.tab === "archived");
    expect(archivedIdx).toBeGreaterThanOrEqual(0);
    const selState = { ...searchState, searchSelected: archivedIdx, searchScroll: 0 };
    const result = applyKey(selState, "Enter");
    expect(result.status).toContain("Archived sessions can't be opened directly");
  });
});

describe("search mode - arrows only navigation", () => {
  test("literal j appends to query instead of moving selection", () => {
    let state = makeState();
    state = applyKey(state, "/");
    state = applyKey(state, "j");
    expect(state.query).toBe("j");
    expect(state.searchSelected).toBe(0);
  });

  test("literal k appends to query instead of moving selection", () => {
    let state = makeState();
    state = applyKey(state, "/");
    state = applyKey(state, "k");
    expect(state.query).toBe("k");
    expect(state.searchSelected).toBe(0);
  });

  test("ArrowDown moves search selection down", () => {
    let state = makeState();
    state = applyKey(state, "/");
    state = applyKey(state, "ArrowDown");
    expect(state.searchSelected).toBe(1);
    state = applyKey(state, "ArrowDown");
    expect(state.searchSelected).toBe(2);
  });

  test("ArrowUp moves search selection up with floor at 0", () => {
    let state = makeState();
    state = applyKey(state, "/");
    state = applyKey(state, "ArrowDown");
    state = applyKey(state, "ArrowDown");
    state = applyKey(state, "ArrowDown");
    expect(state.searchSelected).toBe(3);
    state = applyKey(state, "ArrowUp");
    expect(state.searchSelected).toBe(2);
    state = applyKey(state, "ArrowUp");
    state = applyKey(state, "ArrowUp");
    state = applyKey(state, "ArrowUp");
    state = applyKey(state, "ArrowUp");
    expect(state.searchSelected).toBe(0);
  });

  test("j in search does not change searchScroll", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    let state = makeState(many);
    state = applyKey(state, "/");
    for (let i = 0; i < 12; i++) state = applyKey(state, "j");
    expect(state.query.length).toBe(12);
    expect(state.searchSelected).toBe(0);
    expect(state.searchScroll).toBe(0);
  });
});

describe("active destructive flow unification", () => {
  test("active session: a no longer triggers direct archive", () => {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    const result = applyKey(state, "a");
    expect(result.pendingAction).toBeNull();
    expect(result.pendingChoice).toBeNull();
    expect(result.status).toBe("use D to archive or delete this session");
  });

  test("active session: D still opens archive/delete choice", () => {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    const result = applyKey(state, "D");
    expect(result.pendingChoice).toBe("archive_or_delete");
  });

  test("active session: Delete opens archive/delete choice", () => {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    const result = applyKey(state, "Delete");
    expect(result.pendingChoice).toBe("archive_or_delete");
  });

  test("active folder: a no longer triggers direct bulk archive", () => {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstFolder(state);
    const result = applyKey(state, "a");
    expect(result.pendingAction).toBeNull();
    expect(result.pendingChoice).toBeNull();
  });
});

describe("choice overlay key contract", () => {
  function setupActiveSessionChoice() {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "D");
    return state;
  }

  test("uppercase A chooses archive from choice overlay", () => {
    let state = setupActiveSessionChoice();
    expect(state.pendingChoice).toBe("archive_or_delete");
    const result = applyKey(state, "A");
    expect(result.pendingChoice).toBeNull();
    expect(result.pendingAction).toBe("archive");
  });

  test("lowercase a chooses archive from choice overlay", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "a");
    expect(result.pendingChoice).toBeNull();
    expect(result.pendingAction).toBe("archive");
  });

  test("c cancels choice overlay with cleared pending fields", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "c");
    expect(result.pendingChoice).toBeNull();
    expect(result.status).toBe("cancelled");
  });

  test("C cancels choice overlay with cleared pending fields", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "C");
    expect(result.pendingChoice).toBeNull();
    expect(result.status).toBe("cancelled");
  });

  test("Esc cancels choice overlay with cleared pending fields", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "Esc");
    expect(result.pendingChoice).toBeNull();
    expect(result.status).toBe("cancelled");
  });

  test("Escape cancels choice overlay with cleared pending fields", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "Escape");
    expect(result.pendingChoice).toBeNull();
    expect(result.status).toBe("cancelled");
  });

  test("d from choice overlay chooses delete", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "d");
    expect(result.pendingChoice).toBeNull();
    expect(result.pendingAction).toBe("delete");
  });

  test("D from choice overlay chooses delete", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "D");
    expect(result.pendingChoice).toBeNull();
    expect(result.pendingAction).toBe("delete");
  });

  test("Delete from choice overlay chooses delete", () => {
    let state = setupActiveSessionChoice();
    const result = applyKey(state, "Delete");
    expect(result.pendingChoice).toBeNull();
    expect(result.pendingAction).toBe("delete");
  });

  test("cancel clears pendingDirectory and pendingCount for folder choices", () => {
    let state = makeState();
    state = expandFolderWithSessions(state);
    state = cursorOnFirstFolder(state);
    state = applyKey(state, "D");
    expect(state.pendingChoice).toBe("archive_or_delete");
    expect(state.pendingDirectory).toBeDefined();
    expect(state.pendingCount).toBeDefined();
    const result = applyKey(state, "c");
    expect(result.pendingChoice).toBeNull();
    expect(result.pendingDirectory).toBeUndefined();
    expect(result.pendingCount).toBeUndefined();
  });
});

describe("fresh session keybindings", () => {
  test("N on active folder sets freshDirectory", () => {
    let state = cursorOnFirstFolder(makeState());
    const folder = getVisibleRows(state)[state.cursor] as any;
    const result = applyKey(state, "N");
    expect(result.freshDirectory).toBe(folder.directory);
    expect(result.status).toBe(`opening ${folder.directory}`);
  });

  test("Alt+Enter on active session uses session directory", () => {
    let state = cursorOnFirstSession(makeState());
    const session = getVisibleRows(state)[state.cursor] as any;
    const result = applyKey(state, "Alt+Enter");
    expect(result.freshDirectory).toBe(session.directory);
    expect(result.status).toBe(`opening ${session.directory}`);
  });

  test("N in archived tab is blocked", () => {
    let state = makeState(archivedSessions);
    state = { ...state, tab: "archived" as const };
    const result = applyKey(state, "N");
    expect(result.freshDirectory).toBeUndefined();
    expect(result.status).toBe("new sessions only start from the Active tab");
  });

  test("active folder and session rows advertise N new", () => {
    const folderState = cursorOnFirstFolder(makeState());
    expect(chipLabels(actionChips(folderState))).toContain("N new");
    const sessionState = cursorOnFirstSession(makeState());
    expect(chipLabels(actionChips(sessionState))).toContain("N new");
  });

  test("N in search mode appends to query instead of starting fresh session", () => {
    let state = makeState();
    state = applyKey(state, "/");
    state = applyKey(state, "N");
    expect(state.inputMode).toBe("search");
    expect(state.query).toBe("N");
    expect(state.freshDirectory).toBeUndefined();
  });
});

describe("memoized derived state", () => {
  test("searchResultsFor returns same array reference for unchanged state", () => {
    clearActionMemo();
    const state = { ...makeState(sessions), inputMode: "search" as const, query: "Session" };
    const a = searchResultsFor(state);
    const b = searchResultsFor(state);
    expect(a).toBe(b);
  });

  test("actionChips returns same array reference for unchanged state", () => {
    clearActionMemo();
    const state = cursorOnFirstSession(makeState());
    const a = actionChips(state);
    const b = actionChips(state);
    expect(a).toBe(b);
  });

  test("clearActionMemo invalidates cached results", () => {
    clearActionMemo();
    const state = cursorOnFirstSession(makeState());
    const a = actionChips(state);
    clearActionMemo();
    const b = actionChips(state);
    expect(a).not.toBe(b);
  });
});
