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

const advance = (cwd, wf, rev, to, caller = 'kantoku--workflow-director', session = 's1') =>
  runOk([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', to, '--expected-rev', String(rev), '--session', session, '--caller', caller,
  ]);

test('init seeds WF1 workflow_states and accepts WF1 phase names', () => {
  const { cwd, wf } = mkWorkflow('wf1');
  const state = runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'kantoku--workflow-director', '--phase', 'RECEIVED', '--session', 's1',
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
    'kantoku--workflow-director',
    ['ROUTED', 'DISCUSSION_MEMORY_READ', 'SPEC_DRAFT', 'USER_SCOPE_REVIEW', 'RECON', 'PLAN_DRAFT'],
    'PLAN_DRAFT',
  );
});

test('WF2 representative path accepts exact spec state names', () => {
  expectRepresentativePath(
    'wf2',
    'bakeneko--bug-hunter',
    ['ROUTED', 'BUG_CONTEXT_READ', 'REPRO_ATTEMPT', 'RECON', 'EVIDENCE_GATHERING', 'MINIMIZE', 'ROOT_CAUSE_ANALYSIS', 'HYPOTHESIS_TEST'],
    'HYPOTHESIS_TEST',
  );
});

test('WF3 representative path accepts exact spec state names', () => {
  expectRepresentativePath(
    'wf3',
    'fudo--security-guardian',
    ['ROUTED', 'SECURITY_SCOPE_READ', 'SECURITY_TOOLING_READINESS', 'RECON', 'THREAT_MODEL', 'SECURITY_ANALYSIS_PLAN'],
    'SECURITY_ANALYSIS_PLAN',
  );
});

test('WF4 representative path accepts exact spec state names', () => {
  expectRepresentativePath(
    'wf4',
    'tsuchigumo--research-weaver',
    ['ROUTED', 'LIGHT_SCOPE', 'RESEARCH_BRIEF', 'USER_BRIEF_REVIEW', 'MODE_SELECTION', 'QUERY_FRONTIER', 'SEARCH_DISCOVERY', 'SOURCE_SCREENING', 'FETCH_NATIVE', 'EVIDENCE_MATRIX'],
    'EVIDENCE_MATRIX',
  );
});

test('WF5 representative path accepts exact spec state names including COMPLETE terminal', () => {
  expectRepresentativePath(
    'wf5',
    'daikoku--finance-steward',
    ['INTENT_CLASSIFY', 'MODE_SELECTION', 'BANK_STATUS', 'ARTIFACT_AUDIT', 'REUSE_DECISION', 'SOURCE_SCREENING', 'SOURCE_GATHERING', 'EXTRACTION', 'NORMALIZE', 'MODULE_EXECUTION', 'FRESHNESS_VERIFY', 'CROSS_VERIFY', 'SYNTHESIS', 'REVIEW', 'DELIVERY', 'BANK_UPDATE_DECISION', 'PERSISTENCE_DECISION', 'LEARN_OFFER', 'TMP_CLEANUP_OFFER', 'COMPLETE'],
    'COMPLETE',
  );
});

test('invalid states and invalid transitions are rejected per workflow map', () => {
  const { cwd, wf } = mkWorkflow('wf1');
  runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'kantoku--workflow-director', '--phase', 'RECEIVED', '--session', 's1',
  ]);

  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'scope', '--expected-rev', '1', '--session', 's1', '--caller', 'kantoku--workflow-director',
  ], 1, /--to must be one of/);

  const wf2 = mkWorkflow('wf2');
  let state = runOk([
    'init', '--cwd', wf2.cwd, '--workflow', wf2.wf,
    '--specialist', 'bakeneko--bug-hunter', '--phase', 'RECEIVED', '--session', 's1',
  ]);
  state = advance(wf2.cwd, wf2.wf, state.rev, 'ROUTED', 'bakeneko--bug-hunter');
  state = advance(wf2.cwd, wf2.wf, state.rev, 'BUG_CONTEXT_READ', 'bakeneko--bug-hunter');
  state = advance(wf2.cwd, wf2.wf, state.rev, 'REPRO_ATTEMPT', 'bakeneko--bug-hunter');

  expectFailure([
    'advance', '--cwd', wf2.cwd, '--workflow', wf2.wf,
    '--to', 'FIX_ANALYSIS', '--expected-rev', String(state.rev), '--session', 's1', '--caller', 'bakeneko--bug-hunter',
  ], 1, /invalid transition for wf2: REPRO_ATTEMPT -> FIX_ANALYSIS/);
});

