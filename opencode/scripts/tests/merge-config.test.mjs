import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPTS_DIR = join(import.meta.dir, '..');
const MERGE = join(SCRIPTS_DIR, 'merge-config.mjs');
const UNMERGE = join(SCRIPTS_DIR, 'unmerge-config.mjs');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'merge-cfg-'));
}

function runMerge(cfg, args = []) {
  return execFileSync('bun', [MERGE, cfg, ...args], { encoding: 'utf8' });
}

function runUnmerge(cfg, args = []) {
  return execFileSync('bun', [UNMERGE, cfg, ...args], { encoding: 'utf8' });
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Build a minimal source opencode.jsonc with an `agent` block
const FLEET_SOURCE = {
  '$schema': 'https://opencode.ai/config.json',
  plugin: ['./plugins/nio.js', './plugins/komainu.js'],
  instructions: ['./rules/*.md'],
  agent: {
    'oni--red-team-reviewer': { model: 'openai/gpt-5.5' },
    'tsukumogami--code-forgemaster': { model: 'opencode-go/kimi-k2.6' },
    'yumemi--story-smith': { model: 'opencode-go/glm-5.1' },
  },
};

test('merge-config: creates new config with agent mappings when target missing', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.json');
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);

  runMerge(cfg, ['nio.js', 'komainu.js', '--rules', '--agents-source', source]);

  const out = readJson(cfg);
  expect(out.plugin).toContain('./plugins/nio.js');
  expect(out.plugin).toContain('./plugins/komainu.js');
  expect(out.instructions).toContain('./rules/*.md');
  expect(out.agent['oni--red-team-reviewer']).toEqual({ model: 'openai/gpt-5.5' });
  expect(out.agent['tsukumogami--code-forgemaster']).toEqual({ model: 'opencode-go/kimi-k2.6' });
  expect(out.agent['yumemi--story-smith']).toEqual({ model: 'opencode-go/glm-5.1' });
});

test('merge-config: idempotent — running twice yields identical result', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.jsonc');
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);

  runMerge(cfg, ['nio.js', 'komainu.js', '--rules', '--agents-source', source]);
  const first = readFileSync(cfg, 'utf8');
  runMerge(cfg, ['nio.js', 'komainu.js', '--rules', '--agents-source', source]);
  const second = readFileSync(cfg, 'utf8');

  expect(second).toBe(first);
  // No duplicate plugin entries
  const out = readJson(cfg);
  expect(out.plugin.filter((p) => p === './plugins/nio.js')).toHaveLength(1);
  expect(out.plugin.filter((p) => p === './plugins/komainu.js')).toHaveLength(1);
});

test('merge-config: preserves user-defined agent not present in source', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.jsonc');
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);
  writeJson(cfg, {
    plugin: [],
    instructions: [],
    agent: {
      'my-custom-agent': { model: 'anthropic/claude-3.5-sonnet' },
      'oni--red-team-reviewer': { model: 'old-model/v1' },
    },
  });

  runMerge(cfg, ['--agents-source', source]);

  const out = readJson(cfg);
  // User-defined agent survives
  expect(out.agent['my-custom-agent']).toEqual({ model: 'anthropic/claude-3.5-sonnet' });
  // Fleet-owned agent is overwritten with the new model mapping
  expect(out.agent['oni--red-team-reviewer']).toEqual({ model: 'openai/gpt-5.5' });
  // New fleet agents added
  expect(out.agent['tsukumogami--code-forgemaster']).toEqual({ model: 'opencode-go/kimi-k2.6' });
  expect(out.agent['yumemi--story-smith']).toEqual({ model: 'opencode-go/glm-5.1' });
});

test('merge-config: handles .jsonc with line comments', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.jsonc');
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);
  // Write a .jsonc with line comments — stripped before parse
  writeFileSync(cfg, `{
  // opencode config with line comments
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./plugins/nio.js"],
  "agent": {
    "my-custom": { "model": "anthropic/claude-3.5-sonnet" }
  }
}
`);

  runMerge(cfg, ['komainu.js', '--agents-source', source]);

  const out = readJson(cfg);
  expect(out.plugin).toContain('./plugins/nio.js');
  expect(out.plugin).toContain('./plugins/komainu.js');
  // User agent preserved
  expect(out.agent['my-custom']).toEqual({ model: 'anthropic/claude-3.5-sonnet' });
  // Fleet agents added
  expect(out.agent['oni--red-team-reviewer']).toEqual({ model: 'openai/gpt-5.5' });
});

test('merge-config: overwrites fleet agent model with new value (model upgrade path)', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.jsonc');
  const sourceV1 = join(dir, 'source-v1.jsonc');
  const sourceV2 = join(dir, 'source-v2.jsonc');
  writeJson(sourceV1, FLEET_SOURCE);
  writeJson(sourceV2, {
    ...FLEET_SOURCE,
    agent: {
      ...FLEET_SOURCE.agent,
      'oni--red-team-reviewer': { model: 'openai/gpt-6.0' }, // upgraded
    },
  });

  runMerge(cfg, ['--agents-source', sourceV1]);
  expect(readJson(cfg).agent['oni--red-team-reviewer']).toEqual({ model: 'openai/gpt-5.5' });

  // Run again with the new source — model should be upgraded
  runMerge(cfg, ['--agents-source', sourceV2]);
  expect(readJson(cfg).agent['oni--red-team-reviewer']).toEqual({ model: 'openai/gpt-6.0' });
  // Other agents untouched
  expect(readJson(cfg).agent['tsukumogami--code-forgemaster']).toEqual({ model: 'opencode-go/kimi-k2.6' });
});

