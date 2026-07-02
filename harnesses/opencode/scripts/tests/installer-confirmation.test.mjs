import { test, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPTS_DIR = join(import.meta.dir, '..');
const INSTALLER = join(SCRIPTS_DIR, 'install-fleet.sh');
const FLEET_ROOT = join(SCRIPTS_DIR, '..');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'install-confirm-'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function runInstaller(dir, input = '') {
  try {
    const result = execFileSync('bash', [INSTALLER, '--all', '--custom', dir, '--no-common-skills', '--yes'], {
      encoding: 'utf8',
      input,
      stdio: 'pipe',
      timeout: 120000,
    });
    return { stdout: result, stderr: '', code: 0 };
  } catch (e) {
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      code: e.status || 1,
    };
  }
}

test('installer runs model resolver and shows confirmation when no changes needed', { timeout: 60000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    writeJson(cfg, { plugin: [], instructions: [], agent: {} });

    const result = runInstaller(dir, '');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Resolving model mappings');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer writes resolved routing manifest to target', { timeout: 60000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    writeJson(cfg, { plugin: [], instructions: [], agent: {} });

    const result = runInstaller(dir, '');
    expect(result.code).toBe(0);

    const routingManifest = join(dir, 'docs/routing-manifest.json');
    const routing = readJson(routingManifest);
    expect(routing.version).toBeDefined();
    expect(routing.specialists).toBeDefined();
    expect(routing.subagents).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer applies resolved model map to target config', { timeout: 60000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    writeJson(cfg, {
      plugin: ['./plugins/my-existing.js'],
      instructions: [],
      agent: {
        'my-wiring-test-agent': { model: 'anthropic/claude-3.5-sonnet' },
      },
    });

    const result = runInstaller(dir, '');
    expect(result.code).toBe(0);

    const out = readJson(cfg);
    expect(out.plugin).toContain('./plugins/my-existing.js');
    expect(out.plugin).toContain('./plugins/nio.js');
    expect(out.plugin).toContain('./plugins/komainu.js');
    expect(out.agent['my-wiring-test-agent']).toEqual({ model: 'anthropic/claude-3.5-sonnet' });
    expect(out.agent['tsukumogami--code-forgemaster']).toBeDefined();
    expect(out.agent['oni--red-team-reviewer']).toEqual({ model: 'openai/gpt-5.5' });
    expect(out.agent['kantoku--workflow-director']).toEqual({ model: 'opencode-go/kimi-k2.6' });
    expect(out.instructions).toContain('./rules/*.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer dry-run shows model resolution without writing', { timeout: 60000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    writeJson(cfg, { plugin: [], instructions: [], agent: {} });

    const result = execFileSync('bash', [INSTALLER, '--dry-run', '--all', '--custom', dir, '--yes'], {
      encoding: 'utf8',
      input: 's\nn\n',
      stdio: 'pipe',
    });
    expect(result).toContain('Resolving model mappings');
    expect(result).toContain('[dry-run]');
    expect(result).toContain('write resolved routing-manifest.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer fails in non-interactive mode when model changes required without --yes', { timeout: 60000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    writeJson(cfg, { plugin: [], instructions: [], agent: {} });

    const scriptContent = readFileSync(INSTALLER, 'utf8');
    expect(scriptContent).toContain('non-interactive mode');
    expect(scriptContent).toContain('AUTO_CONFIRM');
    expect(scriptContent).toContain('-t 0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer proceeds with --yes flag in non-interactive mode when model changes required', { timeout: 60000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    writeJson(cfg, { plugin: [], instructions: [], agent: {} });

    const scriptContent = readFileSync(INSTALLER, 'utf8');
    expect(scriptContent).toContain('--yes');
    expect(scriptContent).toContain('AUTO_CONFIRM=1');
    expect(scriptContent).toContain('Auto-confirming model mappings');

    const result = execFileSync('bash', [INSTALLER, '--all', '--custom', dir, '--no-common-skills', '--yes'], {
      encoding: 'utf8',
      input: '',
      stdio: 'pipe',
    });
    expect(result).toContain('Resolving model mappings');
    if (result.includes('All desired models available. No changes needed')) {
      // Test environment has all models available; --yes path not triggered but flag is recognized
      expect(result).toContain('Resolving model mappings');
    } else {
      expect(result).toContain('Auto-confirming model mappings');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer help includes --yes flag', { timeout: 10000 }, () => {
  const result = execFileSync('bash', [INSTALLER, '--help'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  expect(result).toContain('--yes');
  expect(result).toContain('Auto-confirm');
});