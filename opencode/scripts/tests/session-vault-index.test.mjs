import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INDEX_VERSION,
  archiveSession,
  emptyIndex,
  loadIndex,
  removeSession,
  restoreSession,
  saveIndex,
  upsertSession,
} from '../lib/session-vault-index.mjs';

test('loadIndex returns empty v2 structure when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  expect(loadIndex(file)).toEqual(emptyIndex());
  expect(INDEX_VERSION).toBe(2);
});

test('loadIndex migrates v1 sessions to v2 defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      sessions: [{ id: 'ses_1', title: 'Old', workspace: '/repo', status: 'deleted', updated_at: '2026-06-05T10:00:00.000Z' }],
    }),
  );

  const index = loadIndex(file);
  expect(index.version).toBe(2);
  expect(index.sessions[0]).toEqual({
    id: 'ses_1',
    title: 'Old',
    workspace: '/repo',
    status: 'archived',
    model: null,
    tokens_in: null,
    tokens_out: null,
    messages_count: null,
    cost: null,
    created_at: '2026-06-05T10:00:00.000Z',
    updated_at: '2026-06-05T10:00:00.000Z',
    archived_at: null,
    archive_path: null,
  });
});

test('upsertSession inserts and updates normalized records by id', () => {
  const first = upsertSession(emptyIndex(), { id: 'ses_1', title: 'First', workspace: '/repo', status: 'active' });
  expect(first.sessions).toHaveLength(1);
  expect(first.sessions[0].status).toBe('active');
  expect(first.sessions[0].model).toBeNull();

  const second = upsertSession(first, { id: 'ses_1', title: 'Renamed', model: 'opencode-go/glm-5.1' });
  expect(second.sessions).toHaveLength(1);
  expect(second.sessions[0].title).toBe('Renamed');
  expect(second.sessions[0].model).toBe('opencode-go/glm-5.1');
  expect(second.sessions[0].status).toBe('active');
});

test('archiveSession marks active session archived with path and timestamp', () => {
  const index = upsertSession(emptyIndex(), { id: 'ses_1', title: 'First', workspace: '/repo', status: 'active' });
  const next = archiveSession(index, 'ses_1', '/tmp/archive/ses_1.json', '2026-06-05T12:00:00.000Z');
  expect(next.sessions[0].status).toBe('archived');
  expect(next.sessions[0].archive_path).toBe('/tmp/archive/ses_1.json');
  expect(next.sessions[0].archived_at).toBe('2026-06-05T12:00:00.000Z');
});

test('restoreSession returns archived session to active and clears archive metadata', () => {
  const archived = {
    version: 2,
    sessions: [{
      id: 'ses_1', title: 'First', workspace: '/repo', status: 'archived', model: null,
      tokens_in: null, tokens_out: null, messages_count: null, cost: null,
      created_at: '2026-06-05T10:00:00.000Z', updated_at: '2026-06-05T12:00:00.000Z',
      archived_at: '2026-06-05T12:00:00.000Z', archive_path: '/tmp/archive/ses_1.json',
    }],
  };

  const next = restoreSession(archived, 'ses_1');
  expect(next.sessions[0].status).toBe('active');
  expect(next.sessions[0].archive_path).toBeNull();
  expect(next.sessions[0].archived_at).toBeNull();
});

test('removeSession removes matching session from index', () => {
  const index = {
    version: 2,
    sessions: [
      { id: 'ses_1', title: 'One', workspace: '/a', status: 'active' },
      { id: 'ses_2', title: 'Two', workspace: '/b', status: 'active' },
    ],
  };
  const next = removeSession(index, 'ses_1');
  expect(next.sessions.map(session => session.id)).toEqual(['ses_2']);
});

test('saveIndex writes normalized v2 JSON atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  saveIndex(file, emptyIndex());
  const raw = readFileSync(file, 'utf8');
  expect(raw).toContain('"version": 2');
});
