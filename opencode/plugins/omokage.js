import { homedir } from 'node:os';
import { join } from 'node:path';
import { archiveSession as archiveLibSession, loadIndex, saveIndex, upsertSession } from '../scripts/lib/session-vault-index.mjs';

function defaultIndexPath() {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || homedir(), '.local', 'share');
  return join(base, 'opencode', 'session-vault', 'index.json');
}

function createStore(file = defaultIndexPath()) {
  return {
    read: () => loadIndex(file),
    write: index => saveIndex(file, index),
  };
}

function eventSessionId(event) {
  return event?.properties?.id || event?.properties?.sessionID || event?.properties?.session?.id || null;
}

function sdkData(response) {
  return response?.data || response || {};
}

function sessionRecord(session, fallback = {}) {
  return {
    id: String(session.id || fallback.id || ''),
    title: session.title,
    workspace: session.workspace || session.path?.root || session.path,
    model: session.model || session.modelID || session.model_id,
    tokens_in: Number.isFinite(session.tokens_in) ? session.tokens_in : Number.isFinite(session.input) ? session.input : undefined,
    tokens_out: Number.isFinite(session.tokens_out) ? session.tokens_out : Number.isFinite(session.output) ? session.output : undefined,
    cost: Number.isFinite(session.cost) ? session.cost : undefined,
    created_at: session.created_at || session.createdAt,
    updated_at: session.updated_at || session.updatedAt,
    status: 'active',
  };
}

async function fetchSession(client, id) {
  if (!client?.session?.get || !id) return { id };
  try {
    return sdkData(await client.session.get({ path: { id } }));
  } catch {
    return { id };
  }
}

async function fetchMessageCount(client, id) {
  if (!client?.session?.messages || !id) return null;
  try {
    const response = sdkData(await client.session.messages({ path: { id } }));
    return Array.isArray(response) ? response.length : null;
  } catch {
    return null;
  }
}

export function __test_createVaultHandlers({ store, client, archiveSession: archiveFn, now = () => new Date().toISOString(), indexPath }) {
  const writeQueue = { current: Promise.resolve() };
  const enqueue = fn => {
    writeQueue.current = writeQueue.current.then(fn, fn);
    return writeQueue.current;
  };

  async function upsertFromSdk(id, extra = {}) {
    const sdkSession = await fetchSession(client, id);
    const messagesCount = extra.includeMessages ? await fetchMessageCount(client, id) : undefined;
    return enqueue(async () => {
      const index = store.read();
      const next = upsertSession(index, {
        ...sessionRecord(sdkSession, { id }),
        messages_count: Number.isFinite(messagesCount) ? messagesCount : undefined,
        updated_at: sdkSession.updatedAt || sdkSession.updated_at || now(),
      });
      store.write(next);
    });
  }

  return {
    event: async ({ event }) => {
      const id = eventSessionId(event);
      if (!id) return;
      if (event.type === 'session.created' || event.type === 'session.updated') return upsertFromSdk(id);
      if (event.type === 'session.idle') return upsertFromSdk(id, { includeMessages: true });
      if (event.type === 'session.deleted') {
        return enqueue(async () => {
          const index = store.read();
          const next = archiveFn ? archiveFn(index, id) : archiveLibSession(index, id, null, now());
          store.write(next);
        });
      }
    },
    runCommand: async (argv, runCtx = {}) => {
      if (!indexPath) return { code: 1, stdout: '', stderr: 'no indexPath configured\n' };
      const { runSessionVaultCommand } = await import('../scripts/session-vault.mjs');
      return runSessionVaultCommand(argv, { ...runCtx, indexPath, env: runCtx.env || process.env });
    },
  };
}

export default async function SessionVaultPlugin({ client }) {
  const store = createStore();
  const handlers = __test_createVaultHandlers({ store, client });
  try {
    if (client?.session?.list) {
      const response = sdkData(await client.session.list());
      const sessions = Array.isArray(response) ? response : [];
      let index = store.read();
      for (const session of sessions) index = upsertSession(index, sessionRecord(session));
      if (sessions.length > 0) store.write(index);
    }
  } catch {
    // Keep opencode startup resilient if refresh cannot reach the SDK.
  }
  return handlers;
}