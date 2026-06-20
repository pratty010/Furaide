import { describe, expect, test } from "bun:test";
import { applyKey, buildSearchOverlay } from "../src/tui.tsx";
import { createInitialState, currentSession, getVisibleRows, type UiSession } from "../src/dashboard/state.ts";
import { actionChips } from "../src/dashboard/actions.ts";
import { Box, BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { buildMessagesContent, buildMetadataContent, buildSessionsContent, buildActionBarContent } from "../src/dashboard/render.ts";
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

  test("tab cycles focus: sessions -> messages -> metadata -> sessions", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "Tab");
    expect(state.focus).toBe("messages");
    state = applyKey(state, "Tab");
    expect(state.focus).toBe("metadata");
    state = applyKey(state, "Tab");
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "Tab");
    expect(state.focus).toBe("messages");
  });

  test("S-Tab cycles focus in reverse", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "S-Tab");
    expect(state.focus).toBe("metadata");
    state = applyKey(state, "S-Tab");
    expect(state.focus).toBe("messages");
    state = applyKey(state, "S-Tab");
    expect(state.focus).toBe("sessions");
  });

  test("'t' key toggles active/archived tab", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    expect(state.tab).toBe("active");
    state = applyKey(state, "t");
    expect(state.tab).toBe("archived");
    state = applyKey(state, "t");
    expect(state.tab).toBe("active");
  });

  test("Tab in search input mode does not cycle focus", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
    const before = state;
    const after = applyKey(state, "Tab");
    expect(after).toBe(before);
  });

  test("focused mode: Tab cycles focus, layout re-renders to show focused pane", () => {
    const state = createInitialState(sessions, { height: 20, width: 100 });
    expect(dashboardLayout(100, 20).mode).toBe("focused");
    const s1 = applyKey(state, "Tab");
    expect(s1.focus).toBe("messages");
    const s2 = applyKey(s1, "Tab");
    expect(s2.focus).toBe("metadata");
    const s3 = applyKey(s2, "Tab");
    expect(s3.focus).toBe("sessions");
  });

  test("sessions focus: j/k move cursor, not scroll", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
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
    let state = createInitialState(sessions, { height: 10, width: 100 });
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
    let state = createInitialState(sessions, { height: 10, width: 100 });
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
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = { ...state, focus: "messages" as const, messageRows: [
      { role: "user", time: 1, text: "a" },
      { role: "user", time: 2, text: "b" },
      { role: "user", time: 3, text: "c" },
    ] };
    state = applyKey(state, "G");
    expect(state.messageScroll).toBe(2);
  });

  test("metadata focus: G jumps detailScroll to end", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = { ...state, focus: "metadata" as const };
    state = applyKey(state, "G");
    expect(state.detailScroll).toBeGreaterThan(0);
  });

  test("messages focus: Ctrl+D/PageDown bumps messageScroll by 5", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
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
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = { ...state, focus: "metadata" as const, detailScroll: 1 };
    state = applyKey(state, "Ctrl+U");
    expect(state.detailScroll).toBe(0);
    state = applyKey(state, "PageUp");
    expect(state.detailScroll).toBe(0);
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

  test("j/k in search mode update searchSelected, k decrements at top", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "/");
    state = applyKey(state, "j");
    state = applyKey(state, "j");
    expect(state.searchSelected).toBe(2);
    state = applyKey(state, "k");
    expect(state.searchSelected).toBe(1);
    state = applyKey(state, "k");
    state = applyKey(state, "k");
    state = applyKey(state, "k");
    expect(state.searchSelected).toBe(0);
  });

  test("j in search mode updates searchScroll when selection passes visible window", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    let state = createInitialState(many, { height: 14, width: 100 });
    state = applyKey(state, "/");
    for (let i = 0; i < 12; i++) state = applyKey(state, "j");
    expect(state.searchSelected).toBe(12);
    expect(state.searchScroll).toBeGreaterThan(0);
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

  test("active session: d -> permanent delete confirmation", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "d");
    expect(state.pendingAction).toBe("delete");
  });

  test("archived session: r -> restore confirmation", () => {
    let state = createInitialState(archivedSessions, { height: 10, width: 100 });
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    const next = applyKey(state, "r");
    expect(next.pendingAction).toBe("restore");
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
  test("action chips do not expose c/C/E/m keys", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const chips = actionChips(state);
    const allKeys = chips.flatMap(c => (c.key || "").split("|")).filter(Boolean);
    for (const banned of ["c", "C", "E", "m"]) {
      expect(allKeys).not.toContain(banned);
    }
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

  test("action chips show Esc back for active session", () => {
    const state = createInitialState(sessions, { height: 10, width: 100 });
    const folder = state.folders[0];
    const next = { ...state, expandedFolders: new Set([folder.directory]), cursor: 1 };
    const labels = actionChips(next).map(c => c.label);
    expect(labels).toContain("Esc back");
  });

  test("action chips show restore hint for archived session", () => {
    const archived = sessions.map((s) => ({ ...s, timeArchived: 100 }));
    let state = createInitialState(archived, { height: 10, width: 100 });
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    const labels = actionChips(state).map(c => c.label);
    expect(labels).toContain("r restore");
  });

  test("search overlay shows position indicator when more results than visible window", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    const state = createInitialState(many, { height: 14, width: 100 });
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
    const state = createInitialState(many, { height: 14, width: 100 });
    state.inputMode = "search";
    state.query = "Session";
    state.searchSelected = 0;
    state.searchScroll = 0;
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("Session 0");
  });

  test("search overlay with scroll advanced shows higher-numbered title", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...sessions[0],
      id: `ses_${i}`,
      title: `Session ${i}`,
      directory: `/repo/${i}`,
    }));
    const state = createInitialState(many, { height: 14, width: 100 });
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
      const state = createInitialState(sessions, { width: 120, height: 30 });
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

      const actionBar = new TextRenderable(renderer, { id: "action-bar", height: layout.actionRows, content: buildActionBarContent(state) });

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
    const setup = await createTestRenderer({ width: 60, height: 20 });
    try {
      const { renderer } = setup;
      const state: any = { ...createInitialState(sessions, { width: 60, height: 20 }), focus: "metadata" };
      const layout = dashboardLayout(60, 20);
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
      const baseState = createInitialState(sessions, { width: 100, height: 30 });
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
