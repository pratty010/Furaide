import { describe, expect, test, vi, beforeEach, afterEach } from "bun:test";
import { applyKey, createInitialState, currentSession, renderRows, getVisibleRows, type UiSession, buildLeftContent, buildRightContent, buildSearchOverlay, continueSession } from "../src/tui.tsx";

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

describe("folder tree navigation", () => {
  test("initial state shows only folders", () => {
    const state = createInitialState(sessions, { height: 20, width: 100 });
    const visible = getVisibleRows(state);
    expect(visible.every(row => !('id' in row))).toBe(true);
  });

  test("Enter on a folder expands it to show sessions", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    // Assume the first folder is /repo/current
    state = applyKey(state, "Enter");
    expect(state.expandedFolders.size).toBe(1);
    const visible = getVisibleRows(state);
    expect(visible.some(row => 'id' in row)).toBe(true);
  });

  test("o toggles all folders", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "o");
    expect(state.expandedFolders.size).toBeGreaterThan(0);
    state = applyKey(state, "o");
    expect(state.expandedFolders.size).toBe(0);
  });

  test("b at root shows feedback", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "b");
    expect(state.status).toBe("already at root");
  });
});

describe("search and input modes", () => {
  test("slash enters search mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
  });

  test("directory shortcut enters directory mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "\\");
    expect(state.inputMode).toBe("directory");
  });

  test("type updates query in search mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "type:curr");
    expect(state.query).toBe("curr");
  });

  test("entering search resets searchSelected", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = { ...state, searchSelected: 5 };
    state = applyKey(state, "/");
    expect(state.searchSelected).toBe(0);
  });
});

describe("session navigation", () => {
  test("moves selection and scrolls", () => {
    let state = createInitialState(sessions, { height: 5, width: 100 });
    state = applyKey(state, "o"); // expand all so we have rows
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    expect(state.cursor).toBe(2);
  });

  test("tab cycles tab state", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    expect(state.tab).toBe("active");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("all");
  });

  test("Enter on a session opens continue confirmation", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "Enter");
    state = applyKey(state, "j");
    state = applyKey(state, "Enter");
    expect(state.pendingAction).toBe("continue");
    expect(state.status).toContain("confirm continue");
  });
});

describe("renderRows", () => {
  test("renders list and detail markers", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const output = renderRows(state).join("\n");
    expect(output).toContain("theme:list");
    expect(output).toContain("theme:detail");
  });

  test("renders detail labels when a session is selected", () => {
    let state = createInitialState(sessions, { height: 14, width: 100 });
    state = applyKey(state, "Enter"); // expand first folder
    state = applyKey(state, "j"); // move to first session
    const output = renderRows(state).join("\n");
    expect(output).toContain("Directory ");
    expect(output).toContain("Agent     ");
    expect(output).toContain("Model     ");
  });

  test("clips rows to viewport width so panels stay separate", () => {
    let state = createInitialState(sessions.map(session => ({ ...session, title: `${session.title} ${"x".repeat(120)}` })), { height: 12, width: 60 });
    state = applyKey(state, "Enter");
    state = applyKey(state, "j");
    const output = renderRows(state);
    expect(output.every(line => line.length <= 60)).toBe(true);
  });

  test("renders confirmation overlay in front of content", () => {
    let state = createInitialState(sessions, { height: 14, width: 100 });
    state = applyKey(state, "Enter");
    state = applyKey(state, "j");
    state = applyKey(state, "d");
    const output = renderRows(state).join("\n");
    expect(output).toContain("[y] confirm");
    expect(output).toContain("DELETE");
  });
});

describe("confirmation state", () => {
  test("archive opens a confirmation modal", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "Enter");
    state = applyKey(state, "j");
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    expect(state.status).toContain("confirm archive");
  });

  test("n cancels the pending action", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "Enter");
    state = applyKey(state, "j");
    state = applyKey(state, "d");
    state = applyKey(state, "n");
    expect(state.pendingAction).toBeNull();
    expect(state.status).toBe("cancelled");
  });

  test("folder rows reject session-only actions", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "d");
    expect(state.status).toBe("actions only apply to sessions");
    expect(state.pendingAction).toBeNull();
  });

  test("active sessions reject restore", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "Enter");
    state = applyKey(state, "j");
    state = applyKey(state, "r");
    expect(state.status).toBe("restore only applies to archived sessions");
  });

  test("archived sessions reject archive", () => {
    const archivedSession = { ...sessions[0], timeArchived: 999, directory: "/repo/current" };
    let state = createInitialState([archivedSession], { height: 10, width: 100 });
    state = {
      ...state,
      folders: [{ directory: "/repo/current", active: 0, archived: 1, latestUpdated: 1 }],
      sessions: [archivedSession],
      allSessions: [archivedSession],
      expandedFolders: new Set(["/repo/current"]),
      cursor: 1,
    };
    state = applyKey(state, "a");
    expect(state.status).toBe("archive only applies to active sessions");
  });
});
