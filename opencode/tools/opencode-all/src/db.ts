import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { capText, hasControlBytes, renderSafe } from "./sanitize.ts";

export type Tab = "active" | "archived" | "all";

export type SessionRow = {
  id: string;
  title: string;
  directory: string;
  path: string;
  agent: string;
  model: string;
  shareUrl: string;
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  timeCreated: number;
  timeUpdated: number;
  timeArchived: number | null;
  isCurrent: boolean;
  suspicious: boolean;
};

export type SessionDetail = SessionRow & { messages: number; diffPath: string | null };

export type ListOptions = {
  dbPath?: string;
  tab: Tab;
  cwd: string;
  query?: string;
  directory?: string;
};

export function defaultDbPath(): string {
  if (process.env.OPENCODE_ALL_DB_PATH) return process.env.OPENCODE_ALL_DB_PATH;
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "opencode.db");
}

function openDb(path = defaultDbPath()): Database {
  const db = new Database(path);
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

function tabWhere(tab: Tab): string {
  if (tab === "active") return "time_archived IS NULL";
  if (tab === "archived") return "time_archived IS NOT NULL";
  return "1 = 1";
}

function toRow(raw: any, cwd: string): SessionRow {
  const title = renderSafe(raw.title);
  const directory = renderSafe(raw.directory);
  const path = renderSafe(raw.path);
  const agent = renderSafe(raw.agent);
  const model = renderSafe(raw.model);
  const shareUrl = renderSafe(raw.share_url);
  const isCurrent = directory.startsWith(cwd) || path.startsWith(cwd);
  const suspicious = [raw.title, raw.directory, raw.path, raw.agent, raw.model, raw.share_url].some(hasControlBytes);
  return {
    id: String(raw.id),
    title: capText(title, 240),
    directory: capText(directory, 300),
    path: capText(path, 300),
    agent: capText(agent, 80),
    model: capText(model, 120),
    shareUrl: capText(shareUrl, 240),
    cost: Number(raw.cost || 0),
    tokensInput: Number(raw.tokens_input || 0),
    tokensOutput: Number(raw.tokens_output || 0),
    timeCreated: Number(raw.time_created || 0),
    timeUpdated: Number(raw.time_updated || 0),
    timeArchived: raw.time_archived == null ? null : Number(raw.time_archived),
    isCurrent,
    suspicious,
  };
}

function rank(row: SessionRow, q: string): number {
  if (!q) return 0;
  const fields = [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].map(v => v.toLowerCase());
  const query = q.toLowerCase();
  if (fields.some(v => v.startsWith(query))) return 0;
  if (fields.some(v => v.includes(query))) return 1;
  return 2;
}

function subsequence(haystack: string, needle: string): boolean {
  let idx = 0;
  for (const char of haystack.toLowerCase()) {
    if (char === needle[idx]?.toLowerCase()) idx++;
    if (idx === needle.length) return true;
  }
  return needle.length === 0;
}

function matches(row: SessionRow, q = ""): boolean {
  if (!q) return true;
  const fields = [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl];
  return fields.some(field => field.toLowerCase().includes(q.toLowerCase()) || subsequence(field, q));
}

export function listSessions(options: ListOptions): SessionRow[] {
  const db = openDb(options.dbPath);
  try {
    const rows = db.query(`
      SELECT id, title, directory, COALESCE(path, '') AS path, COALESCE(agent, '') AS agent,
             COALESCE(model, '') AS model, COALESCE(share_url, '') AS share_url,
             cost, tokens_input, tokens_output, time_created, time_updated, time_archived
      FROM session
      WHERE parent_id IS NULL AND ${tabWhere(options.tab)}
      ORDER BY time_updated DESC
    `).all().map(raw => toRow(raw, options.cwd));
    return rows
      .filter(row => !options.directory || row.directory === options.directory)
      .filter(row => matches(row, options.query))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || rank(a, options.query || "") - rank(b, options.query || "") || b.timeUpdated - a.timeUpdated);
  } finally {
    db.close();
  }
}

export function getSessionDetail(options: { dbPath?: string; id: string; cwd?: string }): SessionDetail | null {
  const db = openDb(options.dbPath);
  try {
    const raw = db.query(`
      SELECT id, title, directory, COALESCE(path, '') AS path, COALESCE(agent, '') AS agent,
             COALESCE(model, '') AS model, COALESCE(share_url, '') AS share_url,
             cost, tokens_input, tokens_output, time_created, time_updated, time_archived
      FROM session WHERE id = ?
    `).get(options.id);
    if (!raw) return null;
    const row = toRow(raw, options.cwd || process.cwd());
    const messages = Number((db.query("SELECT COUNT(*) AS count FROM message WHERE session_id = ?").get(options.id) as { count?: number } | null)?.count || 0);
    const diffBase = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
    const diffPath = join(diffBase, "opencode", "storage", "session_diff", `${options.id}.json`);
    return { ...row, messages, diffPath: existsSync(diffPath) ? diffPath : null };
  } finally {
    db.close();
  }
}

export function setArchived(options: { dbPath?: string; id: string; archivedAt: number | null }): void {
  const db = openDb(options.dbPath);
  try {
    db.query("UPDATE session SET time_archived = ? WHERE id = ?").run(options.archivedAt, options.id);
  } finally {
    db.close();
  }
}

export function listDirectories(options: { dbPath?: string; prefix?: string }): Array<{ directory: string; count: number }> {
  const db = openDb(options.dbPath);
  try {
    const prefix = renderSafe(options.prefix || "").toLowerCase();
    return db.query(`
      SELECT directory, COUNT(*) AS count
      FROM session
      WHERE parent_id IS NULL
      GROUP BY directory
      ORDER BY directory ASC
    `).all()
      .map((row: any) => ({ directory: renderSafe(row.directory), count: Number(row.count || 0) }))
      .filter(row => !prefix || row.directory.toLowerCase().includes(prefix));
  } finally {
    db.close();
  }
}