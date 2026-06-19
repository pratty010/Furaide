#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bg, bold, Box, createCliRenderer, fg, StyledText, TextChunk, TextRenderable } from "@opentui/core";
import {
  deleteSessionById,
  DirectoryRow,
  exportSessionToFile,
  getSessionDetail,
  importSessionFromFile,
  listActiveSessionsInDir,
  listArchivedSessionsInDir,
  listDirectories,
  listSessions,
  readArchivedMessages,
  removeArchiveFile,
  SessionDetail,
  SessionRow,
  setArchived,
  type ArchivedMessageRow,
  type Tab,
} from "./db.ts";

export type UiSession = SessionRow;
export type Viewport = { height: number; width: number };
type InputMode = null | "search" | "directory" | "filter";
type PendingAction =
  | "delete"
  | "archive"
  | "restore"
  | "export_sanitized"
  | "continue"
  | "archive_and_delete"
  | "import"
  | "bulk_archive"
  | "bulk_restore"
  | "bulk_delete"
  | null;
type ScrollFocus = "left" | "right";

type ThemeDoc = {
  name: string;
  vars: Record<string, string>;
  pane: Record<string, string>;
};

export type UiState = {
  folders: DirectoryRow[];
  allSessions: UiSession[];
  sessions: UiSession[];
  expandedFolders: Set<string>;
  messagesExpanded: boolean;
  cursor: number;
  listScroll: number;
  detailScroll: number;
  messageScroll: number;
  tab: Tab;
  inputMode: InputMode;
  query: string;
  directory?: string;
  sort: "updated" | "created" | "cost" | "title" | "recency";
  stack: Array<Pick<UiState, "cursor" | "listScroll" | "tab" | "query" | "directory" | "sort" | "expandedFolders">>;
  viewport: Viewport;
  status: string;
  pendingAction: PendingAction;
  pendingDirectory?: string;
  pendingCount?: number;
  searchSelected: number;
  scrollFocus: ScrollFocus;
  archivedMessages: ArchivedMessageRow[];
};

const tabs: Tab[] = ["active", "archived"];
const theme = JSON.parse(readFileSync(new URL("../themes/friday.json", import.meta.url), "utf8")) as ThemeDoc;

let continueRequest: { id: string; fork: boolean } | null = null;
let quitRequestCode: number | null = null;

function tone(slot: string): string {
  const key = theme.pane[slot] || slot;
  return theme.vars[key] || key;
}

function cwd(): string {
  return process.env.OPENCODE_ALL_CWD || process.cwd();
}

function leftRowsCount(state: UiState): number {
  return Math.max(1, Math.floor((state.viewport.height - 2) * 0.5));
}

function rightTopRows(state: UiState): number {
  return Math.max(1, Math.floor((state.viewport.height - 2) * 0.5));
}

function rightBottomRows(state: UiState): number {
  return Math.max(1, state.viewport.height - 2 - rightTopRows(state));
}

function sortFolders(rows: DirectoryRow[], baseCwd: string): DirectoryRow[] {
  return [...rows].sort((a, b) => Number(b.directory.startsWith(baseCwd)) - Number(a.directory.startsWith(baseCwd)) || b.latestUpdated - a.latestUpdated || a.directory.localeCompare(b.directory));
}

function parseModel(model: string): string {
  if (!model) return "-";
  try {
    const parsed = JSON.parse(model) as { providerID?: string; id?: string; variant?: string };
    return [parsed.providerID, parsed.id, parsed.variant].filter(Boolean).join("/").replace(/\/$/, "");
  } catch {
    return model;
  }
}

