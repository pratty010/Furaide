import { test, expect } from 'bun:test';
import { join } from 'node:path';

const pluginPath = join(import.meta.dir, '../../plugins/nio.js');

async function loadPlugin() {
  return await import(pluginPath);
}

function makeCtx(verdict) {
  return {
    readVerdict: () => verdict, // null = unreadable
  };
}

test('critical verdict blocks deliver, bash, edit, task', async () => {
  const plugin = await loadPlugin();
  const hook = plugin.__test_hookFor(makeCtx('critical'));
  for (const tool of ['deliver', 'bash', 'edit', 'task', 'webfetch']) {
    await expect(hook({ tool })).rejects.toThrow(/critical/);
  }
});

test('unreadable verdict fails CLOSED (blocks deliver)', async () => {
  const plugin = await loadPlugin();
  const hook = plugin.__test_hookFor(makeCtx(null));
  await expect(hook({ tool: 'deliver' })).rejects.toThrow(/fail-closed|unreadable|cannot read/i);
});

test('ok verdict allows all tools', async () => {
  const plugin = await loadPlugin();
  const hook = plugin.__test_hookFor(makeCtx('ok'));
  await expect(hook({ tool: 'deliver' })).resolves.toBeUndefined();
  await expect(hook({ tool: 'bash' })).resolves.toBeUndefined();
});

test('warn verdict allows (only critical blocks)', async () => {
  const plugin = await loadPlugin();
  const hook = plugin.__test_hookFor(makeCtx('warn'));
  await expect(hook({ tool: 'deliver' })).resolves.toBeUndefined();
});

test('no active workflow (no state.json) allows tools (no-workflow = unblocked)', async () => {
  const plugin = await loadPlugin();
  // When there is no workflow active, verdict reader returns 'ok' (no gate to enforce)
  const hook = plugin.__test_hookFor(makeCtx('ok'));
  await expect(hook({ tool: 'bash' })).resolves.toBeUndefined();
});
