import { test, expect } from 'bun:test';
const { __test_hookFor } = await import('../../plugins/delivery-gate.js');

function makeHook(verdict) {
  return __test_hookFor({ readVerdict: () => verdict });
}

test('no active workflow (ok) → allows delivery', async () => {
  await expect(makeHook('ok')({})).resolves.toBeUndefined();
});

test('warn verdict → allows delivery', async () => {
  await expect(makeHook('warn')({})).resolves.toBeUndefined();
});

test('critical verdict → blocks delivery', async () => {
  await expect(makeHook('critical')({})).rejects.toThrow('delivery-gate');
});

test('warn-unresolved verdict → blocks delivery', async () => {
  await expect(makeHook('warn-unresolved')({})).rejects.toThrow('delivery-gate');
});

test('null verdict (unreadable state) → blocks delivery (fail-closed)', async () => {
  await expect(makeHook(null)({})).rejects.toThrow('delivery-gate fail-closed');
});