function formatTime(epoch: number): string {
  if (!epoch) return "--:--:--";
  const d = new Date(epoch);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function getVisibleRows(state: UiState): Array<DirectoryRow | UiSession> {
  const rows: Array<DirectoryRow | UiSession> = [];
  const visibleSessions = state.directory
    ? state.sessions.filter(s => s.directory === state.directory)
    : state.sessions;
  const sessionDirectories = new Set(visibleSessions.map(s => s.directory));
  const foldersToShow = state.directory
    ? state.folders.filter(f => f.directory === state.directory)
    : state.folders.filter(f => sessionDirectories.has(f.directory) || f.active + f.archived > 0);
  for (const folder of foldersToShow) {
    if (state.directory && folder.directory !== state.directory) continue;
    rows.push(folder);
    if (state.expandedFolders.has(folder.directory)) {
      const folderSessions = visibleSessions.filter(s => s.directory === folder.directory);
      rows.push(...folderSessions);
    }
  }
  return rows;
}

export function currentSession(state: UiState): UiSession | undefined {
  const row = getVisibleRows(state)[state.cursor];
  if (row && "id" in row) return row as UiSession;
  return undefined;
}

export function reloadState(state: UiState): UiState {
  const baseCwd = cwd();
  let folders = sortFolders(listDirectories({ prefix: state.query }), baseCwd);
  if (state.inputMode === "search" && state.query) {
    folders = folders.filter(row => row.directory.toLowerCase().includes(state.query.toLowerCase()));
  }
  const dbSessions = listSessions({ tab: state.tab, cwd: baseCwd, directory: state.directory, query: state.query });
  const sessions = dbSessions.length > 0
    ? dbSessions
    : state.allSessions
        .filter(row => !state.directory || row.directory === state.directory)
        .filter(row => !state.query || [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].some(value => value.toLowerCase().includes(state.query.toLowerCase())));
  const visible = getVisibleRows({ ...state, folders, sessions });
  const cursor = Math.min(state.cursor, Math.max(0, visible.length - 1));
  let archivedMessages: ArchivedMessageRow[] = state.archivedMessages;
  if (state.tab === "archived" && sessions[cursor] && "id" in sessions[cursor]) {
    archivedMessages = readArchivedMessages(sessions[cursor].id);
  }
  return { ...state, folders, sessions, cursor, listScroll: Math.min(state.listScroll, cursor), archivedMessages };
}

export function createInitialState(sessions: UiSession[], viewport: Viewport): UiState {
  const realFolders = listDirectories({ prefix: "" });
  const realDirs = new Set(realFolders.map(f => f.directory));
  const sessionDirs = new Set(sessions.map(s => s.directory));
  const syntheticFolders: DirectoryRow[] = [];
  for (const dir of sessionDirs) {
    if (!realDirs.has(dir)) {
      const matching = sessions.filter(s => s.directory === dir);
      syntheticFolders.push({
        directory: dir,
        active: matching.filter(s => s.timeArchived == null).length,
        archived: matching.filter(s => s.timeArchived != null).length,
        latestUpdated: matching.reduce((m, s) => Math.max(m, s.timeUpdated), 0),
      });
    }
  }
  const folders = sortFolders([...realFolders, ...syntheticFolders], cwd());
  return {
    folders,
    allSessions: sessions,
    sessions,
    expandedFolders: new Set<string>(),
    messagesExpanded: false,
    cursor: 0,
    listScroll: 0,
    detailScroll: 0,
    messageScroll: 0,
    tab: "active",
    inputMode: null,
    query: "",
    sort: "updated",
    stack: [],
    viewport,
    status: "ready",
    pendingAction: null,
    searchSelected: 0,
    scrollFocus: "left",
    archivedMessages: [],
  };
}

export function clampCursor(state: UiState): UiState {
  const total = getVisibleRows(state).length;
  const max = Math.max(0, total - 1);
  const cursor = Math.max(0, Math.min(state.cursor, max));
  const rows = leftRowsCount(state);
  let listScroll = state.listScroll;
  if (cursor < listScroll) listScroll = cursor;
  if (cursor >= listScroll + rows) listScroll = cursor - rows + 1;
  return { ...state, cursor, listScroll: Math.max(0, listScroll) };
}

function popStack(state: UiState): UiState {
  const prev = state.stack.at(-1);
  if (!prev) return { ...state, status: "already at root" };
  const next: UiState = {
    ...state,
    ...prev,
    inputMode: null,
    stack: state.stack.slice(0, -1),
    status: "back",
  };
  return clampCursor(reloadState(next));
}

function selectFolderAtCursor(state: UiState): DirectoryRow | undefined {
  const row = getVisibleRows(state)[state.cursor];
  if (row && !("id" in row)) return row as DirectoryRow;
  return undefined;
}

function confirmOverlayText(state: UiState): string {
  if (!state.pendingAction) return "";
  const selected = currentSession(state);
  switch (state.pendingAction) {
    case "archive":
      return `Archive session ${selected?.id || ""}?`;
    case "archive_and_delete":
      return `Archive + delete ${selected?.id || ""}? This removes it from active.`;
    case "import":
      return `Import archived session ${selected?.id || ""}?`;
    case "delete":
      return `Delete ${selected?.id || ""} permanently?`;
    case "bulk_archive":
      return `Bulk archive ${state.pendingCount ?? 0} active sessions under ${state.pendingDirectory || ""}?`;
    case "bulk_restore":
      return `Bulk restore ${state.pendingCount ?? 0} archived sessions under ${state.pendingDirectory || ""}?`;
    case "bulk_delete":
      return `Bulk delete ${state.pendingCount ?? 0} sessions under ${state.pendingDirectory || ""}?`;
    default:
      return "Are you sure?";
  }
}

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
  const active = listActiveSessionsInDir(directory);
  const archived = listArchivedSessionsInDir(directory);
  const rows = [...active, ...archived];
  let ok = 0;
  let failed = 0;
  let lastError = "";
  for (const row of rows) {
    const del = deleteSessionById(row.id);
    if (!del.ok) { failed += 1; lastError = del.stderr.slice(-160); continue; }
    removeArchiveFile(row.id);
    ok += 1;
  }
  const status = `bulk deleted ${ok}/${rows.length}` + (failed ? `, ${failed} failed: ${lastError}` : "");
  return { ok, failed, status };
}

