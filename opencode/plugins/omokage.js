import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;

export function __test_syncHookFor(ctx) {
  return async function sessionCloseHook() {
    const sessionId = ctx.getSessionId();
    if (sessionId) return ctx.syncSession(sessionId);
    return ctx.syncNew();
  };
}

function runHelper(args) {
  const script = join(FLEET_ROOT, 'scripts', 'session-vault.mjs');
  execFileSync('bun', [script, ...args], { stdio: 'ignore' });
}

const hook = __test_syncHookFor({
  getSessionId: () => process.env.OPENCODE_SESSION_ID || null,
  syncSession: async id => runHelper(['sync-session', id]),
  syncNew: async () => runHelper(['sync-new']),
});

export default {
  name: 'session-vault-sync',
  hooks: {
    'response.before': async () => {},
    'session.stop': hook,
  },
};
