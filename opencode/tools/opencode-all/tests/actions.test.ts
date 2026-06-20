import { describe, expect, test } from "bun:test";
import { createInitialState, getVisibleRows, type PaneFocus, type UiSession } from "../src/dashboard/state.ts";
import {
  confirmOverlayText,
  actionContext,
  actionChips,
  applyKey,
  executePendingAction,
  type ActionChip,
} from "../src/dashboard/actions.ts";

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

const vp = { height: 20, width: 100 };

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
    const state = createInitialState(sessions, vp);
    expect(confirmOverlayText(state)).toBe("");
  });

  test("archive", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const text = confirmOverlayText({ ...state, pendingAction: "archive" });
    expect(text).toContain("Archive session");
  });

  test("archive_and_delete", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const text = confirmOverlayText({ ...state, pendingAction: "archive_and_delete" });
    expect(text).toContain("Archive + delete");
  });

  test("import", () => {
    const state = cursorOnFirstSession(createInitialState(archivedSessions, vp));
    const text = confirmOverlayText({ ...state, pendingAction: "import" });
    expect(text).toContain("Import archived session");
  });

  test("delete", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const text = confirmOverlayText({ ...state, pendingAction: "delete" });
    expect(text).toContain("Delete");
    expect(text).toContain("permanently");
  });

  test("bulk_archive", () => {
    const state = createInitialState(sessions, vp);
    const text = confirmOverlayText({ ...state, pendingAction: "bulk_archive", pendingDirectory: "/repo", pendingCount: 3 });
    expect(text).toContain("Bulk archive");
    expect(text).toContain("/repo");
  });

  test("bulk_restore", () => {
    const state = createInitialState(sessions, vp);
    const text = confirmOverlayText({ ...state, pendingAction: "bulk_restore", pendingDirectory: "/repo", pendingCount: 2 });
    expect(text).toContain("Bulk restore");
    expect(text).toContain("/repo");
  });

  test("bulk_delete", () => {
    const state = createInitialState(sessions, vp);
    const text = confirmOverlayText({ ...state, pendingAction: "bulk_delete", pendingDirectory: "/repo", pendingCount: 5 });
    expect(text).toContain("Bulk delete");
    expect(text).toContain("/repo");
  });
});

describe("actionContext", () => {
  test("folder row returns isFolder", () => {
    const state = cursorOnFirstFolder(createInitialState(sessions, vp));
    const ctx = actionContext(state);
    expect(ctx.isFolder).toBe(true);
    expect(ctx.isSession).toBe(false);
    expect(ctx.isArchived).toBe(false);
  });

  test("active session row returns isSession not isArchived", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const ctx = actionContext(state);
    expect(ctx.isFolder).toBe(false);
    expect(ctx.isSession).toBe(true);
    expect(ctx.isArchived).toBe(false);
  });

  test("archived session row returns isSession and isArchived", () => {
    const state = cursorOnFirstSession(createInitialState(archivedSessions, vp));
    const ctx = actionContext(state);
    expect(ctx.isFolder).toBe(false);
    expect(ctx.isSession).toBe(true);
    expect(ctx.isArchived).toBe(true);
  });
});

