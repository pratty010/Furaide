#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bg, bold, Box, createCliRenderer, fg, StyledText, TextChunk, TextRenderable } from "@opentui/core";
import { DirectoryRow, getSessionDetail, listDirectories, listSessions, SessionDetail, SessionRow, setArchived, Tab } from "./db.ts";

export type UiSession = SessionRow;
export type Viewport = { height: number; width: number };
type InputMode = null | "search" | "directory" | "filter";
type PendingAction = "delete" | "archive" | "restore" | "export_sanitized" | "export_raw" | "continue" | "continue_fork" | null;

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
  tab: Tab;
  inputMode: InputMode;
  query: string;
  directory?: string;
  sort: "updated" | "created" | "cost" | "title" | "recency";
  stack: Array<Pick<UiState, "cursor" | "listScroll" | "tab" | "query" | "directory" | "sort" | "expandedFolders">>;
  viewport: Viewport;
  status: string;
  pendingAction: PendingAction;
  searchSelected: number;
};

const tabs: Tab[] = ["active", "archived", "all"];
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
  return Math.max(1, state.viewport.height - 3);
}

function rightRowsCount(state: UiState): number {
  return Math.max(1, state.viewport.height - 3);
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

export function getVisibleRows(state: UiState): Array<DirectoryRow | UiSession> {
  const rows: Array<DirectoryRow | UiSession> = [];
  const visibleSessions = state.directory
    ? state.sessions.filter(s => s.directory === state.directory)
    : state.sessions;
  for (const folder of state.folders) {
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
  if (row && 'id' in row) return row as UiSession;
  return undefined;
}

function reloadState(state: UiState): UiState {
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
  return { ...state, folders, sessions, cursor, listScroll: Math.min(state.listScroll, cursor) };
}

export function createInitialState(sessions: UiSession[], viewport: Viewport): UiState {
  return {
    folders: sortFolders(listDirectories({ prefix: "" }), cwd()),
    allSessions: sessions,
    sessions,
    expandedFolders: new Set<string>(),
    messagesExpanded: false,
    cursor: 0,
    listScroll: 0,
    detailScroll: 0,
    tab: "active",
    inputMode: null,
    query: "",
    sort: "updated",
    stack: [],
    viewport,
    status: "ready",
    pendingAction: null,
    searchSelected: 0,
  };
}

function searchResultsFor(state: UiState): UiSession[] {
  const query = state.query.trim().toLowerCase();
  const base = state.allSessions;
  if (!query) return base.slice(0, 20);
  return base.filter(row =>
    [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].some(v =>
      v.toLowerCase().includes(query)
    )
  ).slice(0, 20);
}

function actionContext(state: UiState): { isFolder: boolean; isSession: boolean; isArchived: boolean; hasStack: boolean } {
  const row = getVisibleRows(state)[state.cursor];
  const isFolder = row && !("id" in row);
  const isSession = row && "id" in row;
  const isArchived = isSession && (row as UiSession).timeArchived != null;
  const hasStack = state.stack.length > 0;
  return { isFolder: !!isFolder, isSession: !!isSession, isArchived, hasStack };
}

function clampCursor(state: UiState): UiState {
  const total = getVisibleRows(state).length;
  const max = Math.max(0, total - 1);
  const cursor = Math.max(0, Math.min(state.cursor, max));
  const rows = leftRowsCount(state);
  let listScroll = state.listScroll;
  if (cursor < listScroll) listScroll = cursor;
  if (cursor >= listScroll + rows) listScroll = cursor - rows + 1;
  return { ...state, cursor, listScroll: Math.max(0, listScroll) };
}

function pushDrill(state: UiState, directory: string): UiState {
  const next: UiState = {
    ...state,
    stack: [...state.stack, { cursor: state.cursor, listScroll: state.listScroll, tab: state.tab, query: state.query, directory: state.directory, sort: state.sort, expandedFolders: new Set(state.expandedFolders) }],
    directory,
    query: "",
    inputMode: null,
    cursor: 0,
    listScroll: 0,
    status: `drilled into ${directory}`,
  };
  return clampCursor(reloadState(next));
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

function executePendingAction(state: UiState): UiState {
  const selected = currentSession(state);
  if (!selected || !state.pendingAction) return { ...state, pendingAction: null, status: "cancelled" };

  if (state.pendingAction === "archive") archiveSession(selected.id);
  if (state.pendingAction === "restore") restoreSession(selected.id);
  if (state.pendingAction === "delete") deleteSession(selected.id);
  if (state.pendingAction === "export_sanitized") exportSession(selected.id, false);
  if (state.pendingAction === "export_raw") exportSession(selected.id, true);
  if (state.pendingAction === "continue") {
    continueRequest = { id: selected.id, fork: false };
    return { ...state, pendingAction: null, status: `continuing ${selected.id}` };
  }
  if (state.pendingAction === "continue_fork") {
    continueRequest = { id: selected.id, fork: true };
    return { ...state, pendingAction: null, status: `continuing fork ${selected.id}` };
  }

  return clampCursor(reloadState({ ...state, pendingAction: null, status: `executed ${state.pendingAction}` }));
}

export function applyKey(state: UiState, key: string): UiState {
  if (key.startsWith("drill:")) return pushDrill(state, key.slice("drill:".length));
  if (key === "/") return { ...state, inputMode: "search", query: "", searchSelected: 0, status: "search" };
  if (key === "\\") return { ...state, inputMode: "directory", query: "", searchSelected: 0, status: "directory" };
  if (key === "f") return { ...state, inputMode: "filter", searchSelected: 0, status: "filter" };
  if (key.startsWith("type:")) {
    const query = key.slice("type:".length);
    return clampCursor(reloadState({ ...state, query, cursor: 0, listScroll: 0, status: `${state.inputMode || "input"}:${query}` }));
  }
  if (key === "Escape" || key === "Esc") return clampCursor(reloadState({ ...state, inputMode: null, query: "", searchSelected: 0, status: "ready", pendingAction: null }));
  
  if (state.pendingAction && key === "y") return executePendingAction(state);
  if (state.pendingAction && key === "n") return { ...state, status: "cancelled", pendingAction: null };

  if (key === "j" || key === "ArrowDown") return clampCursor({ ...state, cursor: state.cursor + 1 });
  if (key === "k" || key === "ArrowUp") return clampCursor({ ...state, cursor: state.cursor - 1 });
  if (key === "G") return clampCursor({ ...state, cursor: getVisibleRows(state).length - 1 });
  if (key === "gg") return clampCursor({ ...state, cursor: 0 });
  if (key === "Ctrl+D" || key === "PageDown") return clampCursor({ ...state, cursor: state.cursor + Math.floor(leftRowsCount(state) / 2) });
  if (key === "Ctrl+U" || key === "PageUp") return clampCursor({ ...state, cursor: state.cursor - Math.floor(leftRowsCount(state) / 2) });
  if (key === "Tab") return clampCursor(reloadState({ ...state, tab: tabs[(tabs.indexOf(state.tab) + 1) % tabs.length], cursor: 0, listScroll: 0 }));
  if (!state.inputMode && key === "b") return popStack(state);
  if (key === "B") return clampCursor(reloadState({ ...state, directory: undefined, query: "", inputMode: null, stack: [], cursor: 0, listScroll: 0, status: "reset" }));
  if (!state.inputMode && key === "m") return { ...state, messagesExpanded: !state.messagesExpanded };
  if (!state.inputMode && key === "o") {
    const allExpanded = state.folders.every(f => state.expandedFolders.has(f.directory));
    const nextSet = new Set<string>();
    if (!allExpanded) state.folders.forEach(f => { nextSet.add(f.directory); });
    return clampCursor(reloadState({ ...state, expandedFolders: nextSet }));
  }

  // Context-sensitive actions
  const ctx = actionContext(state);
  const session = currentSession(state);

  if (key === "Enter") {
    if (state.pendingAction) return executePendingAction(state);
    const row = getVisibleRows(state)[state.cursor];
    if (row && !("id" in row)) {
      const dir = (row as DirectoryRow).directory;
      const nextExpanded = new Set(state.expandedFolders);
      if (nextExpanded.has(dir)) nextExpanded.delete(dir);
      else nextExpanded.add(dir);
      return clampCursor(reloadState({ ...state, expandedFolders: nextExpanded }));
    }
    return session
      ? { ...state, status: `confirm continue ${session.id}`, pendingAction: "continue" }
      : state;
  }

  // Navigation and universal keys are always allowed
  if (["j", "k", "ArrowDown", "ArrowUp", "G", "gg", "Ctrl+D", "PageDown", "Ctrl+U", "PageUp", "Tab", "b", "B", "m", "o"].includes(key)) {
    return state;
  }

  if (ctx.isFolder) {
    // Folder rows: only navigation, Enter, o, /, \, Tab, b, B are valid (already handled above)
    // Invalid actions on folder: a, r, d, e, E, c, C, m
    if (["a", "r", "d", "e", "E", "c", "C"].includes(key)) {
      return { ...state, status: "actions only apply to sessions" };
    }
    return state;
  }

  if (ctx.isSession) {
    if (ctx.isArchived) {
      // Archived session: valid: Enter/c (continue), C (fork), r (restore), d (delete), e, E, m, tabs, nav
      // Invalid: a (archive)
      if (key === "a") return { ...state, status: "archive only applies to active sessions" };
      if (key === "r") return session ? { ...state, status: `confirm restore ${session.id}`, pendingAction: "restore" } : state;
    } else {
      // Active session: valid: Enter/c (continue), C (fork), a (archive), d (delete), e, E, m, tabs, nav
      // Invalid: r (restore)
      if (key === "r") return { ...state, status: "restore only applies to archived sessions" };
      if (key === "a") return session ? { ...state, status: `confirm archive ${session.id}`, pendingAction: "archive" } : state;
    }

    // Common actions for both active and archived
    if (key === "d") return session ? { ...state, status: `confirm delete ${session.id}`, pendingAction: "delete" } : state;
    if (key === "e") return session ? { ...state, status: `confirm export sanitized ${session.id}`, pendingAction: "export_sanitized" } : state;
    if (key === "E") return session ? { ...state, status: `confirm export raw ${session.id}`, pendingAction: "export_raw" } : state;
    if (key === "c") return session ? { ...state, status: `confirm continue ${session.id}`, pendingAction: "continue" } : state;
    if (key === "C") return session ? { ...state, status: `confirm continue fork ${session.id}`, pendingAction: "continue_fork" } : state;

    return state;
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

function treeRowLabel(row: DirectoryRow | UiSession, isSelected: boolean, isExpanded?: boolean): string {
  const isDir = !('id' in row);
  if (isDir) {
    const dir = row as DirectoryRow;
    const prefix = isExpanded ? "▼" : "▶";
    const cwdMark = dir.directory.startsWith(cwd()) ? "◉ " : "○ ";
    return `${isSelected ? "❯ " : "  "}theme:folder-${dir.directory.startsWith(cwd()) ? "cwd" : "other"} ${cwdMark}${prefix} ${dir.directory} (${dir.active} active)`;
  } else {
    const session = row as UiSession;
    const archive = session.timeArchived == null ? "" : "[A] ";
    return `${isSelected ? "❯ " : "  "}theme:session-${session.isCurrent ? "cwd" : "other"}   ${archive}${session.title}`;
  }
}

function overlayLines(state: UiState, width: number, height: number): Array<{ row: number; text: string }> {
  if (!state.pendingAction) return [];
  const selected = currentSession(state);
  const action = state.pendingAction.replaceAll("_", " ").toUpperCase();
  const target = selected ? clip(`${selected.title} (${selected.id})`, width - 8) : "No session selected";
  const body = state.pendingAction === "delete"
    ? "This permanently removes the session."
    : state.pendingAction === "archive"
      ? "This moves the session into Archived."
      : state.pendingAction === "restore"
        ? "This restores the session to Active."
        : state.pendingAction === "continue" || state.pendingAction === "continue_fork"
          ? "This opens the session in OpenCode."
          : "This action will run now.";
  const boxWidth = Math.min(64, Math.max(38, width - 8));
  const start = Math.max(1, Math.min(Math.floor((height - 7) / 2), Math.max(1, height - 6)));
  const left = Math.max(0, Math.floor((width - boxWidth) / 2));
  const top = `${" ".repeat(left)}┌${"─".repeat(boxWidth - 2)}┐`;
  const title = `${" ".repeat(left)}│ ${clip(action, boxWidth - 4).padEnd(boxWidth - 4)} │`;
  const targetLine = `${" ".repeat(left)}│ ${clip(target, boxWidth - 4).padEnd(boxWidth - 4)} │`;
  const bodyLine = `${" ".repeat(left)}│ ${clip(body, boxWidth - 4).padEnd(boxWidth - 4)} │`;
  const buttons = `${" ".repeat(left)}│ ${clip("[y] confirm   [n] cancel   [Esc] dismiss", boxWidth - 4).padEnd(boxWidth - 4)} │`;
  const bottom = `${" ".repeat(left)}└${"─".repeat(boxWidth - 2)}┘`;
  return [
    { row: start, text: top },
    { row: start + 1, text: title },
    { row: start + 2, text: targetLine },
    { row: start + 3, text: bodyLine },
    { row: start + 4, text: buttons },
    { row: start + 5, text: bottom },
  ];
}

export function renderRows(state: UiState): string[] {
  const visible = getVisibleRows(state);
  const rows = leftRowsCount(state);
  const leftWidth = Math.min(58, Math.max(28, Math.floor(state.viewport.width * 0.48)));
  const rightWidth = Math.max(20, state.viewport.width - leftWidth - 3);
  const visibleSlice = visible.slice(state.listScroll, state.listScroll + rows);
  const detail = selectedDetail(state);
  const header = `theme:list Folders & Sessions ${state.cursor + 1} / ${Math.max(visible.length, 1)} [${state.tab}]`;

  const curSession = currentSession(state);
  const fallbackDetailLines = curSession ? [
    `theme:detail ${curSession.title}`,
    `ID: ${curSession.id}`,
    `Directory: ${curSession.directory}`,
    `Agent: ${curSession.agent || "-"}`,
    `Model: ${parseModel(curSession.model)}`,
    `Recent:`,
  ] : [];

  let detailLines: string[] = [];
  if (detail) {
    detailLines = [
      `theme:detail Detail: ${detail.title}`,
      `ID        ${detail.id}`,
      `Directory ${detail.directory}`,
      `Agent     ${detail.agent || "-"}`,
      `Model     ${parseModel(detail.model)}`,
      `Cost      ${fmtCost(detail.cost)}`,
      `Tokens    in ${detail.tokensInput} · out ${detail.tokensOutput} · reasoning ${detail.tokensReasoning}`,
      `Cache     read ${detail.tokensCacheRead} · write ${detail.tokensCacheWrite}`,
      `Messages  ${detail.messages} (${detail.partCounts.tool || 0} tool · ${detail.partCounts.step || 0} step · ${detail.partCounts.text || 0} text · ${detail.partCounts.reasoning || 0} think)`,
      `Changes   ${detail.summaryFiles} files · +${detail.summaryAdditions} / -${detail.summaryDeletions}`,
      `Diff      ${detail.diffPath ? `${detail.diffPath} (${detail.diffBytes || 0} bytes)` : "-"}`,
      `Recent Messages (m to toggle)`,
      ...detail.recentText.slice(0, state.messagesExpanded ? 10 : 4).map(item => `[${item.role[0].toUpperCase()}] ${item.text}`),
      `Top Tools`,
      ...detail.toolCounts.slice(0, 4).map(item => `${item.tool}: ${item.count} ok, ${item.status === "error" ? item.count : 0} err`),
    ];
  } else {
    detailLines = curSession ? fallbackDetailLines : ["theme:detail No session selected"];
  }

  const lines = [pad(clip(header, leftWidth), leftWidth) + " │ " + pad(clip(detailLines[0] || "", rightWidth), rightWidth)];

  for (let i = 0; i < rows; i++) {
    const item = visibleSlice[i];
    const absolute = state.listScroll + i;
    const isExpanded = item && !('id' in item) ? state.expandedFolders.has((item as DirectoryRow).directory) : false;
    const left = item ? treeRowLabel(item, absolute === state.cursor, isExpanded) : "";
    const right = detailLines[i + 1] || "";
    lines.push(pad(clip(left, leftWidth), leftWidth) + " │ " + pad(clip(right, rightWidth), rightWidth));
  }

  lines.push(pad(clip(`q quit · / search · o toggle all · m msgs · Tab tabs · Enter open/toggle · b back · e export · a archive · d delete · c continue`, state.viewport.width), state.viewport.width));

  const overlay = overlayLines(state, state.viewport.width, lines.length);
  for (const item of overlay) {
    if (item.row >= 0 && item.row < lines.length) lines[item.row] = pad(clip(item.text, state.viewport.width), state.viewport.width);
  }

  return lines;
}

function buildLeftContent(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const visible = getVisibleRows(state);
  const header = `Folders & Sessions ${state.cursor + 1} / ${Math.max(visible.length, 1)} [${state.tab}]`;
  chunks.push({ text: header + "\n", fg: tone("text"), bg: tone("surfaceAlt"), bold: true });

  const visibleSlice = visible.slice(state.listScroll, state.listScroll + leftRowsCount(state));
  for (let i = 0; i < visibleSlice.length; i++) {
    const item = visibleSlice[i];
    const absolute = state.listScroll + i;
    const isDir = item && !('id' in item);
    const isExpanded = isDir ? state.expandedFolders.has((item as DirectoryRow).directory) : false;
    const isSelected = absolute === state.cursor;

    if (isDir) {
      const dir = item as DirectoryRow;
      const prefix = isExpanded ? "▼" : "▶";
      const cwdMark = dir.directory.startsWith(cwd()) ? "◉ " : "○ ";
      const label = `${isSelected ? "❯ " : "  "}${cwdMark}${prefix} ${dir.directory} (${dir.active} active)`;
      const color = dir.directory.startsWith(cwd()) ? tone("cyan") : tone("success");
      chunks.push({ text: label + "\n", fg: color, bold: isSelected });
    } else {
      const session = item as UiSession;
      const archive = session.timeArchived == null ? "" : "[A] ";
      const label = `${isSelected ? "❯ " : "  "}  ${archive}${session.title}`;
      const color = session.isCurrent ? tone("cyan") : tone("muted");
      chunks.push({ text: label + "\n", fg: color, bg: isSelected ? tone("listSelectedBg") : undefined });
    }
  }

  return new StyledText(chunks);
}

function buildRightContent(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  const selected = currentSession(state);
  const detail = selected ? getSessionDetail({ id: selected.id, cwd: cwd() }) : null;

  if (!detail) {
    chunks.push({ text: "No session selected\n", fg: tone("muted") });
    return new StyledText(chunks);
  }

  // Header
  chunks.push({ text: `Detail: ${detail.title}\n`, fg: tone("text"), bold: true });

  // Metadata with Friday theme colors
  const labelColor = tone("detailLabel");
  const valueColor = tone("detailValue");

  chunks.push({ text: "ID        ", fg: labelColor });
  chunks.push({ text: detail.id + "\n", fg: valueColor });

  chunks.push({ text: "Directory ", fg: labelColor });
  chunks.push({ text: detail.directory + "\n", fg: valueColor });

  chunks.push({ text: "Agent     ", fg: labelColor });
  chunks.push({ text: (detail.agent || "-") + "\n", fg: valueColor });

  chunks.push({ text: "Model     ", fg: labelColor });
  chunks.push({ text: parseModel(detail.model) + "\n", fg: valueColor });

  chunks.push({ text: "Cost      ", fg: labelColor });
  chunks.push({ text: fmtCost(detail.cost) + "\n", fg: tone("detailCost") });

  chunks.push({ text: "Tokens    ", fg: labelColor });
  chunks.push({ text: `in ${detail.tokensInput} · out ${detail.tokensOutput} · reasoning ${detail.tokensReasoning}\n`, fg: tone("detailTokens") });

  chunks.push({ text: "Cache     ", fg: labelColor });
  chunks.push({ text: `read ${detail.tokensCacheRead} · write ${detail.tokensCacheWrite}\n`, fg: tone("detailTokens") });

  chunks.push({ text: "Messages  ", fg: labelColor });
  chunks.push({ text: `${detail.messages} (${detail.partCounts.tool || 0} tool · ${detail.partCounts.step || 0} step · ${detail.partCounts.text || 0} text · ${detail.partCounts.reasoning || 0} think)\n`, fg: valueColor });

  chunks.push({ text: "Changes   ", fg: labelColor });
  chunks.push({ text: `${detail.summaryFiles} files · +${detail.summaryAdditions} / -${detail.summaryDeletions}\n`, fg: valueColor });

  chunks.push({ text: "Diff      ", fg: labelColor });
  chunks.push({ text: (detail.diffPath ? `${detail.diffPath} (${detail.diffBytes || 0} bytes)` : "-") + "\n", fg: valueColor });

  // Recent messages
  chunks.push({ text: "\nRecent Messages (m to toggle)\n", fg: labelColor, bold: true });
  const recentLimit = state.messagesExpanded ? 10 : 4;
  for (const item of detail.recentText.slice(0, recentLimit)) {
    const roleColor = item.role === "user" ? tone("cyan") : tone("text");
    chunks.push({ text: `[${item.role[0].toUpperCase()}] `, fg: roleColor });
    chunks.push({ text: item.text + "\n", fg: tone("muted") });
  }

  // Top tools
  chunks.push({ text: "\nTop Tools\n", fg: labelColor, bold: true });
  for (const item of detail.toolCounts.slice(0, 4)) {
    chunks.push({ text: `${item.tool}: `, fg: valueColor });
    chunks.push({ text: `${item.count} ok`, fg: tone("success") });
    if (item.status === "error") {
      chunks.push({ text: `, ${item.count} err`, fg: tone("error") });
    }
    chunks.push({ text: "\n" });
  }

  return new StyledText(chunks);
}

function buildSearchOverlay(state: UiState): StyledText {
  const width = Math.floor(state.viewport.width * 0.7);
  const boxWidth = Math.max(40, Math.min(width, state.viewport.width - 4));
  const innerWidth = boxWidth - 4;
  const results = searchResultsFor(state);
  const maxResults = Math.min(results.length, 10);

  const chunks: TextChunk[] = [];

  // Top border
  chunks.push({ text: "┌" + "─".repeat(boxWidth - 2) + "┐\n", fg: tone("modalBorder") });

  // Title line
  const title = "🔍 Search Sessions";
  const closeHint = "Esc";
  const titleLine = `│ ${title}${" ".repeat(Math.max(0, innerWidth - title.length - closeHint.length - 1))}${closeHint} │`;
  chunks.push({ text: titleLine + "\n", fg: tone("modalFg"), bg: tone("modalBg") });

  // Input line
  const queryDisplay = state.query + "█";
  const inputLine = `│ > ${clip(queryDisplay, innerWidth - 3)}${" ".repeat(Math.max(0, innerWidth - 3 - queryDisplay.length))} │`;
  chunks.push({ text: inputLine + "\n", fg: tone("text"), bg: tone("modalBg") });

  // Separator
  chunks.push({ text: "├" + "─".repeat(boxWidth - 2) + "┤\n", fg: tone("modalBorder"), bg: tone("modalBg") });

  // Results
  if (results.length === 0) {
    const noResults = "No results";
    chunks.push({ text: `│ ${noResults}${" ".repeat(innerWidth - noResults.length)} │\n`, fg: tone("muted"), bg: tone("modalBg") });
  } else {
    for (let i = 0; i < maxResults; i++) {
      const session = results[i];
      const isSelected = i === state.searchSelected;
      const marker = isSelected ? "❯ " : "  ";
      const titleText = clip(session.title, innerWidth - 2);
      const line = `│ ${marker}${titleText}${" ".repeat(Math.max(0, innerWidth - 2 - titleText.length))} │`;
      chunks.push({ text: line + "\n", fg: tone("text"), bg: isSelected ? tone("listSelectedBg") : tone("modalBg") });
    }
    // Fill remaining space
    for (let i = maxResults; i < 10; i++) {
      chunks.push({ text: `│ ${" ".repeat(innerWidth)} │\n`, fg: tone("modalFg"), bg: tone("modalBg") });
    }
  }

  // Separator
  chunks.push({ text: "├" + "─".repeat(boxWidth - 2) + "┤\n", fg: tone("modalBorder"), bg: tone("modalBg") });

  // Footer
  const footer = "↑↓ navigate · Enter select · Esc cancel";
  const footerLine = `│ ${clip(footer, innerWidth)}${" ".repeat(Math.max(0, innerWidth - footer.length))} │`;
  chunks.push({ text: footerLine + "\n", fg: tone("dim"), bg: tone("modalBg") });

  // Bottom border
  chunks.push({ text: "└" + "─".repeat(boxWidth - 2) + "┘\n", fg: tone("modalBorder"), bg: tone("modalBg") });

  return new StyledText(chunks);
}

function buildConfirmOverlay(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  if (!state.pendingAction) return new StyledText(chunks);
  const width = Math.floor(state.viewport.width * 0.7);
  const boxWidth = Math.max(44, Math.min(width, state.viewport.width - 6));
  const innerWidth = boxWidth - 4;
  const session = currentSession(state);
  const action = state.pendingAction.replaceAll("_", " ").toUpperCase();
  const target = session ? clip(`${session.title} (${session.id})`, innerWidth) : "No session selected";
  const body = state.pendingAction === "delete"
    ? "This permanently removes the session."
    : state.pendingAction === "archive"
      ? "This moves the session into Archived."
      : state.pendingAction === "restore"
        ? "This restores the session to Active."
        : state.pendingAction === "continue" || state.pendingAction === "continue_fork"
          ? "This opens the session in OpenCode."
          : "This action will run now.";

  chunks.push({ text: "┌" + "─".repeat(boxWidth - 2) + "┐\n", fg: tone("modalBorder") });
  const titleLine = `│ ${clip(action, innerWidth).padEnd(innerWidth)} │`;
  chunks.push({ text: titleLine + "\n", fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  const targetLine = `│ ${clip(target, innerWidth).padEnd(innerWidth)} │`;
  chunks.push({ text: targetLine + "\n", fg: tone("detailValue"), bg: tone("modalBg") });
  const bodyLine = `│ ${clip(body, innerWidth).padEnd(innerWidth)} │`;
  chunks.push({ text: bodyLine + "\n", fg: tone("warning"), bg: tone("modalBg") });
  const buttonLine = `│ ${clip("[y] confirm   [n] cancel   [Esc] dismiss", innerWidth).padEnd(innerWidth)} │`;
  chunks.push({ text: buttonLine + "\n", fg: tone("dim"), bg: tone("modalBg") });
  chunks.push({ text: "└" + "─".repeat(boxWidth - 2) + "┘\n", fg: tone("modalBorder") });
  return new StyledText(chunks);
}

function contextHints(state: UiState): string {
  if (state.pendingAction) return "[y] confirm · [n] cancel · [Esc] dismiss";
  if (state.inputMode === "search") return "↑↓ navigate · Enter select · Esc cancel";
  const row = getVisibleRows(state)[state.cursor];
  if (!row) return "q quit";
  if (!("id" in row)) return "Enter expand/collapse · o toggle all · / search · \\ folders · Tab tabs · b back · q quit";
  const session = row as UiSession;
  if (session.timeArchived != null) {
    return "Enter continue · r restore · d delete · e export · E raw · c continue · C fork · m msgs · b back · q quit";
  }
  return "Enter continue · a archive · d delete · e export · E raw · c continue · C fork · m msgs · b back · q quit";
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
  if (key?.name === "return") return "Enter";
  if (key?.name === "escape") return "Escape";
  if (key?.name === "backspace") return "Backspace";
  return key?.sequence || key?.name || "";
}

function appendTyped(state: UiState, value: string): UiState | null {
  if (!state.inputMode) return null;
  if (value === "Backspace") {
    return applyKey(state, `type:${state.query.slice(0, -1)}`);
  }
  if (value.length === 1 && value >= " ") {
    return applyKey(state, `type:${state.query}${value}`);
  }
  return null;
}

export async function startInteractiveTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    useMouse: true,
    onDestroy: () => {
      if (continueRequest && quitRequestCode === null) {
        const req = continueRequest;
        continueRequest = null;
        const child = spawn(opencodeBin(), ["--session", req.id, ...(req.fork ? ["--fork"] : [])], { stdio: "inherit" });
        child.on("exit", (code) => process.exit(code ?? 0));
        child.on("error", () => process.exit(1));
        return;
      }
      if (quitRequestCode !== null) {
        const code = quitRequestCode;
        quitRequestCode = null;
        process.exit(code);
      }
    },
  });
  let state = createInitialState(listSessions({ tab: "active", cwd: cwd() }), { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });

  // Create left and right panes with Box layout
  const leftPane = new TextRenderable(renderer, {
    id: "left-pane",
    width: "50%",
    wrapMode: "none",
    truncate: true,
    content: buildLeftContent(state),
  });

  const rightPane = new TextRenderable(renderer, {
    id: "right-pane",
    width: "50%",
    wrapMode: "word",
    content: buildRightContent(state),
  });

  const statusBar = new TextRenderable(renderer, {
    id: "status-bar",
    height: 1,
    wrapMode: "none",
    truncate: true,
    content: new StyledText([{ text: contextHints(state), fg: tone("statusFg"), bg: tone("statusBg") }]),
  });

  const contentRow = Box({ flexDirection: "row", width: "100%", flexGrow: 1 }, leftPane, rightPane);
  const rootBox = Box({ flexDirection: "column", width: "100%", height: "100%" }, contentRow, statusBar);
  renderer.root.add(rootBox);

  // Create search overlay
  const searchOverlay = new TextRenderable(renderer, {
    id: "search-overlay",
    position: "absolute",
    top: "20%",
    left: "10%",
    right: "10%",
    height: "60%",
    zIndex: 100,
    visible: false,
    content: buildSearchOverlay(state),
  });
  renderer.root.add(searchOverlay);

  const confirmOverlay = new TextRenderable(renderer, {
    id: "confirm-overlay",
    position: "absolute",
    top: "35%",
    left: "15%",
    right: "15%",
    height: "30%",
    zIndex: 110,
    visible: false,
    content: buildConfirmOverlay(state),
  });
  renderer.root.add(confirmOverlay);

  let pendingG = false;

  process.stdout.on("resize", () => {
    state = { ...state, viewport: { height: process.stdout.rows || 24, width: process.stdout.columns || 100 } };
    leftPane.content = buildLeftContent(state);
    rightPane.content = buildRightContent(state);
    statusBar.content = new StyledText([{ text: contextHints(state), fg: tone("statusFg"), bg: tone("statusBg") }]);
    if (searchOverlay.visible) searchOverlay.content = buildSearchOverlay(state);
    if (confirmOverlay.visible) confirmOverlay.content = buildConfirmOverlay(state);
    renderer.requestRender();
  });

  renderer.keyInput.on("keypress", (key: any) => {
    const mapped = mapKey(key);

    // Global quit
    if (mapped === "q") {
      quitRequestCode = 0;
      renderer.destroy();
      return;
    }

    const hasPendingAction = !!state.pendingAction;
    const isSearchMode = state.inputMode === "search";
    const isDirectoryMode = state.inputMode === "directory";
    const isFilterMode = state.inputMode === "filter";
    const hasOverlay = hasPendingAction || isSearchMode || isDirectoryMode || isFilterMode;

    // Handle 'gg' double-tap
    if (mapped === "g") {
      if (pendingG) {
        state = applyKey(state, "gg");
        pendingG = false;
      } else {
        pendingG = true;
        return;
      }
    } else {
      pendingG = false;
    }

    // Overlay-first routing
    if (hasPendingAction) {
      // Only y, n, Escape are handled
      if (mapped === "y" || mapped === "n" || mapped === "Escape" || mapped === "Esc") {
        state = applyKey(state, mapped);
      }
      // All other keys ignored
    } else if (isSearchMode) {
      // Search mode: handle navigation, selection, typing
      if (mapped === "ArrowUp" || mapped === "k") {
        const results = searchResultsFor(state);
        state = { ...state, searchSelected: Math.max(0, state.searchSelected - 1) };
      } else if (mapped === "ArrowDown" || mapped === "j") {
        const results = searchResultsFor(state);
        state = { ...state, searchSelected: Math.min(results.length - 1, state.searchSelected + 1) };
      } else if (mapped === "Enter") {
        const results = searchResultsFor(state);
        const selected = results[state.searchSelected];
        if (selected) {
          // Ensure folder is expanded
          const nextExpanded = new Set(state.expandedFolders);
          nextExpanded.add(selected.directory);
          const refreshed = reloadState({ ...state, expandedFolders: nextExpanded });
          // Find the row index in visible rows
          const visible = getVisibleRows(refreshed);
          const rowIndex = visible.findIndex(r => "id" in r && r.id === selected.id);
          if (rowIndex >= 0) {
            state = {
              ...refreshed,
              expandedFolders: nextExpanded,
              cursor: rowIndex,
              listScroll: Math.max(0, rowIndex - Math.floor(leftRowsCount(refreshed) / 2)),
              inputMode: null,
              query: "",
              searchSelected: 0,
              status: `selected ${selected.id}`
            };
          }
        }
      } else if (mapped === "Escape" || mapped === "Esc") {
        state = applyKey(state, "Escape");
      } else {
        // Handle typing and backspace
        const typed = appendTyped(state, mapped);
        if (typed !== null) state = { ...typed, searchSelected: 0 };
      }
    } else if (isDirectoryMode || isFilterMode) {
      // Directory/Filter mode: only typing, backspace, escape
      if (mapped === "Escape" || mapped === "Esc") {
        state = applyKey(state, "Escape");
      } else {
        const typed = appendTyped(state, mapped);
        if (typed !== null) state = typed;
      }
    } else {
      // No overlay active: normal navigation and actions
      const typed = appendTyped(state, mapped);
      state = typed !== null ? typed : applyKey(state, mapped);
    }

    // Update panes
    leftPane.content = buildLeftContent(state);
    rightPane.content = buildRightContent(state);
    statusBar.content = new StyledText([{ text: contextHints(state), fg: tone("statusFg"), bg: tone("statusBg") }]);

    // Toggle search overlay visibility
    searchOverlay.visible = state.inputMode === "search";
    if (searchOverlay.visible) {
      searchOverlay.content = buildSearchOverlay(state);
    }

    confirmOverlay.visible = !!state.pendingAction;
    if (confirmOverlay.visible) {
      confirmOverlay.content = buildConfirmOverlay(state);
    }

    if (continueRequest) {
      renderer.destroy();
      return;
    }

    renderer.requestRender();
  });
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

function opencodeBin(): string {
  return process.env.OPENCODE_ALL_OPENCODE_BIN || "opencode";
}

export function exportSession(id: string, raw = false): number {
  const args = ["export", id];
  if (!raw) args.push("--sanitize");
  const result = spawnSync(opencodeBin(), args, { stdio: "inherit" });
  audit(raw ? "export_raw" : "export_sanitized", id, String(result.status ?? 1));
  return result.status ?? 1;
}

export function deleteSession(id: string): number {
  const result = spawnSync(opencodeBin(), ["session", "delete", id], { stdio: "inherit" });
  audit("delete", id, String(result.status ?? 1));
  return result.status ?? 1;
}

export function archiveSession(id: string): void {
  setArchived({ id, archivedAt: Date.now() });
  audit("archive", id, "ok");
}

export function restoreSession(id: string): void {
  setArchived({ id, archivedAt: null });
  audit("restore", id, "ok");
}

export function continueSession(id: string, fork = false): void {
  const args = ["--session", id];
  if (fork) args.push("--fork");
  const child = spawn(opencodeBin(), args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", () => process.exit(1));
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
  for (const line of renderRows(state)) console.log(line.replace(/theme:(list|detail)\s/g, ""));
}

if (import.meta.main) await main();
