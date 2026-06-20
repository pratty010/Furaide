import {
  type ArchivedMessageRow,
  type DirectoryRow,
  type SessionRow,
  type Tab,
  listDirectories,
  listSessions,
  readArchivedMessages,
  readRecentMessages,
} from "../db.ts";

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
export type PaneFocus = "messages" | "metadata" | "sessions" | "search" | "confirm";

export type UiState = {
  folders: DirectoryRow[];
  allSessions: UiSession[];
  sessions: UiSession[];
  expandedFolders: Set<string>;
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
  searchScroll: number;
  focus: PaneFocus;
  messageRows: ArchivedMessageRow[];
};

export const tabs: Tab[] = ["active", "archived"];

export function cwd(): string {
  return process.env.OPENCODE_ALL_CWD || process.cwd();
}

export function sortFolders(rows: DirectoryRow[], baseCwd: string): DirectoryRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.directory.startsWith(baseCwd)) - Number(a.directory.startsWith(baseCwd)) ||
      b.latestUpdated - a.latestUpdated ||
      a.directory.localeCompare(b.directory),
  );
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

export function selectedVisibleSession(state: UiState): UiSession | undefined {
  return currentSession(state);
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
  const nextBase = { ...state, folders, sessions, cursor };
  const selected = selectedVisibleSession(nextBase);
  let messageRows: ArchivedMessageRow[] = [];
  if (selected) {
    messageRows = selected.timeArchived == null
      ? readRecentMessages(selected.id)
      : readArchivedMessages(selected.id);
  }
  return { ...state, folders, sessions, cursor, listScroll: Math.min(state.listScroll, cursor), messageRows, messageScroll: 0 };
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
    searchScroll: 0,
    focus: "sessions",
    messageRows: [],
  };
}

export function clampCursor(state: UiState): UiState {
  const total = getVisibleRows(state).length;
  const max = Math.max(0, total - 1);
  const cursor = Math.max(0, Math.min(state.cursor, max));
  const rows = Math.max(1, Math.floor((state.viewport.height - 2) * 0.5));
  let listScroll = state.listScroll;
  if (cursor < listScroll) listScroll = cursor;
  if (cursor >= listScroll + rows) listScroll = cursor - rows + 1;
  return { ...state, cursor, listScroll: Math.max(0, listScroll) };
}

export function popStack(state: UiState): UiState {
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

export function selectFolderAtCursor(state: UiState): DirectoryRow | undefined {
  const row = getVisibleRows(state)[state.cursor];
  if (row && !("id" in row)) return row as DirectoryRow;
  return undefined;
}
