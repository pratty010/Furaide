import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { capText, hasControlBytes, renderSafe } from "./sanitize.ts";

export type Tab = "active" | "archived";

export type ArchivedMessageRow = {
  role: "user" | "assistant" | "system";
  time: number;
  text: string;
};

export type ActiveMessageRow = {
  role: "user" | "assistant";
  time: number;
  text: string;
};

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(id);
}

function invalidCliResult(id: string): { ok: false; code: number; stderr: string } {
  return { ok: false, code: -2, stderr: `invalid session id: ${renderSafe(id)}` };
}

export function defaultArchivePath(id: string): string {
  if (!isSafeSessionId(id)) throw new Error(`invalid session id: ${renderSafe(id)}`);
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all", "exports", `${id}.json`);
}

export function defaultArchiveRoot(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all", "exports");
}

function opencodeBin(): string {
  return process.env.OPENCODE_ALL_OPENCODE_BIN || "opencode";
}

export function exportSessionToFile(id: string): { ok: boolean; code: number; stderr: string } {
  if (!isSafeSessionId(id)) return invalidCliResult(id);
  const file = defaultArchivePath(id);
  mkdirSync(dirname(file), { recursive: true });
  const result = spawnSync(opencodeBin(), ["export", id], { stdio: ["ignore", "pipe", "pipe"] });
  if (result.status === 0) {
    writeFileSync(file, result.stdout || Buffer.from(""), { mode: 0o600 });
  }
  return { ok: result.status === 0, code: result.status ?? 1, stderr: (result.stderr || "").toString() };
}

export function importSessionFromFile(id: string): { ok: boolean; code: number; stderr: string } {
  if (!isSafeSessionId(id)) return invalidCliResult(id);
  const file = defaultArchivePath(id);
  if (!existsSync(file)) {
    return { ok: false, code: -1, stderr: `archive file not found at ${file}` };
  }
  const result = spawnSync(opencodeBin(), ["import", file], { stdio: "pipe" });
  return { ok: result.status === 0, code: result.status ?? 1, stderr: (result.stderr || "").toString() };
}

export function deleteSessionById(id: string): { ok: boolean; code: number; stderr: string } {
  if (!isSafeSessionId(id)) return invalidCliResult(id);
  const result = spawnSync(opencodeBin(), ["session", "delete", id], { stdio: "pipe" });
  return { ok: result.status === 0, code: result.status ?? 1, stderr: (result.stderr || "").toString() };
}

export function removeArchiveFile(id: string): { ok: boolean; err?: string } {
  if (!isSafeSessionId(id)) return { ok: false, err: `invalid session id: ${renderSafe(id)}` };
  const file = defaultArchivePath(id);
  if (!existsSync(file)) return { ok: true };
  try {
    unlinkSync(file);
    return { ok: true };
  } catch (err) {
    return { ok: false, err: (err as Error).message };
  }
}

export function readRecentMessages(id: string, maxMessages = 200, dbPath = defaultDbPath()): ActiveMessageRow[] {
  if (!isSafeSessionId(id)) return [];
  const db = openDb(dbPath);
  try {
    return (db.query(`
      SELECT json_extract(m.data, '$.role') AS role,
             m.time_created AS time,
             json_extract(p.data, '$.text') AS text
      FROM message m
      JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ?
        AND json_extract(m.data, '$.role') IN ('user', 'assistant')
        AND json_extract(p.data, '$.type') = 'text'
      ORDER BY m.time_created ASC
      LIMIT ?
    `).all(id, maxMessages) as Array<{ role?: string; time?: number; text?: string }>).map(item => ({
      role: (item.role === "user" ? "user" : "assistant") as "user" | "assistant",
      time: Number(item.time || 0),
      text: renderSafe(item.text || ""),
    }));
  } finally {
    db.close();
  }
}

export function readArchivedMessages(id: string, maxMessages = 200): ArchivedMessageRow[] {
  if (!isSafeSessionId(id)) return [];
  const file = defaultArchivePath(id);
  if (!existsSync(file)) return [];
  try {
    const size = statSync(file).size;
    if (size > MAX_ARCHIVE_BYTES) return [{ role: "system", time: 0, text: `archive too large (${size} bytes)` }];
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const messages = Array.isArray(raw?.messages) ? raw.messages : [];
    const rows: ArchivedMessageRow[] = [];
    for (const m of messages) {
      if (rows.length >= maxMessages) break;
      const role = m?.info?.role;
      if (role !== "user" && role !== "assistant") continue;
      const time = Number(m?.info?.time?.created ?? 0);
      const parts = Array.isArray(m?.parts) ? m.parts : [];
      const textPart = parts.find((p: any) => p?.type === "text");
      const text = renderSafe(String(textPart?.text ?? ""));
      rows.push({ role, time, text });
    }
    return rows;
  } catch {
    return [{ role: "system", time: 0, text: "archive corrupt or unreadable" }];
  }
}

