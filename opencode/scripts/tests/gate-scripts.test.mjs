import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';

const run = (script, arg) =>
  JSON.parse(execFileSync('bun', [script, JSON.stringify(arg)], { encoding: 'utf8' }));

test('citation-verify: regulated uncited → critical', () => {
  const r = run('scripts/citation-verify.mjs', { claims: [{ text: 'Drug X cures cancer', regulated: true }] });
  expect(r.verdict).toBe('critical');
});
test('citation-verify: unregulated uncited → warn', () => {
  const r = run('scripts/citation-verify.mjs', { claims: [{ text: 'Market is big', regulated: false }] });
  expect(r.verdict).toBe('warn');
});
test('citation-verify: all cited → ok', () => {
  const r = run('scripts/citation-verify.mjs', { claims: [{ text: 'X is true', regulated: true, source_id: 'S1' }] });
  expect(r.verdict).toBe('ok');
});

test('playbook-check: unmapped obligation → warn', () => {
  const r = run('scripts/playbook-check.mjs', { obligations: [{ id: 'O1' }] });
  expect(r.verdict).toBe('warn');
});
test('playbook-check: all mapped → ok', () => {
  const r = run('scripts/playbook-check.mjs', { obligations: [{ id: 'O1', clause: '§3.2' }] });
  expect(r.verdict).toBe('ok');
});

test('action-allowlist: action not in list → critical', () => {
  const r = run('scripts/action-allowlist.mjs', { action: 'rm -rf /', allowlist: ['deploy', 'rollback'], rollback: 'undo' });
  expect(r.verdict).toBe('critical');
});
test('action-allowlist: in list, no rollback → critical', () => {
  const r = run('scripts/action-allowlist.mjs', { action: 'deploy', allowlist: ['deploy'] });
  expect(r.verdict).toBe('critical');
});
test('action-allowlist: in list with rollback → ok', () => {
  const r = run('scripts/action-allowlist.mjs', { action: 'deploy', allowlist: ['deploy'], rollback: 'rollback-deploy' });
  expect(r.verdict).toBe('ok');
});

test('voice-check: overlap below threshold → warn', () => {
  const r = run('scripts/voice-check.mjs', { output: 'hello world', profile_tokens: ['brand', 'innovation', 'excellence', 'transformative', 'synergy'], threshold: 0.5 });
  expect(r.verdict).toBe('warn');
});
test('voice-check: overlap above threshold → ok', () => {
  const r = run('scripts/voice-check.mjs', { output: 'brand innovation excellence', profile_tokens: ['brand', 'innovation', 'excellence'], threshold: 0.5 });
  expect(r.verdict).toBe('ok');
});