test('verify/review transition caps reject excess retry loops', () => {
  const { cwd, wf } = mkWorkflow('wf1');
  let state = runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'kantoku--workflow-director', '--phase', 'VERIFY', '--session', 's1',
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
    '--to', 'FIX_ANALYSIS', '--expected-rev', String(state.rev), '--session', 's1', '--caller', 'kantoku--workflow-director',
  ], 1, /loop cap reached for verify/);

  const reviewFlow = mkWorkflow('wf5');
  let reviewState = runOk([
    'init', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--specialist', 'daikoku--finance-steward', '--phase', 'REVIEW', '--session', 's1',
  ]);

  reviewState = advance(reviewFlow.cwd, reviewFlow.wf, reviewState.rev, 'SYNTHESIS', 'daikoku--finance-steward');
  reviewState = advance(reviewFlow.cwd, reviewFlow.wf, reviewState.rev, 'REVIEW', 'daikoku--finance-steward');

  expectFailure([
    'advance', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--to', 'SYNTHESIS', '--expected-rev', String(reviewState.rev), '--session', 's1', '--caller', 'daikoku--finance-steward',
  ], 1, /loop cap reached for review/);
});

test('gate warn counter preserves legacy behavior and applies workflow caps for verify/review', () => {
  const generic = mkWorkflow('wf1');
  runOk([
    'init', '--cwd', generic.cwd, '--workflow', generic.wf,
    '--specialist', 'kantoku--workflow-director', '--phase', 'VERIFY', '--session', 's1',
  ]);

  let last;
  for (let i = 0; i < 4; i++) {
    last = runOk([
      'gate', '--cwd', generic.cwd, '--workflow', generic.wf,
      '--gate', 'tests', '--verdict', 'warn', '--max-iterations', '3', '--session', 's1', '--caller', 'kantoku--workflow-director',
    ]);
  }
  expect(last.gate_verdicts.tests).toBe('warn-unresolved');

  const verifyFlow = mkWorkflow('wf1');
  runOk([
    'init', '--cwd', verifyFlow.cwd, '--workflow', verifyFlow.wf,
    '--specialist', 'kantoku--workflow-director', '--phase', 'VERIFY', '--session', 's1',
  ]);

  for (let i = 0; i < 3; i++) {
    last = runOk([
      'gate', '--cwd', verifyFlow.cwd, '--workflow', verifyFlow.wf,
      '--gate', 'verify', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'kantoku--workflow-director',
    ]);
  }
  expect(last.gate_verdicts.verify).toBe('warn');
  last = runOk([
    'gate', '--cwd', verifyFlow.cwd, '--workflow', verifyFlow.wf,
    '--gate', 'verify', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'kantoku--workflow-director',
  ]);
  expect(last.gate_verdicts.verify).toBe('warn-unresolved');

  const reviewFlow = mkWorkflow('wf3');
  runOk([
    'init', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--specialist', 'fudo--security-guardian', '--phase', 'REVIEW', '--session', 's1',
  ]);

  for (let i = 0; i < 2; i++) {
    last = runOk([
      'gate', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
      '--gate', 'review', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'fudo--security-guardian',
    ]);
  }
  expect(last.gate_verdicts.review).toBe('warn');
  last = runOk([
    'gate', '--cwd', reviewFlow.cwd, '--workflow', reviewFlow.wf,
    '--gate', 'review', '--verdict', 'warn', '--max-iterations', '99', '--session', 's1', '--caller', 'fudo--security-guardian',
  ]);
  expect(last.gate_verdicts.review).toBe('warn-unresolved');
});

