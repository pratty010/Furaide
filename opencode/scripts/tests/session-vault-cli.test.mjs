import { test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCommandArgs, runSessionVaultCommand } from '../session-vault.mjs';

let dir;
let indexPath;
let env;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-vault-cli-'));
  indexPath = join(dir, 'index.json');
  env = { ...process.env, SESSION_VAULT_ARCHIVE_DIR: join(dir, 'archive') };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(sessions) {
  writeFileSync(indexPath, JSON.stringify({ version: 2, sessions }, null, 2));
}

test('runSessionVaultCommand list returns active sessions as table by default', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: '/archive/ses_2.json' },
  ]);
  const result = await runSessionVaultCommand(['list'], { env, indexPath });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('| 1 | ses_1');
  expect(result.stdout).not.toContain('ses_2');
});

test('runSessionVaultCommand list --all includes archived sessions', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: '/archive/ses_2.json' },
  ]);
  const result = await runSessionVaultCommand(['list', '--all'], { env, indexPath });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('ses_1');
  expect(result.stdout).toContain('ses_2');
});

test('runSessionVaultCommand list --format json emits JSON array', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
  ]);
  const result = await runSessionVaultCommand(['list', '--format', 'json'], { env, indexPath });
  expect(result.code).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed[0].id).toBe('ses_1');
});

test('runSessionVaultCommand list --workspace filters by substring', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: '/archive/ses_2.json' },
  ]);
  const result = await runSessionVaultCommand(['list', '--all', '--workspace', 'brand'], { env, indexPath });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('ses_2');
  expect(result.stdout).not.toContain('ses_1');
});

test('runSessionVaultCommand show returns session detail', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', tokens_in: 1200, tokens_out: 300, messages_count: 8, cost: 0.04, created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z', model: 'opencode-go/glm-5.1' },
  ]);
  const result = await runSessionVaultCommand(['show', 'ses_1'], { env, indexPath });
  expect(result.code).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.id).toBe('ses_1');
  expect(parsed.title).toBe('Fix installer');
  expect(parsed.status).toBe('active');
});

test('runSessionVaultCommand show on missing session returns code 1', async () => {
  seed([]);
  const result = await runSessionVaultCommand(['show', 'ses_missing'], { env, indexPath });
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/not found/);
});

test('runSessionVaultCommand archive writes archive file and updates index', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
  ]);
  const result = await runSessionVaultCommand(['archive', 'ses_1'], { env, indexPath });
  expect(result.code).toBe(0);
  const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
  const persisted = stored.sessions.find(s => s.id === 'ses_1');
  expect(persisted.status).toBe('archived');
  expect(existsSync(persisted.archive_path)).toBe(true);
});

test('runSessionVaultCommand restore clears archive fields and returns code 0', async () => {
  seed([
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: '/archive/ses_2.json', archived_at: '2026-06-04T11:00:00.000Z' },
  ]);
  const result = await runSessionVaultCommand(['restore', 'ses_2'], { env, indexPath });
  expect(result.code).toBe(0);
  const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
  const persisted = stored.sessions.find(s => s.id === 'ses_2');
  expect(persisted.status).toBe('active');
  expect(persisted.archive_path).toBeNull();
});

test('runSessionVaultCommand delete removes session from index, preserves archive file', async () => {
  const archiveFile = join(dir, 'archive', 'ses_2.json');
  mkdirSync(join(dir, 'archive'), { recursive: true });
  writeFileSync(archiveFile, '{"snapshot":true}');
  seed([
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: archiveFile, archived_at: '2026-06-04T11:00:00.000Z' },
  ]);
  const result = await runSessionVaultCommand(['delete', 'ses_2'], { env, indexPath });
  expect(result.code).toBe(0);
  const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
  expect(stored.sessions.find(s => s.id === 'ses_2')).toBeUndefined();
  expect(existsSync(archiveFile)).toBe(true);
});

test('runSessionVaultCommand search filters by query and returns matches', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: '/archive/ses_2.json' },
  ]);
  const result = await runSessionVaultCommand(['search', 'installer'], { env, indexPath });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('ses_1');
  expect(result.stdout).not.toContain('ses_2');
});