describe("actionChips", () => {
  test("pending action returns confirm/cancel chips", () => {
    const state = { ...createInitialState(sessions, vp), pendingAction: "archive" as const };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["confirm", "cancel"]);
    expect(chipLabels(chips)).toEqual(["[y/Enter] confirm", "[n/Esc] cancel"]);
  });

  test("search mode returns search-only chips", () => {
    const state = { ...createInitialState(sessions, vp), inputMode: "search" as const, query: "" };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["open", "wheel", "cancel"]);
    expect(chipLabels(chips)).toEqual(["Enter open", "wheel scroll", "Esc cancel"]);
  });

  test("metadata focus returns generic focus chips", () => {
    const state = { ...createInitialState(sessions, vp), focus: "metadata" as const };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["tab-focus", "back", "quit", "wheel"]);
  });

  test("messages focus returns generic focus chips", () => {
    const state = { ...createInitialState(sessions, vp), focus: "messages" as const };
    const chips = actionChips(state);
    expect(chipIds(chips)).toEqual(["tab-focus", "back", "quit", "wheel"]);
  });

  test("action chips do not advertise unsupported mouse click actions", () => {
    const contexts = [
      { ...createInitialState(sessions, vp), pendingAction: "archive" as const },
      { ...createInitialState(sessions, vp), inputMode: "search" as const },
      { ...createInitialState(sessions, vp), focus: "metadata" as const },
      { ...createInitialState(sessions, vp), focus: "messages" as const },
      cursorOnFirstFolder(createInitialState(sessions, vp)),
      cursorOnFirstSession(createInitialState(sessions, vp)),
    ];
    for (const state of contexts) {
      const labels = chipLabels(actionChips(state));
      expect(labels.some(label => label.includes("click") || label.includes("double-click"))).toBe(false);
    }
  });

  test("metadata focus hides all destructive actions (delete, archive, import, restore)", () => {
    const state = { ...createInitialState(sessions, vp), focus: "metadata" as const };
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("import");
    expect(ids).not.toContain("restore");
    expect(ids).not.toContain("expand");
    expect(ids).not.toContain("open");
  });

  test("messages focus hides all destructive actions (delete, archive, import, restore)", () => {
    const state = { ...createInitialState(sessions, vp), focus: "messages" as const };
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("import");
    expect(ids).not.toContain("restore");
    expect(ids).not.toContain("expand");
    expect(ids).not.toContain("open");
  });

  test("metadata focus has no danger chips", () => {
    const state = { ...createInitialState(sessions, vp), focus: "metadata" as const };
    const chips = actionChips(state);
    expect(chips.some(c => c.danger)).toBe(false);
  });

  test("messages focus has no danger chips", () => {
    const state = { ...createInitialState(sessions, vp), focus: "messages" as const };
    const chips = actionChips(state);
    expect(chips.some(c => c.danger)).toBe(false);
  });

  test("active session in sessions focus exposes the t tab chip", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("tab");
    expect(chipLabels(chips).some(l => l.includes("t tab"))).toBe(true);
  });

  test("archived session in sessions focus exposes the t tab chip", () => {
    let state = createInitialState(archivedSessions, vp);
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("tab");
  });

  test("folder row in sessions focus exposes the t tab chip", () => {
    const state = cursorOnFirstFolder(createInitialState(sessions, vp));
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("tab");
  });

  test("folder row returns chip set with expand/toggle/archive/restore/delete/search/focus/back/quit", () => {
    const state = cursorOnFirstFolder(createInitialState(sessions, vp));
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("expand");
    expect(chipIds(chips)).toContain("toggle-all");
    expect(chipIds(chips)).toContain("archive");
    expect(chipIds(chips)).toContain("restore");
    expect(chipIds(chips)).toContain("delete");
    expect(chipIds(chips)).toContain("search");
    expect(chipIds(chips)).toContain("tab-focus");
    expect(chipIds(chips)).toContain("back");
    expect(chipIds(chips)).toContain("quit");
  });

  test("active session row returns chip set with open/archive/delete/search/focus/back/quit", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("open");
    expect(chipIds(chips)).toContain("archive");
    expect(chipIds(chips)).toContain("delete");
    expect(chipIds(chips)).toContain("search");
    expect(chipIds(chips)).toContain("tab-focus");
    expect(chipIds(chips)).toContain("back");
    expect(chipIds(chips)).toContain("quit");
    expect(chipIds(chips)).not.toContain("import");
    expect(chipIds(chips)).not.toContain("restore");
  });

  test("archived session row returns chip set with open/restore/delete/search/focus/back/quit", () => {
    const state = cursorOnFirstSession(createInitialState(archivedSessions, vp));
    const chips = actionChips(state);
    expect(chipIds(chips)).toContain("open");
    expect(chipIds(chips)).toContain("restore");
    expect(chipIds(chips)).toContain("delete");
    expect(chipIds(chips)).toContain("search");
    expect(chipIds(chips)).toContain("tab-focus");
    expect(chipIds(chips)).toContain("back");
    expect(chipIds(chips)).toContain("quit");
    expect(chipIds(chips)).not.toContain("archive");
    expect(chipIds(chips)).not.toContain("import");
  });

  test("invalid actions not shown for active session", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("import");
    expect(ids).not.toContain("restore");
  });

  test("invalid actions not shown for archived session", () => {
    const state = cursorOnFirstSession(createInitialState(archivedSessions, vp));
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("import");
  });

  test("folder row in sessions focus exposes wheel scroll only", () => {
    const state = cursorOnFirstFolder(createInitialState(sessions, vp));
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("wheel");
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(ids.some(id => id.startsWith("mouse"))).toBe(false);
  });

  test("active session row in sessions focus exposes wheel scroll only", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("wheel");
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(ids.some(id => id.startsWith("mouse"))).toBe(false);
  });

  test("archived session row in sessions focus exposes wheel scroll only", () => {
    const state = cursorOnFirstSession(createInitialState(archivedSessions, vp));
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("wheel");
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(ids.some(id => id.startsWith("mouse"))).toBe(false);
  });

  test("metadata focus exposes wheel scroll without click chips", () => {
    const state = { ...createInitialState(sessions, vp), focus: "metadata" as const };
    const chips = actionChips(state);
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(chipLabels(chips).some(label => label.includes("click"))).toBe(false);
  });

  test("messages focus exposes wheel scroll without click chips", () => {
    const state = { ...createInitialState(sessions, vp), focus: "messages" as const };
    const chips = actionChips(state);
    expect(chipLabels(chips)).toContain("wheel scroll");
    expect(chipLabels(chips).some(label => label.includes("click"))).toBe(false);
  });
});

