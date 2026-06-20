import {
  currentSession,
  selectFolderAtCursor,
  getVisibleRows,
  popStack,
  tabs,
  clampCursor,
  reloadState,
} from "./state.ts";
import type { PaneFocus, UiState, UiSession } from "./state.ts";

const FOCUS_CYCLE: PaneFocus[] = ["messages", "metadata", "sessions"];

function nextFocus(focus: PaneFocus): PaneFocus {
  const idx = FOCUS_CYCLE.indexOf(focus);
  if (idx === -1) return FOCUS_CYCLE[0];
  return FOCUS_CYCLE[(idx + 1) % FOCUS_CYCLE.length];
}

function prevFocus(focus: PaneFocus): PaneFocus {
  const idx = FOCUS_CYCLE.indexOf(focus);
  if (idx === -1) return FOCUS_CYCLE[FOCUS_CYCLE.length - 1];
  return FOCUS_CYCLE[(idx - 1 + FOCUS_CYCLE.length) % FOCUS_CYCLE.length];
}

function moveSessionCursor(state: UiState, cursor: number): UiState {
  return reloadState(clampCursor({ ...state, cursor }));
}
import type { DirectoryRow } from "../db.ts";
import {
  deleteSessionById,
  exportSessionToFile,
  importSessionFromFile,
  listActiveSessionsInDir,
  listArchivedSessionsInDir,
  removeArchiveFile,
  setArchived,
} from "../db.ts";

export type ActionChip = {
  id: string;
  label: string;
  key?: string;
  mouse?: boolean;
  danger?: boolean;
  primary?: boolean;
};

function bulkArchiveInDir(directory: string): { ok: number; failed: number; status: string } {
  const rows = listActiveSessionsInDir(directory);
  let ok = 0;
  let failed = 0;
  let lastError = "";
  for (const row of rows) {
    const res = exportSessionToFile(row.id);
    if (!res.ok) { failed += 1; lastError = res.stderr.slice(-160); continue; }
    setArchived({ id: row.id, archivedAt: Date.now() });
    ok += 1;
  }
  const status = `bulk archived ${ok}/${rows.length}` + (failed ? `, ${failed} failed: ${lastError}` : "");
  return { ok, failed, status };
}

function bulkRestoreInDir(directory: string): { ok: number; failed: number; status: string } {
  const rows = listArchivedSessionsInDir(directory);
  let ok = 0;
  let failed = 0;
  let lastError = "";
  for (const row of rows) {
    const imp = importSessionFromFile(row.id);
    if (!imp.ok) { failed += 1; lastError = imp.stderr.slice(-160); continue; }
    setArchived({ id: row.id, archivedAt: null });
    const rem = removeArchiveFile(row.id);
    if (!rem.ok) { lastError = rem.err || ""; }
    ok += 1;
  }
  const status = `bulk restored ${ok}/${rows.length}` + (failed ? `, ${failed} failed: ${lastError}` : "");
  return { ok, failed, status };
}

function bulkDeleteInDir(directory: string): { ok: number; failed: number; status: string } {
  const archived = listArchivedSessionsInDir(directory);
  const rows = [...archived];
  let ok = 0;
  let failed = 0;
  let lastError = "";
  for (const row of rows) {
    const del = deleteSessionById(row.id);
    if (!del.ok) { failed += 1; lastError = del.stderr.slice(-160); continue; }
    removeArchiveFile(row.id);
    ok += 1;
  }
  const status = `bulk deleted ${ok}/${rows.length} archived` + (failed ? `, ${failed} failed: ${lastError}` : "");
  return { ok, failed, status };
}

