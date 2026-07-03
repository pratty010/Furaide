// Migawari (Model Failover) — The substitute spirit that watches for a model going down and notes it.
// Part of Furaidē's shikigami — F.R.I.D.A.Y. collection (https://github.com/pratty010/F.R.I.D.A.Y)
/**
 * migawari.js
 *
 * SCOPE NOTE: automatic runtime model failover is NOT possible with the
 * OpenCode plugin SDK — there is no hook that can intercept a failed model
 * call and retry it with a different model (confirmed against
 * @opencode-ai/plugin's `Hooks` interface; the closest thing is the generic
 * `event` hook, which is `Promise<void>` with no mutable output — a pure
 * notification, not an interception point). Automatic model substitution
 * for this fleet happens at INSTALL TIME via `scripts/model-resolve.mjs`,
 * which swaps unavailable models before the fleet ever runs.
 *
 * This plugin is a PASSIVE NOTIFICATION/LOGGING hook only. It registers on
 * the generic `event` hook (the only hook the SDK exposes for this), filters
 * for `session.error` events, and appends a compact record to a failover
 * visibility log so an operator can see what happened. It does not and
 * cannot retry the call or swap the active model.
 *
 * The `resolveChain`/`nextModel`/`classify` pure functions are kept because
 * they're still useful for that visibility story (e.g. an operator or a
 * future tool consulting "what would the next fallback have been") — they
 * are no longer wired into a runtime interception path, because no such
 * path exists in this SDK version.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

// __FLEET_ROOT__ is populated by install-fleet.sh with this scope's install root.
// Fallback: plugin's own grandparent dir (../../ from plugins/failover/), then cwd (legacy).
const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;

export function resolveChain(manifest, agentName) {
  const entry = manifest.specialists?.[agentName] ?? manifest.subagents?.[agentName];
  if (!entry) return null;
  return [entry.primary, ...(entry.fallback ?? [])];
}

export function nextModel(chain, current) {
  const idx = chain.indexOf(current);
  if (idx === -1 || idx === chain.length - 1) return null;
  return chain[idx + 1];
}

export function classify(err) {
  const msg = String(err?.message ?? err ?? '');
  // Retryable: provider 429/5xx, timeout, model_not_found, rate limit
  if (/429|503|502|500|timeout|rate.?limit|model.?not.?found|overloaded/i.test(msg)) return 'retryable';
  // Non-retryable: auth, permission
  if (/401|403|auth|permission|api.?key/i.test(msg)) return 'fatal';
  return 'retryable'; // default: try next
}

// Mirrors audit-logger.js's convention: a session's active workflow (if any)
// is recorded in a marker file at the project root, and the workflow's log
// directory is resolved via scripts/state-path.mjs.
function activeWorkflowId(cwd = process.cwd()) {
  const file = join(cwd, '.opencode-active-workflow');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

function resolveFailoverLogPath(cwd, workflow) {
  const scriptPath = join(FLEET_ROOT, 'scripts', 'state-path.mjs');
  const raw = execFileSync('bun', [scriptPath, '--cwd', cwd, '--workflow', workflow], { encoding: 'utf8', timeout: 5000 });
  // Sibling to audit.jsonl inside the same workflow state dir.
  return join(JSON.parse(raw).stateDir, 'failover.jsonl');
}

// Flattens the SDK's discriminated error union (ProviderAuthError |
// UnknownError | MessageOutputLengthError | MessageAbortedError | ApiError)
// down to the fields that are actually useful in a log line.
function summarizeError(error) {
  if (!error) return { errorName: null, message: null };
  const data = error.data ?? {};
  const summary = { errorName: error.name ?? null, message: data.message ?? null };
  if (data.providerID !== undefined) summary.providerID = data.providerID;
  if (data.statusCode !== undefined) summary.statusCode = data.statusCode;
  if (typeof data.isRetryable === 'boolean') summary.isRetryable = data.isRetryable;
  return summary;
}

/**
 * Returns the `event` hook function. Deps are injectable for unit tests
 * (mirrors audit-logger.js's `__test_hookFor` pattern).
 */
export function __test_hookFor(deps = {}) {
  return async function onEvent({ event } = {}) {
    if (!event || event.type !== 'session.error') return;
    try {
      const cwd = deps.cwd || process.cwd();
      const workflow = (deps.getWorkflowId || activeWorkflowId)(cwd);
      if (!workflow) return; // no active workflow, nowhere to attribute the log
      const { sessionID = null, error } = event.properties || {};
      const line = {
        ts: (deps.now || (() => new Date().toISOString()))(),
        sessionID,
        ...summarizeError(error),
      };
      const logPath = (deps.resolveLogPath || resolveFailoverLogPath)(cwd, workflow);
      mkdirSync(dirname(logPath), { recursive: true });
      (deps.appendLine || appendFileSync)(logPath, `${JSON.stringify(line)}\n`, 'utf8');
    } catch {
      // Never let logging failures interrupt the session.
    }
  };
}

const realHook = __test_hookFor();

/** Factory returning the plugin object — used by the package export in src/index.ts. */
export async function createModelFailoverPlugin() {
  return {
    name: 'model-failover',
    hooks: {
      event: realHook,
    },
  };
}

export default {
  name: 'model-failover',
  // opencode plugin hook: the generic `event` hook is the only hook the SDK
  // exposes for observing model/session errors. It cannot retry or swap
  // models — see the SCOPE NOTE above. This is logging only.
  hooks: {
    event: realHook,
  },
};
