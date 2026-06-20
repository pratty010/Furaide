import { describe, expect, test, beforeAll } from "bun:test";
import { dashboardLayout } from "../src/dashboard/layout.ts";
import {
  buildMessagesContent,
  buildMetadataContent,
  buildSessionsContent,
  buildActionBarContent,
  buildConfirmOverlay,
  buildChoiceOverlay,
  buildSearchOverlay,
  setTheme,
} from "../src/dashboard/render.ts";
import { getVisibleRows } from "../src/dashboard/state.ts";
import type { SessionDetail, ArchivedMessageRow, DirectoryRow } from "../src/db.ts";
import type { UiState, UiSession } from "../src/dashboard/state.ts";

function flatText(st: { chunks: Array<{ text?: string }> }): string {
  return st.chunks.map(c => c.text || "").join("");
}

const testTheme = {
  name: "test",
  vars: {
    text: "#ffffff", surfaceAlt: "#1a1a1a",
    cyan: "#00ffff", success: "#00ff00", muted: "#888888",
    listSelectedBg: "#333333", detailValue: "#cccccc", detailCost: "#ffcc00",
    detailTokens: "#aaaaaa", accent: "#ff6600", dim: "#666666",
    modalBorder: "#555555", modalFg: "#ffffff", modalBg: "#222222",
    statusFg: "#ffffff", statusBg: "#000000", danger: "#ff0000",
  },
  pane: {
    text: "text", surfaceAlt: "surfaceAlt",
    cyan: "cyan", success: "success", muted: "muted",
    listSelectedBg: "listSelectedBg", detailValue: "detailValue",
    detailCost: "detailCost", detailTokens: "detailTokens",
    accent: "accent", dim: "dim",
    modalBorder: "modalBorder", modalFg: "modalFg", modalBg: "modalBg",
    statusFg: "statusFg", statusBg: "statusBg", danger: "danger",
  },
};

const mockSession: UiSession = {
  id: "ses_1", title: "Test Session", directory: "/test/proj",
  path: "", agent: "build", model: JSON.stringify({ providerID: "openai", id: "gpt-4" }),
  shareUrl: "", cost: 1.23, tokensInput: 100, tokensOutput: 50,
  timeCreated: 100000, timeUpdated: 200000, timeArchived: null,
  isCurrent: true, suspicious: false,
};

const mockArchivedSession: UiSession = {
  ...mockSession, id: "ses_2", title: "Archived Session",
  timeArchived: 300000, isCurrent: false,
};

const mockFolder: DirectoryRow = {
  directory: "/test/proj", active: 1, archived: 1, latestUpdated: 200000,
};

function baseState(overrides: Partial<UiState> = {}): UiState {
  return {
    folders: [mockFolder],
    sessions: [mockSession, mockArchivedSession],
    allSessions: [mockSession, mockArchivedSession],
    expandedFolders: new Set<string>(),
    cursor: 0,
    listScroll: 0,
    detailScroll: 0,
    messageScroll: 0,
    tab: "active",
    inputMode: null,
    query: "",
    directory: undefined,
    sort: "updated",
    stack: [],
    viewport: { height: 24, width: 100 },
    status: "ready",
    pendingAction: null,
    pendingDirectory: undefined,
    pendingCount: undefined,
    searchSelected: 0,
    searchScroll: 0,
    searchResults: [],
    focus: "sessions",
    messageRows: [],
    ...overrides,
  } as UiState;
}

const mockDetail: SessionDetail = {
  ...mockSession,
  messages: 5,
  diffPath: null,
  diffBytes: null,
  partCounts: { text: 10, tool: 3 },
  toolCounts: [{ tool: "read", status: "success", count: 2 }],
  recentText: [{ role: "user", timeCreated: 100000, text: "hello" }],
  tokensReasoning: 20,
  tokensCacheRead: 5,
  tokensCacheWrite: 3,
  summaryFiles: 3,
  summaryAdditions: 10,
  summaryDeletions: 2,
};

