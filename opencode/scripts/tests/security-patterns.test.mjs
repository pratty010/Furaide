import { test, expect } from 'bun:test';
const { __test_hookFor } = await import('../../plugins/security-patterns.js');

test('clean content passes through', async () => {
  const hook = __test_hookFor();
  await expect(hook({ tool: 'edit', input: { content: 'const x = 1;' } })).resolves.toBeUndefined();
});

test('first hardcoded secret hit → SECURITY WARNING', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'edit', input: { content: 'const key = "sk-abc123456789012345";' } })
  ).rejects.toThrow('SECURITY WARNING');
});

test('second hit of same pattern → SECURITY ESCALATION', async () => {
  const hook = __test_hookFor();
  const payload = { tool: 'edit', input: { content: 'const key = "sk-abc123456789012345";' } };
  try { await hook(payload); } catch {}
  await expect(hook(payload)).rejects.toThrow('SECURITY ESCALATION');
});

test('direct state.json write → SECURITY WARNING', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'write', input: { file_path: 'state.json', content: '{}' } })
  ).rejects.toThrow('SECURITY WARNING');
});

test('gemini-2.5 model reference → SECURITY WARNING', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'edit', input: { content: 'model: google-vertex/gemini-2.5-flash' } })
  ).rejects.toThrow('SECURITY WARNING');
});

test('non-Edit/Write tool → no check (bash with secret)', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'bash', input: { command: 'echo sk-abc123456789012345' } })
  ).resolves.toBeUndefined();
});
