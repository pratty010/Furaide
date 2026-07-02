import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPTS_DIR = join(import.meta.dir, '..');
const INSTALLER = join(SCRIPTS_DIR, 'install-fleet.sh');
const UNINSTALLER = join(SCRIPTS_DIR, 'uninstall-fleet.sh');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'install-receipt-'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function runInstaller(dir, extraArgs = []) {
  return execFileSync('bash', [INSTALLER, '--all', '--custom', dir, '--no-common-skills', '--yes', ...extraArgs], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120000,
  });
}

function runUninstaller(dir, extraArgs = []) {
  return execFileSync('bash', [UNINSTALLER, '--purge', '--custom', dir, ...extraArgs], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120000,
  });
}

test('installer creates backups and receipt when overwriting existing files', { timeout: 120000 }, () => {
  const dir = tmp();
  try {
    const cfg = join(dir, 'opencode.json');
    const existingAgent = join(dir, 'agents', 'tsuchigumo--research-weaver.md');
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeJson(cfg, { plugin: ['./plugins/custom.js'], instructions: [], agent: {} });
    writeFileSync(existingAgent, 'old agent content\n');

    const output = runInstaller(dir);

    const receiptPath = join(dir, '.furaide-install-receipt.json');
    expect(existsSync(receiptPath)).toBe(true);
    const receipt = readJson(receiptPath);
    expect(receipt.timestamp).toBeDefined();
    expect(Array.isArray(receipt.selectedComponents)).toBe(true);
    expect(receipt.selectedComponents).toContain('agents-core');
    expect(receipt.mergedConfig).toBeDefined();
    expect(receipt.modelMapSummary).toBeDefined();

    const backupRoot = join(dir, 'kura_backup', receipt.timestamp);
    expect(existsSync(join(backupRoot, 'opencode.json'))).toBe(true);
    expect(existsSync(join(backupRoot, 'agents', 'tsuchigumo--research-weaver.md'))).toBe(true);
    expect(output).toContain('Backup created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uninstall uses receipt cleanup and removes receipt after success', { timeout: 120000 }, () => {
  const dir = tmp();
  try {
    writeJson(join(dir, 'opencode.json'), { plugin: [], instructions: [], agent: {} });
    runInstaller(dir);

    const receiptPath = join(dir, '.furaide-install-receipt.json');
    expect(existsSync(receiptPath)).toBe(true);
    expect(existsSync(join(dir, 'agents', 'tsuchigumo--research-weaver.md'))).toBe(true);

    runUninstaller(dir);

    expect(existsSync(receiptPath)).toBe(false);
    expect(existsSync(join(dir, 'agents', 'tsuchigumo--research-weaver.md'))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer dry-run reports backup and receipt actions without writing', { timeout: 120000 }, () => {
  const dir = tmp();
  try {
    writeJson(join(dir, 'opencode.json'), { plugin: [], instructions: [], agent: {} });
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'agents', 'tsuchigumo--research-weaver.md'), 'old\n');

    const output = runInstaller(dir, ['--dry-run']);

    expect(output).toContain('Backup would be created');
    expect(output).toContain('write install receipt');
    expect(existsSync(join(dir, '.furaide-install-receipt.json'))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
