// Migawari (Model Failover) — The substitute spirit that stands in with a fallback model when one fails.
// Part of Furaidē's shikigami — F.R.I.D.A.Y. collection (https://github.com/pratty010/F.R.I.D.A.Y)
/**
 * migawari.js
 * Manifest-driven cross-vendor model failover plugin.
 * On retryable model/provider errors, walks the agent's fallback chain
 * and logs each transition to ~/.local/share/opencode/state/<slug>/failover.ndjson.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';

// __FLEET_ROOT__ is populated by install-fleet.sh with this scope's install root.
// Fallback: plugin's own parent dir (../ from plugins/), then cwd (legacy).
const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;

// Load manifest once at plugin init
let manifest = null;
function getManifest() {
  if (!manifest) {
    let p = join(FLEET_ROOT, 'docs', 'routing-manifest.json');
    if (!existsSync(p)) p = join(process.cwd(), 'docs', 'routing-manifest.json');
    manifest = JSON.parse(readFileSync(p, 'utf8'));
  }
  return manifest;
}

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

function logFailover(agentName, from, to, reason) {
  try {
    const slug = process.cwd().replace(/[/.]/g, '-');
    const dir = join(homedir(), '.local', 'share', 'opencode', 'state', slug);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), agent: agentName, from, to, reason }) + '\n';
    appendFileSync(join(dir, 'failover.ndjson'), line);
  } catch {}
}

// Exposed for unit tests
export { logFailover };

export default {
  name: 'model-failover',
  // opencode plugin hook: called when a model error occurs during a session
  hooks: {
    'model.error': async ({ agent, model, error, setModel }) => {
      if (classify(error) === 'fatal') return; // don't retry fatal errors
      const m = getManifest();
      const chain = resolveChain(m, agent);
      if (!chain) return;
      const next = nextModel(chain, model);
      if (!next) throw new Error(`model-failover: chain exhausted for agent "${agent}" after "${model}"`);
      logFailover(agent, model, next, error?.message ?? String(error));
      setModel(next);
    },
  },
};
