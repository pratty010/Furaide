import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';

const run = (script, arg) =>
  JSON.parse(execFileSync('bun', [script, JSON.stringify(arg)], { encoding: 'utf8' }));

const runSecuritySeverity = (finding, options = {}) => {
  const args = ['scripts/security-severity.mjs', '--finding', JSON.stringify(finding)];

  try {
    return {
      status: 0,
      json: JSON.parse(execFileSync('bun', args, { encoding: 'utf8' })),
    };
  } catch (error) {
    if (typeof error.stdout !== 'string') {
      throw error;
    }

    return {
      status: error.status ?? 1,
      json: JSON.parse(error.stdout),
    };
  }
};

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

test('security-severity: low finding → ok', () => {
  const { status, json } = runSecuritySeverity({ reachability: 0, attackerControl: 0, impact: 1, preconditions: 3, authGate: 3 });
  expect(status).toBe(0);
  expect(json.verdict).toBe('ok');
  expect(json.required_action).toBeUndefined();
});

test('security-severity: medium finding → warn', () => {
  const { status, json } = runSecuritySeverity({ reachability: 1, attackerControl: 1, impact: 1, preconditions: 1, authGate: 2 });
  expect(status).toBe(0);
  expect(json.verdict).toBe('warn');
  expect(json.required_action).toBeUndefined();
});

test('security-severity: high finding defaults to critical + fix-in-place', () => {
  const { status, json } = runSecuritySeverity({ reachability: 2, attackerControl: 2, impact: 2, preconditions: 1, authGate: 1 });
  expect(status).toBe(0);
  expect(json.verdict).toBe('critical');
  expect(json.required_action).toBe('fix-in-place');
});

test('security-severity: critical finding allows scout-alternative', () => {
  const { status, json } = runSecuritySeverity({
    reachability: 2,
    attackerControl: 2,
    impact: 2,
    preconditions: 1,
    authGate: 1,
    required_action: 'scout-alternative',
  });
  expect(status).toBe(0);
  expect(json.verdict).toBe('critical');
  expect(json.required_action).toBe('scout-alternative');
});

test('security-severity: critical finding allows accept-risk-pending-approval', () => {
  const { status, json } = runSecuritySeverity({
    reachability: 1,
    attackerControl: 3,
    impact: 3,
    preconditions: 1,
    authGate: 1,
    required_action: 'accept-risk-pending-approval',
  });
  expect(status).toBe(0);
  expect(json.verdict).toBe('critical');
  expect(json.required_action).toBe('accept-risk-pending-approval');
});

test('security-severity: highest severity finding → escalate', () => {
  const { status, json } = runSecuritySeverity({ reachability: 3, attackerControl: 3, impact: 3, preconditions: 0, authGate: 0 });
  expect(status).toBe(0);
  expect(json.verdict).toBe('escalate');
  expect(json.required_action).toBeUndefined();
});

test('security-severity: legacy required_action is rejected with migration hint', () => {
  const { status, json } = runSecuritySeverity({
    reachability: 2,
    attackerControl: 2,
    impact: 2,
    preconditions: 2,
    authGate: 1,
    required_action: 'alternative-required',
  });
  expect(status).toBe(2);
  expect(json.valid).toBe(false);
  expect(json.errors[0]).toContain('legacy value "alternative-required"');
  expect(json.errors[0]).toContain('scout-alternative');
});

test('security-severity: legacy verdict is rejected with migration hint', () => {
  const { status, json } = runSecuritySeverity({
    reachability: 3,
    attackerControl: 3,
    impact: 3,
    preconditions: 0,
    authGate: 0,
    verdict: 'escalate-security',
  });
  expect(status).toBe(2);
  expect(json.valid).toBe(false);
  expect(json.errors[0]).toContain('legacy value "escalate-security"');
  expect(json.errors[0]).toContain('escalate');
});

test('security-severity: accepted-risk legacy required_action is rejected with migration hint', () => {
  const { status, json } = runSecuritySeverity({
    reachability: 1,
    attackerControl: 3,
    impact: 3,
    preconditions: 1,
    authGate: 1,
    required_action: 'accepted-risk',
  });
  expect(status).toBe(2);
  expect(json.valid).toBe(false);
  expect(json.errors[0]).toContain('legacy value "accepted-risk"');
  expect(json.errors[0]).toContain('accept-risk-pending-approval');
});
