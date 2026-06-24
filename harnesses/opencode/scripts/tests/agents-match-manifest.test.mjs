import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../lib/jsonc.mjs';

const FLEET_ROOT = join(import.meta.dir, '..', '..');
const manifest = JSON.parse(readFileSync(join(FLEET_ROOT, 'docs/routing-manifest.json'), 'utf8'));
const config = parseJsonc(readFileSync(join(FLEET_ROOT, 'config/opencode.jsonc'), 'utf8'));
const configAgents = config.agent ?? {};

const allAgents = {
  ...manifest.specialists,
  ...manifest.subagents,
};

for (const [name, entry] of Object.entries(allAgents)) {
  test(`opencode.jsonc agent["${name}"].model matches manifest primary`, () => {
    const cfg = configAgents[name];
    expect(cfg, `opencode.jsonc agent["${name}"] is missing`).not.toBeUndefined();
    expect(cfg.model, `opencode.jsonc agent["${name}"].model is missing`).not.toBeUndefined();
    expect(cfg.model).toBe(entry.primary);
  });
}

test('manifest covers all 30 agent config entries', () => {
  // opencode.jsonc must be the source of truth for runtime model assignments,
  // but the routing manifest must enumerate them so the canonical check has
  // something to compare against. Brand-builder assets are shelved under
  // future-work/ and are no longer part of the active fleet.
  const manifestNames = new Set([
    ...Object.keys(manifest.specialists ?? {}),
    ...Object.keys(manifest.subagents ?? {}),
  ]);
  const configNames = new Set(Object.keys(configAgents));
  for (const name of configNames) {
    expect(manifestNames.has(name), `${name} is in opencode.jsonc but not in any manifest section`).toBe(true);
  }
  for (const name of manifestNames) {
    expect(configNames.has(name), `${name} is in manifest but not in opencode.jsonc`).toBe(true);
  }
  expect(configNames.size).toBe(30);
});