function executePendingAction(state: UiState): UiState {
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
    const exp = exportSessionToFile(selected.id);
    if (!exp.ok) {
      return { ...state, pendingAction: null, status: `export failed (exit ${exp.code}): ${exp.stderr.slice(-160)}` };
    }
    const del = deleteSessionById(selected.id);
    if (!del.ok) {
      return { ...state, pendingAction: null, status: `exported but delete failed: ${del.stderr.slice(-160)}` };
    }
    removeArchiveFile(selected.id);
    return clampCursor(reloadState({ ...state, pendingAction: null, status: `archived + deleted ${selected.id}` }));
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
    removeArchiveFile(selected.id);
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
    continueRequest = { id: selected.id, fork: false };
    return { ...state, pendingAction: null, status: `continuing ${selected.id}` };
  }

  return clampCursor(reloadState({ ...state, pendingAction: null, status: `executed ${state.pendingAction}` }));
}

function openSessionInOpencode(state: UiState, id: string, fork = false): UiState {
  continueRequest = { id, fork };
  return { ...state, status: `opening ${id}` };
}

function actionContext(state: UiState): { isFolder: boolean; isSession: boolean; isArchived: boolean } {
  const row = getVisibleRows(state)[state.cursor];
  const isFolder = row && !("id" in row);
  const isSession = row && "id" in row;
  const isArchived = isSession && (row as UiSession).timeArchived != null;
  return { isFolder: !!isFolder, isSession: !!isSession, isArchived };
}

