#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bg, bold, createCliRenderer, fg, StyledText, TextChunk, TextRenderable } from "@opentui/core";
import { DirectoryRow, getSessionDetail, listDirectories, listSessions, SessionDetail, SessionRow, setArchived, Tab } from "./db.ts";

export type UiSession = SessionRow;
export type Viewport = { height: number; width: number };
type LeftMode = "folders" | "sessions";
type InputMode = null | "search" | "directory" | "filter";
type PendingAction = "delete" | "archive" | "restore" | "export_sanitized" | "export_raw" | null;

type ThemeDoc = {
  name: string;
  vars: Record<string, string>;
  pane: Record<string, string>;
};

export type UiState = {
  mode: LeftMode;
  folders: DirectoryRow[];
  allSessions: UiSession[];
  sessions: UiSession[];
  cursor: number;
  listScroll: number;
  detailScroll: number;
  tab: Tab;
  inputMode: InputMode;
  query: string;
  directory?: string;
  sort: "updated" | "created" | "cost" | "title" | "recency";
  stack: Array<Pick<UiState, "cursor" | "listScroll" | "tab" | "query" | "directory" | "sort" | "mode">>;
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

function leftRows(state: UiState): number {
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

function currentFolder(state: UiState): DirectoryRow | undefined {
  return state.folders[state.cursor];
}

export function currentSession(state: UiState): UiSession | undefined {
  return state.sessions[state.cursor];
}

function reloadState(state: UiState): UiState {
  const baseCwd = cwd();
  if (state.mode === "folders") {
    let folders = sortFolders(listDirectories({ prefix: state.query }), baseCwd);
    if (state.inputMode === "search" && state.query) {
      folders = folders.filter(row => row.directory.toLowerCase().includes(state.query.toLowerCase()));
    }
    const cursor = Math.min(state.cursor, Math.max(0, folders.length - 1));
    return { ...state, folders, cursor, listScroll: Math.min(state.listScroll, cursor) };
  }

  const dbSessions = listSessions({ tab: state.tab, cwd: baseCwd, directory: state.directory, query: state.query });
  const sessions = dbSessions.length > 0
    ? dbSessions
    : state.allSessions
        .filter(row => !state.directory || row.directory === state.directory)
        .filter(row => !state.query || [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].some(value => value.toLowerCase().includes(state.query.toLowerCase())));
  const cursor = Math.min(state.cursor, Math.max(0, sessions.length - 1));
  return { ...state, sessions, cursor, listScroll: Math.min(state.listScroll, cursor) };
}

export function createInitialState(sessions: UiSession[], viewport: Viewport): UiState {
  return {
    mode: "folders",
    folders: sortFolders(listDirectories({ prefix: "" }), cwd()),
    allSessions: sessions,
    sessions,
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
  const total = state.mode === "folders" ? state.folders.length : state.sessions.length;
  const max = Math.max(0, total - 1);
  const cursor = Math.max(0, Math.min(state.cursor, max));
  const rows = leftRows(state);
  let listScroll = state.listScroll;
  if (cursor < listScroll) listScroll = cursor;
  if (cursor >= listScroll + rows) listScroll = cursor - rows + 1;
  return { ...state, cursor, listScroll: Math.max(0, listScroll) };
}

function openFolder(state: UiState, directory: string): UiState {
  const next: UiState = {
    ...state,
    mode: "sessions",
    stack: [...state.stack, { cursor: state.cursor, listScroll: state.listScroll, tab: state.tab, query: state.query, directory: state.directory, sort: state.sort, mode: state.mode }],
    directory,
    query: "",
    inputMode: null,
    cursor: 0,
    listScroll: 0,
    status: `opened ${directory}`,
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

  return clampCursor(reloadState({ ...state, pendingAction: null, status: `executed ${state.pendingAction}` }));
}

export function applyKey(state: UiState, key: string): UiState {
  if (key.startsWith("folder:")) return openFolder(state, key.slice("folder:".length));
  if (key.startsWith("drill:")) return openFolder(state, key.slice("drill:".length));
  if (key === "/") return { ...state, inputMode: "search", query: "", status: "search" };
  if (key === "\\") return { ...state, inputMode: "directory", mode: "folders", query: "", status: "directory" };
  if (key === "f") return { ...state, inputMode: "filter", status: "filter" };
  if (key.startsWith("type:")) {
    const query = key.slice("type:".length);
    return clampCursor(reloadState({ ...state, query, cursor: 0, listScroll: 0, status: `${state.inputMode || "input"}:${query}` }));
  }
  if (key === "Escape" || key === "Esc") return clampCursor(reloadState({ ...state, inputMode: null, query: "", status: "ready" }));
  if (key === "j" || key === "ArrowDown") return clampCursor({ ...state, cursor: state.cursor + 1 });
  if (key === "k" || key === "ArrowUp") return clampCursor({ ...state, cursor: state.cursor - 1 });
  if (key === "G") return clampCursor({ ...state, cursor: (state.mode === "folders" ? state.folders.length : state.sessions.length) - 1 });
  if (key === "gg") return clampCursor({ ...state, cursor: 0 });
  if (key === "Ctrl+D" || key === "PageDown") return clampCursor({ ...state, cursor: state.cursor + Math.floor(leftRows(state) / 2) });
  if (key === "Ctrl+U" || key === "PageUp") return clampCursor({ ...state, cursor: state.cursor - Math.floor(leftRows(state) / 2) });
  if (key === "Tab") return clampCursor(reloadState({ ...state, tab: tabs[(tabs.indexOf(state.tab) + 1) % tabs.length], cursor: 0, listScroll: 0 }));
  if (key === "b") return popStack(state);
  if (key === "B") return clampCursor(reloadState({ ...state, mode: "folders", directory: undefined, query: "", inputMode: null, stack: [], cursor: 0, listScroll: 0, status: "reset" }));
  if (key === "Enter") {
    if (state.pendingAction) return executePendingAction(state);
    if (state.mode === "folders") {
      const folder = currentFolder(state);
      return folder ? openFolder(state, folder.directory) : state;
    }
    return state;
  }
  if (key === "d") return state.mode === "sessions" ? { ...state, status: `confirm delete ${currentSession(state)?.id || ""}`.trim(), pendingAction: "delete" } : state;
  if (key === "a") return state.mode === "sessions" ? { ...state, status: `confirm archive ${currentSession(state)?.id || ""}`.trim(), pendingAction: "archive" } : state;
  if (key === "r") return state.mode === "sessions" ? { ...state, status: `confirm restore ${currentSession(state)?.id || ""}`.trim(), pendingAction: "restore" } : state;
  if (key === "e") return state.mode === "sessions" ? { ...state, status: `confirm export sanitized ${currentSession(state)?.id || ""}`.trim(), pendingAction: "export_sanitized" } : state;
  if (key === "E") return state.mode === "sessions" ? { ...state, status: `confirm export raw ${currentSession(state)?.id || ""}`.trim(), pendingAction: "export_raw" } : state;
  if (state.pendingAction && key === "y") return executePendingAction(state);
  if (state.pendingAction && key === "n") return { ...state, status: "cancelled", pendingAction: null };
  return state;
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function fmtCost(value: number): string {
  return value > 0 ? `$${value.toFixed(2)}` : "$0.00";
}

function selectedDetail(state: UiState): SessionDetail | null {
  if (state.mode !== "sessions") return null;
  const selected = currentSession(state);
  if (!selected) return null;
  return getSessionDetail({ id: selected.id, cwd: cwd() });
}

function folderLabel(row: DirectoryRow, isSelected: boolean): string {
  const marker = isSelected ? "❯ " : "  ";
  return `${marker}${row.directory} (${row.active} active, ${row.archived} archived)`;
}

function sessionLabel(row: UiSession, isSelected: boolean): string {
  const marker = isSelected ? "❯ " : "  ";
  const archive = row.timeArchived == null ? "" : "[A] ";
  return `${marker}${archive}${row.title}`;
}

export function renderRows(state: UiState): string[] {
  const rows = leftRows(state);
  const leftWidth = Math.min(58, Math.max(28, Math.floor(state.viewport.width * 0.48)));
  const source = state.mode === "folders" ? state.folders : state.sessions;
  const visible = source.slice(state.listScroll, state.listScroll + rows);
  const detail = selectedDetail(state);
  const header = state.mode === "folders"
    ? `theme:list Folders ${state.cursor + 1} / ${Math.max(source.length, 1)} [${state.tab}]`
    : `theme:list Sessions ${state.cursor + 1} / ${Math.max(source.length, 1)} [${state.tab}]`;

  const fallbackDetailLines = state.mode === "sessions" && currentSession(state) ? [
    `theme:detail ${currentSession(state)?.title || "No session selected"}`,
    `Directory: ${currentSession(state)?.directory || "-"}`,
    `Agent: ${currentSession(state)?.agent || "-"}`,
    `Model: ${parseModel(currentSession(state)?.model || "")}`,
    `Recent:`,
  ] : [];

  const detailLines = detail ? [
    `theme:detail ${detail.title}`,
    `ID: ${detail.id}`,
    `Directory: ${detail.directory}`,
    `Agent: ${detail.agent || "-"}`,
    `Model: ${parseModel(detail.model)}`,
    `Messages: ${detail.messages}`,
    `Parts: text ${detail.partCounts.text || 0} · tool ${detail.partCounts.tool || 0} · reasoning ${detail.partCounts.reasoning || 0}`,
    `Tokens: in ${detail.tokensInput} · out ${detail.tokensOutput} · reasoning ${detail.tokensReasoning}`,
    `Cache: read ${detail.tokensCacheRead} · write ${detail.tokensCacheWrite}`,
    `Cost: ${fmtCost(detail.cost)}`,
    `Changes: ${detail.summaryFiles} files · +${detail.summaryAdditions} / -${detail.summaryDeletions}`,
    `Diff: ${detail.diffPath ? `${detail.diffPath} (${detail.diffBytes || 0} bytes)` : "-"}`,
    `Recent:`,
    ...detail.recentText.map(item => `${item.role[0].toUpperCase()} ${item.text}`),
    `Tools:`,
    ...detail.toolCounts.slice(0, 4).map(item => `${item.tool} ${item.count} ${item.status}`),
  ] : state.mode === "folders" ? [
    `theme:detail Folder browser`,
    `Directory: ${currentFolder(state)?.directory || "-"}`,
    `Active: ${currentFolder(state)?.active || 0}`,
    `Archived: ${currentFolder(state)?.archived || 0}`,
    `Latest: ${currentFolder(state)?.latestUpdated || 0}`,
    `Shortcut: Enter opens sessions`,
    `Back: b one level · B root`,
  ] : fallbackDetailLines.length > 0 ? fallbackDetailLines : ["theme:detail No session selected"];

  const lines = [pad(header, leftWidth) + " │ " + (detailLines[0] || "")];

  for (let i = 0; i < rows; i++) {
    const item = visible[i];
    const absolute = state.listScroll + i;
    const left = state.mode === "folders"
      ? item ? folderLabel(item as DirectoryRow, absolute === state.cursor) : ""
      : item ? sessionLabel(item as UiSession, absolute === state.cursor) : "";
    const right = detailLines[i + 1] || "";
    lines.push(pad(left, leftWidth) + " │ " + right);
  }

  lines.push(`q quit · / search · \\ folders · Tab tabs · Enter open · b back · e export · a archive · r restore · d delete · c continue · R refresh`);
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
    if (line.includes("❯")) {
      chunks.push(...chunkLine(line.replace("theme:selected ", ""), tone("text"), tone("listSelectedBg"), true));
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
