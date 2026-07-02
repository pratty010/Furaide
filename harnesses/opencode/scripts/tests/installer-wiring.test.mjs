import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, delimiter, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execPath } from 'node:process';

const SCRIPTS_DIR = join(import.meta.dir, '..');
const INSTALLER = join(SCRIPTS_DIR, 'install-fleet.sh');
const FLEET_ROOT = join(SCRIPTS_DIR, '..');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'install-wiring-'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function stubbedEnv(binDir) {
  const bunDir = dirname(execPath);
  const path = [binDir, bunDir, '/usr/bin', '/bin'].join(delimiter);
  return { ...process.env, PATH: path };
}

// Run install-fleet.sh against a temp target and capture its exit code.
// The installer may write to /dev/tty for the optional common-skills prompt
// even on success; we surface that as stderr but only treat a non-zero
// exit code as a real failure.
function runInstaller(dir) {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  // bx/tvly CLI stubs are intentionally not created here; the web-tools
  // plugin no longer depends on those binaries.
  try {
    execFileSync('bash', [INSTALLER, '--all', '--custom', dir, '--no-common-skills', '--yes'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000,
      env: stubbedEnv(binDir),
    });
  } catch (e) {
    if (typeof e.status === 'number' && e.status !== 0) {
      throw new Error(`install-fleet.sh exited ${e.status}:\n${e.stdout}\n${e.stderr}`);
    }
  }
}

test('install-fleet.sh: --all --custom <tmp> wires agent model mappings into target opencode.json', { timeout: 120000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    // Pre-populate target with a user plugin + user agent
    writeJson(cfg, {
      plugin: ['./plugins/my-existing.js'],
      instructions: [],
      agent: {
        'my-wiring-test-agent': { model: 'anthropic/claude-3.5-sonnet' },
      },
    });

    runInstaller(dir);

    // Installer writes either opencode.json or opencode.jsonc. For .json pre-existing,
    // it stays as .json.
    const out = readJson(cfg);
    // User plugin preserved
    expect(out.plugin).toContain('./plugins/my-existing.js');
    // Fleet plugins added
    expect(out.plugin).toContain('./plugins/gates/nio.js');
    expect(out.plugin).toContain('./plugins/gates/komainu.js');
    // .ts plugin entries must be registered too (adversarial-review blocker:
    // previous filter `plugins/*.js` skipped them, so web-tools never landed
    // in the target's plugin array).
    expect(out.plugin).toContain('./plugins/tools/web-tools.ts');
    // User agent preserved
    expect(out.agent['my-wiring-test-agent']).toEqual({ model: 'anthropic/claude-3.5-sonnet' });
    // Fleet agent model mappings wired
    expect(out.agent['tsukumogami--code-forgemaster']).toBeDefined();
    expect(out.agent['oni--red-team-reviewer']).toEqual({ model: 'openai/gpt-5.5' });
    expect(out.agent['kantoku--workflow-director']).toEqual({ model: 'opencode-go/kimi-k2.6' });
    // Fleet rules added
    expect(out.instructions).toContain('./rules/*.md');
    expect(readFileSync(join(dir, 'web-tools.yml'), 'utf8')).toContain('webSearch:');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install-fleet.sh: --all wiring carries agents-core agent model mappings end-to-end', { timeout: 120000 }, () => {
  // Exercises the installer-wide wiring (--all is the cleanest non-interactive
  // path; see install-fleet.sh ask_scope's auto-select branch). The contract
  // under test is that agents-core contributes its `agent` model mappings
  // to the target, even when other components are also installed.
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    writeJson(cfg, { plugin: [], instructions: [], agent: {} });

    runInstaller(dir);

    const out = readJson(cfg);
    // Fleet agents-core contributes model mappings
    expect(out.agent['tsukumogami--code-forgemaster']).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install-fleet.sh: ships opencode.jsonc in agents-core component (manifest lists it)', () => {
  // The manifest must list opencode.jsonc in the agents-core component so the
  // fleet's runtime config (with agent model mappings) gets copied by default.
  const manifest = readJson(join(FLEET_ROOT, 'config/fleet-manifest.json'));
  const agentsCore = manifest.components.find((c) => c.id === 'agents-core');
  expect(agentsCore, 'agents-core component missing from manifest').toBeDefined();
  expect(agentsCore.files).toContain('config/opencode.jsonc');
});

test('install-fleet.sh: web-tools package-fragment path fails non-zero when bun install fails', { timeout: 120000 }, () => {
  // Adversarial: the previous installer masked `bun install` failures with
  // `|| _warn ...`, hiding broken installs as success. The web-tools path
  // must now exit non-zero when `bun install` fails so CI catches the breakage.
  const dir = tmp();
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    // Pre-seed a target package.json so merge-package-fragment reports CHANGED
    // and the installer takes the bun install branch.
    writeJson(join(dir, 'package.json'), { name: 'target', version: '0.0.0', dependencies: {} });
    // Stub bun: report a version on `bun --version`, fail on `bun install`.
    writeFileSync(
      join(binDir, 'bun'),
      "#!/usr/bin/env bash\nif [[ \"$1\" == \"--version\" ]]; then echo '1.1.0'; exit 0; fi\necho 'stub bun: simulated install failure' >&2\nexit 1\n",
      { mode: 0o755 },
    );

    let status = 0;
    let stderr = '';
    try {
      execFileSync('bash', [INSTALLER, '--all', '--custom', dir, '--no-common-skills'], {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 120000,
        env: stubbedEnv(binDir),
      });
    } catch (e) {
      status = typeof e.status === 'number' ? e.status : 1;
      stderr = (e.stderr || '') + (e.stdout || '');
    }
    expect(status, `installer should exit non-zero when bun install fails during web-tools fragment install; output=\n${stderr}`).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
