import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archivePathFor,
  archiveVaultSession,
  classifySearch,
  deleteVaultSession,
  filterSessions,
  formatTable,
  formatTimestamp,
  restoreVaultSession,
  selectVisibleSessions,
  showVaultSession,
} from '../session-vault.mjs';

const TEMP_PREFIX = join(tmpdir(), 'session-vault-helper-');

const FIXTURE = {
  sessions: [
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', tokens_in: 1200, tokens_out: 300, messages_count: 8, cost: 0.04, created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z', model: 'opencode-go/glm-5.1', archive_path: null, archived_at: null },
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', tokens_in: null, tokens_out: null, messages_count: null, cost: null, created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', model: null, archive_path: '/archive/ses_2.json', archived_at: '2026-06-04T11:00:00.000Z' },
  ],
};

test('selectVisibleSessions sorts recent first', () => {
  expect(selectVisibleSessions(FIXTURE)[0].id).toBe('ses_1');
});

test('filterSessions defaults to active sessions', () => {
  expect(filterSessions(FIXTURE.sessions, {}).map(session => session.id)).toEqual(['ses_1']);
});

test('filterSessions supports --all, status, and workspace filters', () => {
  expect(filterSessions(FIXTURE.sessions, { all: true }).map(session => session.id)).toEqual(['ses_1', 'ses_2']);
  expect(filterSessions(FIXTURE.sessions, { status: 'archived' }).map(session => session.id)).toEqual(['ses_2']);
  expect(filterSessions(FIXTURE.sessions, { all: true, workspace: 'brand' }).map(session => session.id)).toEqual(['ses_2']);
});

test('classifySearch filters by id, title, workspace, and model', () => {
  expect(classifySearch(FIXTURE.sessions, 'installer').map(session => session.id)).toEqual(['ses_1']);
  expect(classifySearch(FIXTURE.sessions, 'ses_2').map(session => session.id)).toEqual(['ses_2']);
  expect(classifySearch(FIXTURE.sessions, 'glm').map(session => session.id)).toEqual(['ses_1']);
});

test('formatTimestamp returns readable local-ish timestamp and dash for missing values', () => {
  expect(formatTimestamp(null)).toBe('-');
  expect(formatTimestamp('2026-06-05T10:00:00.000Z')).toMatch(/^2026-06-05 \d{2}:\d{2}$/);
});

test('formatTable renders header, row numbers, metrics, and archived rows', () => {
  const table = formatTable(FIXTURE.sessions);
  expect(table).toContain('| # | ID');
  expect(table).toContain('| 1 | ses_1');
  expect(table).toContain('1,500');
  expect(table).toContain('| 2 | ses_2');
  expect(table).toContain('archived');
});

test('archivePathFor uses env override before default vault archive directory', () => {
  expect(archivePathFor('ses_1', { SESSION_VAULT_ARCHIVE_DIR: '/tmp/vault-archive' })).toBe('/tmp/vault-archive/ses_1.json');
});

test('showVaultSession returns active session with default and detailed fields', () => {
  const session = showVaultSession(FIXTURE, 'ses_1');
  expect(session.id).toBe('ses_1');
  expect(session.title).toBe('Fix installer');
  expect(session.status).toBe('active');
});

test('showVaultSession returns archived session with archive_path and archived_at', () => {
  const session = showVaultSession(FIXTURE, 'ses_2');
  expect(session.status).toBe('archived');
  expect(session.archive_path).toBe('/archive/ses_2.json');
});

test('showVaultSession throws when session not found', () => {
  expect(() => showVaultSession(FIXTURE, 'ses_missing')).toThrow(/not found/);
});

test('archiveVaultSession writes archive file, updates index, and persists', () => {
  const dir = mkdtempSync(TEMP_PREFIX);
  const indexPath = join(dir, 'index.json');
  const env = { SESSION_VAULT_ARCHIVE_DIR: join(dir, 'archive') };
  try {
    const session = archiveVaultSession(FIXTURE, 'ses_1', indexPath, env);
    expect(session.status).toBe('archived');
    expect(session.archive_path.endsWith('ses_1.json')).toBe(true);
    expect(existsSync(session.archive_path)).toBe(true);
    const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
    const persisted = stored.sessions.find(s => s.id === 'ses_1');
    expect(persisted.status).toBe('archived');
    expect(persisted.archive_path).toBe(session.archive_path);
    expect(persisted.archived_at).toBeTruthy();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archiveVaultSession is idempotent when session is already archived', () => {
  const dir = mkdtempSync(TEMP_PREFIX);
  const indexPath = join(dir, 'index.json');
  const env = { SESSION_VAULT_ARCHIVE_DIR: join(dir, 'archive') };
  try {
    const first = archiveVaultSession(FIXTURE, 'ses_2', indexPath, env);
    const second = archiveVaultSession(FIXTURE, 'ses_2', indexPath, env);
    expect(second.archive_path).toBe(first.archive_path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restoreVaultSession clears archive fields and updates index', () => {
  const dir = mkdtempSync(TEMP_PREFIX);
  const indexPath = join(dir, 'index.json');
  const env = { SESSION_VAULT_ARCHIVE_DIR: join(dir, 'archive') };
  try {
    const restored = restoreVaultSession(FIXTURE, 'ses_2', indexPath);
    expect(restored.status).toBe('active');
    expect(restored.archive_path).toBeNull();
    expect(restored.archived_at).toBeNull();
    const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
    const persisted = stored.sessions.find(s => s.id === 'ses_2');
    expect(persisted.status).toBe('active');
    expect(persisted.archive_path).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteVaultSession removes session from index without deleting archive', () => {
  const dir = mkdtempSync(TEMP_PREFIX);
  const indexPath = join(dir, 'index.json');
  try {
    const archiveFile = join(dir, 'archive', 'ses_2.json');
    mkdirSync(join(dir, 'archive'), { recursive: true });
    writeFileSync(archiveFile, '{"snapshot": true}');
    const localFixture = {
      sessions: [
        { ...FIXTURE.sessions[1], archive_path: archiveFile },
      ],
    };
    const result = deleteVaultSession(localFixture, 'ses_2', indexPath);
    expect(result.removed).toBe(true);
    expect(result.archive_preserved).toBe(true);
    const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(stored.sessions.find(s => s.id === 'ses_2')).toBeUndefined();
    expect(existsSync(archiveFile)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
