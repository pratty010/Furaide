import { existsSync, statSync } from "node:fs";
import { listArchivedSessionFiles, listSessions, defaultArchiveRoot, defaultDbPath } from "../db.ts";
import type { DirectoryRow, SessionRow, Tab } from "../db.ts";

export type SessionIndex = {
  active: Map<string, SessionRow>;
  archived: Map<string, SessionRow>;
  activeByDir: Map<string, Set<string>>;
  archivedByDir: Map<string, Set<string>>;
};

export type BuildSessionIndexOptions = {
  dbPath?: string;
  archiveRoot?: string;
  cwd: string;
};

let cachedIndex: { key: string; index: SessionIndex } | null = null;

function sourceKey(options: BuildSessionIndexOptions): string {
  const dbPath = options.dbPath || defaultDbPath();
  const archiveRoot = options.archiveRoot || defaultArchiveRoot();
  const dbMtime = existsSync(dbPath) ? statSync(dbPath).mtimeMs : 0;
  const archiveMtime = existsSync(archiveRoot) ? statSync(archiveRoot).mtimeMs : 0;
  return `${dbPath}:${dbMtime}:${archiveRoot}:${archiveMtime}:${options.cwd}`;
}

export function clearSessionIndexCache(): void {
  cachedIndex = null;
}

function emptyIndex(): SessionIndex {
  return {
    active: new Map(),
    archived: new Map(),
    activeByDir: new Map(),
    archivedByDir: new Map(),
  };
}

function addToGroup(group: Map<string, Set<string>>, row: SessionRow): void {
  const set = group.get(row.directory) || new Set<string>();
  set.add(row.id);
  group.set(row.directory, set);
}

function removeFromGroup(group: Map<string, Set<string>>, row: SessionRow): void {
  const set = group.get(row.directory);
  if (!set) return;
  set.delete(row.id);
  if (set.size === 0) group.delete(row.directory);
}

export function addActiveToIndex(index: SessionIndex, row: SessionRow): void {
  index.active.set(row.id, { ...row, timeArchived: null });
  addToGroup(index.activeByDir, { ...row, timeArchived: null });
}

export function addArchivedToIndex(index: SessionIndex, row: SessionRow): void {
  const timeArchived = row.timeArchived ?? Date.now();
  index.archived.set(row.id, { ...row, timeArchived });
  addToGroup(index.archivedByDir, { ...row, timeArchived });
}

export function removeActiveFromIndex(index: SessionIndex, id: string): SessionRow | undefined {
  const row = index.active.get(id);
  if (!row) return undefined;
  index.active.delete(id);
  removeFromGroup(index.activeByDir, row);
  return row;
}

export function removeArchivedFromIndex(index: SessionIndex, id: string): SessionRow | undefined {
  const row = index.archived.get(id);
  if (!row) return undefined;
  index.archived.delete(id);
  removeFromGroup(index.archivedByDir, row);
  return row;
}

export function buildSessionIndex(options: BuildSessionIndexOptions): SessionIndex {
  const key = sourceKey(options);
  if (cachedIndex?.key === key) return cachedIndex.index;
  const index = emptyIndex();
  const active = listSessions({ tab: "active", cwd: options.cwd, dbPath: options.dbPath });
  for (const row of active) addActiveToIndex(index, row);
  const archived = listArchivedSessionFiles({ archiveRoot: options.archiveRoot, cwd: options.cwd });
  for (const row of archived) {
    if (index.active.has(row.id)) continue;
    addArchivedToIndex(index, row);
  }
  cachedIndex = { key, index };
  return index;
}

export function rowsForTab(index: SessionIndex, tab: Tab, directory?: string, query = ""): SessionRow[] {
  const source = tab === "active" ? index.active : index.archived;
  const lower = query.trim().toLowerCase();
  return [...source.values()]
    .filter(row => !directory || row.directory === directory)
    .filter(row => !lower || [row.title, row.directory, row.id].some(value => value.toLowerCase().includes(lower)))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.timeUpdated - a.timeUpdated);
}

export function directoriesForTab(index: SessionIndex, tab: Tab): DirectoryRow[] {
  const group = tab === "active" ? index.activeByDir : index.archivedByDir;
  const source = tab === "active" ? index.active : index.archived;
  return [...group.entries()]
    .map(([directory, ids]) => {
      let latestUpdated = 0;
      for (const id of ids) latestUpdated = Math.max(latestUpdated, source.get(id)?.timeUpdated || 0);
      return { directory, active: 0, archived: 0, latestUpdated };
    })
    .map(row => ({
      ...row,
      active: tab === "active" ? group.get(row.directory)?.size ?? 0 : 0,
      archived: tab === "archived" ? group.get(row.directory)?.size ?? 0 : 0,
    }))
    .sort((a, b) => a.directory.localeCompare(b.directory));
}

export type SerializableSessionIndex = {
  active: SessionRow[];
  archived: SessionRow[];
};

export function serializeSessionIndex(index: SessionIndex): SerializableSessionIndex {
  return { active: [...index.active.values()], archived: [...index.archived.values()] };
}

export function deserializeSessionIndex(raw: SerializableSessionIndex): SessionIndex {
  const index = emptyIndex();
  for (const row of raw.active) addActiveToIndex(index, row);
  for (const row of raw.archived) addArchivedToIndex(index, row);
  return index;
}
