// Nurikabe (Delivery Gate) — The wall-spirit that holds the reply at the checkpoint until the verdict clears.
// Part of Furaidē's shikigami — F.R.I.D.A.Y. collection (https://github.com/pratty010/F.R.I.D.A.Y)
/**
 * nurikabe.js
 * opencode plugin: fail-closed response delivery gate.
 * Verified hook: `tool.execute.before` for the `deliver` tool per
 * https://opencode.ai/docs/plugins/ (fetched 2026-07-02). The live docs do not
 * document `response.before`; they do document `tool.execute.before`.
 * Blocks agent response delivery when active workflow has critical/warn-unresolved verdict.
 * No-op when no workflow is active. Mirrors gate-enforcer verdict-reading logic exactly.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

// __FLEET_ROOT__ is populated by install-fleet.sh with this scope's install root.
// Fallback: plugin's own grandparent dir (../../ from plugins/gates/), then cwd (legacy).
const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;
export const DOC_URL = 'https://opencode.ai/docs/plugins/';
export const HOOK_EVENT = 'tool.execute.before';

export function __test_hookFor(ctx) {
  return async function toolExecuteBefore({ tool } = {}) {
    if (tool !== 'deliver') return;

    let verdict;
    try {
      verdict = ctx.readVerdict();
    } catch {
      verdict = null;
    }

    if (verdict === null || verdict === undefined) {
      throw new Error(
        'delivery-gate fail-closed: cannot read workflow verdict before response delivery',
      );
    }

    if (verdict === 'critical' || verdict === 'warn-unresolved') {
      throw new Error(
        `delivery-gate: blocked response delivery — active workflow has unresolved ${verdict} verdict. Resolve gate before delivering.`,
      );
    }
    // ok or warn: allow
  };
}

function getActiveWorkflowVerdict() {
  const activeFile = join(process.cwd(), '.opencode-active-workflow');
  if (!existsSync(activeFile)) return 'ok';

  let workflowId;
  try {
    workflowId = readFileSync(activeFile, 'utf8').trim();
  } catch {
    return null;
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
    return null;
  }
}

const realHook = __test_hookFor({ readVerdict: getActiveWorkflowVerdict });

export default {
  name: 'delivery-gate',
  hooks: {
    [HOOK_EVENT]: realHook,
  },
};
