import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../lib/jsonc.mjs';
import { INTERIM_V2_FLEET } from '../lib/agent-fleet-map.mjs';

const FLEET_ROOT = join(import.meta.dir, '..', '..');
const manifest = JSON.parse(readFileSync(join(FLEET_ROOT, 'docs/routing-manifest.json'), 'utf8'));
const config = parseJsonc(readFileSync(join(FLEET_ROOT, 'config/opencode.jsonc'), 'utf8'));
const configAgents = config.agent ?? {};

// During interim v2, we only check the survivors that are still in routing-manifest.json.
// general/explore/scout are not in routing-manifest.json yet (Task 9).
const survivors = INTERIM_V2_FLEET.filter(name => !['general', 'explore', 'scout'].includes(name));

for (const name of survivors) {
  test(`opencode.jsonc agent["${name}"].model matches manifest primary`, () => {
    const manifestEntry = (manifest.specialists ?? {})[name] || (manifest.subagents ?? {})[name];
    const cfg = configAgents[name];
    expect(cfg, `opencode.jsonc agent["${name}"] is missing`).not.toBeUndefined();
    expect(cfg.model, `opencode.jsonc agent["${name}"].model is missing`).not.toBeUndefined();
    expect(cfg.model).toBe(manifestEntry.primary);
  });
}

test('config covers exactly the interim v2 fleet', () => {
  const configNames = new Set(Object.keys(configAgents));
  expect(configNames.size).toBe(INTERIM_V2_FLEET.length);
  for (const name of INTERIM_V2_FLEET) {
    expect(configNames.has(name), `${name} is missing from opencode.jsonc`).toBe(true);
  }
});
