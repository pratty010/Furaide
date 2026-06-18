import { existsSync, statSync } from "node:fs";
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

export type DirectoryRow = {
  directory: string;
  active: number;
  archived: number;
  latestUpdated: number;
};

export type RecentTextRow = {
  role: "user" | "assistant" | "system";
  timeCreated: number;
  text: string;
};

export type ToolCountRow = {
  tool: string;
  status: string;
  count: number;
};

export type SessionDetail = SessionRow & {
  messages: number;
  diffPath: string | null;
  diffBytes: number | null;
  partCounts: Record<string, number>;
  toolCounts: ToolCountRow[];
  recentText: RecentTextRow[];
  tokensReasoning: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  summaryFiles: number;
  summaryAdditions: number;
  summaryDeletions: number;
};

type SessionRawRow = {
  id: string;
  title: string;
  directory: string;
  path: string;
  agent: string;
  model: string;
  share_url: string;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning?: number;
  tokens_cache_read?: number;
  tokens_cache_write?: number;
  summary_files?: number;
  summary_additions?: number;
  summary_deletions?: number;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
};

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

function toRow(raw: SessionRawRow, cwd: string): SessionRow {
  const title = renderSafe(raw.title);
  const directory = renderSafe(raw.directory);
  const path = renderSafe(raw.path || "");
  const agent = renderSafe(raw.agent || "");
  const model = renderSafe(raw.model || "");
  const shareUrl = renderSafe(raw.share_url || "");
  const isCurrent = directory.startsWith(cwd) || path.startsWith(cwd);
  const suspicious = [raw.title, raw.directory, raw.path, raw.agent, raw.model, raw.share_url].some(hasControlBytes);
  return {
    id: String(raw.id),
    title: capText(title, 240),
    directory: capText(directory, 300),
    path: capText(path, 300),
    agent: capText(agent, 80),
    model: capText(model, 160),
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
    `).all() as SessionRawRow[];

    return rows
      .map(raw => toRow(raw, options.cwd))
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
             cost, tokens_input, tokens_output, COALESCE(tokens_reasoning, 0) AS tokens_reasoning,
             COALESCE(tokens_cache_read, 0) AS tokens_cache_read, COALESCE(tokens_cache_write, 0) AS tokens_cache_write,
             COALESCE(summary_files, 0) AS summary_files, COALESCE(summary_additions, 0) AS summary_additions,
             COALESCE(summary_deletions, 0) AS summary_deletions,
             time_created, time_updated, time_archived
      FROM session WHERE id = ?
    `).get(options.id) as SessionRawRow | null;
    if (!raw) return null;

    const row = toRow(raw, options.cwd || process.cwd());
    const messages = Number((db.query("SELECT COUNT(*) AS count FROM message WHERE session_id = ?").get(options.id) as { count?: number } | null)?.count || 0);

    const partRows = db.query(`
      SELECT json_extract(data, '$.type') AS type, COUNT(*) AS count
      FROM part
      WHERE session_id = ?
      GROUP BY json_extract(data, '$.type')
    `).all(options.id) as Array<{ type?: string; count?: number }>;
    const partCounts = Object.fromEntries(partRows.map(item => [String(item.type || "unknown"), Number(item.count || 0)]));

    const toolCounts = (db.query(`
      SELECT json_extract(data, '$.tool') AS tool,
             json_extract(data, '$.state.status') AS status,
             COUNT(*) AS count
      FROM part
      WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'
      GROUP BY tool, status
      ORDER BY count DESC
      LIMIT 12
    `).all(options.id) as Array<{ tool?: string; status?: string; count?: number }>).map(item => ({
      tool: renderSafe(item.tool || "unknown"),
      status: renderSafe(item.status || "unknown"),
      count: Number(item.count || 0),
    }));

    const recentText = (db.query(`
      SELECT json_extract(m.data, '$.role') AS role,
             m.time_created AS time_created,
             substr(json_extract(p.data, '$.text'), 1, 240) AS text
      FROM message m
      JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ? AND json_extract(p.data, '$.type') = 'text'
      ORDER BY m.time_created DESC
      LIMIT 4
    `).all(options.id) as Array<{ role?: string; time_created?: number; text?: string }>).map(item => ({
      role: (["user", "assistant", "system"].includes(String(item.role)) ? item.role : "assistant") as "user" | "assistant" | "system",
      timeCreated: Number(item.time_created || 0),
      text: capText(renderSafe(item.text || ""), 120),
    }));

    const diffBase = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
    const diffPath = join(diffBase, "opencode", "storage", "session_diff", `${options.id}.json`);
    const hasDiff = existsSync(diffPath);

    return {
      ...row,
      messages,
      diffPath: hasDiff ? diffPath : null,
      diffBytes: hasDiff ? statSync(diffPath).size : null,
      partCounts,
      toolCounts,
      recentText,
      tokensReasoning: Number(raw.tokens_reasoning || 0),
      tokensCacheRead: Number(raw.tokens_cache_read || 0),
      tokensCacheWrite: Number(raw.tokens_cache_write || 0),
      summaryFiles: Number(raw.summary_files || 0),
      summaryAdditions: Number(raw.summary_additions || 0),
      summaryDeletions: Number(raw.summary_deletions || 0),
    };
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

export function listDirectories(options: { dbPath?: string; prefix?: string }): DirectoryRow[] {
  const db = openDb(options.dbPath);
  try {
    const prefix = renderSafe(options.prefix || "").toLowerCase();
    return (db.query(`
      SELECT
        directory,
        SUM(CASE WHEN time_archived IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN time_archived IS NOT NULL THEN 1 ELSE 0 END) AS archived,
        MAX(time_updated) AS latest_updated
      FROM session
      WHERE parent_id IS NULL
      GROUP BY directory
      ORDER BY directory ASC
    `).all() as Array<{ directory?: string; active?: number; archived?: number; latest_updated?: number }>)
      .map(row => ({
        directory: renderSafe(row.directory || ""),
        active: Number(row.active || 0),
        archived: Number(row.archived || 0),
        latestUpdated: Number(row.latest_updated || 0),
      }))
      .filter(row => !prefix || row.directory.toLowerCase().includes(prefix));
  } finally {
    db.close();
  }
}
