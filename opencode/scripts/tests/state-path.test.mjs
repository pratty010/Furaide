import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';

test('state-path slug + workflow dir', () => {
  const o = JSON.parse(
    execFileSync('bun', ['scripts/state-path.mjs', '--cwd', '/home/ace/proj', '--workflow', 'wf1'],
      { encoding: 'utf8' })
  );
  expect(o.slug).toBe('-home-ace-proj');
  expect(o.stateDir).toMatch(/\.local\/share\/opencode\/state\/-home-ace-proj\/wf1$/);
  expect(o.statePath).toMatch(/wf1\/state\.json$/);
  expect(o.journalPath).toMatch(/wf1\/journal\.ndjson$/);
  expect(o.lockPath).toMatch(/wf1\/\.lock$/);
});