export function confirmOverlayText(state: UiState): string {
  if (!state.pendingAction) return "";
  const selected = currentSession(state);
  switch (state.pendingAction) {
    case "archive":
      return `Archive session ${selected?.id || ""}?`;
    case "archive_and_delete":
      return `Archive + delete ${selected?.id || ""}? This legacy action is disabled.`;
    case "import":
      return `Import archived session ${selected?.id || ""}?`;
    case "delete":
      return `Delete ${selected?.title || selected?.id || ""} permanently? No archive will be created.`;
    case "bulk_archive":
      return `Bulk archive ${state.pendingCount ?? 0} active sessions under ${state.pendingDirectory || ""}?`;
    case "bulk_restore":
      return `Bulk restore ${state.pendingCount ?? 0} archived sessions under ${state.pendingDirectory || ""}?`;
    case "bulk_delete":
      return `Bulk delete ${state.pendingCount ?? 0} archived sessions under ${state.pendingDirectory || ""}?`;
    default:
      return "Are you sure?";
  }
}

export function executePendingAction(
  state: UiState,
  onContinue?: (id: string, fork: boolean) => void,
): UiState {
  const selected = currentSession(state);
  if (!state.pendingAction) return { ...state, pendingAction: null, status: "cancelled" };

  if (state.pendingAction === "bulk_archive" && state.pendingDirectory) {
    const result = bulkArchiveInDir(state.pendingDirectory);
    return clampCursor(reloadState({ ...state, pendingAction: null, pendingDirectory: undefined, pendingCount: undefined, status: result.status }));
  }
  if (state.pendingAction === "bulk_restore" && state.pendingDirectory) {
    const result = bulkRestoreInDir(state.pendingDirectory);
    return clampCursor(reloadState({ ...state, pendingAction: null, pendingDirectory: undefined, pendingCount: undefined, status: result.status }));
  }
  if (state.pendingAction === "bulk_delete" && state.pendingDirectory) {
    const result = bulkDeleteInDir(state.pendingDirectory);
    return clampCursor(reloadState({ ...state, pendingAction: null, pendingDirectory: undefined, pendingCount: undefined, status: result.status }));
  }

  if (!selected) return { ...state, pendingAction: null, status: "no session selected" };

  if (state.pendingAction === "archive") {
    const res = exportSessionToFile(selected.id);
    if (!res.ok) {
      return { ...state, pendingAction: null, status: `archive failed (exit ${res.code}): ${res.stderr.slice(-160)}` };
    }
    setArchived({ id: selected.id, archivedAt: Date.now() });
    return clampCursor(reloadState({ ...state, pendingAction: null, status: `archived + exported ${selected.id}` }));
  }

  if (state.pendingAction === "archive_and_delete") {
    return { ...state, pendingAction: null, status: "legacy archive+delete disabled; use a archive or d delete" };
  }

  if (state.pendingAction === "restore") {
    setArchived({ id: selected.id, archivedAt: null });
    return clampCursor(reloadState({ ...state, pendingAction: null, tab: "active", cursor: 0, listScroll: 0, status: `restored ${selected.id}` }));
  }

  if (state.pendingAction === "import") {
    const imp = importSessionFromFile(selected.id);
    if (!imp.ok) {
      return { ...state, pendingAction: null, status: imp.code === -1 ? imp.stderr : `import failed (exit ${imp.code}): ${imp.stderr.slice(-160)}` };
    }
    setArchived({ id: selected.id, archivedAt: null });
    const rem = removeArchiveFile(selected.id);
    if (!rem.ok) {
      return clampCursor(reloadState({ ...state, pendingAction: null, status: `imported but file removal failed: ${rem.err}` }));
    }
    return clampCursor(reloadState({ ...state, pendingAction: null, status: `imported ${selected.id}` }));
  }

  if (state.pendingAction === "delete") {
    const del = deleteSessionById(selected.id);
    if (!del.ok) {
      return { ...state, pendingAction: null, status: `delete failed: ${del.stderr.slice(-160)}` };
    }
    const rem = removeArchiveFile(selected.id);
    if (!rem.ok) {
      return clampCursor(reloadState({ ...state, pendingAction: null, status: `deleted but archive file removal failed: ${rem.err}` }));
    }
    return clampCursor(reloadState({ ...state, pendingAction: null, status: `deleted ${selected.id}` }));
  }

  if (state.pendingAction === "export_sanitized") {
    const res = exportSessionToFile(selected.id);
    if (!res.ok) {
      return { ...state, pendingAction: null, status: `export failed (exit ${res.code}): ${res.stderr.slice(-160)}` };
    }
    return clampCursor(reloadState({ ...state, pendingAction: null, status: `exported ${selected.id}` }));
  }

  if (state.pendingAction === "continue") {
    onContinue?.(selected.id, false);
    return { ...state, pendingAction: null, status: `continuing ${selected.id}` };
  }

  return clampCursor(reloadState({ ...state, pendingAction: null, status: `executed ${state.pendingAction}` }));
}

