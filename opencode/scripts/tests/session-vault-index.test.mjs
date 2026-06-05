import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyIndex, loadIndex, upsertSession, saveIndex } from '../lib/session-vault-index.mjs';

test('loadIndex returns empty structure when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  expect(loadIndex(file)).toEqual(emptyIndex());
});

test('upsertSession inserts and updates by id', () => {
  const first = upsertSession(emptyIndex(), { id: 'ses_1', title: 'First', workspace: '/repo', status: 'active' });
  expect(first.sessions).toHaveLength(1);

  const second = upsertSession(first, { id: 'ses_1', title: 'Renamed', workspace: '/repo', status: 'archived' });
  expect(second.sessions).toHaveLength(1);
  expect(second.sessions[0].title).toBe('Renamed');
  expect(second.sessions[0].status).toBe('archived');
});

test('saveIndex writes normalized JSON atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  saveIndex(file, emptyIndex());
  const raw = readFileSync(file, 'utf8');
  expect(raw).toContain('"version": 1');
});
