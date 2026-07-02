import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

const mkWorkflow = (wf) => ({
  cwd: mkdtempSync(join(tmpdir(), `${wf}-smoke-`)),
  wf,
});

const writeJson = (filePath, value) => {
  mkdirSync(filePath.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
};

const runFinanceStatus = (root, subject) => {
  const result = spawnSync('bun', ['scripts/knowledge-bank-finance.mjs', 'status', '--subject', subject, '--root', root], {
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
};

const seedFinanceStatusFixture = (root, subject = 'acme') => {
  const subjectDir = join(root, 'research', 'financial', subject);
  writeJson(join(subjectDir, 'bank-manifest.json'), {
    subject_identity: {
      company: 'Acme Corp',
      ticker: 'ACME',
      exchange: 'NYSE',
      jurisdiction: 'US',
      currency: 'USD',
    },
    last_run: {
      mode: 'quick_update',
      operation: 'bank_status',
      at: '2026-07-01T12:00:00.000Z',
    },
    thesis_status: 'monitoring',
    entries: [
      {
        id: 'entry-1',
        subject,
        title: 'Revenue up',
        issuer: 'Acme Corp',
        period: 'FY2025',
        source_url: 'https://example.com/filing',
        retrieved_date: '2026-07-01',
        currency_unit: 'USD_millions',
        confidence: 'high',
        validation_status: 'verified',
        producing_module: 'finance_xbrl_extract',
      },
    ],
    known_conflicts: ['Margin guidance differs from transcript'],
    open_gaps: ['No peer comps refresh'],
  });
  writeJson(join(subjectDir, 'artifact-registry.json'), {
    artifacts: [
      {
        id: 'artifact-1',
        name: 'latest-filing.json',
        kind: 'filing',
        path: 'artifacts/latest-filing.json',
        updated_at: '2026-07-01T10:00:00.000Z',
        validation_status: 'verified',
      },
    ],
  });
  writeJson(join(subjectDir, 'source-registry.json'), {
    sources: [
      {
        id: 'src-1',
        class: 'issuer',
        license: 'public',
        timestamp: '2026-07-01T09:00:00.000Z',
        url: 'https://example.com/filing',
      },
    ],
  });
};

const specialists = {
  wf1: 'deep-researcher',
  wf2: 'debugger',
  wf3: 'security-owner',
  wf4: 'research-owner',
  wf5: 'finance-owner',
};

const initWorkflow = (wf, phase = 'RECEIVED', session = 's1') => {
  const flow = mkWorkflow(wf);
  const state = runOk([
    'init', '--cwd', flow.cwd, '--workflow', flow.wf,
    '--specialist', specialists[wf], '--phase', phase, '--session', session,
  ]);
  return { ...flow, session, state };
};

const advance = (flow, to) => {
  flow.state = runOk([
    'advance', '--cwd', flow.cwd, '--workflow', flow.wf,
    '--to', to, '--expected-rev', String(flow.state.rev),
    '--session', flow.session, '--caller', specialists[flow.wf],
  ]);
  return flow.state;
};

const expectIllegalTransition = (flow, to, pattern) => {
  expectFailure([
    'advance', '--cwd', flow.cwd, '--workflow', flow.wf,
    '--to', to, '--expected-rev', String(flow.state.rev),
    '--session', flow.session, '--caller', specialists[flow.wf],
  ], 1, pattern);
};

const walk = (flow, states) => {
  for (const nextState of states) advance(flow, nextState);
  return flow.state;
};

test('WF1 smoke: happy path reaches TMP_CLEANUP_OFFER and verify cap escalates to BLOCKED_CLARIFY only', () => {
  const happy = initWorkflow('wf1');
  walk(happy, [
    'ROUTED',
    'DISCUSSION_MEMORY_READ',
    'SPEC_DRAFT',
    'USER_SCOPE_REVIEW',
    'RECON',
    'PLAN_DRAFT',
    'USER_PLAN_REVIEW',
    'IMPLEMENT_ANALYSIS',
    'SIMPLE_IMPLEMENT',
    'VERIFY_PREP',
    'VERIFY',
    'REVIEW',
    'CHECKPOINT_GIT',
    'FINISH_READY',
    'GIT_HANDOFF',
    'LEARN_OFFER',
    'TMP_CLEANUP_OFFER',
  ]);
  expect(happy.state.phase).toBe('TMP_CLEANUP_OFFER');

  const capped = initWorkflow('wf1', 'VERIFY');
  walk(capped, ['FIX_ANALYSIS', 'SIMPLE_IMPLEMENT', 'VERIFY_PREP', 'VERIFY']);
  walk(capped, ['FIX_ANALYSIS', 'SIMPLE_IMPLEMENT', 'VERIFY_PREP', 'VERIFY']);
  expectIllegalTransition(capped, 'FIX_ANALYSIS', /loop cap reached for verify/);
  advance(capped, 'BLOCKED_CLARIFY');
  expect(capped.state.phase).toBe('BLOCKED_CLARIFY');

  const illegal = initWorkflow('wf1');
  expectIllegalTransition(illegal, 'PLAN_DRAFT', /invalid transition for wf1: RECEIVED -> PLAN_DRAFT/);
});

test('WF2 smoke: 3rd hypothesis loop escalates to ARCHITECTURE_QUESTION and fix path includes REGRESSION_GUARD', () => {
  const flow = initWorkflow('wf2');
  walk(flow, [
    'ROUTED',
    'BUG_CONTEXT_READ',
    'REPRO_ATTEMPT',
    'RECON',
    'EVIDENCE_GATHERING',
    'MINIMIZE',
    'ROOT_CAUSE_ANALYSIS',
    'HYPOTHESIS_TEST',
    'EVIDENCE_GATHERING',
    'MINIMIZE',
    'ROOT_CAUSE_ANALYSIS',
    'HYPOTHESIS_TEST',
    'EVIDENCE_GATHERING',
    'MINIMIZE',
    'ROOT_CAUSE_ANALYSIS',
    'HYPOTHESIS_TEST',
    'ARCHITECTURE_QUESTION',
    'FIX_ANALYSIS',
    'SIMPLE_FIX',
    'REGRESSION_GUARD',
    'VERIFY_PREP',
    'VERIFY',
    'REVIEW',
    'CHECKPOINT_GIT',
    'FINISH_READY',
    'GIT_HANDOFF',
    'LEARN_OFFER',
    'TMP_CLEANUP_OFFER',
  ]);
  expect(flow.state.phase).toBe('TMP_CLEANUP_OFFER');

  const illegal = initWorkflow('wf2');
  walk(illegal, ['ROUTED', 'BUG_CONTEXT_READ', 'REPRO_ATTEMPT']);
  expectIllegalTransition(illegal, 'FIX_ANALYSIS', /invalid transition for wf2: REPRO_ATTEMPT -> FIX_ANALYSIS/);
});

test('WF3 smoke: risk acceptance path reaches handoff and critical path cannot jump straight to GIT_HANDOFF', () => {
  const flow = initWorkflow('wf3');
  walk(flow, [
    'ROUTED',
    'SECURITY_SCOPE_READ',
    'SECURITY_TOOLING_READINESS',
    'RECON',
    'THREAT_MODEL',
    'SECURITY_ANALYSIS_PLAN',
    'STATIC_AND_SUPPLY_CHAIN_ANALYSIS',
    'FINDINGS_CLASSIFICATION',
    'RISK_ACCEPTANCE_REVIEW',
    'REVIEW',
    'FINISH_READY',
    'GIT_HANDOFF',
    'LEARN_OFFER',
    'TMP_CLEANUP_OFFER',
  ]);
  expect(flow.state.phase).toBe('TMP_CLEANUP_OFFER');

  const illegal = initWorkflow('wf3');
  walk(illegal, [
    'ROUTED',
    'SECURITY_SCOPE_READ',
    'SECURITY_TOOLING_READINESS',
    'RECON',
    'THREAT_MODEL',
    'SECURITY_ANALYSIS_PLAN',
    'STATIC_AND_SUPPLY_CHAIN_ANALYSIS',
    'FINDINGS_CLASSIFICATION',
    'RISK_ACCEPTANCE_REVIEW',
  ]);
  expectIllegalTransition(illegal, 'GIT_HANDOFF', /invalid transition for wf3: RISK_ACCEPTANCE_REVIEW -> GIT_HANDOFF/);
});

test('WF4 smoke: quick-answer path ends at DELIVERY and blocks persistence follow-up', () => {
  const flow = initWorkflow('wf4');
  walk(flow, [
    'ROUTED',
    'LIGHT_SCOPE',
    'RESEARCH_BRIEF',
    'USER_BRIEF_REVIEW',
    'QUICK_ANSWER',
    'DELIVERY',
  ]);
  expect(flow.state.phase).toBe('DELIVERY');
  expectIllegalTransition(flow, 'PERSISTENCE_DECISION', /invalid transition for wf4: DELIVERY -> PERSISTENCE_DECISION/);
});

test('WF5 smoke: engine-level gap loop cap falls through to SYNTHESIS and terminal COMPLETE is reachable', () => {
  const flow = initWorkflow('wf5');
  walk(flow, [
    'INTENT_CLASSIFY',
    'MODE_SELECTION',
    'BANK_STATUS',
    'ARTIFACT_AUDIT',
    'REUSE_DECISION',
    'SOURCE_SCREENING',
    'SOURCE_GATHERING',
    'EXTRACTION',
    'NORMALIZE',
    'MODULE_EXECUTION',
    'FRESHNESS_VERIFY',
    'CROSS_VERIFY',
    'GAP_LOOP',
    'SOURCE_GATHERING',
    'EXTRACTION',
    'NORMALIZE',
    'MODULE_EXECUTION',
    'FRESHNESS_VERIFY',
    'CROSS_VERIFY',
    'GAP_LOOP',
  ]);
  expectIllegalTransition(flow, 'SOURCE_GATHERING', /loop cap reached for gap_loop/);
  walk(flow, [
    'SYNTHESIS',
    'REVIEW',
    'DELIVERY',
    'BANK_UPDATE_DECISION',
    'PERSISTENCE_DECISION',
    'LEARN_OFFER',
    'TMP_CLEANUP_OFFER',
    'COMPLETE',
  ]);
  expect(flow.state.phase).toBe('COMPLETE');

  const illegal = initWorkflow('wf5');
  walk(illegal, ['INTENT_CLASSIFY', 'BANK_STATUS']);
  expectIllegalTransition(illegal, 'COMPLETE', /invalid transition for wf5: BANK_STATUS -> COMPLETE/);
});

test('WF5 smoke: engine-level model_validate loop cap falls through to BLOCKED_CLARIFY', () => {
  const flow = initWorkflow('wf5');
  walk(flow, [
    'INTENT_CLASSIFY',
    'MODE_SELECTION',
    'BANK_STATUS',
    'ARTIFACT_AUDIT',
    'REUSE_DECISION',
    'SOURCE_SCREENING',
    'SOURCE_GATHERING',
    'EXTRACTION',
    'NORMALIZE',
    'MODULE_EXECUTION',
    'MODEL_COMPUTE',
    'MODEL_VALIDATE',
    'MODEL_COMPUTE',
    'MODEL_VALIDATE',
    'MODEL_COMPUTE',
    'MODEL_VALIDATE',
  ]);
  expectIllegalTransition(flow, 'MODEL_COMPUTE', /loop cap reached for model_validate/);
  walk(flow, ['BLOCKED_CLARIFY', 'MODE_SELECTION']);
  expect(flow.state.phase).toBe('MODE_SELECTION');
});

test('WF5 smoke: BANK_STATUS fixture subject produces the expected status card', () => {
  const root = mkdtempSync(join(tmpdir(), 'wf5-bank-status-'));
  seedFinanceStatusFixture(root);

  const card = runFinanceStatus(root, 'acme');

  expect(card.subject_identity).toEqual({
    company: 'Acme Corp',
    ticker: 'ACME',
    exchange: 'NYSE',
    jurisdiction: 'US',
    currency: 'USD',
  });
  expect(card.last_run).toEqual({
    mode: 'quick_update',
    operation: 'bank_status',
    at: '2026-07-01T12:00:00.000Z',
  });
  expect(card.available_artifacts).toContain('latest-filing.json');
  expect(card.current_thesis_status).toBe('monitoring');
  expect(card.known_conflicts_or_open_gaps).toEqual([
    'Margin guidance differs from transcript',
    'No peer comps refresh',
  ]);
});
