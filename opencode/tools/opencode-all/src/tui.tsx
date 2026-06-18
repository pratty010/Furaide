#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getSessionDetail, listDirectories, listSessions, setArchived, type SessionRow, type Tab } from "./db.ts";

export type UiSession = SessionRow;

export type Viewport = { height: number; width: number };

export type UiState = {
  sessions: UiSession[];
  cursor: number;
  listScroll: number;
  detailScroll: number;
  tab: Tab;
  query: string;
  directory?: string;
  sort: "updated" | "created" | "cost" | "title" | "recency";
  stack: Array<Pick<UiState, "cursor" | "listScroll" | "tab" | "query" | "directory" | "sort">>;
  viewport: Viewport;
  status: string;
};

const tabs: Tab[] = ["active", "archived", "all"];

export function createInitialState(sessions: UiSession[], viewport: Viewport): UiState {
  return {
    sessions,
    cursor: 0,
    listScroll: 0,
    detailScroll: 0,
    tab: "active",
    query: "",
    sort: "updated",
    stack: [],
    viewport,
    status: "ready",
  };
}

function visibleRows(state: UiState): number {
  return Math.max(1, state.viewport.height - 3);
}

function clampCursor(state: UiState): UiState {
  const max = Math.max(0, state.sessions.length - 1);
  const cursor = Math.max(0, Math.min(state.cursor, max));
  const rows = visibleRows(state);
  let listScroll = state.listScroll;
  if (cursor < listScroll) listScroll = cursor;
  if (cursor >= listScroll + rows) listScroll = cursor - rows + 1;
  return { ...state, cursor, listScroll: Math.max(0, listScroll) };
}

export function currentSession(state: UiState): UiSession | undefined {
  return state.sessions[state.cursor];
}

function pushDrill(state: UiState, directory: string): UiState {
  return clampCursor({
    ...state,
    stack: [...state.stack, { cursor: state.cursor, listScroll: state.listScroll, tab: state.tab, query: state.query, directory: state.directory, sort: state.sort }],
    directory,
    query: "",
    tab: "all",
    cursor: 0,
    listScroll: 0,
    status: `drilled into ${directory}`,
  });
}

function popDrill(state: UiState): UiState {
  const previous = state.stack.at(-1);
  if (!previous) return state;
  return clampCursor({ ...state, ...previous, stack: state.stack.slice(0, -1), status: "back" });
}

export function applyKey(state: UiState, key: string): UiState {
  if (key.startsWith("drill:")) return pushDrill(state, key.slice("drill:".length));
  if (key === "j" || key === "ArrowDown") return clampCursor({ ...state, cursor: state.cursor + 1 });
  if (key === "k" || key === "ArrowUp") return clampCursor({ ...state, cursor: state.cursor - 1 });
  if (key === "G") return clampCursor({ ...state, cursor: state.sessions.length - 1 });
  if (key === "gg") return clampCursor({ ...state, cursor: 0 });
  if (key === "Ctrl+D" || key === "PageDown") return clampCursor({ ...state, cursor: state.cursor + Math.floor(visibleRows(state) / 2) });
  if (key === "Ctrl+U" || key === "PageUp") return clampCursor({ ...state, cursor: state.cursor - Math.floor(visibleRows(state) / 2) });
  if (key === "Tab") return clampCursor({ ...state, tab: tabs[(tabs.indexOf(state.tab) + 1) % tabs.length], cursor: 0, listScroll: 0 });
  if (key === "b") return popDrill(state);
  if (key === "B") return clampCursor({ ...state, stack: [], directory: undefined, query: "", cursor: 0, listScroll: 0, status: "reset" });
  return state;
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
  spawnSync(opencodeBin(), args, { stdio: "inherit" });
  process.exit(0);
}

function printFallbackList(): void {
  const rows = listSessions({ tab: "active", cwd: process.env.OPENCODE_ALL_CWD || process.cwd() });
  for (const row of rows) {
    console.log(`${row.id}\t${row.title}\t${row.directory}`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--list")) {
    printFallbackList();
    return;
  }

  printFallbackList();
}

if (import.meta.main) await main();
