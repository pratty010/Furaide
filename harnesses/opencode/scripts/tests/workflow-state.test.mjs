import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const run = (args, extraEnv = {}) => {
  const result = spawnSync('bun', ['scripts/workflow-state.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  return {
    ...result,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

const runOk = (args, extraEnv = {}) => {
  const result = run(args, extraEnv);
  expect(result.status).toBe(0);
  return result.stdout ? JSON.parse(result.stdout) : null;
};

const expectFailure = (args, expectedStatus, expectedPattern) => {
  const result = run(args);
  expect(result.status).toBe(expectedStatus);
  expect(result.stderr).toMatch(expectedPattern);
  return result;
};

const mkWorkflow = (wf = 'wf1') => {
  const cwd = mkdtempSync(join(tmpdir(), 'wf'));
  return { cwd, wf };
};

const advance = (cwd, wf, rev, to, caller = 'deep-researcher', session = 's1') =>
  runOk([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', to, '--expected-rev', String(rev), '--session', session, '--caller', caller,
  ]);

test('init seeds WF1 workflow_states and accepts WF1 phase names', () => {
  const { cwd, wf } = mkWorkflow('wf1');
  const state = runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'deep-researcher', '--phase', 'RECEIVED', '--session', 's1',
  ]);

  expect(state.rev).toBe(1);
  expect(state.workflow_id).toBe('wf1');
  expect(state.phase).toBe('RECEIVED');
  expect(state.workflow_states[0]).toBe('RECEIVED');
  expect(state.workflow_states).toContain('BLOCKED_CLARIFY');
  expect(state.workflow_states).toContain('TMP_CLEANUP_OFFER');
  expect(state.workflow_states).not.toContain('scope');
});

const expectRepresentativePath = (wf, specialist, path, terminal) => {
  const { cwd } = mkWorkflow(wf);
  let state = runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', specialist, '--phase', 'RECEIVED', '--session', 's1',
  ]);

  for (const nextState of path) {
    state = advance(cwd, wf, state.rev, nextState, specialist);
  }

  expect(state.phase).toBe(terminal);
};

test('WF1 representative path accepts exact spec state names', () => {
  expectRepresentativePath(
    'wf1',
    'deep-researcher',
    ['ROUTED', 'DISCUSSION_MEMORY_READ', 'SPEC_DRAFT', 'USER_SCOPE_REVIEW', 'RECON', 'PLAN_DRAFT'],
    'PLAN_DRAFT',
  );
});

test('WF2 representative path accepts exact spec state names', () => {
  expectRepresentativePath(
    'wf2',
    'debugger',
    ['ROUTED', 'BUG_CONTEXT_READ', 'REPRO_ATTEMPT', 'RECON', 'EVIDENCE_GATHERING', 'MINIMIZE', 'ROOT_CAUSE_ANALYSIS', 'HYPOTHESIS_TEST'],
    'HYPOTHESIS_TEST',
  );
});

test('WF3 representative path accepts exact spec state names', () => {
  expectRepresentativePath(
    'wf3',
    'security-owner',
    ['ROUTED', 'SECURITY_SCOPE_READ', 'SECURITY_TOOLING_READINESS', 'RECON', 'THREAT_MODEL', 'SECURITY_ANALYSIS_PLAN'],
    'SECURITY_ANALYSIS_PLAN',
  );
});

test('WF4 representative path accepts exact spec state names', () => {
  expectRepresentativePath(
    'wf4',
    'research-owner',
    ['ROUTED', 'LIGHT_SCOPE', 'RESEARCH_BRIEF', 'USER_BRIEF_REVIEW', 'MODE_SELECTION', 'QUERY_FRONTIER', 'SEARCH_DISCOVERY', 'SOURCE_SCREENING', 'FETCH_NATIVE', 'EVIDENCE_MATRIX'],
    'EVIDENCE_MATRIX',
  );
});

test('WF5 representative path accepts exact spec state names including COMPLETE terminal', () => {
  expectRepresentativePath(
    'wf5',
    'finance-owner',
    ['INTENT_CLASSIFY', 'MODE_SELECTION', 'BANK_STATUS', 'ARTIFACT_AUDIT', 'REUSE_DECISION', 'SOURCE_SCREENING', 'SOURCE_GATHERING', 'EXTRACTION', 'NORMALIZE', 'MODULE_EXECUTION', 'FRESHNESS_VERIFY', 'CROSS_VERIFY', 'SYNTHESIS', 'REVIEW', 'DELIVERY', 'BANK_UPDATE_DECISION', 'PERSISTENCE_DECISION', 'LEARN_OFFER', 'TMP_CLEANUP_OFFER', 'COMPLETE'],
    'COMPLETE',
  );
});

test('invalid states and invalid transitions are rejected per workflow map', () => {
  const { cwd, wf } = mkWorkflow('wf1');
  runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'deep-researcher', '--phase', 'RECEIVED', '--session', 's1',
  ]);

  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'scope', '--expected-rev', '1', '--session', 's1', '--caller', 'deep-researcher',
  ], 1, /--to must be one of/);

  const wf2 = mkWorkflow('wf2');
  let state = runOk([
    'init', '--cwd', wf2.cwd, '--workflow', wf2.wf,
    '--specialist', 'debugger', '--phase', 'RECEIVED', '--session', 's1',
  ]);
  state = advance(wf2.cwd, wf2.wf, state.rev, 'ROUTED', 'debugger');
  state = advance(wf2.cwd, wf2.wf, state.rev, 'BUG_CONTEXT_READ', 'debugger');
  state = advance(wf2.cwd, wf2.wf, state.rev, 'REPRO_ATTEMPT', 'debugger');

  expectFailure([
    'advance', '--cwd', wf2.cwd, '--workflow', wf2.wf,
    '--to', 'FIX_ANALYSIS', '--expected-rev', String(state.rev), '--session', 's1', '--caller', 'debugger',
  ], 1, /invalid transition for wf2: REPRO_ATTEMPT -> FIX_ANALYSIS/);
});