export function applyKey(state: UiState, key: string): UiState {
  if (key.startsWith("drill:")) {
    const next: UiState = { ...state, directory: key.slice("drill:".length), inputMode: null, status: "drilled" };
    return clampCursor(reloadState(next));
  }
  if (key === "/") return { ...state, inputMode: "search", query: "", searchSelected: 0, status: "search" };
  if (key === "\\") return { ...state, inputMode: "directory", query: "", searchSelected: 0, status: "directory" };
  if (key === "f") return { ...state, inputMode: "filter", searchSelected: 0, status: "filter" };
  if (key.startsWith("type:")) {
    const query = key.slice("type:".length);
    return clampCursor(reloadState({ ...state, query, cursor: 0, listScroll: 0, status: `${state.inputMode || "input"}:${query}` }));
  }
  if (key === "Escape" || key === "Esc") {
    if (state.pendingAction) return { ...state, status: "cancelled", pendingAction: null, pendingDirectory: undefined, pendingCount: undefined };
    if (state.inputMode) return clampCursor(reloadState({ ...state, inputMode: null, query: "", searchSelected: 0, status: "ready" }));
    if (state.stack.length > 0) return popStack(state);
    return { ...state, status: "already at root" };
  }

  if (state.inputMode === "search") {
    if (key === "ArrowUp" || key === "k") return { ...state, searchSelected: Math.max(0, state.searchSelected - 1) };
    if (key === "ArrowDown" || key === "j") return { ...state, searchSelected: Math.min(searchResultsFor(state).length - 1, state.searchSelected + 1) };
    if (key === "Enter") {
      const results = searchResultsFor(state);
      const sel = results[state.searchSelected];
      if (sel) {
        return openSessionInOpencode({ ...state, inputMode: null, query: "", searchSelected: 0, scrollFocus: "right" }, sel.id);
      }
      return state;
    }
    if (key === "Backspace") return applyKey(state, `type:${state.query.slice(0, -1)}`);
    if (key.length === 1 && key >= " ") return applyKey(state, `type:${state.query}${key}`);
    return state;
  }

  if (state.inputMode === "directory" || state.inputMode === "filter") {
    if (key === "Backspace") return applyKey(state, `type:${state.query.slice(0, -1)}`);
    if (key.length === 1 && key >= " ") return applyKey(state, `type:${state.query}${key}`);
    return state;
  }

  if (state.pendingAction) {
    if (key === "y" || key === "Enter") return executePendingAction(state);
    if (key === "n") return { ...state, status: "cancelled", pendingAction: null, pendingDirectory: undefined, pendingCount: undefined };
    return state;
  }

  if (key === "Tab") {
    if (state.inputMode || state.pendingAction) return state;
    if (state.scrollFocus === "left") return { ...state, scrollFocus: "right" };
    const nextTab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length];
    return clampCursor(reloadState({ ...state, tab: nextTab, cursor: 0, listScroll: 0, scrollFocus: "left" }));
  }
  if (key === "S-Tab") {
    if (state.inputMode || state.pendingAction) return state;
    if (state.scrollFocus === "right") return { ...state, scrollFocus: "left" };
    const nextTab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length];
    return clampCursor(reloadState({ ...state, tab: nextTab, cursor: 0, listScroll: 0, scrollFocus: "left" }));
  }
  if (key === "B") {
    return clampCursor(reloadState({ ...state, directory: undefined, query: "", inputMode: null, stack: [], cursor: 0, listScroll: 0, scrollFocus: "left", status: "reset" }));
  }
  if (key === "o") {
    const allExpanded = state.folders.length > 0 && state.folders.every(f => state.expandedFolders.has(f.directory));
    const nextSet = new Set<string>();
    if (!allExpanded) state.folders.forEach(f => { nextSet.add(f.directory); });
    return clampCursor(reloadState({ ...state, expandedFolders: nextSet }));
  }
  if (key === "m") {
    return { ...state, messagesExpanded: !state.messagesExpanded };
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
    if (state.scrollFocus === "right" && state.tab === "archived" && state.archivedMessages.length > 0) {
      const max = Math.max(0, state.archivedMessages.length - 1);
      return { ...state, messageScroll: Math.min(max, state.messageScroll + 1) };
    }
    return clampCursor({ ...state, cursor: state.cursor + 1 });
  }
  if (key === "k" || key === "ArrowUp") {
    if (state.scrollFocus === "right" && state.tab === "archived" && state.archivedMessages.length > 0) {
      return { ...state, messageScroll: Math.max(0, state.messageScroll - 1) };
    }
    return clampCursor({ ...state, cursor: state.cursor - 1 });
  }
  if (key === "G") return clampCursor({ ...state, cursor: getVisibleRows(state).length - 1 });
  if (key === "gg") return clampCursor({ ...state, cursor: 0 });
  if (key === "Ctrl+D" || key === "PageDown") {
    if (state.scrollFocus === "right" && state.tab === "archived" && state.archivedMessages.length > 0) {
      return { ...state, messageScroll: Math.min(Math.max(0, state.archivedMessages.length - 1), state.messageScroll + 5) };
    }
    return clampCursor({ ...state, cursor: state.cursor + Math.floor(leftRowsCount(state) / 2) });
  }
  if (key === "Ctrl+U" || key === "PageUp") {
    if (state.scrollFocus === "right" && state.tab === "archived" && state.archivedMessages.length > 0) {
      return { ...state, messageScroll: Math.max(0, state.messageScroll - 5) };
    }
    return clampCursor({ ...state, cursor: state.cursor - Math.floor(leftRowsCount(state) / 2) });
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
      return openSessionInOpencode(state, session.id);
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
      const count = listActiveSessionsInDir(folder.directory).length + listArchivedSessionsInDir(folder.directory).length;
      if (count === 0) return { ...state, status: "no sessions in this folder" };
      return { ...state, status: confirmOverlayText({ ...state, pendingAction: "bulk_delete", pendingDirectory: folder.directory, pendingCount: count }), pendingAction: "bulk_delete", pendingDirectory: folder.directory, pendingCount: count };
    }
    return state;
  }

  if (ctx.isSession && session) {
    if (ctx.isArchived) {
      if (key === "a") return { ...state, status: "archive only applies to active sessions" };
      if (key === "i") return { ...state, status: `confirm import ${session.id}`, pendingAction: "import" };
      if (key === "d") return { ...state, status: `confirm delete ${session.id} (permanent)`, pendingAction: "delete" };
    } else {
      if (key === "r") return { ...state, status: "restore only applies to archived sessions" };
      if (key === "i") return { ...state, status: "import only applies to archived sessions" };
      if (key === "a") return { ...state, status: `confirm archive ${session.id}`, pendingAction: "archive" };
      if (key === "d") return { ...state, status: `confirm archive + delete ${session.id}`, pendingAction: "archive_and_delete" };
    }
  }

  return state;
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function fmtCost(value: number): string {
  return value > 0 ? `$${value.toFixed(2)}` : "$0.00";
}

