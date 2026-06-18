#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bg, bold, createCliRenderer, fg, StyledText, TextChunk, TextRenderable } from "@opentui/core";
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
};

const tabs: Tab[] = ["active", "archived", "all"];
const theme = JSON.parse(readFileSync(new URL("../themes/friday.json", import.meta.url), "utf8")) as ThemeDoc;

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
  for (const folder of state.folders) {
    rows.push(folder);
    if (state.expandedFolders.has(folder.directory)) {
      const folderSessions = state.sessions.filter(s => s.directory === folder.directory);
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
  };
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
  if (!prev) return state;
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
  if (state.pendingAction === "continue") continueSession(selected.id, false);
  if (state.pendingAction === "continue_fork") continueSession(selected.id, true);

  return clampCursor(reloadState({ ...state, pendingAction: null, status: `executed ${state.pendingAction}` }));
}

export function applyKey(state: UiState, key: string): UiState {
  if (key.startsWith("drill:")) return pushDrill(state, key.slice("drill:".length));
  if (key === "/") return { ...state, inputMode: "search", query: "", status: "search" };
  if (key === "\\") return { ...state, inputMode: "directory", query: "", status: "directory" };
  if (key === "f") return { ...state, inputMode: "filter", status: "filter" };
  if (key.startsWith("type:")) {
    const query = key.slice("type:".length);
    return clampCursor(reloadState({ ...state, query, cursor: 0, listScroll: 0, status: `${state.inputMode || "input"}:${query}` }));
  }
  if (key === "Escape" || key === "Esc") return clampCursor(reloadState({ ...state, inputMode: null, query: "", status: "ready", pendingAction: null }));
  
  if (state.pendingAction && key === "y") return executePendingAction(state);
  if (state.pendingAction && key === "n") return { ...state, status: "cancelled", pendingAction: null };

  if (key === "j" || key === "ArrowDown") return clampCursor({ ...state, cursor: state.cursor + 1 });
  if (key === "k" || key === "ArrowUp") return clampCursor({ ...state, cursor: state.cursor - 1 });
  if (key === "G") return clampCursor({ ...state, cursor: getVisibleRows(state).length - 1 });
  if (key === "gg") return clampCursor({ ...state, cursor: 0 });
  if (key === "Ctrl+D" || key === "PageDown") return clampCursor({ ...state, cursor: state.cursor + Math.floor(leftRowsCount(state) / 2) });
  if (key === "Ctrl+U" || key === "PageUp") return clampCursor({ ...state, cursor: state.cursor - Math.floor(leftRowsCount(state) / 2) });
  if (key === "Tab") return clampCursor(reloadState({ ...state, tab: tabs[(tabs.indexOf(state.tab) + 1) % tabs.length], cursor: 0, listScroll: 0 }));
  if (key === "b") return popStack(state);
  if (key === "B") return clampCursor(reloadState({ ...state, directory: undefined, query: "", inputMode: null, stack: [], cursor: 0, listScroll: 0, status: "reset" }));
  if (key === "m") return { ...state, messagesExpanded: !state.messagesExpanded };
  if (key === "o") {
    const allExpanded = state.folders.every(f => state.expandedFolders.has(f.directory));
    const nextSet = new Set<string>();
    if (!allExpanded) state.folders.forEach(f => { nextSet.add(f.directory); });
    return clampCursor(reloadState({ ...state, expandedFolders: nextSet }));
  }
  
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
    return currentSession(state)
      ? { ...state, status: `confirm continue ${currentSession(state)?.id || ""}`.trim(), pendingAction: "continue" }
      : state;
  }
  
  if (key === "d") return currentSession(state) ? { ...state, status: `confirm delete ${currentSession(state)?.id || ""}`.trim(), pendingAction: "delete" } : state;
  if (key === "a") return currentSession(state) ? { ...state, status: `confirm archive ${currentSession(state)?.id || ""}`.trim(), pendingAction: "archive" } : state;
  if (key === "r") return currentSession(state) ? { ...state, status: `confirm restore ${currentSession(state)?.id || ""}`.trim(), pendingAction: "restore" } : state;
  if (key === "e") return currentSession(state) ? { ...state, status: `confirm export sanitized ${currentSession(state)?.id || ""}`.trim(), pendingAction: "export_sanitized" } : state;
  if (key === "E") return currentSession(state) ? { ...state, status: `confirm export raw ${currentSession(state)?.id || ""}`.trim(), pendingAction: "export_raw" } : state;
  if (key === "c") return currentSession(state) ? { ...state, status: `confirm continue ${currentSession(state)?.id || ""}`.trim(), pendingAction: "continue" } : state;
  if (key === "C") return currentSession(state) ? { ...state, status: `confirm continue fork ${currentSession(state)?.id || ""}`.trim(), pendingAction: "continue_fork" } : state;

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
  const start = Math.max(1, Math.floor((height - 7) / 2));
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

