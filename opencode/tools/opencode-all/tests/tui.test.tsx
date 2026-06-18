import { describe, expect, test } from "bun:test";
import { applyKey, createInitialState, currentSession, renderRows, type UiSession } from "../src/tui.tsx";

const sessions: UiSession[] = Array.from({ length: 100 }, (_, index) => ({
  id: `ses_${index}`,
  title: `Session ${index}`,
  directory: index % 2 === 0 ? "/repo/current" : "/repo/other",
  path: "",
  agent: "build",
  model: "model",
  shareUrl: "",
  cost: index,
  tokensInput: index,
  tokensOutput: index,
  timeCreated: index,
  timeUpdated: index,
  timeArchived: null,
  isCurrent: index % 2 === 0,
  suspicious: false,
}));

describe("TUI state", () => {
  test("moves selection and scrolls", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    for (let i = 0; i < 60; i++) state = applyKey(state, "j");
    expect(state.cursor).toBe(60);
    expect(state.listScroll).toBeGreaterThan(0);
    expect(currentSession(state)?.id).toBe("ses_60");
  });

  test("jumps top and bottom", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "G");
    expect(state.cursor).toBe(99);
    state = applyKey(state, "gg");
    expect(state.cursor).toBe(0);
  });

  test("cycles active archived all tabs", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    expect(state.tab).toBe("active");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("all");
  });

  test("drills and backs out", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "drill:/repo/current");
    expect(state.directory).toBe("/repo/current");
    expect(state.stack).toHaveLength(1);
    state = applyKey(state, "b");
    expect(state.directory).toBeUndefined();
    expect(state.stack).toHaveLength(0);
  });

  test("clears drill stack", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "drill:/repo/current");
    state = applyKey(state, "drill:/repo/current/sub");
    expect(state.stack).toHaveLength(2);
    state = applyKey(state, "B");
    expect(state.directory).toBeUndefined();
    expect(state.stack).toHaveLength(0);
  });
});

describe("renderRows", () => {
  test("renders selected row and status", () => {
    const state = createInitialState(sessions.slice(0, 3), { height: 10, width: 100 });
    const output = renderRows(state).join("\n");
    expect(output).toContain("❯ Session 0");
    expect(output).toContain("q quit");
  });

  test("renders scroll counter", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "G");
    expect(renderRows(state).join("\n")).toContain("100 / 100");
  });
});

describe("confirmation state", () => {
  test("delete opens a confirmation modal", () => {
    let state = createInitialState(sessions.slice(0, 1), { height: 10, width: 100 });
    state = applyKey(state, "d");
    expect(state.status).toContain("confirm delete");
  });

  test("archive opens a confirmation modal", () => {
    let state = createInitialState(sessions.slice(0, 1), { height: 10, width: 100 });
    state = applyKey(state, "a");
    expect(state.status).toContain("confirm archive");
  });

  test("y executes the pending action and clears status", () => {
    let state = createInitialState(sessions.slice(0, 1), { height: 10, width: 100 });
    state = applyKey(state, "a");
    state = applyKey(state, "y");
    expect(state.status).not.toContain("confirm");
  });

  test("n cancels the pending action", () => {
    let state = createInitialState(sessions.slice(0, 1), { height: 10, width: 100 });
    state = applyKey(state, "d");
    state = applyKey(state, "n");
    expect(state.status).not.toContain("confirm");
  });
});