beforeAll(() => {
  setTheme(testTheme as any);
});

describe("buildMessagesContent", () => {
  test("returns placeholder when no session selected", () => {
    const state = baseState({ cursor: 0, expandedFolders: new Set() });
    const text = flatText(buildMessagesContent(state));
    expect(text).toContain("Select a session");
  });

  test("returns empty message when no message rows", () => {
    const state = baseState({ cursor: 1, expandedFolders: new Set([mockFolder.directory]) });
    const text = flatText(buildMessagesContent(state));
    expect(text).toContain("(no messages)");
  });

  test("renders user and assistant messages with U/A prefix and timestamp", () => {
    const msgs: ArchivedMessageRow[] = [
      { role: "user", time: 100000, text: "hello" },
      { role: "assistant", time: 200000, text: "world" },
    ];
    const state = baseState({ cursor: 1, expandedFolders: new Set([mockFolder.directory]), messageRows: msgs });
    const text = flatText(buildMessagesContent(state));
    expect(text).toContain("U");
    expect(text).toContain("A");
    expect(text).toContain("hello");
    expect(text).toContain("world");
  });

  test("filters out system messages", () => {
    const msgs: ArchivedMessageRow[] = [
      { role: "system", time: 50000, text: "system msg" },
      { role: "user", time: 100000, text: "user msg" },
    ];
    const state = baseState({ cursor: 1, expandedFolders: new Set([mockFolder.directory]), messageRows: msgs });
    const text = flatText(buildMessagesContent(state));
    expect(text).not.toContain("system msg");
    expect(text).toContain("user msg");
  });
});

describe("buildMetadataContent", () => {
  test("returns placeholder when no detail", () => {
    const state = baseState();
    const text = flatText(buildMetadataContent(state, null));
    expect(text).toContain("No session selected");
  });

  test("renders detail fields with id, directory, agent, model", () => {
    const text = flatText(buildMetadataContent(baseState(), mockDetail));
    expect(text).toContain("ses_1");
    expect(text).toContain("/test/proj");
    expect(text).toContain("build");
    expect(text).toContain("gpt-4");
    expect(text).toContain("openai");
  });

  test("renders cost, tokens, and times", () => {
    const text = flatText(buildMetadataContent(baseState(), mockDetail));
    expect(text).toContain("$1.23");
    expect(text).toContain("100");
    expect(text).toContain("50");
    expect(text).toContain("20");
  });

  test("renders suspicious indicator when flagged", () => {
    const suspicious = { ...mockDetail, suspicious: true };
    const text = flatText(buildMetadataContent(baseState({ viewport: { height: 60, width: 100 } }), suspicious));
    expect(text).toContain("suspicious");
  });

  test("renders (cwd) indicator for current directory", () => {
    const cwdDetail = { ...mockDetail, isCurrent: true };
    const text = flatText(buildMetadataContent(baseState(), cwdDetail));
    expect(text).toContain("(cwd)");
  });
});

describe("buildSessionsContent", () => {
  test("renders header with tab name", () => {
    const state = baseState({ expandedFolders: new Set([mockFolder.directory]) });
    const text = flatText(buildSessionsContent(state));
    expect(text).toContain("[Active]");
    expect(text).toContain("Archived");
  });

  test("renders folder rows with directory name and without counts", () => {
    const state = baseState({ expandedFolders: new Set([mockFolder.directory]) });
    const text = flatText(buildSessionsContent(state));
    expect(text).toContain("/test/proj");
    expect(text).not.toContain("1 active");
    expect(text).not.toContain("1 archived");
  });

  test("renders session rows with title, updated time, cost, and archive marker", () => {
    const state = baseState({ expandedFolders: new Set([mockFolder.directory]) });
    const visible = getVisibleRows(state);
    const sessionIdx = visible.findIndex(r => "id" in r);
    const cursorState = { ...state, cursor: sessionIdx };
    const text = flatText(buildSessionsContent(cursorState));
    expect(text).toContain("Test Session");
    expect(text).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(text).toContain("$1.23");
  });

  test("selected row has selection marker", () => {
    const state = baseState({ expandedFolders: new Set([mockFolder.directory]) });
    const visible = getVisibleRows(state);
    const sessionIdx = visible.findIndex(r => "id" in r);
    const cursorState = { ...state, cursor: sessionIdx };
    const text = flatText(buildSessionsContent(cursorState));
    expect(text).toContain("\u276f");
  });
});