test('ownership, CAS conflicts, and journal behavior remain intact', () => {
  const { cwd, wf } = mkWorkflow('wf4');
  runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'tsuchigumo--research-weaver', '--phase', 'RECEIVED', '--session', 's1',
  ]);

  // 'daikoku--finance-steward' owns no state in WF4 (research), so it is
  // genuinely outside WF4's DAG-based allowed-callers set — this must still
  // fail with 5, unlike a legitimate multi-specialist handoff (see the
  // dedicated DAG-based-callers passing-path test below).
  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'ROUTED', '--expected-rev', '1', '--session', 's1', '--caller', 'daikoku--finance-steward',
  ], 5, /ownership/);

  let state = advance(cwd, wf, 1, 'ROUTED', 'tsuchigumo--research-weaver');
  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'LIGHT_SCOPE', '--expected-rev', '1', '--session', 's1', '--caller', 'tsuchigumo--research-weaver',
  ], 9, /conflict/);

  state = advance(cwd, wf, state.rev, 'LIGHT_SCOPE', 'tsuchigumo--research-weaver');
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

test('H4: DAG-based allowed-callers permits a legitimate multi-specialist handoff', () => {
  // kantoku--workflow-director inits and advances a WF1 workflow; kagami--verifier
  // (a different agent, never the initiating specialist) then calls gate on the
  // same workflow instance. Both agents own at least one WF1 state per the spec's
  // state-ownership table, so this must succeed — previously this failed with
  // exit 5 because only the exact original --specialist string was accepted.
  const { cwd, wf } = mkWorkflow('wf1');
  let state = runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'kantoku--workflow-director', '--phase', 'RECEIVED', '--session', 's1',
  ]);

  state = advance(cwd, wf, state.rev, 'ROUTED', 'kantoku--workflow-director');
  expect(state.phase).toBe('ROUTED');

  const gateResult = runOk([
    'gate', '--cwd', cwd, '--workflow', wf,
    '--gate', 'scope', '--verdict', 'ok', '--session', 's1', '--caller', 'kagami--verifier',
  ]);
  expect(gateResult.gate_verdicts.scope).toBe('ok');
  // state.specialist still records who initiated the run (audit/display field only).
  expect(gateResult.specialist).toBe('kantoku--workflow-director');
});

test('H2: unresolved critical gate verdict blocks the terminal/delivery transition', () => {
  // Drive WF1 to CHECKPOINT_GIT (the only state with an edge into FINISH_READY),
  // record a critical verdict (cmdGate persists the verdict to state before
  // exiting 2), then attempt to advance into FINISH_READY (WF1's
  // terminal/delivery-adjacent state) — this must be rejected with exit code 6,
  // the new code documented in workflow-state.mjs superseding the dead
  // plugins/gates/nurikabe.js tool-gating attempt.
  const { cwd, wf } = mkWorkflow('wf1');
  let state = runOk([
    'init', '--cwd', cwd, '--workflow', wf,
    '--specialist', 'kantoku--workflow-director', '--phase', 'CHECKPOINT_GIT', '--session', 's1',
  ]);

  const gateArgs = [
    'gate', '--cwd', cwd, '--workflow', wf,
    '--gate', 'release', '--verdict', 'critical', '--session', 's1', '--caller', 'oni--red-team-reviewer',
  ];
  const criticalResult = run(gateArgs);
  expect(criticalResult.status).toBe(2);
  expect(criticalResult.stderr).toMatch(/critical gate "release" triggered/);

  const stateAfterCritical = runOk(['read', '--cwd', cwd, '--workflow', wf]);
  expect(stateAfterCritical.gate_verdicts.release).toBe('critical');
  const revAfterCritical = stateAfterCritical.rev;

  expectFailure([
    'advance', '--cwd', cwd, '--workflow', wf,
    '--to', 'FINISH_READY', '--expected-rev', String(revAfterCritical), '--session', 's1', '--caller', 'hanko--git-seal',
  ], 6, /terminal-transition blocked/);

  // Resolve the critical verdict — a later gate call for the same gate name
  // overwrites the recorded verdict, matching the "no corresponding
  // escalate/override recorded afterward" resolution rule.
  const resolved = runOk([
    'gate', '--cwd', cwd, '--workflow', wf,
    '--gate', 'release', '--verdict', 'escalate', '--session', 's1', '--caller', 'oni--red-team-reviewer',
  ]);
  expect(resolved.gate_verdicts.release).toBe('escalate');

  const afterEscalate = advance(cwd, wf, resolved.rev, 'FINISH_READY', 'hanko--git-seal');
  expect(afterEscalate.phase).toBe('FINISH_READY');
});
