import { describe, expect, test } from "bun:test";
import { applyKey, createInitialState, currentSession, renderRows, type UiSession } from "../src/tui.tsx";

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

describe("folder navigation", () => {
  test("initial mode is folders", () => {
    const state = createInitialState(sessions, { height: 20, width: 100 });
    expect(state.mode).toBe("folders");
  });

  test("folder shortcut opens sessions mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "folder:/repo/current");
    expect(state.mode).toBe("sessions");
    expect(state.directory).toBe("/repo/current");
  });

  test("b returns to previous mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "folder:/repo/current");
    state = applyKey(state, "b");
    expect(state.mode).toBe("folders");
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
    expect(state.mode).toBe("folders");
  });

  test("type updates query in search mode", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "type:curr");
    expect(state.query).toBe("curr");
  });
});

describe("session navigation", () => {
  test("moves selection and scrolls in sessions mode", () => {
    let state = createInitialState(sessions, { height: 5, width: 100 });
    state = applyKey(state, "folder:/repo/current");
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    expect(state.cursor).toBe(2);
    expect(currentSession(state)?.id).toBe("ses_2");
  });

  test("tab cycles tab state", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "folder:/repo/current");
    expect(state.tab).toBe("active");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("all");
  });
});

describe("renderRows", () => {
  test("renders list and detail markers", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const output = renderRows(state).join("\n");
    expect(output).toContain("theme:list");
    expect(output).toContain("theme:detail");
  });

  test("renders detail labels in sessions mode", () => {
    let state = createInitialState(sessions, { height: 14, width: 100 });
    state = applyKey(state, "folder:/repo/current");
    const output = renderRows(state).join("\n");
    expect(output).toContain("Directory:");
    expect(output).toContain("Agent:");
    expect(output).toContain("Model:");
    expect(output).toContain("Recent:");
  });
});

describe("confirmation state", () => {
  test("archive opens a confirmation modal", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "folder:/repo/current");
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    expect(state.status).toContain("confirm archive");
  });

  test("n cancels the pending action", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "folder:/repo/current");
    state = applyKey(state, "d");
    state = applyKey(state, "n");
    expect(state.pendingAction).toBeNull();
    expect(state.status).toBe("cancelled");
  });
});
