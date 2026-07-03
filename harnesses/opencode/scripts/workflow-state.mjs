#!/usr/bin/env node
/**
 * workflow-state.mjs
 * Sole writer for workflow state. Every specialist calls this at phase boundaries.
 * Never write state.json directly.
 *
 * Subcommands: init, read, advance, gate
 *
 * Exit codes:
 *   0 — success (state JSON on stdout)
 *   1 — general error
 *   2 — critical gate verdict
 *   5 — ownership rejection (caller not in the workflow's allowed-callers set)
 *   6 — terminal-transition blocked: unresolved critical gate verdict recorded for this
 *       workflow instance (next free code after 5/ownership; see WORKFLOW_TERMINAL_STATES
 *       and the H2 check in cmdAdvance — supersedes plugins/gates/nurikabe.js, which never
 *       had a real attachment point)
 *   9 — CAS conflict (stale expected-rev)
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
  fdatasyncSync,
  renameSync,
  appendFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import process from 'node:process';
import { acquire, release } from './lib/state-lock.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      a[k.slice(2)] = argv[++i];
    } else if (k.startsWith('--')) {
      a[k.slice(2)] = true;
    }
  }
  return a;
}

function cwdToSlug(absolutePath) {
  return absolutePath.replace(/[/.]/g, '-');
}

function toEdgeMap(entries) {
  return Object.fromEntries(entries.map(([from, to]) => [from, Object.freeze([...to])])) ;
}

const WORKFLOWS = Object.freeze({
  // WF1 transcribed from docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md
  // lines 311-379 (diagram), 570-597 (state table), 932-934 (loop caps).
  wf1: {
    initial: 'RECEIVED',
    states: Object.freeze([
      'RECEIVED', 'ROUTED', 'DISCUSSION_MEMORY_READ', 'SPEC_DRAFT', 'USER_SCOPE_REVIEW',
      'RECON', 'PLAN_DRAFT', 'USER_PLAN_REVIEW', 'IMPLEMENT_ANALYSIS', 'SIMPLE_IMPLEMENT',
      'COMPLEX_IMPLEMENT', 'PARALLEL_IMPLEMENT', 'SEQUENTIAL_IMPLEMENT', 'VERIFY_PREP',
      'VERIFY', 'FIX_ANALYSIS', 'REVIEW', 'CHECKPOINT_GIT', 'FINISH_READY', 'GIT_HANDOFF',
      'LEARN_OFFER', 'LEARN', 'TMP_CLEANUP_OFFER', 'BLOCKED_CLARIFY',
    ]),
    edges: toEdgeMap([
      ['RECEIVED', ['ROUTED']],
      ['ROUTED', ['DISCUSSION_MEMORY_READ', 'SIMPLE_IMPLEMENT', 'BLOCKED_CLARIFY']],
      ['DISCUSSION_MEMORY_READ', ['SPEC_DRAFT']],
      ['SPEC_DRAFT', ['USER_SCOPE_REVIEW']],
      ['USER_SCOPE_REVIEW', ['SPEC_DRAFT', 'RECON']],
      ['RECON', ['PLAN_DRAFT', 'BLOCKED_CLARIFY', 'SPEC_DRAFT']],
      ['PLAN_DRAFT', ['USER_PLAN_REVIEW']],
      ['USER_PLAN_REVIEW', ['PLAN_DRAFT', 'IMPLEMENT_ANALYSIS']],
      ['IMPLEMENT_ANALYSIS', ['SIMPLE_IMPLEMENT', 'COMPLEX_IMPLEMENT', 'PARALLEL_IMPLEMENT', 'SEQUENTIAL_IMPLEMENT']],
      ['SIMPLE_IMPLEMENT', ['VERIFY_PREP']],
      ['COMPLEX_IMPLEMENT', ['VERIFY_PREP', 'BLOCKED_CLARIFY']],
      ['PARALLEL_IMPLEMENT', ['VERIFY_PREP']],
      ['SEQUENTIAL_IMPLEMENT', ['VERIFY_PREP']],
      ['VERIFY_PREP', ['VERIFY']],
      ['VERIFY', ['REVIEW', 'FIX_ANALYSIS', 'BLOCKED_CLARIFY']],
      ['REVIEW', ['FIX_ANALYSIS', 'CHECKPOINT_GIT', 'BLOCKED_CLARIFY']],
      ['FIX_ANALYSIS', ['SIMPLE_IMPLEMENT', 'COMPLEX_IMPLEMENT', 'PARALLEL_IMPLEMENT', 'SEQUENTIAL_IMPLEMENT']],
      ['CHECKPOINT_GIT', ['FINISH_READY']],
      ['FINISH_READY', ['GIT_HANDOFF']],
      ['GIT_HANDOFF', ['LEARN_OFFER']],
      ['LEARN_OFFER', ['LEARN', 'TMP_CLEANUP_OFFER']],
      ['LEARN', ['TMP_CLEANUP_OFFER']],
      ['TMP_CLEANUP_OFFER', []],
      ['BLOCKED_CLARIFY', ['SPEC_DRAFT', 'PLAN_DRAFT']],
    ]),
    caps: Object.freeze({
      verify: Object.freeze({ phase: 'VERIFY', retry: ['FIX_ANALYSIS'], fallback: 'BLOCKED_CLARIFY', max: 3 }),
      review: Object.freeze({ phase: 'REVIEW', retry: ['FIX_ANALYSIS'], fallback: 'BLOCKED_CLARIFY', max: 2 }),
    }),
  },

  // WF2 transcribed from docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md
  // lines 1138-1195 (diagram), 1226-1255 (state table).
  wf2: {
    initial: 'RECEIVED',
    states: Object.freeze([
      'RECEIVED', 'ROUTED', 'BUG_CONTEXT_READ', 'REPRO_ATTEMPT', 'RECON', 'EVIDENCE_GATHERING',
      'MINIMIZE', 'ROOT_CAUSE_ANALYSIS', 'HYPOTHESIS_TEST', 'FIX_ANALYSIS', 'SIMPLE_FIX',
      'COMPLEX_FIX', 'PARALLEL_FIX', 'SEQUENTIAL_FIX', 'REGRESSION_GUARD', 'VERIFY_PREP',
      'VERIFY', 'REVIEW', 'ARCHITECTURE_QUESTION', 'CHECKPOINT_GIT', 'FINISH_READY',
      'GIT_HANDOFF', 'LEARN_OFFER', 'LEARN', 'TMP_CLEANUP_OFFER', 'BLOCKED_CLARIFY',
    ]),
    edges: toEdgeMap([
      ['RECEIVED', ['ROUTED']],
      ['ROUTED', ['BUG_CONTEXT_READ', 'BLOCKED_CLARIFY']],
      ['BUG_CONTEXT_READ', ['REPRO_ATTEMPT']],
      ['REPRO_ATTEMPT', ['RECON', 'BLOCKED_CLARIFY']],
      ['RECON', ['EVIDENCE_GATHERING', 'BLOCKED_CLARIFY']],
      ['EVIDENCE_GATHERING', ['MINIMIZE']],
      ['MINIMIZE', ['ROOT_CAUSE_ANALYSIS']],
      ['ROOT_CAUSE_ANALYSIS', ['HYPOTHESIS_TEST']],
      ['HYPOTHESIS_TEST', ['FIX_ANALYSIS', 'EVIDENCE_GATHERING', 'ARCHITECTURE_QUESTION']],
      ['FIX_ANALYSIS', ['SIMPLE_FIX', 'COMPLEX_FIX', 'PARALLEL_FIX', 'SEQUENTIAL_FIX']],
      ['SIMPLE_FIX', ['REGRESSION_GUARD']],
      ['COMPLEX_FIX', ['REGRESSION_GUARD']],
      ['PARALLEL_FIX', ['REGRESSION_GUARD']],
      ['SEQUENTIAL_FIX', ['REGRESSION_GUARD']],
      ['REGRESSION_GUARD', ['VERIFY_PREP']],
      ['VERIFY_PREP', ['VERIFY']],
      ['VERIFY', ['REVIEW', 'FIX_ANALYSIS', 'BLOCKED_CLARIFY']],
      ['REVIEW', ['FIX_ANALYSIS', 'CHECKPOINT_GIT', 'BLOCKED_CLARIFY']],
      ['ARCHITECTURE_QUESTION', ['ROOT_CAUSE_ANALYSIS', 'FIX_ANALYSIS', 'BLOCKED_CLARIFY']],
      ['CHECKPOINT_GIT', ['FINISH_READY']],
      ['FINISH_READY', ['GIT_HANDOFF']],
      ['GIT_HANDOFF', ['LEARN_OFFER']],
      ['LEARN_OFFER', ['LEARN', 'TMP_CLEANUP_OFFER']],
      ['LEARN', ['TMP_CLEANUP_OFFER']],
      ['TMP_CLEANUP_OFFER', []],
      ['BLOCKED_CLARIFY', ['BUG_CONTEXT_READ', 'ARCHITECTURE_QUESTION']],
    ]),
    caps: Object.freeze({
      hypothesis: Object.freeze({ phase: 'HYPOTHESIS_TEST', retry: ['EVIDENCE_GATHERING'], fallback: 'ARCHITECTURE_QUESTION', max: 3 }),
      verify: Object.freeze({ phase: 'VERIFY', retry: ['FIX_ANALYSIS'], fallback: 'BLOCKED_CLARIFY', max: 3 }),
      review: Object.freeze({ phase: 'REVIEW', retry: ['FIX_ANALYSIS'], fallback: 'BLOCKED_CLARIFY', max: 2 }),
    }),
  },

  // WF3 transcribed from docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md
  // lines 1470-1527 (diagram), 1576-1603 (state table).
  wf3: {
    initial: 'RECEIVED',
    states: Object.freeze([
      'RECEIVED', 'ROUTED', 'SECURITY_SCOPE_READ', 'SECURITY_TOOLING_READINESS', 'RECON',
      'THREAT_MODEL', 'SECURITY_ANALYSIS_PLAN', 'STATIC_AND_SUPPLY_CHAIN_ANALYSIS',
      'FINDINGS_CLASSIFICATION', 'FIX_ANALYSIS', 'SIMPLE_FIX', 'COMPLEX_FIX', 'PARALLEL_FIX',
      'SEQUENTIAL_FIX', 'VERIFY_PREP', 'VERIFY', 'RISK_ACCEPTANCE_REVIEW', 'REVIEW',
      'FINISH_READY', 'GIT_HANDOFF', 'LEARN_OFFER', 'LEARN', 'TMP_CLEANUP_OFFER',
      'BLOCKED_CLARIFY',
    ]),
    edges: toEdgeMap([
      ['RECEIVED', ['ROUTED']],
      ['ROUTED', ['SECURITY_SCOPE_READ', 'BLOCKED_CLARIFY']],
      ['SECURITY_SCOPE_READ', ['SECURITY_TOOLING_READINESS']],
      ['SECURITY_TOOLING_READINESS', ['RECON', 'BLOCKED_CLARIFY']],
      ['RECON', ['THREAT_MODEL', 'SECURITY_ANALYSIS_PLAN', 'BLOCKED_CLARIFY']],
      ['THREAT_MODEL', ['SECURITY_ANALYSIS_PLAN']],
      ['SECURITY_ANALYSIS_PLAN', ['STATIC_AND_SUPPLY_CHAIN_ANALYSIS']],
      ['STATIC_AND_SUPPLY_CHAIN_ANALYSIS', ['FINDINGS_CLASSIFICATION']],
      ['FINDINGS_CLASSIFICATION', ['FIX_ANALYSIS', 'RISK_ACCEPTANCE_REVIEW', 'VERIFY']],
      ['FIX_ANALYSIS', ['SIMPLE_FIX', 'COMPLEX_FIX', 'PARALLEL_FIX', 'SEQUENTIAL_FIX']],
      ['SIMPLE_FIX', ['VERIFY_PREP']],
      ['COMPLEX_FIX', ['VERIFY_PREP']],
      ['PARALLEL_FIX', ['VERIFY_PREP']],
      ['SEQUENTIAL_FIX', ['VERIFY_PREP']],
      ['VERIFY_PREP', ['VERIFY']],
      ['VERIFY', ['RISK_ACCEPTANCE_REVIEW', 'REVIEW', 'FIX_ANALYSIS', 'BLOCKED_CLARIFY']],
      ['RISK_ACCEPTANCE_REVIEW', ['FIX_ANALYSIS', 'REVIEW', 'BLOCKED_CLARIFY']],
      ['REVIEW', ['FIX_ANALYSIS', 'FINISH_READY', 'BLOCKED_CLARIFY']],
      ['FINISH_READY', ['GIT_HANDOFF']],
      ['GIT_HANDOFF', ['LEARN_OFFER']],
      ['LEARN_OFFER', ['LEARN', 'TMP_CLEANUP_OFFER']],
      ['LEARN', ['TMP_CLEANUP_OFFER']],
      ['TMP_CLEANUP_OFFER', []],
      ['BLOCKED_CLARIFY', ['SECURITY_SCOPE_READ', 'RISK_ACCEPTANCE_REVIEW']],
    ]),
    caps: Object.freeze({
      verify: Object.freeze({ phase: 'VERIFY', retry: ['FIX_ANALYSIS'], fallback: 'BLOCKED_CLARIFY', max: 3 }),
      review: Object.freeze({ phase: 'REVIEW', retry: ['FIX_ANALYSIS'], fallback: 'BLOCKED_CLARIFY', max: 2 }),
    }),
  },

  // WF4 transcribed from docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md
  // lines 1727-1796 (diagram), 1830-1859 (state table), plus WF5 cap note at 2162.
  wf4: {
    initial: 'RECEIVED',
    states: Object.freeze([
      'RECEIVED', 'ROUTED', 'LIGHT_SCOPE', 'RESEARCH_BRIEF', 'USER_BRIEF_REVIEW',
      'MODE_SELECTION', 'QUERY_FRONTIER', 'SEARCH_DISCOVERY', 'SOURCE_SCREENING',
      'FETCH_NATIVE', 'FETCH_PLUGIN_FALLBACK', 'NOTEBOOKLM_AUTH', 'NOTEBOOKLM_IMPORT',
      'NOTEBOOKLM_ANSWER', 'EVIDENCE_MATRIX', 'CITATION_VERIFY', 'GAP_LOOP', 'SYNTHESIS',
      'REVIEW', 'DELIVERY', 'PERSISTENCE_DECISION', 'LEARN_OFFER', 'LEARN',
      'TMP_CLEANUP_OFFER', 'QUICK_ANSWER', 'BLOCKED_CLARIFY',
    ]),
    edges: toEdgeMap([
      ['RECEIVED', ['ROUTED']],
      ['ROUTED', ['LIGHT_SCOPE', 'BLOCKED_CLARIFY']],
      ['LIGHT_SCOPE', ['RESEARCH_BRIEF', 'BLOCKED_CLARIFY']],
      ['RESEARCH_BRIEF', ['USER_BRIEF_REVIEW']],
      ['USER_BRIEF_REVIEW', ['RESEARCH_BRIEF', 'MODE_SELECTION', 'QUICK_ANSWER']],
      ['MODE_SELECTION', ['QUERY_FRONTIER', 'NOTEBOOKLM_AUTH', 'BLOCKED_CLARIFY']],
      ['QUERY_FRONTIER', ['SEARCH_DISCOVERY']],
      ['SEARCH_DISCOVERY', ['SOURCE_SCREENING', 'QUERY_FRONTIER']],
      ['SOURCE_SCREENING', ['FETCH_NATIVE']],
      ['FETCH_NATIVE', ['FETCH_PLUGIN_FALLBACK', 'EVIDENCE_MATRIX']],
      ['FETCH_PLUGIN_FALLBACK', ['EVIDENCE_MATRIX', 'QUERY_FRONTIER']],
      ['NOTEBOOKLM_AUTH', ['NOTEBOOKLM_IMPORT', 'QUERY_FRONTIER']],
      ['NOTEBOOKLM_IMPORT', ['NOTEBOOKLM_ANSWER']],
      ['NOTEBOOKLM_ANSWER', ['EVIDENCE_MATRIX']],
      ['EVIDENCE_MATRIX', ['CITATION_VERIFY']],
      ['CITATION_VERIFY', ['GAP_LOOP', 'SYNTHESIS']],
      ['GAP_LOOP', ['QUERY_FRONTIER', 'SOURCE_SCREENING', 'SYNTHESIS']],
      ['SYNTHESIS', ['REVIEW']],
      ['REVIEW', ['GAP_LOOP', 'DELIVERY']],
      ['DELIVERY', ['PERSISTENCE_DECISION']],
      ['PERSISTENCE_DECISION', ['LEARN_OFFER']],
      ['LEARN_OFFER', ['LEARN', 'TMP_CLEANUP_OFFER']],
      ['LEARN', ['TMP_CLEANUP_OFFER']],
      ['TMP_CLEANUP_OFFER', []],
      ['QUICK_ANSWER', ['DELIVERY']],
      ['BLOCKED_CLARIFY', ['LIGHT_SCOPE']],
    ]),
    caps: Object.freeze({
      gap_loop: Object.freeze({ phase: 'GAP_LOOP', retry: ['QUERY_FRONTIER', 'SOURCE_SCREENING'], fallback: 'SYNTHESIS', max: 2 }),
    }),
  },

  // WF5 transcribed from docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md
  // lines 2108-2164 (diagram/caps), 2166-2200 (state table).
  wf5: {
    initial: 'RECEIVED',
    states: Object.freeze([
      'RECEIVED', 'INTENT_CLASSIFY', 'MODE_SELECTION', 'DIRECT_OPERATION', 'BANK_STATUS',
      'BANK_QUERY', 'ARTIFACT_AUDIT', 'REUSE_DECISION', 'REFRESH_PLAN', 'SOURCE_SCREENING',
      'SOURCE_POLICY_GATE', 'SOURCE_GATHERING', 'EXTRACTION', 'NORMALIZE', 'ASSUMPTION_LOCK',
      'MODULE_EXECUTION', 'MODEL_COMPUTE', 'MODEL_VALIDATE', 'FRESHNESS_VERIFY',
      'CROSS_VERIFY', 'GAP_LOOP', 'SYNTHESIS', 'REVIEW', 'DELIVERY', 'BANK_UPDATE_DECISION',
      'PERSISTENCE_DECISION', 'LEARN_OFFER', 'LEARN', 'TMP_CLEANUP_OFFER', 'COMPLETE',
      'BLOCKED_CLARIFY',
    ]),
    edges: toEdgeMap([
      ['RECEIVED', ['INTENT_CLASSIFY']],
      ['INTENT_CLASSIFY', ['MODE_SELECTION', 'DIRECT_OPERATION', 'BANK_STATUS']],
      ['MODE_SELECTION', ['BANK_STATUS']],
      ['DIRECT_OPERATION', ['BANK_STATUS']],
      ['BANK_STATUS', ['BANK_QUERY', 'ARTIFACT_AUDIT']],
      ['BANK_QUERY', ['BANK_STATUS']],
      ['ARTIFACT_AUDIT', ['REUSE_DECISION']],
      ['REUSE_DECISION', ['REFRESH_PLAN', 'SOURCE_SCREENING']],
      ['REFRESH_PLAN', ['SOURCE_SCREENING']],
      ['SOURCE_SCREENING', ['SOURCE_POLICY_GATE', 'SOURCE_GATHERING']],
      ['SOURCE_POLICY_GATE', ['SOURCE_GATHERING', 'BLOCKED_CLARIFY']],
      ['SOURCE_GATHERING', ['EXTRACTION']],
      ['EXTRACTION', ['NORMALIZE']],
      ['NORMALIZE', ['ASSUMPTION_LOCK', 'MODULE_EXECUTION']],
      ['ASSUMPTION_LOCK', ['MODULE_EXECUTION']],
      ['MODULE_EXECUTION', ['MODEL_COMPUTE', 'FRESHNESS_VERIFY']],
      ['MODEL_COMPUTE', ['MODEL_VALIDATE']],
      ['MODEL_VALIDATE', ['FRESHNESS_VERIFY', 'MODEL_COMPUTE', 'ASSUMPTION_LOCK', 'BLOCKED_CLARIFY']],
      ['FRESHNESS_VERIFY', ['CROSS_VERIFY']],
      ['CROSS_VERIFY', ['GAP_LOOP', 'SYNTHESIS']],
      ['GAP_LOOP', ['SOURCE_GATHERING', 'SYNTHESIS']],
      ['SYNTHESIS', ['REVIEW']],
      ['REVIEW', ['SYNTHESIS', 'DELIVERY', 'BLOCKED_CLARIFY']],
      ['DELIVERY', ['BANK_UPDATE_DECISION']],
      ['BANK_UPDATE_DECISION', ['PERSISTENCE_DECISION']],
      ['PERSISTENCE_DECISION', ['LEARN_OFFER']],
      ['LEARN_OFFER', ['LEARN', 'TMP_CLEANUP_OFFER']],
      ['LEARN', ['TMP_CLEANUP_OFFER']],
      ['TMP_CLEANUP_OFFER', ['COMPLETE']],
      ['COMPLETE', []],
      ['BLOCKED_CLARIFY', ['MODE_SELECTION']],
    ]),
    caps: Object.freeze({
      model_validate: Object.freeze({ phase: 'MODEL_VALIDATE', retry: ['MODEL_COMPUTE', 'ASSUMPTION_LOCK'], fallback: 'BLOCKED_CLARIFY', max: 3 }),
      gap_loop: Object.freeze({ phase: 'GAP_LOOP', retry: ['SOURCE_GATHERING'], fallback: 'SYNTHESIS', max: 2 }),
      review: Object.freeze({ phase: 'REVIEW', retry: ['SYNTHESIS'], fallback: 'BLOCKED_CLARIFY', max: 2 }),
    }),
  },
});

// ---------------------------------------------------------------------------
// DAG-based ownership (H4): per-workflow allowed-callers table.
//
// Each list is the set of agent names documented as owning at least one state
// in that workflow, per the state-ownership tables in
// docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md
// (WF1: lines ~570-597, WF2: ~1226-1255, WF3: ~1576-1603, WF4: ~1830-1859,
// WF5: ~2166-2200), cross-referenced against agents/*.md. Generic role labels
// in the spec tables ("build or general", "active implementer", "debugger",
// "primary/coordinator") are resolved here to the concrete agent(s) that fill
// that role. `state.specialist` (recorded at init) is kept as an audit/display
// field only — it is no longer the sole authorization gate; any agent in the
// workflow's list below may call `advance`/`gate` on that workflow instance.
// ---------------------------------------------------------------------------
const WORKFLOW_ALLOWED_CALLERS = Object.freeze({
  wf1: Object.freeze([
    'kantoku--workflow-director',
    'kyakuhon--spec-planner',
    'general',
    'build',
    'tsukumogami--code-forgemaster',
    'kagami--verifier',
    'oni--red-team-reviewer',
    'hanko--git-seal',
    'hansei--lesson-keeper',
  ]),
  wf2: Object.freeze([
    'kantoku--workflow-director',
    'bakeneko--bug-hunter',
    'kagami--verifier',
    'explore',
    'scout',
    'general',
    'build',
    'tsukumogami--code-forgemaster',
    'oni--red-team-reviewer',
    'hanko--git-seal',
    'hansei--lesson-keeper',
  ]),
  wf3: Object.freeze([
    'kantoku--workflow-director',
    'fudo--security-guardian',
    'explore',
    'scout',
    'general',
    'build',
    'tsukumogami--code-forgemaster',
    'kagami--verifier',
    'oni--red-team-reviewer',
    'hanko--git-seal',
    'hansei--lesson-keeper',
  ]),
  wf4: Object.freeze([
    'kantoku--workflow-director',
    'tsuchigumo--research-weaver',
    'kagami--verifier',
    'oni--red-team-reviewer',
    'general',
    'build',
    'hansei--lesson-keeper',
  ]),
  wf5: Object.freeze([
    'kantoku--workflow-director',
    'kura--knowledge-banker',
    'daikoku--finance-steward',
    'tsuchigumo--research-weaver',
    'general',
    'kagami--verifier',
    'oni--red-team-reviewer',
    'hansei--lesson-keeper',
  ]),
});

// ---------------------------------------------------------------------------
// Delivery gate (H2): per-workflow terminal/delivery-adjacent state.
//
// This is the state whose incoming transition must be blocked when the
// workflow instance carries an unresolved `critical` gate verdict. WF1-WF3
// share the same shape (REVIEW/RISK_ACCEPTANCE_REVIEW -> ... -> FINISH_READY
// -> GIT_HANDOFF): FINISH_READY is the "about to hand off" checkpoint. WF4
// and WF5 both have a state literally named DELIVERY immediately after
// REVIEW/SYNTHESIS — the direct analog of the "deliver" action
// plugins/gates/nurikabe.js originally (and never successfully) tried to gate.
// Supersedes nurikabe.js; see its SUPERSEDED header.
// ---------------------------------------------------------------------------
const WORKFLOW_TERMINAL_STATES = Object.freeze({
  wf1: 'FINISH_READY',
  wf2: 'FINISH_READY',
  wf3: 'FINISH_READY',
  wf4: 'DELIVERY',
  wf5: 'DELIVERY',
});

const WORKFLOW_ALIASES = Object.freeze({
  w1: 'wf1',
  w2: 'wf2',
  w3: 'wf3',
  w4: 'wf4',
  w5: 'wf5',
});

function resolveWorkflowConfig(workflow) {
  const normalized = WORKFLOW_ALIASES[String(workflow || '').toLowerCase()] || String(workflow || '').toLowerCase();
  const config = WORKFLOWS[normalized];
  if (!config) {
    die(`unknown workflow: "${workflow}". Valid: ${Object.keys(WORKFLOWS).join(', ')}`);
  }
  return { workflowId: normalized, config };
}

function assertValidState(config, phase, context) {
  if (!config.states.includes(phase)) {
    die(`${context} must be one of ${config.states.join(', ')}`);
  }
}

function canResumeBlockedState(state, to) {
  return state.phase === 'BLOCKED_CLARIFY' && state.blocked_from_phase && state.blocked_from_phase === to;
}

function assertAllowedTransition(state, config, to) {
  if (state.workflow_id === 'wf4' && state.phase === 'DELIVERY' && state.previous_phase === 'QUICK_ANSWER') {
    die(`invalid transition for ${state.workflow_id}: ${state.phase} -> ${to}`);
  }
  const allowed = config.edges[state.phase] || [];
  if (allowed.includes(to) || canResumeBlockedState(state, to)) return;
  die(`invalid transition for ${state.workflow_id}: ${state.phase} -> ${to}`);
}

function applyTransitionCaps(state, config, from, to) {
  const loopCounts = state.loop_counts || {};
  for (const [name, cap] of Object.entries(config.caps || {})) {
    if (from !== cap.phase) continue;
    const current = loopCounts[name] || 0;
    if (cap.retry.includes(to)) {
      const next = current + 1;
      if (next >= cap.max) {
        die(`loop cap reached for ${name}: ${from} cannot transition to ${to}; advance to ${cap.fallback}`);
      }
      loopCounts[name] = next;
      continue;
    }
    loopCounts[name] = 0;
  }
  state.loop_counts = loopCounts;
}

function resolveGateMaxIterations(config, gate, requestedMaxIterations) {
  const workflowCap = config.caps?.[String(gate || '').toLowerCase()]?.max;
  if (workflowCap === undefined) return requestedMaxIterations;
  return Number.isFinite(requestedMaxIterations)
    ? Math.min(requestedMaxIterations, workflowCap)
    : workflowCap;
}

function resolvePaths(cwd, workflow) {
  const home = process.env.HOME || process.env.USERPROFILE || '/root';
  const slug = cwdToSlug(resolve(cwd));
  const stateDir = join(home, '.local', 'share', 'opencode', 'state', slug, workflow);
  const statePath = join(stateDir, 'state.json');
  const journalPath = join(stateDir, 'journal.ndjson');
  const lockPath = join(stateDir, '.lock');
  return { stateDir, statePath, journalPath, lockPath };
}

function readState(statePath) {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

/**
 * Atomically write state: write to tmp, fdatasync, rename.
 */
