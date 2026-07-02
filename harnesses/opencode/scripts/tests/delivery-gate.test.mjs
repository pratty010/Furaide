import { test, expect } from 'bun:test';
const { __test_hookFor, default: plugin, HOOK_EVENT } = await import('../../plugins/gates/nurikabe.js');

function makeHook(verdict) {
  return __test_hookFor({ readVerdict: () => verdict });
}

test('no active workflow (ok) → allows delivery', async () => {
  await expect(makeHook('ok')({ tool: 'deliver' })).resolves.toBeUndefined();
});

test('warn verdict → allows delivery', async () => {
  await expect(makeHook('warn')({ tool: 'deliver' })).resolves.toBeUndefined();
});

test('critical verdict → blocks delivery', async () => {
  await expect(makeHook('critical')({ tool: 'deliver' })).rejects.toThrow('delivery-gate');
});

test('warn-unresolved verdict → blocks delivery', async () => {
  await expect(makeHook('warn-unresolved')({ tool: 'deliver' })).rejects.toThrow('delivery-gate');
});

test('null verdict (unreadable state) → blocks delivery (fail-closed)', async () => {
  await expect(makeHook(null)({ tool: 'deliver' })).rejects.toThrow('delivery-gate fail-closed');
});

test('non-deliver tools are ignored by nurikabe', async () => {
  await expect(makeHook('critical')({ tool: 'bash' })).resolves.toBeUndefined();
});

test('plugin registers the documented tool hook', () => {
  expect(HOOK_EVENT).toBe('tool.execute.before');
  expect(plugin.hooks[HOOK_EVENT]).toBeDefined();
});
