// Compaction Injector — injects active workflow state into session compaction.
// Part of Furaidē's shikigami — F.R.I.D.A.Y. collection (https://github.com/pratty010/F.R.I.D.A.Y)
/**
 * Uses `experimental.session.compacting` per https://opencode.ai/docs/plugins/
 * (fetched 2026-07-02), which documents compaction prompt/context injection.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;
export const HOOK_EVENT = 'experimental.session.compacting';

function activeWorkflowId(cwd = process.cwd()) {
  const file = join(cwd, '.opencode-active-workflow');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

function readWorkflowSummary(cwd = process.cwd()) {
  const workflow = activeWorkflowId(cwd);
  if (!workflow) return '';
  const raw = execFileSync('bun', [join(FLEET_ROOT, 'scripts/workflow-state.mjs'), 'read', '--cwd', cwd, '--workflow', workflow], { encoding: 'utf8', timeout: 5000 });
  const state = JSON.parse(raw);
  const verdicts = Object.entries(state.gate_verdicts || {}).map(([gate, verdict]) => `${gate}:${verdict}`).join(', ') || 'none';
  const sessions = Array.isArray(state.sessions) ? state.sessions.length : 0;
  return ['## Active Workflow State', `workflow_id: ${state.workflow_id}`, `specialist: ${state.specialist}`, `phase: ${state.phase}`, `gate_verdicts: ${verdicts}`, `next_action: ${state.next_action || 'none'}`, `sessions: ${sessions}`].join('\n');
}

export function __test_hookFor(deps = {}) {
  return async function sessionCompacting(input = {}, output = {}) {
    // experimental.session.compacting's real input type only has {sessionID}, no cwd field.
    const summary = (deps.readSummary || readWorkflowSummary)(deps.directory || process.cwd());
    if (!summary) return;
    output.context ||= [];
    output.context.push(summary);
  };
}

/** Factory returning the plugin object — used by the package export in src/index.ts */
export async function createCompactionInjectorPlugin(input = {}) {
  return {
    name: 'compaction-injector',
    hooks: {
      [HOOK_EVENT]: __test_hookFor({ directory: input.directory }),
    },
  };
}

export const CompactionInjectorPlugin = async (input = {}) => ({
  [HOOK_EVENT]: __test_hookFor({ directory: input.directory }),
});

export default CompactionInjectorPlugin;