export function actionContext(state: UiState): { isFolder: boolean; isSession: boolean; isArchived: boolean } {
  const row = getVisibleRows(state)[state.cursor];
  const isFolder = row && !("id" in row);
  const isSession = row && "id" in row;
  const isArchived = isSession && (row as UiSession).timeArchived != null;
  return { isFolder: !!isFolder, isSession: !!isSession, isArchived };
}

export function actionChips(state: UiState): ActionChip[] {
  if (state.pendingAction) {
    return [
      { id: "confirm", label: "[y/Enter] confirm", key: "y|Enter", primary: true },
      { id: "cancel", label: "[n/Esc] cancel", key: "n|Esc" },
    ];
  }

  if (state.inputMode === "search") {
    return [
      { id: "open", label: "Enter open", key: "Enter", primary: true },
      { id: "wheel", label: "wheel scroll", mouse: true },
      { id: "cancel", label: "Esc cancel", key: "Esc" },
    ];
  }

  if (state.focus === "metadata" || state.focus === "messages") {
    return [
      { id: "tab-focus", label: "Tab focus", key: "Tab" },
      { id: "back", label: "Esc back", key: "Esc" },
      { id: "quit", label: "q quit", key: "q" },
      { id: "wheel", label: "wheel scroll", mouse: true },
    ];
  }

  const row = getVisibleRows(state)[state.cursor];
  if (!row) return [{ id: "quit", label: "q quit", key: "q" }];

  if (!("id" in row)) {
    return [
      { id: "expand", label: "Enter expand", key: "Enter" },
      { id: "toggle-all", label: "o toggle", key: "o" },
      { id: "archive", label: "a archive", key: "a" },
      { id: "restore", label: "r restore", key: "r" },
      { id: "delete", label: "d delete", key: "d", danger: true },
      { id: "search", label: "/ search", key: "/" },
      { id: "tab", label: "t tab", key: "t" },
      { id: "tab-focus", label: "Tab focus", key: "Tab" },
      { id: "back", label: "Esc back", key: "Esc" },
      { id: "quit", label: "q quit", key: "q" },
      { id: "wheel", label: "wheel scroll", mouse: true },
    ];
  }

  const session = row as UiSession;
  if (session.timeArchived != null) {
    return [
      { id: "open", label: "Enter open", key: "Enter" },
      { id: "restore", label: "r restore", key: "r" },
      { id: "delete", label: "d delete", key: "d", danger: true },
      { id: "search", label: "/ search", key: "/" },
      { id: "tab", label: "t tab", key: "t" },
      { id: "tab-focus", label: "Tab focus", key: "Tab" },
      { id: "back", label: "Esc back", key: "Esc" },
      { id: "quit", label: "q quit", key: "q" },
      { id: "wheel", label: "wheel scroll", mouse: true },
    ];
  }

  return [
    { id: "open", label: "Enter open", key: "Enter" },
    { id: "archive", label: "a archive", key: "a" },
    { id: "delete", label: "d delete", key: "d", danger: true },
    { id: "search", label: "/ search", key: "/" },
    { id: "tab", label: "t tab", key: "t" },
    { id: "tab-focus", label: "Tab focus", key: "Tab" },
    { id: "back", label: "Esc back", key: "Esc" },
    { id: "quit", label: "q quit", key: "q" },
    { id: "wheel", label: "wheel scroll", mouse: true },
  ];
}