function selectedDetail(state: UiState): SessionDetail | null {
  const selected = currentSession(state);
  if (!selected) return null;
  return getSessionDetail({ id: selected.id, cwd: cwd() });
}

function searchResultsFor(state: UiState): UiSession[] {
  const query = state.query.trim().toLowerCase();
  const base = state.allSessions;
  if (!query) return base.slice(0, 20);
  return base.filter(row =>
    [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].some(v => v.toLowerCase().includes(query))
  ).slice(0, 20);
}

function buildLeftContent(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const visible = getVisibleRows(state);
  const header = `Sessions (${state.tab}) ${state.cursor + 1} / ${Math.max(visible.length, 1)}`;
  chunks.push({ text: header + "\n", fg: tone("text"), bg: tone("surfaceAlt"), bold: true });

  const visibleSlice = visible.slice(state.listScroll, state.listScroll + leftRowsCount(state));
  for (let i = 0; i < visibleSlice.length; i++) {
    const item = visibleSlice[i];
    const absolute = state.listScroll + i;
    const isDir = item && !("id" in item);
    const isExpanded = isDir ? state.expandedFolders.has((item as DirectoryRow).directory) : false;
    const isSelected = absolute === state.cursor;
    const marker = isSelected ? "❯ " : "  ";
    if (isDir) {
      const dir = item as DirectoryRow;
      const prefix = isExpanded ? "▼" : "▶";
      const cwdMark = dir.directory.startsWith(cwd()) ? "◉ " : "○ ";
      const label = `${marker}${cwdMark}${prefix} ${dir.directory} (${dir.active} active, ${dir.archived} archived)`;
      const color = dir.directory.startsWith(cwd()) ? tone("cyan") : tone("success");
      chunks.push({ text: label + "\n", fg: color, bold: isSelected });
    } else {
      const session = item as UiSession;
      const archive = session.timeArchived == null ? "" : "[A] ";
      const label = `${marker}  ${archive}${session.title}`;
      const color = session.isCurrent ? tone("cyan") : tone("muted");
      chunks.push({ text: label + "\n", fg: color, bg: isSelected ? tone("listSelectedBg") : undefined });
    }
  }
  return new StyledText(chunks);
}