test('verify/review transition caps reject excess retry loops', () => {
  const { cwd, wf } = mkWorkflow('wf1');
  let state = runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'deep-researcher', '--phase', 'VERIFY', '--session', 's1',
  ]);

  state = advance(cwd, wf, state.rev, 'FIX_ANALYSIS');
  state = advance(cwd, wf, state.rev, 'SIMPLE_IMPLEMENT');
  state = advance(cwd, wf, state.rev, 'VERIFY_PREP');
  state = advance(cwd, wf, state.rev, 'VERIFY');
  state = advance(cwd, wf, state.rev, 'FIX_ANALYSIS');
  state = advance(cwd, wf, state.rev, 'SIMPLE_IMPLEMENT');
  state = advance(cwd, wf, state.rev, 'VERIFY_PREP');
  state = advance(cwd, wf, state.rev, 'VERIFY');

  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'FIX_ANALYSIS', '--expected-rev', String(state.rev), '--session', 's1', '--caller', 'deep-researcher',
  ], 1, /loop cap reached for verify/);

  const reviewFlow = mkWorkflow('wf5');
  let reviewState = runOk([
    'init', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--specialist', 'finance-owner', '--phase', 'REVIEW', '--session', 's1',
  ]);

  reviewState = advance(reviewFlow.cwd, reviewFlow.wf, reviewState.rev, 'SYNTHESIS', 'finance-owner');
  reviewState = advance(reviewFlow.cwd, reviewFlow.wf, reviewState.rev, 'REVIEW', 'finance-owner');

  expectFailure([
    'advance', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--to', 'SYNTHESIS', '--expected-rev', String(reviewState.rev), '--session', 's1', '--caller', 'finance-owner',
  ], 1, /loop cap reached for review/);
});

test('gate warn counter preserves legacy behavior and applies workflow caps for verify/review', () => {
  const generic = mkWorkflow('wf1');
  runOk([
    'init', '--cwd', generic.cwd, '--workflow', generic.wf,
    '--specialist', 'coding', '--phase', 'VERIFY', '--session', 's1',
  ]);

  let last;
  for (let i = 0; i < 4; i++) {
    last = runOk([
      'gate', '--cwd', generic.cwd, '--workflow', generic.wf,
      '--gate', 'tests', '--verdict', 'warn', '--max-iterations', '3', '--session', 's1', '--caller', 'coding',
    ]);
  }
  expect(last.gate_verdicts.tests).toBe('warn-unresolved');

  const verifyFlow = mkWorkflow('wf1');
  runOk([
    'init', '--cwd', verifyFlow.cwd, '--workflow', verifyFlow.wf,
    '--specialist', 'coding', '--phase', 'VERIFY', '--session', 's1',
  ]);

  for (let i = 0; i < 3; i++) {
    last = runOk([
      'gate', '--cwd', verifyFlow.cwd, '--workflow', verifyFlow.wf,
      '--gate', 'verify', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'coding',
    ]);
  }
  expect(last.gate_verdicts.verify).toBe('warn');
  last = runOk([
    'gate', '--cwd', verifyFlow.cwd, '--workflow', verifyFlow.wf,
    '--gate', 'verify', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'coding',
  ]);
  expect(last.gate_verdicts.verify).toBe('warn-unresolved');

  const reviewFlow = mkWorkflow('wf3');
  runOk([
    'init', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--specialist', 'security-owner', '--phase', 'REVIEW', '--session', 's1',
  ]);

  for (let i = 0; i < 2; i++) {
    last = runOk([
      'gate', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
      '--gate', 'review', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'security-owner',
    ]);
  }
  expect(last.gate_verdicts.review).toBe('warn');
  last = runOk([
    'gate', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--gate', 'review', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'security-owner',
  ]);
  expect(last.gate_verdicts.review).toBe('warn-unresolved');
});

test('ownership, CAS conflicts, and journal behavior remain intact', () => {
  const { cwd, wf } = mkWorkflow('wf4');
  runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'research-owner', '--phase', 'RECEIVED', '--session', 's1',
  ]);

  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'ROUTED', '--expected-rev', '1', '--session', 's1', '--caller', 'financial',
  ], 5, /ownership/);

  let state = advance(cwd, wf, 1, 'ROUTED', 'research-owner');
  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'LIGHT_SCOPE', '--expected-rev', '1', '--session', 's1', '--caller', 'research-owner',
  ], 9, /conflict/);

  state = advance(cwd, wf, state.rev, 'LIGHT_SCOPE', 'research-owner');
  expect(state.rev).toBe(3);

  const stateInfo = JSON.parse(spawnSync('bun', [
    'scripts/state-path.mjs', '--cwd', cwd, '--workflow', wf,
  ], { encoding: 'utf8' }).stdout);
  const journal = readFileSync(stateInfo.journalPath, 'utf8').trim().split('\n');
  expect(journal.length).toBe(3);
  expect(JSON.parse(journal[0]).op).toBe('init');
  expect(JSON.parse(journal[1]).op).toBe('advance');
  expect(JSON.parse(journal[2]).to).toBe('LIGHT_SCOPE');
});
