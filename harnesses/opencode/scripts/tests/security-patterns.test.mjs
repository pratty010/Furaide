import { test, expect } from 'bun:test';
const { __test_hookFor } = await import('../../plugins/gates/komainu.js');

test('clean content passes through', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'edit', sessionID: 's1', callID: 'c1' }, { args: { content: 'const x = 1;' } })
  ).resolves.toBeUndefined();
});

test('first hardcoded secret hit → SECURITY WARNING', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'edit', sessionID: 's1', callID: 'c1' }, { args: { content: 'const key = "sk-abc123456789012345";' } })
  ).rejects.toThrow('SECURITY WARNING');
});

test('second hit of same pattern → SECURITY ESCALATION', async () => {
  const hook = __test_hookFor();
  const input = { tool: 'edit', sessionID: 's1', callID: 'c1' };
  const output = { args: { content: 'const key = "sk-abc123456789012345";' } };
  try { await hook(input, output); } catch {}
  await expect(hook(input, output)).rejects.toThrow('SECURITY ESCALATION');
});

test('direct state.json write → SECURITY WARNING', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'write', sessionID: 's1', callID: 'c1' }, { args: { file_path: 'state.json', content: '{}' } })
  ).rejects.toThrow('SECURITY WARNING');
});

test('gemini-2.5 model reference → SECURITY WARNING', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'edit', sessionID: 's1', callID: 'c1' }, { args: { content: 'model: google-vertex/gemini-2.5-flash' } })
  ).rejects.toThrow('SECURITY WARNING');
});

test('non-Edit/Write tool → no check (bash with secret)', async () => {
  const hook = __test_hookFor();
  await expect(
    hook({ tool: 'bash', sessionID: 's1', callID: 'c1' }, { args: { command: 'echo sk-abc123456789012345' } })
  ).resolves.toBeUndefined();
});