function buildRightTopContent(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const detail = selectedDetail(state);
  if (!detail) {
    chunks.push({ text: "No session selected\n", fg: tone("muted") });
    return new StyledText(chunks);
  }
  chunks.push({ text: `📁 ${detail.directory}\n`, fg: tone("detailValue") });
  chunks.push({ text: `🤖 ${detail.agent || "-"} · ${parseModel(detail.model)}\n`, fg: tone("detailValue") });
  chunks.push({ text: `💰 ${fmtCost(detail.cost)}\n`, fg: tone("detailCost") });
  chunks.push({ text: `📊 in ${detail.tokensInput} · out ${detail.tokensOutput} · reasoning ${detail.tokensReasoning}\n`, fg: tone("detailTokens") });
  chunks.push({ text: `🗂  cache r ${detail.tokensCacheRead} · w ${detail.tokensCacheWrite}\n`, fg: tone("detailTokens") });
  chunks.push({ text: `📅 created ${formatTime(detail.timeCreated)} · updated ${formatTime(detail.timeUpdated)}${detail.timeArchived ? ` · archived ${formatTime(detail.timeArchived)}` : ""}\n`, fg: tone("detailValue") });
  chunks.push({ text: `📈 ${detail.summaryFiles} files · +${detail.summaryAdditions} / -${detail.summaryDeletions}\n`, fg: tone("detailValue") });
  chunks.push({ text: `📎 ${detail.diffPath ? `${detail.diffPath} (${detail.diffBytes || 0}b)` : "-"}\n`, fg: tone("detailValue") });
  if (detail.toolCounts.length > 0) {
    chunks.push({ text: `🔧 ${detail.toolCounts.slice(0, 4).map(t => `${t.tool} ${t.count} ${t.status}`).join(" · ")}\n`, fg: tone("success") });
  }
  return new StyledText(chunks);
}

function buildRightBottomContent(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const selected = currentSession(state);
  if (!selected) {
    chunks.push({ text: "💬 Select a session to view messages\n", fg: tone("muted") });
    return new StyledText(chunks);
  }
  chunks.push({ text: `💬 ${state.messagesExpanded ? "Messages (full)" : "Messages (last 10)"} (m to toggle)\n`, fg: tone("accent"), bold: true });
  const rows = rightBottomRows(state) - 2;
  if (selected.timeArchived == null) {
    const recent = selected.id ? "" : "";
    void recent;
    chunks.push({ text: "(Live message previews for active sessions are loaded from SQLite.)\n", fg: tone("dim") });
  } else {
    const msgs = state.archivedMessages;
    if (msgs.length === 0) {
      chunks.push({ text: "(no archived messages found at default archive path)\n", fg: tone("muted") });
    } else {
      const start = Math.max(0, Math.min(state.messageScroll, Math.max(0, msgs.length - rows)));
      const visible = msgs.slice(start, start + rows);
      for (const m of visible) {
        const prefix = m.role === "user" ? "U" : "A";
        const line = `${formatTime(m.time)} ${prefix} ${clip(m.text, 60)}\n`;
        const color = m.role === "user" ? tone("cyan") : tone("text");
        chunks.push({ text: line, fg: color });
      }
      if (msgs.length > rows) {
        chunks.push({ text: `(${state.messageScroll + 1}–${Math.min(state.messageScroll + rows, msgs.length)} of ${msgs.length})\n`, fg: tone("dim") });
      }
    }
  }
  return new StyledText(chunks);
}

