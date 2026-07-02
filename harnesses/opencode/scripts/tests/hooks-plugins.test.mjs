import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const auditMod = await import('../../plugins/hooks/audit-logger.js');
const compactionMod = await import('../../plugins/hooks/compaction-injector.js');

const tempDirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-plugin-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

test('hook plugins register expected events', async () => {
  const auditHooks = await auditMod.default({});
  const compactionHooks = await compactionMod.default({});
  expect(auditMod.HOOK_EVENT).toBe('tool.execute.after');
  expect(typeof auditHooks[auditMod.HOOK_EVENT]).toBe('function');
  expect(compactionMod.HOOK_EVENT).toBe('experimental.session.compacting');
  expect(typeof compactionHooks[compactionMod.HOOK_EVENT]).toBe('function');
});

test('audit logger appends JSONL for bash/task with compact fields', async () => {
  const dir = tempDir();
  const auditPath = join(dir, 'audit.jsonl');
  const hook = auditMod.__test_hookFor({
    now: () => '2026-07-02T12:00:00.000Z',
    getWorkflowId: () => 'wf-23',
    resolveAuditPath: () => auditPath,
  });

  await hook({ tool: 'bash', agent: 'kagami--verifier', args: { command: 'bun test scripts/tests/hooks-plugins.test.mjs', workdir: '/repo' } }, { exitCode: 0 });
  await hook({ tool: 'task', args: { subagent_type: 'general', description: 'worker run', prompt: 'x'.repeat(240) } }, { exit: 1 });

  const entries = readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({ ts: '2026-07-02T12:00:00.000Z', agent: 'kagami--verifier', tool: 'bash', exit: 0 });
  expect(entries[0]['args-summary']).toContain('command');
  expect(entries[1]).toMatchObject({ agent: 'general', tool: 'task', exit: 1 });
  expect(entries[1]['args-summary']).toContain('subagent_type');
  expect(entries[1]['args-summary'].length).toBeLessThan(220);
});

test('audit logger ignores non-bash/task tools', async () => {
  const dir = tempDir();
  const auditPath = join(dir, 'audit.jsonl');
  const hook = auditMod.__test_hookFor({
    getWorkflowId: () => 'wf-23',
    resolveAuditPath: () => auditPath,
  });

  await expect(hook({ tool: 'read', args: { filePath: '/tmp/x' } }, {})).resolves.toBeUndefined();
  expect(() => readFileSync(auditPath, 'utf8')).toThrow();
});

test('compaction injector appends workflow summary into compaction context', async () => {
  const hook = compactionMod.__test_hookFor({
    readSummary: () => '## Active Workflow State\nworkflow_id: wf-23\nphase: VERIFY',
  });
  const output = { context: ['existing'] };

  await hook({ cwd: '/repo' }, output);

  expect(output.context).toHaveLength(2);
  expect(output.context[1]).toContain('workflow_id: wf-23');
  expect(output.context[1]).toContain('phase: VERIFY');
});
