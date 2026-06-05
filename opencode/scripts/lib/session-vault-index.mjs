import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const INDEX_VERSION = 1;

export function emptyIndex() {
  return { version: INDEX_VERSION, sessions: [] };
}

export function loadIndex(file) {
  if (!existsSync(file)) return emptyIndex();
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyIndex();
    if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
    if (typeof parsed.version !== 'number') parsed.version = INDEX_VERSION;
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export function upsertSession(index, session) {
  const base = index && Array.isArray(index.sessions) ? index : emptyIndex();
  const sessions = [...base.sessions];
  const idx = sessions.findIndex(s => s && s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...session };
  } else {
    sessions.push({ ...session });
  }
  return { ...base, sessions };
}

export function saveIndex(file, index) {
  const dir = dirname(file);
  if (dir) mkdirSync(dir, { recursive: true });
  const normalized = { version: INDEX_VERSION, sessions: Array.isArray(index?.sessions) ? index.sessions : [] };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return normalized;
}