describe("buildActionBarContent", () => {
  test("renders active session chips with open/archive/delete", () => {
    const state = baseState({ expandedFolders: new Set([mockFolder.directory]), cursor: 1 });
    const text = flatText(buildActionBarContent(state));
    expect(text).toContain("Enter open");
    expect(text).toContain("archive");
    expect(text).toContain("delete");
  });

  test("renders metadata focus chips with tab-focus/back/quit", () => {
    const state = baseState({ focus: "metadata" });
    const text = flatText(buildActionBarContent(state));
    expect(text).toContain("Tab switch tab");
    expect(text).toContain("Esc back");
    expect(text).toContain("q quit");
  });
});

describe("buildConfirmOverlay", () => {
  test("returns empty when no pending action", () => {
    const text = flatText(buildConfirmOverlay(baseState()));
    expect(text).toBe("");
  });

  test("renders overlay with pending action title", () => {
    const state = baseState({ pendingAction: "delete", expandedFolders: new Set([mockFolder.directory]), cursor: 1 });
    const text = flatText(buildConfirmOverlay(state));
    expect(text).toContain("DELETE");
    expect(text).toContain("permanently");
  });

  test("delete confirmation includes destructive text", () => {
    const state = baseState({ pendingAction: "delete", expandedFolders: new Set([mockFolder.directory]), cursor: 1 });
    const text = flatText(buildConfirmOverlay(state));
    expect(text).toContain("DESTRUCTIVE");
    expect(text).toContain("cannot be undone");
  });

  test("archive_and_delete confirmation includes destructive text", () => {
    const state = baseState({ pendingAction: "archive_and_delete", expandedFolders: new Set([mockFolder.directory]), cursor: 1 });
    const text = flatText(buildConfirmOverlay(state));
    expect(text).toContain("DESTRUCTIVE");
  });

  test("bulk_delete confirmation includes destructive text", () => {
    const state = baseState({ pendingAction: "bulk_delete", pendingDirectory: "/test/proj", pendingCount: 5 });
    const text = flatText(buildConfirmOverlay(state));
    expect(text).toContain("DESTRUCTIVE");
  });

  test("non-destructive confirm (archive) does not show destructive warning", () => {
    const state = baseState({ pendingAction: "archive", expandedFolders: new Set([mockFolder.directory]), cursor: 1 });
    const text = flatText(buildConfirmOverlay(state));
    expect(text).toContain("ARCHIVE");
    expect(text).not.toContain("DESTRUCTIVE");
  });

  test("confirm overlay includes only keyboard confirm/cancel hint", () => {
    const state = baseState({ pendingAction: "archive", expandedFolders: new Set([mockFolder.directory]), cursor: 1 });
    const text = flatText(buildConfirmOverlay(state));
    expect(text).toContain("[y/Enter] confirm");
    expect(text).not.toContain("click");
  });
});

describe("buildChoiceOverlay", () => {
  test("returns empty when no pending choice", () => {
    const text = flatText(buildChoiceOverlay(baseState()));
    expect(text).toBe("");
  });

  test("renders archive/delete choices", () => {
    const state = baseState({ pendingChoice: "archive_or_delete" });
    const text = flatText(buildChoiceOverlay(state));
    expect(text).toContain("Archive or Delete");
    expect(text).toContain("[A]");
    expect(text).toContain("[D]");
    expect(text).toContain("[C]");
  });

  test("renders import/delete choices", () => {
    const state = baseState({ pendingChoice: "delete_or_import" });
    const text = flatText(buildChoiceOverlay(state));
    expect(text).toContain("Delete or Import");
    expect(text).toContain("[I]");
    expect(text).toContain("[D]");
    expect(text).toContain("[C]");
  });
});

