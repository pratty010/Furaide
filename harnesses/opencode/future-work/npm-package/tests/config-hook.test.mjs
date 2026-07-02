import { test, expect } from 'bun:test';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentsFromDir } from '../lib/agent-md.mjs';

const PKG_DIR = join(import.meta.dir, '..', '..');
const AGENTS_DIR = join(PKG_DIR, 'agents');
const RULES_DIR = join(PKG_DIR, 'rules');
const COMMANDS_DIR = join(PKG_DIR, 'commands');

const routingManifest = JSON.parse(
  await Bun.file(join(PKG_DIR, 'docs/routing-manifest.json')).text()
);
const modelMap = { ...routingManifest.specialists, ...routingManifest.subagents };

const { FuraideHarness } = await import('../../src/index.ts');

async function runConfigHook(input = {}) {
  const hooks = await FuraideHarness({});
  const config = { ...input };
  await hooks.config(config, {});
  return config;
}

test('(a) registers exactly 15 agents matching bundled frontmatter', async () => {
  const config = await runConfigHook();
  const groundTruth = loadAgentsFromDir(AGENTS_DIR);
  const names = Object.keys(groundTruth);
  expect(names.length).toBe(15);
  expect(Object.keys(config.agent).length).toBe(15);

  for (const name of names) {
    const truth = groundTruth[name];
    const got = config.agent[name];
    expect(got).toBeDefined();
    expect(got.mode).toBe(truth.mode);
    expect(got.temperature).toBe(truth.temperature);
    expect(got.steps).toEqual(truth.steps);
    const expectedModel = modelMap[name]?.primary;
    expect(got.model).toBe(expectedModel);
    // permission structure preserved (aside from bash-path rewrites checked in (b))
    expect(got.permission).toBeDefined();
  }
});

test('(b) scoped-bash patterns rewritten to absolute package paths', async () => {
  const config = await runConfigHook();
  const kantoku = config.agent['kantoku--workflow-director'];
  const bashPerms = kantoku.permission.bash;
  const keys = Object.keys(bashPerms);
  const rewritten = keys.find((k) => k.includes('workflow-state.mjs'));
  expect(rewritten).toBeDefined();
  expect(rewritten).toBe(`bun ${PKG_DIR}/scripts/workflow-state.mjs *`);
  expect(bashPerms['*']).toBe('deny');
});

test('(c) instructions contains package-absolute AGENTS.md and rules/*.md paths', async () => {
  const config = await runConfigHook();
  expect(Array.isArray(config.instructions)).toBe(true);
  const agentsMdPath = join(PKG_DIR, 'config/AGENTS.md');
  expect(config.instructions).toContain(agentsMdPath);
  const ruleFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith('.md'));
  for (const f of ruleFiles) {
    expect(config.instructions).toContain(join(RULES_DIR, f));
  }
});

test('(d) command entries populated from commands/*.md when present', async () => {
  const config = await runConfigHook();
  if (!existsSync(COMMANDS_DIR)) {
    // No commands directory in this repo; nothing to assert.
    expect(true).toBe(true);
    return;
  }
  const commandFiles = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));
  expect(config.command).toBeDefined();
  for (const f of commandFiles) {
    const name = f.replace(/\.md$/, '');
    expect(config.command[name]).toBeDefined();
  }
});

test('(e) user-defined agent config is not overwritten (merge semantics)', async () => {
  const userModel = 'user-provider/user-model-override';
  const input = {
    agent: {
      'kantoku--workflow-director': {
        model: userModel,
      },
    },
  };
  const config = await runConfigHook(input);
  expect(config.agent['kantoku--workflow-director'].model).toBe(userModel);
  // Other fields the user didn't set should still be filled in.
  expect(config.agent['kantoku--workflow-director'].mode).toBe('primary');
  // Other agents untouched by user input should still be fully populated.
  expect(config.agent['kagami--verifier'].model).toBe(modelMap['kagami--verifier'].primary);
});
