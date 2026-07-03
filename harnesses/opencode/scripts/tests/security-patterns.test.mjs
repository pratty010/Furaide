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

test('required plugin removed from opencode.jsonc → SECURITY WARNING', async () => {
  const hook = __test_hookFor();
  await expect(
    hook(
      { tool: 'edit', sessionID: 's2', callID: 'c1' },
      { args: { file_path: 'config/opencode.jsonc', content: '"plugin": ["./plugins/gates/nio.js"]' } }
    )
  ).rejects.toThrow('SECURITY WARNING');
});

test('both required plugins present in opencode.jsonc → no check', async () => {
  const hook = __test_hookFor();
  await expect(
    hook(
      { tool: 'edit', sessionID: 's2', callID: 'c1' },
      {
        args: {
          file_path: 'config/opencode.jsonc',
          content: '"plugin": ["./plugins/gates/nio.js", "./plugins/failover/migawari.js"]',
        },
      }
    )
  ).resolves.toBeUndefined();
});

test('hit-count escalation is per-session, not process-global', async () => {
  const hook = __test_hookFor();
  const output = { args: { content: 'const key = "sk-abc123456789012345";' } };

  // First hit in session A → warning (count 1)
  await expect(
    hook({ tool: 'edit', sessionID: 'sessionA', callID: 'c1' }, output)
  ).rejects.toThrow('SECURITY WARNING');

  // First hit in session B for the same pattern must NOT be treated as an
  // escalated second hit — sessions are isolated.
  await expect(
    hook({ tool: 'edit', sessionID: 'sessionB', callID: 'c1' }, output)
  ).rejects.toThrow('SECURITY WARNING');

  // Second hit in session A now escalates.
  await expect(
    hook({ tool: 'edit', sessionID: 'sessionA', callID: 'c2' }, output)
  ).rejects.toThrow('SECURITY ESCALATION');
});
