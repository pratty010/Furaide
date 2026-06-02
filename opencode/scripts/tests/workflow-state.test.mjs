import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const run = (args, extraEnv = {}) =>
  execFileSync('bun', ['scripts/workflow-state.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });

const mkWorkflow = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'wf'));
  return { cwd, wf: 'w1' };
};

test('init creates state.json with rev=1', () => {
  const { cwd, wf } = mkWorkflow();
  const o = JSON.parse(run(['init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'deep-researcher', '--phase', 'scope', '--session', 's1']));
  expect(o.rev).toBe(1);
  expect(o.phase).toBe('scope');
  expect(o.specialist).toBe('deep-researcher');
});

test('advance increments rev and requires correct caller', () => {
  const { cwd, wf } = mkWorkflow();
  run(['init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'deep-researcher', '--phase', 'scope', '--session', 's1']);
  // wrong caller is rejected
  expect(() =>
    run(['advance', '--cwd', cwd, '--workflow', wf,
      '--to', 'extract', '--expected-rev', '1', '--session', 's1', '--caller', 'financial'])
  ).toThrow();
  // correct caller succeeds
  const o = JSON.parse(run(['advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'extract', '--expected-rev', '1', '--session', 's1', '--caller', 'deep-researcher']));
  expect(o.rev).toBe(2);
  expect(o.phase).toBe('extract');
});

test('stale rev causes conflict exit', () => {
  const { cwd, wf } = mkWorkflow();
  run(['init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'deep-researcher', '--phase', 'scope', '--session', 's1']);
  run(['advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'extract', '--expected-rev', '1', '--session', 's1', '--caller', 'deep-researcher']);
  expect(() =>
    run(['advance', '--cwd', cwd, '--workflow', wf,
      '--to', 'report', '--expected-rev', '1', '--session', 's1', '--caller', 'deep-researcher'])
  ).toThrow(/conflict/);
});

test('gate warn counter caps at max_iterations then forces warn-unresolved', () => {
  const { cwd, wf } = mkWorkflow();
  run(['init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'coding', '--phase', 'test', '--session', 's1']);
  let last;
  for (let i = 0; i < 4; i++) {
    last = JSON.parse(run(['gate', '--cwd', cwd, '--workflow', wf,
      '--gate', 'tests', '--verdict', 'warn', '--max-iterations', '3',
      '--session', 's1', '--caller', 'coding']));
  }
  expect(last.gate_verdicts.tests).toBe('warn-unresolved');
});

test('journal appends one line per op', async () => {
  const { cwd, wf } = mkWorkflow();
  run(['init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'deep-researcher', '--phase', 'scope', '--session', 's1']);
  run(['advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'extract', '--expected-rev', '1', '--session', 's1', '--caller', 'deep-researcher']);
  // Read journal from the state dir
  const { execFileSync: ef } = await import('node:child_process');
  const stateInfo = JSON.parse(execFileSync('bun', ['scripts/state-path.mjs',
    '--cwd', cwd, '--workflow', wf], { encoding: 'utf8' }));
  const journal = readFileSync(stateInfo.journalPath, 'utf8').trim().split('\n');
  expect(journal.length).toBe(2); // init + advance
  const j0 = JSON.parse(journal[0]);
  expect(j0.op).toBe('init');
  const j1 = JSON.parse(journal[1]);
  expect(j1.op).toBe('advance');
  expect(j1.rev).toBe(2);
});