test('merge-config: --agents-source missing file exits non-zero', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.json');
  expect(() => {
    execFileSync('bun', [MERGE, cfg, '--agents-source', join(dir, 'nope.jsonc')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }).toThrow();
});

test('merge-config: --agents-source with no path (last arg) exits non-zero', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.json');
  let err = null;
  try {
    execFileSync('bun', [MERGE, cfg, '--agents-source'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  expect(err.status).not.toBe(0);
  expect(String(err.stderr || '') + String(err.stdout || '')).toMatch(/--agents-source requires a path/);
});

test('merge-config: --agents-source followed by another flag (e.g. --rules) exits non-zero', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.json');
  let err = null;
  try {
    execFileSync('bun', [MERGE, cfg, '--agents-source', '--rules'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  expect(err.status).not.toBe(0);
  expect(String(err.stderr || '') + String(err.stdout || '')).toMatch(/--agents-source/);
});

test('unmerge-config: --agents-source with no path (last arg) exits non-zero', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.json');
  // Pre-create target so the script doesn't short-circuit on "no target config".
  writeJson(cfg, { plugin: [], instructions: [], agent: {} });
  let err = null;
  try {
    execFileSync('bun', [UNMERGE, cfg, '--agents-source'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  expect(err.status).not.toBe(0);
  expect(String(err.stderr || '') + String(err.stdout || '')).toMatch(/--agents-source requires a path/);
});

test('unmerge-config: --agents-source followed by another flag (e.g. --rules) exits non-zero', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.json');
  writeJson(cfg, { plugin: [], instructions: [], agent: {} });
  let err = null;
  try {
    execFileSync('bun', [UNMERGE, cfg, '--agents-source', '--rules'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  expect(err.status).not.toBe(0);
  expect(String(err.stderr || '') + String(err.stdout || '')).toMatch(/--agents-source/);
});

test('unmerge-config: removes fleet plugins, rules, and fleet-owned agent keys', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.jsonc');
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);
  writeJson(cfg, {
    '$schema': 'https://opencode.ai/config.json',
    plugin: ['./plugins/nio.js', './plugins/komainu.js', './plugins/my-user-plugin.js'],
    instructions: ['./rules/*.md', './.claude/CLAUDE.md'],
    agent: {
      'oni--red-team-reviewer': { model: 'openai/gpt-5.5' },
      'tsukumogami--code-forgemaster': { model: 'opencode-go/kimi-k2.6' },
      'my-custom-agent': { model: 'anthropic/claude-3.5-sonnet' },
    },
  });

  runUnmerge(cfg, ['nio.js', 'komainu.js', '--rules', '--agents-source', source]);

  const out = readJson(cfg);
  // Fleet plugins removed
  expect(out.plugin).not.toContain('./plugins/nio.js');
  expect(out.plugin).not.toContain('./plugins/komainu.js');
  // User plugin survives
  expect(out.plugin).toContain('./plugins/my-user-plugin.js');
  // Fleet rules removed
  expect(out.instructions).not.toContain('./rules/*.md');
  // User instruction survives
  expect(out.instructions).toContain('./.claude/CLAUDE.md');
  // Fleet agents removed
  expect(out.agent['oni--red-team-reviewer']).toBeUndefined();
  expect(out.agent['tsukumogami--code-forgemaster']).toBeUndefined();
  // User agent survives
  expect(out.agent['my-custom-agent']).toEqual({ model: 'anthropic/claude-3.5-sonnet' });
});

test('unmerge-config: idempotent — second run is a no-op', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.jsonc');
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);
  writeJson(cfg, {
    plugin: ['./plugins/nio.js', './plugins/my-user.js'],
    instructions: ['./rules/*.md'],
    agent: {
      'oni--red-team-reviewer': { model: 'openai/gpt-5.5' },
      'my-custom-agent': { model: 'anthropic/claude-3.5-sonnet' },
    },
  });

  runUnmerge(cfg, ['nio.js', '--rules', '--agents-source', source]);
  const first = readFileSync(cfg, 'utf8');
  runUnmerge(cfg, ['nio.js', '--rules', '--agents-source', source]);
  const second = readFileSync(cfg, 'utf8');

  expect(second).toBe(first);
  const out = readJson(cfg);
  expect(out.plugin).toEqual(['./plugins/my-user.js']);
  expect(out.instructions).toEqual([]);
  expect(out.agent).toEqual({ 'my-custom-agent': { model: 'anthropic/claude-3.5-sonnet' } });
});

test('unmerge-config: target missing exits 0 (nothing to unmerge)', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.json'); // never created
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);
  // Should not throw and should exit 0
  runUnmerge(cfg, ['nio.js', '--agents-source', source]);
});

test('merge/unmerge round-trip: state returns to user-only agents', () => {
  const dir = tmp();
  const cfg = join(dir, 'opencode.jsonc');
  const source = join(dir, 'source.jsonc');
  writeJson(source, FLEET_SOURCE);

  const initial = {
    plugin: ['./plugins/my-user.js'],
    instructions: ['./.claude/CLAUDE.md'],
    agent: {
      'my-custom-agent': { model: 'anthropic/claude-3.5-sonnet' },
    },
  };
  writeJson(cfg, initial);

  // Merge fleet
  runMerge(cfg, ['nio.js', 'komainu.js', '--rules', '--agents-source', source]);
  // Unmerge fleet
  runUnmerge(cfg, ['nio.js', 'komainu.js', '--rules', '--agents-source', source]);

  const final = readJson(cfg);
  // All fleet additions removed
  expect(final.plugin).toEqual(['./plugins/my-user.js']);
  expect(final.instructions).toEqual(['./.claude/CLAUDE.md']);
  expect(final.agent).toEqual({
    'my-custom-agent': { model: 'anthropic/claude-3.5-sonnet' },
  });
});