describe("dashboardLayout", () => {
  test("wide layout uses half top split and two-row action bar", () => {
    const layout = dashboardLayout(110, 30);
    expect(layout.mode).toBe("wide");
    expect(layout.topPercent).toBe(1);
    expect(layout.sessionsPercent).toBe(1);
    expect(layout.actionRows).toBe(2);
    expect(layout.topSplit).toBe("half");
    expect(layout.topMaxHeight).toBe("55%");
    expect(layout.sessionsMinHeight).toBe("30%");
  });

  test("medium layout keeps half top split and two-row action bar", () => {
    const layout = dashboardLayout(100, 30);
    expect(layout.mode).toBe("medium");
    expect(layout.topPercent).toBe(1);
    expect(layout.sessionsPercent).toBe(1);
    expect(layout.actionRows).toBe(2);
    expect(layout.topSplit).toBe("half");
    expect(layout.topMaxHeight).toBe("55%");
    expect(layout.sessionsMinHeight).toBe("30%");
  });

  test("focused layout activates below minimum terminal size", () => {
    const narrow = dashboardLayout(81, 30);
    expect(narrow.mode).toBe("focused");
    expect(narrow.topPercent).toBe(0);
    expect(narrow.sessionsPercent).toBe(0);
    expect(narrow.topSplit).toBe("focused");
    expect(narrow.actionRows).toBe(1);
    expect(narrow.topMaxHeight).toBe("55%");
    expect(narrow.sessionsMinHeight).toBe("30%");

    const short = dashboardLayout(100, 21);
    expect(short.mode).toBe("focused");
    expect(short.topPercent).toBe(0);
    expect(short.sessionsPercent).toBe(0);
    expect(short.topSplit).toBe("focused");
    expect(short.actionRows).toBe(1);
    expect(short.topMaxHeight).toBe("55%");
    expect(short.sessionsMinHeight).toBe("30%");
  });

  test("layout percentages leave room for action bar", () => {
    const wide = dashboardLayout(110, 30);
    expect(wide.topPercent + wide.sessionsPercent).toBeLessThanOrEqual(100);

    const medium = dashboardLayout(100, 30);
    expect(medium.topPercent + medium.sessionsPercent).toBeLessThanOrEqual(100);

    const focused = dashboardLayout(81, 30);
    expect(focused.topPercent + focused.sessionsPercent).toBeLessThanOrEqual(100);
  });

  test("medium mode activates on either dimension below threshold", () => {
    const narrow = dashboardLayout(109, 30);
    expect(narrow.mode).toBe("medium");

    const short = dashboardLayout(110, 29);
    expect(short.mode).toBe("medium");
  });

  test("focused on very small both dimensions", () => {
    const layout = dashboardLayout(40, 10);
    expect(layout.mode).toBe("focused");
    expect(layout.topPercent).toBe(0);
    expect(layout.sessionsPercent).toBe(0);
    expect(layout.topSplit).toBe("focused");
    expect(layout.topMaxHeight).toBe("55%");
    expect(layout.sessionsMinHeight).toBe("30%");
  });

  test("all layout sizes include maxHeight and minHeight constraints", () => {
    const sizes: [number, number][] = [[40, 10], [100, 30], [120, 30]];
    for (const [w, h] of sizes) {
      const layout = dashboardLayout(w, h);
      expect(layout.topMaxHeight).toBe("55%");
      expect(layout.sessionsMinHeight).toBe("30%");
    }
  });
});

describe("buildSearchOverlay", () => {
  test("renders [A]/[a] markers and match type indicators", () => {
    const state = baseState({ inputMode: "search", query: "" });
    const text = flatText(buildSearchOverlay(state));
    expect(text).toContain("[A]");
    expect(text).toContain("[a]");
    expect(text).toContain("meta");
  });
});