test('runSessionVaultCommand refresh returns code 0 and persists refreshed sessions', async () => {
  seed([
    { id: 'ses_1', title: 'Old title', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
  ]);
  const fetcher = async () => [{ id: 'ses_1', title: 'New title', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T11:00:00.000Z', model: 'opencode-go/glm-5.1' }];
  const result = await runSessionVaultCommand(['refresh'], { env, indexPath, fetcher });
  expect(result.code).toBe(0);
  const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
  expect(stored.sessions[0].title).toBe('New title');
});

test('runSessionVaultCommand continue returns code 0 and target session id', async () => {
  seed([
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
  ]);
  const tuiSwitcher = async () => ({ switched: true });
  const result = await runSessionVaultCommand(['continue', 'ses_1'], { env, indexPath, tuiSwitcher });
  expect(result.code).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.id).toBe('ses_1');
  expect(parsed.switched).toBe(true);
});

test('runSessionVaultCommand unknown command returns code 2 with stderr', async () => {
  const result = await runSessionVaultCommand(['bogus'], { env, indexPath });
  expect(result.code).toBe(2);
  expect(result.stderr).toMatch(/unknown command/);
});

test('runSessionVaultCommand refresh preserves archived sessions omitted by fetcher', async () => {
  seed([
    { id: 'ses_archived', title: 'Old work', workspace: '/old', status: 'archived', created_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T01:00:00.000Z', archive_path: join(dir, 'archive', 'ses_archived.json'), archived_at: '2026-05-02T00:00:00.000Z' },
  ]);
  const fetcher = async () => [
    { id: 'ses_active', title: 'New', workspace: '/new', status: 'active', created_at: '2026-06-06T00:00:00.000Z', updated_at: '2026-06-06T01:00:00.000Z' },
  ];
  const result = await runSessionVaultCommand(['refresh'], { env, indexPath, fetcher });
  expect(result.code).toBe(0);
  const stored = JSON.parse(readFileSync(indexPath, 'utf8'));
  const archived = stored.sessions.find(s => s.id === 'ses_archived');
  expect(archived).toBeTruthy();
  expect(archived.status).toBe('archived');
  expect(archived.archive_path).toBe(join(dir, 'archive', 'ses_archived.json'));
  const active = stored.sessions.find(s => s.id === 'ses_active');
  expect(active).toBeTruthy();
  expect(active.status).toBe('active');
  const parsed = JSON.parse(result.stdout);
  expect(parsed.refreshed).toBe(1);
  expect(parsed.preserved_archived).toBe(1);
});

test('runSessionVaultCommand list --status active filters by status', async () => {
  seed([
    { id: 'ses_a', title: 'A', workspace: '/a', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_b', title: 'B', workspace: '/b', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: '/archive/ses_b.json' },
    { id: 'ses_c', title: 'C', workspace: '/c', status: 'active', created_at: '2026-06-03T09:00:00.000Z', updated_at: '2026-06-03T10:00:00.000Z' },
  ]);
  const result = await runSessionVaultCommand(['list', '--all', '--status', 'active'], { env, indexPath });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('ses_a');
  expect(result.stdout).toContain('ses_c');
  expect(result.stdout).not.toContain('ses_b');
});

test('runSessionVaultCommand list --limit caps the number of rows', async () => {
  seed([
    { id: 'ses_a', title: 'A', workspace: '/a', status: 'active', created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_b', title: 'B', workspace: '/b', status: 'active', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z' },
    { id: 'ses_c', title: 'C', workspace: '/c', status: 'active', created_at: '2026-06-03T09:00:00.000Z', updated_at: '2026-06-03T10:00:00.000Z' },
  ]);
  const result = await runSessionVaultCommand(['list', '--limit', '2'], { env, indexPath });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('| 1 |');
  expect(result.stdout).toContain('| 2 |');
  expect(result.stdout).not.toContain('| 3 |');
});

test('parseCommandArgs handles --flag=value form and accumulators', () => {
  const result = parseCommandArgs(['list', '--all', '--format=json', 'ses_1', 'ses_2']);
  expect(result.command).toBe('list');
  expect(result.flags.all).toBe(true);
  expect(result.flags.format).toBe('json');
  expect(result.flags._positional).toEqual(['ses_1', 'ses_2']);
});

test('parseCommandArgs returns undefined command for empty argv', () => {
  const result = parseCommandArgs([]);
  expect(result.command).toBeUndefined();
  expect(result.flags._positional).toEqual([]);
});
