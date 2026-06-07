#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadIndex, normalizeSession, saveIndex, upsertSession } from './lib/session-vault-index.mjs';

export function selectVisibleSessions(index) {
  return [...(index.sessions || [])].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
}

export function filterSessions(sessions, options = {}) {
  return sessions.filter(session => {
    if (!options.all && !options.status && session.status !== 'active') return false;
    if (options.status && session.status !== options.status) return false;
    if (options.workspace && !String(session.workspace || '').toLowerCase().includes(String(options.workspace).toLowerCase())) return false;
    return true;
  });
}

export function classifySearch(sessions, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter(session => `${session.id ?? ''} ${session.title ?? ''} ${session.workspace ?? ''} ${session.status ?? ''} ${session.model ?? ''}`.toLowerCase().includes(q));
}

export function formatTimestamp(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function metric(value) {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '-';
}

function cost(value) {
  return Number.isFinite(value) ? `$${value.toFixed(3)}` : '-';
}

function tokens(session) {
  const total = (Number.isFinite(session.tokens_in) ? session.tokens_in : 0) + (Number.isFinite(session.tokens_out) ? session.tokens_out : 0);
  return total > 0 ? total.toLocaleString('en-US') : '-';
}

export function formatTable(sessions) {
  const rows = [
    ['#', 'ID', 'Title', 'Workspace', 'Tokens', 'Msgs', 'Cost', 'Status', 'Created', 'Updated'],
    ...sessions.map((session, idx) => [
      String(idx + 1),
      session.id || '-',
      session.title || '-',
      session.workspace || '-',
      tokens(session),
      metric(session.messages_count),
      cost(session.cost),
      session.status || '-',
      formatTimestamp(session.created_at),
      formatTimestamp(session.updated_at),
    ]),
  ];
  const widths = rows[0].map((_, col) => Math.max(...rows.map(row => String(row[col]).length)));
  const render = row => `| ${row.map((cell, col) => String(cell).padEnd(widths[col])).join(' | ')} |`;
  const divider = `|${widths.map(width => '-'.repeat(width + 2)).join('|')}|`;
  return [render(rows[0]), divider, ...rows.slice(1).map(render)].join('\n');
}

export function archivePathFor(id, env = process.env) {
  const base = env.SESSION_VAULT_ARCHIVE_DIR || join(homedir(), '.local', 'share', 'opencode', 'session-vault', 'archive');
  return join(base, `${id}.json`);
}

export function showVaultSession(index, id) {
  const session = (index.sessions || []).find(s => s.id === id);
  if (!session) throw new Error(`session ${id} not found`);
  return session;
}

export function archiveVaultSession(index, id, indexPath, env = process.env) {
  const session = showVaultSession(index, id);
  if (session.status === 'archived' && session.archive_path) {
    return session;
  }
  const target = archivePathFor(id, env);
  const payload = { ...session, status: 'archived', archive_path: target, archived_at: new Date().toISOString() };
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(payload, null, 2));
  }
  const entry = index.sessions.find(s => s.id === id);
  if (entry) {
    entry.status = 'archived';
    entry.archive_path = target;
    entry.archived_at = payload.archived_at;
  } else {
    index.sessions.push(payload);
  }
  saveIndex(indexPath, index);
  return payload;
}

export function restoreVaultSession(index, id, indexPath) {
  const session = showVaultSession(index, id);
  const entry = index.sessions.find(s => s.id === id);
  if (entry) {
    entry.status = 'active';
    entry.archive_path = null;
    entry.archived_at = null;
  }
  saveIndex(indexPath, index);
  return { ...session, status: 'active', archive_path: null, archived_at: null };
}

export function deleteVaultSession(index, id, indexPath) {
  const session = showVaultSession(index, id);
  const archivePath = session.archive_path;
  const before = index.sessions.length;
  index.sessions = index.sessions.filter(s => s.id !== id);
  saveIndex(indexPath, index);
  return { removed: index.sessions.length < before, archive_preserved: Boolean(archivePath && existsSync(archivePath)) };
}

function defaultIndexPath(env = process.env) {
  const base = env.XDG_DATA_HOME || join(env.HOME || '.', '.local', 'share');
  return join(base, 'opencode', 'session-vault', 'index.json');
}

export function parseCommandArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') flags.all = true;
    else if (arg === '--status' && i + 1 < args.length) { flags.status = args[++i]; }
    else if (arg.startsWith('--status=')) flags.status = arg.slice('--status='.length);
    else if (arg === '--workspace' && i + 1 < args.length) { flags.workspace = args[++i]; }
    else if (arg.startsWith('--workspace=')) flags.workspace = arg.slice('--workspace='.length);
    else if (arg === '--format' && i + 1 < args.length) { flags.format = args[++i]; }
    else if (arg.startsWith('--format=')) flags.format = arg.slice('--format='.length);
    else if (arg === '--limit' && i + 1 < args.length) { flags.limit = Number(args[++i]); }
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.slice('--limit='.length));
    else if (arg === '--json') flags.format = 'json';
    else if (!flags._positional) flags._positional = [arg];
    else flags._positional.push(arg);
  }
  flags._positional = flags._positional || [];
  return { command, flags };
}

