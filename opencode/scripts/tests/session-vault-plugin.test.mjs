import { test, expect } from 'bun:test';
import { __test_syncHookFor } from '../../plugins/omokage.js';

test('session close hook syncs a known session id', async () => {
  const calls = [];
  const hook = __test_syncHookFor({
    getSessionId: () => 'ses_123',
    syncSession: async id => calls.push(['sync-session', id]),
    syncNew: async () => calls.push(['sync-new']),
  });

  await hook();
  expect(calls).toEqual([['sync-session', 'ses_123']]);
});

test('session close hook falls back to sync-new when session id is missing', async () => {
  const calls = [];
  const hook = __test_syncHookFor({
    getSessionId: () => null,
    syncSession: async id => calls.push(['sync-session', id]),
    syncNew: async () => calls.push(['sync-new']),
  });

  await hook();
  expect(calls).toEqual([['sync-new']]);
});
