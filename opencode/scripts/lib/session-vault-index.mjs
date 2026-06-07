import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const INDEX_VERSION = 2;

export function emptyIndex() {
  return { version: INDEX_VERSION, sessions: [] };
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizeSession(session = {}) {
  const updatedAt = session.updated_at || session.updatedAt || session.time?.updated || nowIso();
  const createdAt = session.created_at || session.createdAt || session.time?.created || updatedAt;
  const rawStatus = session.status === 'archived' ? 'archived' : session.status === 'deleted' ? 'archived' : 'active';

  return {
    id: String(session.id || ''),
    title: session.title || `Session ${createdAt}`,
    workspace: session.workspace || session.path?.root || session.path || process.cwd(),
    status: rawStatus,
    model: session.model || session.model_id || null,
    tokens_in: Number.isFinite(session.tokens_in) ? session.tokens_in : Number.isFinite(session.input) ? session.input : null,
    tokens_out: Number.isFinite(session.tokens_out) ? session.tokens_out : Number.isFinite(session.output) ? session.output : null,
    messages_count: Number.isFinite(session.messages_count) ? session.messages_count : null,
    cost: Number.isFinite(session.cost) ? session.cost : null,
    created_at: createdAt,
    updated_at: updatedAt,
    archived_at: session.archived_at || null,
    archive_path: session.archive_path || null,
  };
}

function normalizeIndex(index) {
  if (!index || typeof index !== 'object') return emptyIndex();
  const sessions = Array.isArray(index.sessions)
    ? index.sessions.filter(session => session && session.id).map(normalizeSession)
    : [];
  return { version: INDEX_VERSION, sessions };
}

export function loadIndex(file) {
  if (!existsSync(file)) return emptyIndex();
  try {
    return normalizeIndex(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return emptyIndex();
  }
}

export function upsertSession(index, session) {
  const base = normalizeIndex(index);
  const sessions = [...base.sessions];
  const idx = sessions.findIndex(item => item.id === session.id);
  if (idx >= 0) {
    sessions[idx] = normalizeSession({ ...sessions[idx], ...session });
  } else {
    sessions.push(normalizeSession(session));
  }
  return { ...base, sessions };
}

export function archiveSession(index, id, archivePath, archivedAt = nowIso()) {
  const base = normalizeIndex(index);
  return {
    ...base,
    sessions: base.sessions.map(session => session.id === id
      ? normalizeSession({ ...session, status: 'archived', archive_path: archivePath, archived_at: archivedAt, updated_at: archivedAt })
      : session),
  };
}

export function restoreSession(index, id) {
  const base = normalizeIndex(index);
  return {
    ...base,
    sessions: base.sessions.map(session => session.id === id
      ? normalizeSession({ ...session, status: 'active', archive_path: null, archived_at: null, updated_at: nowIso() })
      : session),
  };
}

export function removeSession(index, id) {
  const base = normalizeIndex(index);
  return { ...base, sessions: base.sessions.filter(session => session.id !== id) };
}

export function saveIndex(file, index) {
  const dir = dirname(file);
  if (dir) mkdirSync(dir, { recursive: true });
  const normalized = normalizeIndex(index);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return normalized;
}
