#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { emptyIndex, loadIndex, saveIndex } from './lib/session-vault-index.mjs';

export function selectVisibleSessions(index) {
  return [...(index.sessions || [])].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
}

export function classifySearch(sessions, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter(session =>
    `${session.title ?? ''} ${session.workspace ?? ''} ${session.status ?? ''}`.toLowerCase().includes(q),
  );
}

function withSessions(index, sessions) {
  return { ...(index && typeof index === 'object' ? index : emptyIndex()), sessions };
}

export function inspectSession(index, id) {
  const sessions = index?.sessions || [];
  return sessions.find(session => session?.id === id) || null;
}

export function archiveSession(index, id, archivePath) {
  const sessions = [...(index?.sessions || [])];
  const idx = sessions.findIndex(session => session?.id === id);
  if (idx < 0) return withSessions(index, sessions);
  sessions[idx] = { ...sessions[idx], status: 'archived', archive_path: archivePath };
  return withSessions(index, sessions);
}

export function markDeleted(index, id) {
  const sessions = [...(index?.sessions || [])];
  const idx = sessions.findIndex(session => session?.id === id);
  if (idx < 0) return withSessions(index, sessions);
  sessions[idx] = { ...sessions[idx], status: 'deleted' };
  return withSessions(index, sessions);
}

function defaultIndexPath() {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || '.', '.local', 'share');
  return join(base, 'opencode', 'session-vault', 'index.json');
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.main) {
  const [, , cmd, ...rest] = process.argv;

  try {
    if (cmd === 'list') {
      const indexPath = rest[0] ?? defaultIndexPath();
      const index = existsSync(indexPath) ? loadIndex(indexPath) : emptyIndex();
      printJson(selectVisibleSessions(index));
    } else if (cmd === 'search') {
      const [query, indexPathArg] = rest;
      const indexPath = indexPathArg ?? defaultIndexPath();
      const index = existsSync(indexPath) ? loadIndex(indexPath) : emptyIndex();
      printJson(classifySearch(index.sessions, query ?? ''));
    } else if (cmd === 'mark-deleted') {
      const [id, indexPathArg] = rest;
      if (!id) {
        process.stderr.write('mark-deleted requires a session id\n');
        process.exit(1);
      }
      const indexPath = indexPathArg ?? defaultIndexPath();
      const index = loadIndex(indexPath);
      const next = markDeleted(index, id);
      saveIndex(indexPath, next);
      printJson(inspectSession(next, id));
    } else {
      process.stderr.write(`unknown command: ${cmd}\n`);
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`${err?.message || err}\n`);
    process.exit(1);
  }
}
