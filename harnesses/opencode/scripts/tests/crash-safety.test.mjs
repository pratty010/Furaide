import { test, expect } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const runWF = (args, opts = {}) =>
  execFileSync('bun', ['scripts/workflow-state.mjs', ...args], {
    encoding: 'utf8', ...opts,
  });

const readWF = (cwd, wf) =>
  JSON.parse(execFileSync('bun', ['scripts/workflow-state.mjs', 'read', '--cwd', cwd, '--workflow', wf], { encoding: 'utf8' }));

test('state.json is always parseable after process kill', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cs'));
  const wf = 'w1';
  // init a good state
  runWF(['init', '--cwd', cwd, '--workflow', wf, '--specialist', 'deep-researcher', '--phase', 'RECEIVED', '--session', 's1']);
  // Confirm initial state is parseable
  const state = readWF(cwd, wf);
  expect(state.rev).toBe(1);

  // Simulate a kill: spawn an advance process (spawnSync with very short timeout lets it finish
  // or be killed — either way we check the invariant on state.json afterward).
  // spawnSync with a 50 ms timeout will SIGKILL the child if it doesn't finish in time,
  // exercising the "crash mid-write" scenario.
  spawnSync(
    'bun',
    [
        'scripts/workflow-state.mjs',
        'advance', '--cwd', cwd, '--workflow', wf,
        '--to', 'ROUTED', '--expected-rev', '1',
        '--session', 's1', '--caller', 'deep-researcher',
      ],
    { timeout: 50 },   // intentionally tiny — may SIGKILL before rename completes
  );

  // Whether the advance succeeded or was killed, state.json must still be parseable.
  // The atomic write (tmp→fdatasync→rename) guarantees the previous snapshot survives a
  // mid-write kill; if the rename committed, the new snapshot is also whole.
  const reparsed = readWF(cwd, wf);
  expect(typeof reparsed.rev).toBe('number');
  expect(typeof reparsed.specialist).toBe('string');
});

test('double-resume: exactly one advance wins, no torn state', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cs'));
  const wf = 'w2';
  runWF(['init', '--cwd', cwd, '--workflow', wf, '--specialist', 'debugger', '--phase', 'RECEIVED', '--session', 's1']);

  // Run two sequential advances with the same expected-rev.
  // (True concurrency via child_process on a single-threaded lock would require async
  // coordination; sequential with the same rev exercises the CAS conflict path identically.)
  const advanceArgs = [
    'scripts/workflow-state.mjs',
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'ROUTED', '--expected-rev', '1',
    '--session', 's1', '--caller', 'debugger',
  ];

  const r1 = spawnSync('bun', advanceArgs, { encoding: 'utf8', timeout: 10000 });
  const r2 = spawnSync('bun', advanceArgs, { encoding: 'utf8', timeout: 10000 });

  const s1ok = r1.status === 0;
  const s2ok = r2.status === 0;

  // At most one winner — both cannot succeed with the same expected-rev
  expect(s1ok && s2ok).toBe(false);

  // Final state is consistent: exactly one advance committed
  const finalState = readWF(cwd, wf);
  expect(finalState.rev).toBe(2);
});
