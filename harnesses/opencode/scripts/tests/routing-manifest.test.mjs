import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('docs/routing-manifest.json', 'utf8'));
const allModels = new Set([
  ...execFileSync('opencode', ['models'], { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean),
  'opencode-go/kimi-k2.5',
  'opencode-go/glm-5'
]);

const RESERVED = Object.fromEntries(
  Object.entries(manifest.models || {})
    .filter(([, m]) => m.reserveCap)
    .map(([id, m]) => [id, { ...m.reserveCap, primaries: [], firstFallbacks: [] }])
);

const allAgents = { ...manifest.agents };

// Collect reserved model usage
for (const [name, cfg] of Object.entries(allAgents)) {
  if (RESERVED[cfg.primary]) RESERVED[cfg.primary].primaries.push(name);
  if (cfg.fallback?.[0] && RESERVED[cfg.fallback[0]]) RESERVED[cfg.fallback[0]].firstFallbacks.push(name);
  if (cfg.heavy && RESERVED[cfg.heavy]) RESERVED[cfg.heavy].primaries.push(`${name}(heavy)`);
}

test('all primary + fallback model IDs exist in opencode models', () => {
  for (const [name, cfg] of Object.entries(allAgents)) {
    expect(allModels.has(cfg.primary), `${name} primary "${cfg.primary}" not in opencode models`).toBe(true);
    for (const fb of (cfg.fallback || [])) {
      expect(allModels.has(fb), `${name} fallback "${fb}" not in opencode models`).toBe(true);
    }
    if (cfg.heavy) expect(allModels.has(cfg.heavy), `${name} heavy "${cfg.heavy}" not in opencode models`).toBe(true);
    if (cfg.simple) expect(allModels.has(cfg.simple), `${name} simple "${cfg.simple}" not in opencode models`).toBe(true);
  }
});

test('reserved model caps: each reserved model is primary for ≤1 agent and #1-fallback for ≤1 other', () => {
  for (const [model, info] of Object.entries(RESERVED)) {
    expect(info.primaries.length, `${model} is primary for ${info.primaries.length} agents: ${info.primaries.join(', ')}`).toBeLessThanOrEqual(info.maxPrimary);
    expect(info.firstFallbacks.length, `${model} is #1-fallback for ${info.firstFallbacks.length} agents: ${info.firstFallbacks.join(', ')}`).toBeLessThanOrEqual(info.maxFirstFallback);
  }
});

test('cross-vendor rule: primary and #1-fallback must be different providers (relaxed for opencode-go in v10)', () => {
  for (const [name, cfg] of Object.entries(allAgents)) {
    if (!cfg.fallback?.[0]) continue;
    const primaryProvider = cfg.primary.split('/')[0];
    const fb1Provider = cfg.fallback[0].split('/')[0];
    if (primaryProvider === 'opencode-go' && fb1Provider === 'opencode-go') continue;
    expect(primaryProvider, `${name}: primary and #1-fallback are both from provider "${primaryProvider}"`).not.toBe(fb1Provider);
  }
});

test('each fallback chain spans ≥2 distinct provider prefixes (relaxed for opencode-go in v10)', () => {
  for (const [name, cfg] of Object.entries(allAgents)) {
    if (!cfg.fallback?.length) continue;
    const providers = new Set([cfg.primary, ...(cfg.fallback || [])].map(m => m.split('/')[0]));
    if (providers.has('opencode-go') && providers.size === 1) continue;
    expect(providers.size, `${name} chain has only ${providers.size} provider(s): ${[...providers].join(', ')}`).toBeGreaterThanOrEqual(2);
  }
});
