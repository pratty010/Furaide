import { describe, expect, test } from "bun:test";
import { applyKey, createInitialState, currentSession, type UiSession } from "../src/tui.tsx";

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