export async function runSessionVaultCommand(argv, ctx = {}) {
  const env = ctx.env || process.env;
  const indexPath = ctx.indexPath || defaultIndexPath(env);
  const { command, flags } = parseCommandArgs(argv);
  const format = flags.format || 'table';
  const writeJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const writeText = (text) => text.endsWith('\n') ? text : `${text}\n`;

  try {
    if (command === 'list') {
      const index = loadIndex(indexPath);
      const visible = selectVisibleSessions(index);
      const filtered = filterSessions(visible, flags);
      const limit = Number.isFinite(flags.limit) ? flags.limit : null;
      const limited = limit ? filtered.slice(0, limit) : filtered;
      if (format === 'json') {
        return { code: 0, stdout: writeJson(limited), stderr: '' };
      }
      if (limited.length === 0) {
        return { code: 0, stdout: 'No sessions in vault.\n', stderr: '' };
      }
      return { code: 0, stdout: writeText(formatTable(limited)), stderr: '' };
    }

    if (command === 'search') {
      const index = loadIndex(indexPath);
      const matches = classifySearch(index.sessions || [], flags._positional[0] || '');
      const visible = matches.slice().sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
      if (format === 'json') {
        return { code: 0, stdout: writeJson(visible), stderr: '' };
      }
      if (visible.length === 0) {
        return { code: 0, stdout: 'No matches.\n', stderr: '' };
      }
      return { code: 0, stdout: writeText(formatTable(visible)), stderr: '' };
    }

    if (command === 'show') {
      const id = flags._positional[0];
      if (!id) return { code: 1, stdout: '', stderr: 'show requires a session id\n' };
      const index = loadIndex(indexPath);
      const session = showVaultSession(index, id);
      return { code: 0, stdout: writeJson(session), stderr: '' };
    }

    if (command === 'archive') {
      const id = flags._positional[0];
      if (!id) return { code: 1, stdout: '', stderr: 'archive requires a session id\n' };
      const index = loadIndex(indexPath);
      const session = archiveVaultSession(index, id, indexPath, env);
      return { code: 0, stdout: writeJson(session), stderr: '' };
    }

    if (command === 'restore') {
      const id = flags._positional[0];
      if (!id) return { code: 1, stdout: '', stderr: 'restore requires a session id\n' };
      const index = loadIndex(indexPath);
      const session = restoreVaultSession(index, id, indexPath);
      return { code: 0, stdout: writeJson(session), stderr: '' };
    }

    if (command === 'delete') {
      const id = flags._positional[0];
      if (!id) return { code: 1, stdout: '', stderr: 'delete requires a session id\n' };
      const index = loadIndex(indexPath);
      const result = deleteVaultSession(index, id, indexPath);
      return { code: 0, stdout: writeJson(result), stderr: '' };
    }

    if (command === 'refresh') {
      const fetcher = ctx.fetcher || (async () => {
        const { createSdkClient } = await import('@opencode-ai/sdk');
        const client = await createSdkClient();
        const list = await client.session.list();
        return list.data || [];
      });
      const fetched = await fetcher();
      let current = loadIndex(indexPath);
      const fetchedIds = new Set();
      for (const raw of fetched) {
        const normalized = normalizeSession(raw);
        const existing = current.sessions.find(s => s.id === normalized.id);
        if (existing && existing.status === 'archived') {
          fetchedIds.add(normalized.id);
          continue;
        }
        current = upsertSession(current, normalized);
        fetchedIds.add(normalized.id);
      }
      saveIndex(indexPath, current);
      const preservedArchived = current.sessions.filter(s => s.status === 'archived').length;
      return { code: 0, stdout: writeJson({ refreshed: fetched.length, preserved_archived: preservedArchived }), stderr: '' };
    }

    if (command === 'continue') {
      const id = flags._positional[0];
      if (!id) return { code: 1, stdout: '', stderr: 'continue requires a session id\n' };
      const index = loadIndex(indexPath);
      const session = showVaultSession(index, id);
      const switcher = ctx.tuiSwitcher || (async () => {
        const { createSdkClient } = await import('@opencode-ai/sdk');
        const client = await createSdkClient();
        try {
          await client.tui.executeCommand({ body: { command: `session switch ${id}` } });
          return { switched: true };
        } catch {
          return { switched: false, fallback: `opencode --session ${id}` };
        }
      });
      const result = await switcher();
      return { code: 0, stdout: writeJson({ id: session.id, ...result }), stderr: '' };
    }

    return { code: 2, stdout: '', stderr: `unknown command: ${command}\n` };
  } catch (err) {
    return { code: 1, stdout: '', stderr: `${err?.message || err}\n` };
  }
}

if (import.meta.main) {
  const result = await runSessionVaultCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}