export function searchResultsFor(state: UiState): UiSession[] {
  const query = state.query.trim().toLowerCase();
  const base = state.allSessions;
  if (!query) return base.slice(0, 20);
  return base.filter(row =>
    [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].some(v => v.toLowerCase().includes(query))
  ).slice(0, 20);
}

export const SEARCH_VISIBLE_WINDOW = 10;

export function clampSearchScroll(selected: number, scroll: number, total: number): number {
  if (total <= SEARCH_VISIBLE_WINDOW) return 0;
  if (selected < scroll) return selected;
  if (selected >= scroll + SEARCH_VISIBLE_WINDOW) return selected - SEARCH_VISIBLE_WINDOW + 1;
  return scroll;
}

export function searchVisibleSlice(state: UiState): UiSession[] {
  const all = searchResultsFor(state);
  const start = Math.max(0, Math.min(state.searchScroll, Math.max(0, all.length - SEARCH_VISIBLE_WINDOW)));
  return all.slice(start, start + SEARCH_VISIBLE_WINDOW);
}

function openSessionInOpencode(state: UiState, id: string, onContinue?: (id: string, fork: boolean) => void, fork = false): UiState {
  onContinue?.(id, fork);
  return { ...state, status: `opening ${id}` };
}

export function applyKey(
  state: UiState,
  key: string,
  onContinue?: (id: string, fork: boolean) => void,
): UiState {
  if (key.startsWith("drill:")) {
    const next: UiState = { ...state, directory: key.slice("drill:".length), inputMode: null, status: "drilled" };
    return clampCursor(reloadState(next));
  }
  if (key === "/") return { ...state, inputMode: "search", query: "", searchSelected: 0, searchScroll: 0, status: "search" };
  if (key === "\\") return { ...state, inputMode: "directory", query: "", searchSelected: 0, searchScroll: 0, status: "directory" };
  if (key === "f") return { ...state, inputMode: "filter", searchSelected: 0, searchScroll: 0, status: "filter" };
  if (key.startsWith("type:")) {
    const query = key.slice("type:".length);
    return clampCursor(reloadState({ ...state, query, cursor: 0, listScroll: 0, status: `${state.inputMode || "input"}:${query}` }));
  }
  if (key === "Escape" || key === "Esc") {
    if (state.pendingAction) return { ...state, status: "cancelled", pendingAction: null, pendingDirectory: undefined, pendingCount: undefined };
    if (state.inputMode) return clampCursor(reloadState({ ...state, inputMode: null, query: "", searchSelected: 0, searchScroll: 0, status: "ready" }));
    if (state.stack.length > 0) return popStack(state);
    return { ...state, status: "already at root" };
  }

  if (state.inputMode === "search") {
    if (key === "ArrowUp" || key === "k") {
      const nextSel = Math.max(0, state.searchSelected - 1);
      const total = searchResultsFor(state).length;
      const nextScroll = clampSearchScroll(nextSel, state.searchScroll, total);
      return { ...state, searchSelected: nextSel, searchScroll: nextScroll };
    }
    if (key === "ArrowDown" || key === "j") {
      const total = searchResultsFor(state).length;
      const last = Math.max(0, total - 1);
      const nextSel = Math.min(last, state.searchSelected + 1);
      const nextScroll = clampSearchScroll(nextSel, state.searchScroll, total);
      return { ...state, searchSelected: nextSel, searchScroll: nextScroll };
    }
    if (key === "Enter") {
      const results = searchResultsFor(state);
      const sel = results[state.searchSelected];
      if (sel) {
        return openSessionInOpencode({ ...state, inputMode: null, query: "", searchSelected: 0, searchScroll: 0, focus: "metadata" }, sel.id, onContinue);
      }
      return state;
    }
    if (key === "Backspace") return applyKey(state, `type:${state.query.slice(0, -1)}`, onContinue);
    if (key.length === 1 && key >= " ") return applyKey(state, `type:${state.query}${key}`, onContinue);
    return state;
  }

  if (state.inputMode === "directory" || state.inputMode === "filter") {
    if (key === "Backspace") return applyKey(state, `type:${state.query.slice(0, -1)}`, onContinue);
    if (key.length === 1 && key >= " ") return applyKey(state, `type:${state.query}${key}`, onContinue);
    return state;
  }

  if (state.pendingAction) {
    if (key === "y" || key === "Enter") return executePendingAction(state, onContinue);
    if (key === "n") return { ...state, status: "cancelled", pendingAction: null, pendingDirectory: undefined, pendingCount: undefined };
    return state;
  }

  if (key === "Tab") {
    if (state.inputMode || state.pendingAction) return state;
    if (state.focus === "search" || state.focus === "confirm") return state;
    return { ...state, focus: nextFocus(state.focus) };
  }
  if (key === "S-Tab") {
    if (state.inputMode || state.pendingAction) return state;
    if (state.focus === "search" || state.focus === "confirm") return state;
    return { ...state, focus: prevFocus(state.focus) };
  }
  if (key === "t") {
    if (state.inputMode || state.pendingAction) return state;
    const nextTab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length];
    return clampCursor(reloadState({ ...state, tab: nextTab, cursor: 0, listScroll: 0 }));
  }
  if (key === "B") {
    return clampCursor(reloadState({ ...state, directory: undefined, query: "", inputMode: null, stack: [], cursor: 0, listScroll: 0, focus: "sessions", status: "reset" }));
  }
  if (key === "o") {
    const allExpanded = state.folders.length > 0 && state.folders.every(f => state.expandedFolders.has(f.directory));
    const nextSet = new Set<string>();
    if (!allExpanded) state.folders.forEach(f => { nextSet.add(f.directory); });
    return clampCursor(reloadState({ ...state, expandedFolders: nextSet }));
  }
  if (key === "h" || key === "ArrowLeft") {
    const folder = selectFolderAtCursor(state);
    if (folder) {
      const nextSet = new Set(state.expandedFolders);
      nextSet.delete(folder.directory);
      return clampCursor(reloadState({ ...state, expandedFolders: nextSet }));
    }
    return popStack(state);
  }
  if (key === "l" || key === "ArrowRight") {
    const folder = selectFolderAtCursor(state);
    if (folder) {
      const nextSet = new Set(state.expandedFolders);
      nextSet.add(folder.directory);
      return clampCursor(reloadState({ ...state, expandedFolders: nextSet }));
    }
    return state;
  }

  if (key === "j" || key === "ArrowDown") {
    if (state.focus === "messages" && state.messageRows.length > 0) {
      const max = Math.max(0, state.messageRows.length - 1);
      return { ...state, messageScroll: Math.min(max, state.messageScroll + 1) };
    }
    if (state.focus === "metadata") {
      return { ...state, detailScroll: state.detailScroll + 1 };
    }
    return moveSessionCursor(state, state.cursor + 1);
  }
  if (key === "k" || key === "ArrowUp") {
    if (state.focus === "messages" && state.messageRows.length > 0) {
      return { ...state, messageScroll: Math.max(0, state.messageScroll - 1) };
    }
    if (state.focus === "metadata") {
      return { ...state, detailScroll: Math.max(0, state.detailScroll - 1) };
    }
    return moveSessionCursor(state, state.cursor - 1);
  }
  if (key === "G") {
    if (state.focus === "messages" && state.messageRows.length > 0) {
      return { ...state, messageScroll: state.messageRows.length - 1 };
    }
    if (state.focus === "metadata") {
      return { ...state, detailScroll: Number.MAX_SAFE_INTEGER };
    }
    return moveSessionCursor(state, getVisibleRows(state).length - 1);
  }
  if (key === "gg") return moveSessionCursor(state, 0);
  if (key === "Ctrl+D" || key === "PageDown") {
    if (state.focus === "messages" && state.messageRows.length > 0) {
      const max = Math.max(0, state.messageRows.length - 1);
      return { ...state, messageScroll: Math.min(max, state.messageScroll + 5) };
    }
    if (state.focus === "metadata") {
      return { ...state, detailScroll: state.detailScroll + 5 };
    }
    return moveSessionCursor(state, state.cursor + 5);
  }
  if (key === "Ctrl+U" || key === "PageUp") {
    if (state.focus === "messages" && state.messageRows.length > 0) {
      return { ...state, messageScroll: Math.max(0, state.messageScroll - 5) };
    }
    if (state.focus === "metadata") {
      return { ...state, detailScroll: Math.max(0, state.detailScroll - 5) };
    }
    return moveSessionCursor(state, state.cursor - 5);
  }

  if (key === "Enter") {
    const row = getVisibleRows(state)[state.cursor];
    if (row && !("id" in row)) {
      const dir = (row as DirectoryRow).directory;
      const nextExpanded = new Set(state.expandedFolders);
      if (nextExpanded.has(dir)) nextExpanded.delete(dir);
      else nextExpanded.add(dir);
      return clampCursor(reloadState({ ...state, expandedFolders: nextExpanded }));
    }
    const session = currentSession(state);
    if (session) {
      return openSessionInOpencode(state, session.id, onContinue);
    }
    return state;
  }

  const ctx = actionContext(state);
  const session = currentSession(state);
  const folder = selectFolderAtCursor(state);

  if (ctx.isFolder && folder) {
    if (key === "a") {
      const count = listActiveSessionsInDir(folder.directory).length;
      if (count === 0) return { ...state, status: "no active sessions to archive" };
      return { ...state, status: confirmOverlayText({ ...state, pendingAction: "bulk_archive", pendingDirectory: folder.directory, pendingCount: count }), pendingAction: "bulk_archive", pendingDirectory: folder.directory, pendingCount: count };
    }
    if (key === "r") {
      const count = listArchivedSessionsInDir(folder.directory).length;
      if (count === 0) return { ...state, status: "no archived sessions to restore" };
      return { ...state, status: confirmOverlayText({ ...state, pendingAction: "bulk_restore", pendingDirectory: folder.directory, pendingCount: count }), pendingAction: "bulk_restore", pendingDirectory: folder.directory, pendingCount: count };
    }
    if (key === "d") {
      const activeCount = listActiveSessionsInDir(folder.directory).length;
      if (activeCount > 0) return { ...state, status: "bulk delete disabled while active sessions exist; archive or delete individually" };
      const count = listArchivedSessionsInDir(folder.directory).length;
      if (count === 0) return { ...state, status: "no sessions in this folder" };
      return { ...state, status: confirmOverlayText({ ...state, pendingAction: "bulk_delete", pendingDirectory: folder.directory, pendingCount: count }), pendingAction: "bulk_delete", pendingDirectory: folder.directory, pendingCount: count };
    }
    return state;
  }

  if (ctx.isSession && session) {
    if (ctx.isArchived) {
      if (key === "a") return { ...state, status: "archive only applies to active sessions" };
      if (key === "i") return { ...state, status: "import is deferred; use r restore" };
      if (key === "r") return { ...state, status: `confirm restore ${session.id}`, pendingAction: "restore" };
      if (key === "d") return { ...state, status: `confirm delete ${session.id} (permanent)`, pendingAction: "delete" };
    } else {
      if (key === "r") return { ...state, status: "restore only applies to archived sessions" };
      if (key === "i") return { ...state, status: "import only applies to archived sessions" };
      if (key === "a") return { ...state, status: `confirm archive ${session.id}`, pendingAction: "archive" };
      if (key === "d") return { ...state, status: `confirm permanent delete ${session.id}`, pendingAction: "delete" };
    }
  }

  return state;
}
