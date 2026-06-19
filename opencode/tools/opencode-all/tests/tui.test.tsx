import { describe, expect, test } from "bun:test";
import {
  applyKey,
  buildSearchOverlay,
  contextHints,
  createInitialState,
  currentSession,
  getVisibleRows,
  renderRows,
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

function overlayText() {
  const state = createInitialState(sessions, { height: 20, width: 100 });
  state.inputMode = "search";
  const overlay = buildSearchOverlay(state);
  return overlay.chunks.map((chunk: any) => chunk.text || "").join("");
}

describe("initial state", () => {
  test("root/no-directory shows pure session rows", () => {
    const state = createInitialState(sessions, { height: 20, width: 100 });
    const visible = getVisibleRows(state);
    expect(visible.every(row => "id" in row)).toBe(true);
    expect(visible.length).toBe(6);
  });

  test("cursor starts at first session", () => {
    const state = createInitialState(sessions, { height: 20, width: 100 });
    expect(state.cursor).toBe(0);
    expect(currentSession(state)?.id).toBe("ses_0");
  });
});

describe("navigation", () => {
  test("moves selection with j/k", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    expect(state.cursor).toBe(2);
    expect(currentSession(state)?.id).toBe("ses_2");
    state = applyKey(state, "k");
    expect(state.cursor).toBe(1);
  });

  test("tab cycles active -> archived -> all -> active", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    expect(state.tab).toBe("active");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("all");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("active");
  });
});

describe("enter semantics", () => {
  test("Enter on session sets continue confirmation", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "Enter");
    expect(state.pendingAction).toBe("continue");
    expect(state.status).toContain("confirm continue");
  });
});

describe("search mode basics", () => {
  test("slash enters search mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
    expect(state.query).toBe("");
    expect(state.searchSelected).toBe(0);
  });

  test("type updates query", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "type:curr");
    expect(state.query).toBe("curr");
  });

  test("Escape exits search mode and clears query", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "type:test");
    state = applyKey(state, "Escape");
    expect(state.inputMode).toBeNull();
    expect(state.query).toBe("");
    expect(state.status).toBe("ready");
  });
});

describe("Esc as universal back/close", () => {
  test("Esc at root gives ready state", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "Escape");
    expect(state.status).toBe("ready");
  });

  test("Esc pops stack when stack exists", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = {
      ...state,
      stack: [{ cursor: 0, listScroll: 0, tab: "active", query: "", directory: undefined, sort: "updated", expandedFolders: new Set<string>() }],
      directory: "/repo/current",
    };
    state = applyKey(state, "Escape");
    expect(state.stack.length).toBe(0);
    expect(state.status).toBe("back");
  });

  test("Esc cancels pending action", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    state = applyKey(state, "Escape");
    expect(state.pendingAction).toBeNull();
    expect(state.status).toBe("cancelled");
  });
});

describe("confirmation workflow semantics", () => {
  test("archive opens confirmation on active session", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
  });

  test("restore opens confirmation on archived session", () => {
    let state = createInitialState(archivedSessions, { height: 10, width: 100 });
    state = applyKey(state, "r");
    expect(state.pendingAction).toBe("restore");
  });

  test("active delete uses archive_and_export path", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "d");
    expect(state.pendingAction).toBe("archive_and_export");
    expect(state.status).toContain("archive + export");
  });

  test("archived delete uses permanent delete path", () => {
    let state = createInitialState(archivedSessions, { height: 10, width: 100 });
    state = applyKey(state, "d");
    expect(state.pendingAction).toBe("delete");
    expect(state.status).toContain("permanent");
  });

  test("export uses single export action", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "e");
    expect(state.pendingAction).toBe("export_sanitized");
  });

  test("folder rows reject session-only actions", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = {
      ...state,
      directory: "/repo/current",
      folders: [{ directory: "/repo/current", active: 2, archived: 0, latestUpdated: 10 }],
      sessions: sessions.filter(s => s.directory === "/repo/current"),
      expandedFolders: new Set(["/repo/current"]),
      cursor: 0,
    };
    state = applyKey(state, "a");
    expect(state.status).toBe("actions only apply to sessions");
    expect(state.pendingAction).toBeNull();
  });

  test("active sessions reject restore", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "r");
    expect(state.status).toBe("restore only applies to archived sessions");
  });

  test("archived sessions reject archive", () => {
    let state = createInitialState(archivedSessions, { height: 10, width: 100 });
    state = applyKey(state, "a");
    expect(state.status).toBe("archive only applies to active sessions");
  });
});

describe("removed workflow keys", () => {
  test("context hints do not expose c/C/E/m", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const hints = contextHints(state);
    expect(hints).not.toContain(" c ");
    expect(hints).not.toContain(" C ");
    expect(hints).not.toContain(" E ");
    expect(hints).not.toContain(" m ");
  });
});

describe("render helpers", () => {
  test("renderRows includes detail pane labels for selected session", () => {
    const state = createInitialState(sessions, { height: 14, width: 100 });
    const output = renderRows(state).join("\n");
    expect(output).toContain("Directory");
    expect(output).toContain("Agent");
    expect(output).toContain("Model");
  });

  test("search overlay footer shows Enter open", () => {
    const text = overlayText();
    expect(text).toContain("Enter open");
  });

  test("context hints show Esc back", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const hints = contextHints(state);
    expect(hints).toContain("Esc back");
  });
});