import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Verifies the uninstall backup-restore gap fix (section D): when
// install-fleet.sh overwrites a pre-existing fleet-managed file, it backs
// up the original first; uninstall-fleet.sh must then restore that backup
// in place of deleting the file outright or leaving the fleet's installed
// version behind.

const SCRIPTS_DIR = join(import.meta.dir, '..');
const INSTALLER = join(SCRIPTS_DIR, 'install-fleet.sh');
const UNINSTALLER = join(SCRIPTS_DIR, 'uninstall-fleet.sh');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'uninstall-restore-'));
}

function runInstaller(dir, extraArgs = []) {
  return execFileSync('bash', [INSTALLER, '--all', '--custom', dir, '--no-common-skills', '--yes', ...extraArgs], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120000,
  });
}

// uninstall-fleet.sh has no -y/--yes flag; --purge is its non-interactive
// equivalent (skips the per-scope confirmation prompt).
function runUninstaller(dir, extraArgs = []) {
  return execFileSync('bash', [UNINSTALLER, '--purge', '--custom', dir, ...extraArgs], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120000,
  });
}

test('uninstall restores the pre-install sentinel content, not the fleet version', { timeout: 120000 }, () => {
  const dir = tmp();
  const SENTINEL_CONTENT = '// SENTINEL: pre-existing user content, must survive install+uninstall\n';
  try {
    // Pre-seed a sentinel at a fleet-managed path (security-gate component).
    const sentinelPath = join(dir, 'plugins', 'gates', 'komainu.js');
    mkdirSync(join(dir, 'plugins', 'gates'), { recursive: true });
    writeFileSync(sentinelPath, SENTINEL_CONTENT);

    // Install overwrites the sentinel with the fleet's komainu.js, backing
    // up the original first.
    runInstaller(dir);

    expect(existsSync(sentinelPath)).toBe(true);
    const installedContent = readFileSync(sentinelPath, 'utf8');
    expect(installedContent).not.toBe(SENTINEL_CONTENT);

    // Uninstall must restore the backed-up sentinel, not delete the file
    // and not leave the fleet's installed version in place.
    runUninstaller(dir);

    expect(existsSync(sentinelPath)).toBe(true);
    const restoredContent = readFileSync(sentinelPath, 'utf8');
    expect(restoredContent).toBe(SENTINEL_CONTENT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