function chunkLine(text: string, fgColor: string, bgColor?: string, strong = false): TextChunk[] {
  let chunk: TextChunk = strong ? bold(text) : ({ __isChunk: true, text } as TextChunk);
  chunk = fg(fgColor)(chunk as any);
  if (bgColor) chunk = bg(bgColor)(chunk as any);
  return [chunk, { __isChunk: true, text: "\n" } as TextChunk];
}

function styledScreen(state: UiState): StyledText {
  const rows = renderRows(state);
  const chunks: TextChunk[] = [];
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (i === 0) {
      chunks.push(...chunkLine(line.replace("theme:list ", "").replace("theme:detail ", ""), tone("text"), tone("surfaceAlt"), true));
      continue;
    }
    if (line.includes("theme:detail ")) {
      chunks.push(...chunkLine(line.replace("theme:detail ", ""), tone("text"), undefined, true));
      continue;
    }
    if (line.includes("┌") || line.includes("└") || line.includes("[y] confirm")) {
      chunks.push(...chunkLine(line, tone("modalFg"), tone("modalBg"), true));
      continue;
    }
    if (line.includes("❯")) {
      chunks.push(...chunkLine(line.replace("theme:selected ", "").replace(/theme:(folder|session)-(cwd|other) /g, ""), tone("text"), tone("listSelectedBg"), true));
      continue;
    }
    if (line.includes("theme:folder-cwd ")) {
      chunks.push(...chunkLine(line.replace("theme:folder-cwd ", ""), tone("cyan"), undefined, true));
      continue;
    }
    if (line.includes("theme:folder-other ")) {
      chunks.push(...chunkLine(line.replace("theme:folder-other ", ""), tone("success"), undefined, true));
      continue;
    }
    if (line.includes("theme:session-cwd ")) {
      chunks.push(...chunkLine(line.replace("theme:session-cwd ", ""), tone("cyan")));
      continue;
    }
    if (line.includes("theme:session-other ")) {
      chunks.push(...chunkLine(line.replace("theme:session-other ", ""), tone("muted")));
      continue;
    }
    chunks.push(...chunkLine(line, tone("text")));
  }
  return new StyledText(chunks);
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

function appendTyped(state: UiState, value: string): UiState {
  if (!state.inputMode) return state;
  if (value === "Backspace") {
    return applyKey(state, `type:${state.query.slice(0, -1)}`);
  }
  if (value.length === 1 && value >= " ") {
    return applyKey(state, `type:${state.query}${value}`);
  }
  return state;
}

export async function startInteractiveTui(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30, useMouse: true });
  let state = createInitialState(listSessions({ tab: "active", cwd: cwd() }), { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
  const screen = new TextRenderable(renderer, { id: "opencode-all-screen", content: styledScreen(state) });
  renderer.root.add(screen);
  let pendingG = false;

  process.stdout.on("resize", () => {
    state = { ...state, viewport: { height: process.stdout.rows || 24, width: process.stdout.columns || 100 } };
    screen.content = styledScreen(state);
    renderer.requestRender();
  });

  renderer.keyInput.on("keypress", (key: any) => {
    const mapped = mapKey(key);
    if (mapped === "q") {
      renderer.destroy();
      process.exit(0);
    }

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
      const next = appendTyped(state, mapped);
      state = next === state ? applyKey(state, mapped) : next;
    }

    screen.content = styledScreen(state);
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

export function continueSession(id: string, fork = false): never {
  const args = ["--session", id];
  if (fork) args.push("--fork");
  const child = spawn(opencodeBin(), args, { stdio: "inherit", detached: true });
  child.unref();
  process.exit(0);
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