export function getArchivedSessionDetail(id: string): (SessionDetail & { archivePath?: string; archiveBytes?: number }) | null {
  if (!isSafeSessionId(id)) return null;
  const file = defaultArchivePath(id);
  if (!existsSync(file)) return null;
  try {
    const stats = statSync(file);
    if (stats.size > MAX_ARCHIVE_BYTES) return null;
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const row = archiveInfoToRow(raw, file, process.env.OPENCODE_ALL_CWD || process.cwd(), Math.trunc(stats.mtimeMs));
    if (!row) return null;
    const messages = Array.isArray(raw?.messages) ? raw.messages.length : 0;
    return {
      ...row,
      messages,
      diffPath: null,
      diffBytes: null,
      partCounts: {},
      toolCounts: [],
      recentText: readArchivedMessages(id, 4).map(m => ({ role: m.role, timeCreated: m.time, text: m.text })),
      tokensReasoning: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      summaryFiles: Number(raw?.info?.summary?.files || 0),
      summaryAdditions: Number(raw?.info?.summary?.additions || 0),
      summaryDeletions: Number(raw?.info?.summary?.deletions || 0),
      archivePath: file,
      archiveBytes: stats.size,
    };
  } catch {
    return null;
  }
}

export function listArchivedSessionFiles(options: { archiveRoot?: string; cwd?: string } = {}): ArchiveFileRow[] {
  const root = options.archiveRoot || defaultArchiveRoot();
  if (!existsSync(root)) return [];
  const cwdValue = options.cwd || process.env.OPENCODE_ALL_CWD || process.cwd();
  const rows: ArchiveFileRow[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!isSafeSessionId(id)) continue;
    const file = join(root, name);
    try {
      const stats = statSync(file);
      if (stats.size > MAX_ARCHIVE_BYTES) continue;
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const row = archiveInfoToRow(raw, file, cwdValue, Math.trunc(stats.mtimeMs));
      if (row) rows.push(row);
    } catch {
      continue;
    }
  }
  return rows.sort((a, b) => b.timeArchived! - a.timeArchived! || b.timeUpdated - a.timeUpdated);
}

export function listActiveSessionsInDir(directory: string): SessionRow[] {
  return listSessions({ tab: "active", cwd: process.env.OPENCODE_ALL_CWD || process.cwd(), directory });
}

export function listArchivedSessionsInDir(directory: string): SessionRow[] {
  return listSessions({ tab: "archived", cwd: process.env.OPENCODE_ALL_CWD || process.cwd(), directory });
}

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

export type ArchiveFileRow = SessionRow & {
  archivePath: string;
  archiveBytes: number;
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

export function archiveInfoToRow(raw: any, archivePath: string, cwdValue: string, archiveTime: number): ArchiveFileRow | null {
  const info = raw?.info;
  if (!info || typeof info !== "object") return null;
  const id = String(info.id || "");
  if (!isSafeSessionId(id)) return null;
  const title = renderSafe(info.title || id);
  const directory = renderSafe(info.directory || "");
  const path = renderSafe(info.path || "");
  const agent = renderSafe(info.agent || "");
  const model = renderSafe(typeof info.model === "string" ? info.model : JSON.stringify(info.model || ""));
  const tokens = info.tokens || {};
  const summary = info.summary || {};
  const stats = statSync(archivePath);
  return {
    id,
    title: capText(title, 240),
    directory: capText(directory, 300),
    path: capText(path, 300),
    agent: capText(agent, 80),
    model: capText(model, 160),
    shareUrl: "",
    cost: Number(info.cost || 0),
    tokensInput: Number(tokens.input || 0),
    tokensOutput: Number(tokens.output || 0),
    timeCreated: Number(info.time?.created || 0),
    timeUpdated: Number(info.time?.updated || 0),
    timeArchived: archiveTime || Math.trunc(stats.mtimeMs),
    isCurrent: directory.startsWith(cwdValue) || path.startsWith(cwdValue),
    suspicious: [info.title, info.directory, info.path, info.agent, info.model].some(hasControlBytes),
    archivePath,
    archiveBytes: stats.size,
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
  if (!isSafeSessionId(options.id)) return null;
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
  if (!isSafeSessionId(options.id)) return;
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

export function activeSessionsMatchingText(query: string, maxResults = 50, dbPath = defaultDbPath(), cwdValue = process.env.OPENCODE_ALL_CWD || process.cwd()): SessionRow[] {
  try {
    const db = openDb(dbPath);
    try {
      const lower = `%${query.toLowerCase()}%`;
      const rows = db.query(`
        SELECT DISTINCT s.id, s.title, s.directory, COALESCE(s.path, '') AS path,
               COALESCE(s.agent, '') AS agent, COALESCE(s.model, '') AS model,
               COALESCE(s.share_url, '') AS share_url,
               s.cost, s.tokens_input, s.tokens_output,
               s.time_created, s.time_updated, s.time_archived
        FROM session s
        LEFT JOIN message m ON m.session_id = s.id
        LEFT JOIN part p ON p.message_id = m.id
        WHERE s.parent_id IS NULL
          AND s.time_archived IS NULL
          AND (
            LOWER(s.title) LIKE ?
            OR LOWER(s.directory) LIKE ?
            OR LOWER(s.path) LIKE ?
            OR LOWER(s.agent) LIKE ?
            OR LOWER(s.model) LIKE ?
            OR LOWER(json_extract(p.data, '$.text')) LIKE ?
          )
        ORDER BY s.time_updated DESC
        LIMIT ?
      `).all(lower, lower, lower, lower, lower, lower, maxResults) as SessionRawRow[];
      return rows.map(raw => toRow(raw, cwdValue));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}
