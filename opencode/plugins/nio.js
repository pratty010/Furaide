// Niō (Gate Enforcer) — Furaidē's guardian gate-spirit — bars tools when the workflow verdict turns critical.
// Part of Furaidē's shikigami — F.R.I.D.A.Y. collection (https://github.com/pratty010/F.R.I.D.A.Y)
/**
 * nio.js
 * opencode plugin: fail-closed gate enforcement.
 * Blocks mutating/external tools when the active workflow has an unresolved critical verdict.
 * Fails CLOSED (blocks) if the verdict cannot be read.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

// __FLEET_ROOT__ is populated by install-fleet.sh with this scope's install root.
// Fallback: plugin's own parent dir (../ from plugins/), then cwd (legacy).
const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;

const BLOCKED_TOOLS = new Set([
  'workflow-advance',
  'deliver',
  'bash',
  'edit',
  'webfetch',
  'websearch',
  'task',
]);

/**
 * __test_hookFor — exported for unit tests only.
 * ctx: { readVerdict: () => 'ok'|'warn'|'critical'|'warn-unresolved'|null }
 * Returns the hook function.
 */
export function __test_hookFor(ctx) {
  return async function toolExecuteBefore({ tool }) {
    if (!BLOCKED_TOOLS.has(tool)) return; // non-mutating tools always allowed

    let verdict;
    try {
      verdict = ctx.readVerdict();
    } catch {
      verdict = null;
    }

    if (verdict === null || verdict === undefined) {
      throw new Error(
        `gate-enforcer fail-closed: cannot read workflow verdict for tool "${tool}"`,
      );
    }

    if (verdict === 'critical' || verdict === 'warn-unresolved') {
      throw new Error(
        `gate-enforcer: blocked "${tool}" — active workflow has unresolved ${verdict} verdict`,
      );
    }
    // ok or warn: allow
  };
}

/**
 * Read the active workflow verdict for the current process cwd.
 * Returns 'ok' when no workflow is active (no .opencode-active-workflow file).
 * Returns null (fail-closed) when a workflow is active but the state cannot be read.
 */
function getActiveWorkflowVerdict() {
  const activeFile = join(process.cwd(), '.opencode-active-workflow');
  if (!existsSync(activeFile)) return 'ok'; // no active workflow → unblocked

  let workflowId;
  try {
    workflowId = readFileSync(activeFile, 'utf8').trim();
  } catch {
    return null; // unreadable → fail closed
  }

  if (!workflowId) return 'ok';

  try {
    let scriptPath = join(FLEET_ROOT, 'scripts/workflow-state.mjs');
    if (!existsSync(scriptPath)) scriptPath = join(process.cwd(), 'scripts/workflow-state.mjs');
    const raw = execFileSync('bun', [
      scriptPath,
      'read', '--cwd', process.cwd(), '--workflow', workflowId,
    ], { encoding: 'utf8', timeout: 5000 });
    const state = JSON.parse(raw);
    const verdicts = Object.values(state.gate_verdicts || {});
    if (verdicts.includes('critical')) return 'critical';
    if (verdicts.includes('warn-unresolved')) return 'warn-unresolved';
    return 'ok';
  } catch {
    return null; // unreadable → fail closed
  }
}

const realCtx = { readVerdict: getActiveWorkflowVerdict };
const realHook = __test_hookFor(realCtx);

export default {
  name: 'gate-enforcer',
  hooks: {
    'tool.execute.before': realHook,
  },
};