function writeStateAtomic(statePath, state) {
  const tmpPath = statePath + '.tmp.' + process.pid;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  const fd = openSync(tmpPath, 'r+');
  try {
    fdatasyncSync(fd);
  } finally {
    try { closeSync(fd); } catch {}
  }
  renameSync(tmpPath, statePath);
}

function appendJournal(journalPath, entry) {
  appendFileSync(journalPath, JSON.stringify(entry) + '\n', 'utf8');
}

class ExitError extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code;
  }
}

function die(msg, code = 1) {
  throw new ExitError(msg, code);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdInit(args) {
  const { cwd, workflow, specialist, phase, session } = args;
  if (!cwd || !workflow || !specialist || !session) {
    die('init requires --cwd, --workflow, --specialist, --session');
  }

  const { workflowId, config } = resolveWorkflowConfig(workflow);
  const initialPhase = phase || config.initial;
  assertValidState(config, initialPhase, '--phase');

  const { stateDir, statePath, journalPath, lockPath } = resolvePaths(cwd, workflowId);
  mkdirSync(stateDir, { recursive: true });

  const handle = await acquire(lockPath, { session, ttlMs: 30000 });
  try {
    const state = {
      workflow_id: workflowId,
      specialist,
      phase: initialPhase,
      workflow_states: [...config.states],
      decisions: {},
      artifacts: {},
      gate_verdicts: {},
      warn_counts: {},
      loop_counts: {},
      next_action: null,
      governing_file: null,
      blocked_from_phase: null,
      previous_phase: null,
      rev: 1,
      sessions: [session],
    };

    writeStateAtomic(statePath, state);
    appendJournal(journalPath, {
      ts: new Date().toISOString(),
      op: 'init',
        session,
        caller: specialist,
        from: null,
        to: initialPhase,
        rev: 1,
      });

    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  } finally {
    await release(handle);
  }
}

async function cmdRead(args) {
  const { cwd, workflow } = args;
  if (!cwd || !workflow) die('read requires --cwd and --workflow');

  const { workflowId } = resolveWorkflowConfig(workflow);
  const { statePath } = resolvePaths(cwd, workflowId);
  const state = readState(statePath);
  if (!state) die('state.json not found — run init first');
  process.stdout.write(JSON.stringify(state, null, 2) + '\n');
}

async function cmdAdvance(args) {
  const { cwd, workflow, to, session, caller } = args;
  const expectedRev = args['expected-rev'] !== undefined ? parseInt(args['expected-rev'], 10) : undefined;

  if (!cwd || !workflow || !to || !session || !caller || expectedRev === undefined) {
    die('advance requires --cwd, --workflow, --to, --expected-rev, --session, --caller');
  }

  const { workflowId, config } = resolveWorkflowConfig(workflow);
  assertValidState(config, to, '--to');

  const { stateDir, statePath, journalPath, lockPath } = resolvePaths(cwd, workflowId);
  mkdirSync(stateDir, { recursive: true });

  const handle = await acquire(lockPath, { session, ttlMs: 30000 });
  try {
    const state = readState(statePath);
    if (!state) die('state.json not found — run init first');

    // Ownership check (H4: DAG-based allowed-callers, not single-owner-for-life)
    if (!WORKFLOW_ALLOWED_CALLERS[workflowId].includes(caller)) {
      die(
        `ownership: caller="${caller}" is not an allowed caller for ${workflowId} (allowed: ${WORKFLOW_ALLOWED_CALLERS[workflowId].join(', ')})`,
        5,
      );
    }

    // CAS check
    if (expectedRev !== state.rev) {
      die(`conflict: expected rev=${expectedRev} but current rev=${state.rev}`, 9);
    }

    const fromPhase = state.phase;
    assertAllowedTransition(state, config, to);

    // H2: delivery gate, enforced at the workflow-state layer (supersedes
    // plugins/gates/nurikabe.js, which bound to a nonexistent `deliver` tool
    // and never fired). Block entry into the workflow's terminal/delivery
    // state while any recorded gate verdict is still `critical` — i.e. no
    // later verdict for that same gate has overwritten it (escalate/override).
    if (to === WORKFLOW_TERMINAL_STATES[workflowId]) {
      const verdicts = Object.values(state.gate_verdicts || {});
      if (verdicts.includes('critical')) {
        die(
          `terminal-transition blocked: ${workflowId} has an unresolved critical gate verdict; cannot advance to ${to}. Resolve or escalate the verdict first.`,
          6,
        );
      }
    }

    applyTransitionCaps(state, config, fromPhase, to);
    state.phase = to;
    state.workflow_states = state.workflow_states || [...config.states];
    state.blocked_from_phase = to === 'BLOCKED_CLARIFY' ? fromPhase : null;
    state.previous_phase = fromPhase;
    if (!state.sessions.includes(session)) state.sessions.push(session);
    state.rev += 1;

    writeStateAtomic(statePath, state);
    appendJournal(journalPath, {
      ts: new Date().toISOString(),
      op: 'advance',
      session,
      caller,
      from: fromPhase,
      to,
      rev: state.rev,
    });

    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  } finally {
    await release(handle);
  }
}

async function cmdGate(args) {
  const { cwd, workflow, gate, verdict, session, caller } = args;
  const requestedMaxIterations = args['max-iterations'] !== undefined
    ? parseInt(args['max-iterations'], 10)
    : Infinity;

  if (!cwd || !workflow || !gate || !verdict || !session || !caller) {
    die('gate requires --cwd, --workflow, --gate, --verdict, --session, --caller');
  }

  const { workflowId, config } = resolveWorkflowConfig(workflow);
  const maxIterations = resolveGateMaxIterations(config, gate, requestedMaxIterations);

  const { stateDir, statePath, journalPath, lockPath } = resolvePaths(cwd, workflowId);
  mkdirSync(stateDir, { recursive: true });

  const handle = await acquire(lockPath, { session, ttlMs: 30000 });
  try {
    const state = readState(statePath);
    if (!state) die('state.json not found — run init first');

    // Ownership check (H4: DAG-based allowed-callers, not single-owner-for-life)
    if (!WORKFLOW_ALLOWED_CALLERS[workflowId].includes(caller)) {
      die(
        `ownership: caller="${caller}" is not an allowed caller for ${workflowId} (allowed: ${WORKFLOW_ALLOWED_CALLERS[workflowId].join(', ')})`,
        5,
      );
    }

    if (!state.warn_counts) state.warn_counts = {};
    if (!state.gate_verdicts) state.gate_verdicts = {};

    if (verdict === 'warn') {
      state.warn_counts[gate] = (state.warn_counts[gate] || 0) + 1;
      if (state.warn_counts[gate] > maxIterations) {
        state.gate_verdicts[gate] = 'warn-unresolved';
      } else {
        state.gate_verdicts[gate] = verdict;
      }
    } else {
      state.gate_verdicts[gate] = verdict;
    }

    if (!state.sessions.includes(session)) state.sessions.push(session);
    state.rev += 1;

    writeStateAtomic(statePath, state);
    appendJournal(journalPath, {
      ts: new Date().toISOString(),
      op: 'gate',
      session,
      caller,
      gate,
      verdict: state.gate_verdicts[gate],
      rev: state.rev,
    });

    process.stdout.write(JSON.stringify(state, null, 2) + '\n');

    if (verdict === 'critical') die(`critical gate "${gate}" triggered`, 2);
  } finally {
    await release(handle);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (subcommand) {
    case 'init':    await cmdInit(args);    break;
    case 'read':    await cmdRead(args);    break;
    case 'advance': await cmdAdvance(args); break;
    case 'gate':    await cmdGate(args);    break;
    default:
      die(`Unknown subcommand: "${subcommand}". Valid: init, read, advance, gate`);
  }
}

main().catch((err) => {
  process.stderr.write(err instanceof ExitError ? err.message + '\n' : `Fatal: ${err.message}\n`);
  process.exit(err instanceof ExitError ? err.code : 1);
});