export function buildSearchOverlay(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const boxWidth = Math.max(60, Math.min(100, state.viewport.width - 4));
  const inner = boxWidth - 4;
  const results = searchResultsFor(state);
  const maxResults = Math.min(results.length, 10);

  chunks.push({ text: "┌" + "─".repeat(boxWidth - 2) + "┐\n", fg: tone("modalBorder") });
  chunks.push({ text: `│ ${clip("🔍 Search Sessions", inner).padEnd(inner)} │\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  const input = `> ${state.query}█`;
  chunks.push({ text: `│ ${clip(input, inner).padEnd(inner)} │\n`, fg: tone("text"), bg: tone("modalBg") });
  chunks.push({ text: "├" + "─".repeat(boxWidth - 2) + "┤\n", fg: tone("modalBorder"), bg: tone("modalBg") });
  if (results.length === 0) {
    chunks.push({ text: `│ ${clip("No matches", inner).padEnd(inner)} │\n`, fg: tone("muted"), bg: tone("modalBg") });
  } else {
    for (let i = 0; i < maxResults; i++) {
      const r = results[i];
      const isSelected = i === state.searchSelected;
      const left = clip(r.title, Math.max(20, inner - r.directory.length - 4));
      const row = `│ ${isSelected ? "❯" : " "} ${left.padEnd(Math.max(20, inner - r.directory.length - 4))}  ${clip(r.directory, r.directory.length).padEnd(r.directory.length)} │\n`;
      chunks.push({ text: row, fg: isSelected ? tone("accent") : tone("text"), bg: isSelected ? tone("listSelectedBg") : tone("modalBg") });
    }
    for (let i = maxResults; i < 10; i++) {
      chunks.push({ text: `│ ${" ".repeat(inner)} │\n`, fg: tone("modalFg"), bg: tone("modalBg") });
    }
  }
  chunks.push({ text: "├" + "─".repeat(boxWidth - 2) + "┤\n", fg: tone("modalBorder"), bg: tone("modalBg") });
  chunks.push({ text: `│ ${clip("↑↓ navigate · Enter open · Esc cancel", inner).padEnd(inner)} │\n`, fg: tone("dim"), bg: tone("modalBg") });
  chunks.push({ text: "└" + "─".repeat(boxWidth - 2) + "┘\n", fg: tone("modalBorder") });
  return new StyledText(chunks);
}

function buildConfirmOverlay(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  if (!state.pendingAction) return new StyledText(chunks);
  const boxWidth = Math.max(60, Math.min(100, state.viewport.width - 6));
  const inner = boxWidth - 4;
  chunks.push({ text: "┌" + "─".repeat(boxWidth - 2) + "┐\n", fg: tone("modalBorder") });
  const title = state.pendingAction.replaceAll("_", " ").toUpperCase();
  chunks.push({ text: `│ ${clip(title, inner).padEnd(inner)} │\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  chunks.push({ text: `│ ${clip(confirmOverlayText(state), inner).padEnd(inner)} │\n`, fg: tone("detailValue"), bg: tone("modalBg") });
  const session = currentSession(state);
  if (session) {
    chunks.push({ text: `│ ${clip(`${session.title} (${session.id})`, inner).padEnd(inner)} │\n`, fg: tone("muted"), bg: tone("modalBg") });
  }
  chunks.push({ text: `│ ${clip("[y/Enter] confirm · [n/Esc] cancel", inner).padEnd(inner)} │\n`, fg: tone("dim"), bg: tone("modalBg") });
  chunks.push({ text: "└" + "─".repeat(boxWidth - 2) + "┘\n", fg: tone("modalBorder") });
  return new StyledText(chunks);
}

export function contextHints(state: UiState): string {
  if (state.pendingAction) return "[y/Enter] confirm · [n/Esc] cancel";
  if (state.inputMode === "search") return "↑↓ navigate · Enter open · Esc cancel";
  const row = getVisibleRows(state)[state.cursor];
  if (!row) return "q quit";
  if (!("id" in row)) return "Enter expand · o toggle · a archive · r restore · d delete · / search · Tab focus · Esc back · q quit";
  const session = row as UiSession;
  if (session.timeArchived != null) {
    return "Enter open · i import · d delete · / search · Tab focus · Esc back · q quit";
  }
  return "Enter open · a archive · d delete · / search · Tab focus · Esc back · q quit";
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
    return "opencode CLI not found. Set OPENCODE_ALL_OPENCODE_BIN or install opencode.";
  }
  return error instanceof Error ? error.message : String(error);
}

function mapKey(key: any): string {
  if (key?.ctrl && key?.name === "c") return "q";
  if (key?.ctrl && key?.name === "d") return "Ctrl+D";
  if (key?.ctrl && key?.name === "u") return "Ctrl+U";
  if (key?.name === "down") return "j";
  if (key?.name === "up") return "k";
  if (key?.name === "pagedown") return "PageDown";
  if (key?.name === "pageup") return "PageUp";
  if (key?.name === "tab") return "Tab";
  if (key?.shift && key?.name === "tab") return "S-Tab";
  if (key?.name === "return") return "Enter";
  if (key?.name === "escape") return "Escape";
  if (key?.name === "backspace") return "Backspace";
  return key?.sequence || key?.name || "";
}

function opencodeBin(): string {
  return process.env.OPENCODE_ALL_OPENCODE_BIN || "opencode";
}

export async function startInteractiveTui(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30, useMouse: true });
  let state = createInitialState(listSessions({ tab: "active", cwd: cwd() }), { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
  state = reloadState(state);

  const leftPane = new TextRenderable(renderer, { id: "left-pane", width: "50%", wrapMode: "none", truncate: true, content: buildLeftContent(state) });
  const rightTop = new TextRenderable(renderer, { id: "right-top", width: "50%", wrapMode: "word", content: buildRightTopContent(state) });
  const rightBottom = new TextRenderable(renderer, { id: "right-bottom", width: "50%", wrapMode: "word", content: buildRightBottomContent(state) });
  const statusBar = new TextRenderable(renderer, { id: "status-bar", height: 1, wrapMode: "none", truncate: true, content: new StyledText([{ text: contextHints(state), fg: tone("statusFg"), bg: tone("statusBg") }]) });

  const rightColumn = Box({ flexDirection: "column", width: "50%", height: "100%" }, rightTop, rightBottom);
  const rootBox = Box({ flexDirection: "row", width: "100%", height: "100%" }, leftPane, rightColumn);
  const mainColumn = Box({ flexDirection: "column", width: "100%", height: "100%" }, Box({ flexDirection: "row", width: "100%", flexGrow: 1 }, leftPane, rightColumn), statusBar);
  renderer.root.add(mainColumn);

  const searchOverlay = new TextRenderable(renderer, { id: "search-overlay", position: "absolute", top: "20%", left: "10%", right: "10%", height: "60%", zIndex: 100, visible: false, content: buildSearchOverlay(state) });
  const confirmOverlay = new TextRenderable(renderer, { id: "confirm-overlay", position: "absolute", top: "35%", left: "15%", right: "15%", height: "30%", zIndex: 110, visible: false, content: buildConfirmOverlay(state) });
  renderer.root.add(searchOverlay);
  renderer.root.add(confirmOverlay);
  mainColumn.add(searchOverlay);
  mainColumn.add(confirmOverlay);

  const refreshPanes = () => {
    leftPane.content = buildLeftContent(state);
    rightTop.content = buildRightTopContent(state);
    rightBottom.content = buildRightBottomContent(state);
    statusBar.content = new StyledText([{ text: contextHints(state), fg: tone("statusFg"), bg: tone("statusBg") }]);
    searchOverlay.content = buildSearchOverlay(state);
    confirmOverlay.content = buildConfirmOverlay(state);
    searchOverlay.visible = state.inputMode === "search";
    confirmOverlay.visible = !!state.pendingAction;
  };

  process.stdout.on("resize", () => {
    state = { ...state, viewport: { height: process.stdout.rows || 24, width: process.stdout.columns || 100 } };
    refreshPanes();
    renderer.requestRender();
  });

  await new Promise<void>((resolve) => {
    renderer.keyInput.on("keypress", (key: any) => {
      const mapped = mapKey(key);
      if (mapped === "q") {
        quitRequestCode = 0;
        renderer.destroy();
        resolve();
        return;
      }
      const next = applyKey(state, mapped);
      if (next !== state) {
        state = next;
        refreshPanes();
      }
      if (continueRequest) {
        renderer.destroy();
        resolve();
        return;
      }
      renderer.requestRender();
    });
  });

  if (continueRequest) {
    const req = continueRequest;
    continueRequest = null;
    const child = spawn(opencodeBin(), ["--session", req.id, ...(req.fork ? ["--fork"] : [])], { stdio: "inherit" });
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      child.on("error", () => resolve());
    });
  }
}

function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all");
}

function audit(action: string, sessionId: string, status: string): void {
  const file = join(dataDir(), "audit.log");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), action, session_id: sessionId, status })}\n`, { flag: "a", mode: 0o600 });
}

function printFallbackList(): void {
  const rows = listSessions({ tab: "active", cwd: cwd() });
  for (const row of rows) console.log(`${row.id}\t${row.title}\t${row.directory}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--list")) {
    printFallbackList();
    return;
  }
  if (process.stdout.isTTY && !argv.includes("--no-tui")) {
    await startInteractiveTui();
    return;
  }
  const state = createInitialState(listSessions({ tab: "active", cwd: cwd() }), { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
  const left = buildLeftContent(state);
  const right = buildRightTopContent(state);
  const bottom = buildRightBottomContent(state);
  for (const chunk of [...left.chunks, ...right.chunks, ...bottom.chunks]) {
    if (chunk.text) process.stdout.write(String(chunk.text));
  }
}

if (import.meta.main) await main();
