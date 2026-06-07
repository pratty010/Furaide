import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __test_createVaultHandlers } from '../../plugins/omokage.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'session-vault-plugin-'));
}

function makeStore(dir) {
  const indexPath = join(dir, 'index.json');
  return {
    indexPath,
    read: () => {
      if (!existsSync(indexPath)) return { version: 2, sessions: [] };
      return JSON.parse(readFileSync(indexPath, 'utf8'));
    },
    write: (index) => {
      writeFileSync(indexPath, JSON.stringify(index, null, 2));
    },
  };
}

const SDK_SESSION = {
  id: 'ses_test',
  title: 'Test session',
  createdAt: '2026-06-06T09:00:00.000Z',
  updatedAt: '2026-06-06T10:00:00.000Z',
  path: { root: '/a/repo' },
};

test('session.created upserts active session', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    const handlers = __test_createVaultHandlers({
      store,
      indexPath: store.indexPath,
      client: { session: { get: async () => ({ data: { id: 'ses_test', title: 'Test session', path: { root: '/a/repo' }, createdAt: '2026-06-06T09:00:00.000Z', updatedAt: '2026-06-06T10:00:00.000Z' } }) } },
      now: () => '2026-06-06T09:00:00.000Z',
    });
    await handlers.event({ event: { type: 'session.created', properties: { id: 'ses_test' } } });
    const index = store.read();
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0].id).toBe('ses_test');
    expect(index.sessions[0].status).toBe('active');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session.updated enriches with fresh SDK data', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    store.write({ version: 2, sessions: [{ id: 'ses_test', title: 'Old', workspace: '/a/repo', status: 'active', created_at: '2026-06-06T09:00:00.000Z', updated_at: '2026-06-06T09:00:00.000Z' }] });
    const handlers = __test_createVaultHandlers({
      store,
      indexPath: store.indexPath,
      client: { session: { get: async () => ({ data: { id: 'ses_test', title: 'Updated title', path: { root: '/a/repo' }, createdAt: '2026-06-06T09:00:00.000Z', updatedAt: '2026-06-06T10:00:00.000Z' } }) } },
      now: () => '2026-06-06T10:00:00.000Z',
    });
    await handlers.event({ event: { type: 'session.updated', properties: { id: 'ses_test' } } });
    const index = store.read();
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0].title).toBe('Updated title');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session.idle enriches cost and token fields via SDK', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    store.write({ version: 2, sessions: [{ id: 'ses_test', title: 'Created', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T10:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' }] });
    const handlers = __test_createVaultHandlers({
      store,
      indexPath: store.indexPath,
      client: {
        session: {
          get: async () => ({ data: { id: 'ses_test', title: 'Created', path: '/a/repo', input: 100, output: 50, cost: 0.02, updatedAt: '2026-06-05T10:05:00.000Z' } }),
          messages: async () => ({ data: [{}, {}, {}] }),
        },
      },
      now: () => '2026-06-05T10:05:00.000Z',
    });
    await handlers.event({ event: { type: 'session.idle', properties: { id: 'ses_test' } } });
    const index = store.read();
    expect(index.sessions[0].tokens_in).toBe(100);
    expect(index.sessions[0].tokens_out).toBe(50);
    expect(index.sessions[0].messages_count).toBe(3);
    expect(index.sessions[0].cost).toBe(0.02);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session.deleted archives session instead of removing it', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    store.write({ version: 2, sessions: [{ id: 'ses_test', title: 'Created', workspace: '/a/repo', status: 'active', created_at: '2026-06-05T10:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' }] });
    const handlers = __test_createVaultHandlers({
      store,
      indexPath: store.indexPath,
      client: { session: { get: async () => ({ data: { id: 'ses_test', title: 'Created', path: '/a/repo' } }) } },
      now: () => '2026-06-05T10:05:00.000Z',
    });
    await handlers.event({ event: { type: 'session.deleted', properties: { id: 'ses_test' } } });
    const index = store.read();
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0].status).toBe('archived');
    expect(index.sessions[0].archived_at).toBeTruthy();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent onEvent calls serialize through the write queue', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    const client = {
      session: {
        get: async ({ path }) => ({ data: { id: path.id, title: `Session ${path.id}`, path: { root: '/a/repo' }, createdAt: '2026-06-06T09:00:00.000Z', updatedAt: '2026-06-06T10:00:00.000Z' } }),
      },
    };
    const handlers = __test_createVaultHandlers({ store, indexPath: store.indexPath, client, now: () => '2026-06-06T09:00:00.000Z' });
    const events = Array.from({ length: 10 }, (_, i) => ({
      event: { type: 'session.created', properties: { id: `ses_${i}` } },
    }));
    await Promise.all(events.map(evt => handlers.event(evt)));
    const index = store.read();
    expect(index.sessions).toHaveLength(10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runCommand surfaces errors with code 2 for unknown command', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    const handlers = __test_createVaultHandlers({ store, indexPath: store.indexPath, client: {} });
    const result = await handlers.runCommand(['bogus'], {});
    expect(result.code).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runCommand list with empty index returns No sessions', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    const handlers = __test_createVaultHandlers({ store, indexPath: store.indexPath, client: {} });
    const result = await handlers.runCommand(['list'], {});
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No sessions');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runCommand archive writes archive file and updates index', async () => {
  const dir = tempDir();
  try {
    const store = makeStore(dir);
    store.write({ version: 2, sessions: [{ id: 'ses_test', title: 'Test', workspace: '/a/repo', status: 'active', created_at: '2026-06-06T09:00:00.000Z', updated_at: '2026-06-06T10:00:00.000Z' }] });
    const handlers = __test_createVaultHandlers({ store, indexPath: store.indexPath, client: {} });
    const result = await handlers.runCommand(['archive', 'ses_test'], { env: { ...process.env, SESSION_VAULT_ARCHIVE_DIR: join(dir, 'archive') } });
    expect(result.code).toBe(0);
    const index = store.read();
    expect(index.sessions[0].status).toBe('archived');
    expect(index.sessions[0].archive_path).toBeTruthy();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});