describe("search/confirm action bar focus", () => {
  test("search action bar shows only search actions (no quit, no destructive)", () => {
    const state = { ...createInitialState(sessions, vp), inputMode: "search" as const, query: "" };
    const chips = actionChips(state);
    const ids = chipIds(chips);
    expect(ids).toContain("open");
    expect(ids).toContain("cancel");
    expect(ids).toContain("wheel");
    expect(ids).not.toContain("quit");
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
    expect(ids).not.toContain("tab-focus");
    expect(ids).not.toContain("back");
  });

  test("confirm action bar shows only confirm/cancel (no quit, no tab/back)", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
    const chips = actionChips({ ...state, pendingAction: "archive" as const });
    const ids = chipIds(chips);
    expect(ids).toEqual(["confirm", "cancel"]);
    expect(ids).not.toContain("quit");
    expect(ids).not.toContain("tab-focus");
    expect(ids).not.toContain("back");
    expect(ids).not.toContain("delete");
    expect(ids).not.toContain("archive");
  });

  test("confirm action bar for delete still shows only confirm/cancel", () => {
    let state = createInitialState(archivedSessions, vp);
    state = { ...state, tab: "archived" as const };
    state = cursorOnFirstSession(state);
    const chips = actionChips({ ...state, pendingAction: "delete" as const });
    const ids = chipIds(chips);
    expect(ids).toEqual(["confirm", "cancel"]);
  });
});

describe("executePendingAction", () => {
  test("no pendingAction returns cancelled with status", () => {
    const state = createInitialState(sessions, vp);
    const result = executePendingAction(state);
    expect(result.pendingAction).toBeNull();
    expect(result.status).toBe("cancelled");
  });

  test("no selected session returns no session selected", () => {
    const state = createInitialState(sessions, vp);
    const result = executePendingAction({ ...state, pendingAction: "delete" as const });
    expect(result.pendingAction).toBeNull();
    expect(result.status).toBe("no session selected");
  });

  test("continue calls onContinue callback and clears pendingAction", () => {
    const state = cursorOnFirstSession(createInitialState(sessions, vp));
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

describe("applyKey: focus and tab cycling", () => {
  test("Tab cycles focus: sessions -> messages -> metadata -> sessions", () => {
    let state = createInitialState(sessions, vp);
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "Tab");
    expect(state.focus).toBe("messages");
    state = applyKey(state, "Tab");
    expect(state.focus).toBe("metadata");
    state = applyKey(state, "Tab");
    expect(state.focus).toBe("sessions");
  });

  test("S-Tab cycles focus in reverse: sessions -> metadata -> messages -> sessions", () => {
    let state = createInitialState(sessions, vp);
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "S-Tab");
    expect(state.focus).toBe("metadata");
    state = applyKey(state, "S-Tab");
    expect(state.focus).toBe("messages");
    state = applyKey(state, "S-Tab");
    expect(state.focus).toBe("sessions");
  });

  test("'t' key toggles active <-> archived tab and preserves focus on sessions", () => {
    let state = createInitialState(sessions, vp);
    expect(state.tab).toBe("active");
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "t");
    expect(state.tab).toBe("archived");
    expect(state.focus).toBe("sessions");
    state = applyKey(state, "t");
    expect(state.tab).toBe("active");
  });

  test("Tab in search input mode does not change focus", () => {
    let state = createInitialState(sessions, vp);
    state = applyKey(state, "/");
    expect(state.inputMode).toBe("search");
    const before = state;
    const after = applyKey(state, "Tab");
    expect(after).toBe(before);
  });

  test("Tab in pending action mode does not change focus", () => {
    let state = createInitialState(sessions, vp);
    state = expandFolderWithSessions(state);
    state = cursorOnFirstSession(state);
    state = applyKey(state, "a");
    expect(state.pendingAction).toBe("archive");
    const beforeFocus = state.focus;
    const after = applyKey(state, "Tab");
    expect(after.focus).toBe(beforeFocus);
  });
});

describe("applyKey: focus-aware scrolling", () => {
  function makeMessagesState(focus: PaneFocus) {
    let state = createInitialState(sessions, vp);
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
});
