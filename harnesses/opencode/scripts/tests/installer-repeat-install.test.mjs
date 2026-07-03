import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Verifies the repeat-install backup-corruption fix (finding #2): re-running
// install-fleet.sh (e.g. to pick up an update) must NOT mint a fresh backup
// root and orphan the true original backup from the first run. The second
// run has to reuse the first run's backup root (recorded in the install
// receipt) and skip backups for files it already preserved, so uninstall
// still restores the user's real original file — not an intermediate
// fleet-merged copy from run 1.

const SCRIPTS_DIR = join(import.meta.dir, '..');
const INSTALLER = join(SCRIPTS_DIR, 'install-fleet.sh');
const UNINSTALLER = join(SCRIPTS_DIR, 'uninstall-fleet.sh');

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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

test('repeat install preserves the original backup across a second run, so uninstall restores it', { timeout: 120000 }, () => {
  // No HOME override needed: --custom <dir> fully isolates the install
  // target from the real ~/.config/opencode (matches the convention in
  // uninstall-restore.test.mjs / installer-receipt.test.mjs). Overriding
  // HOME here instead breaks the model resolver, which depends on
  // environment/model-availability state under the real HOME.
  const dir = tmp('installer-repeat-install-');
  const SENTINEL_CONTENT = '// SENTINEL: pre-existing user content from before any fleet install\n';

  try {
    // Seed a sentinel at a fleet-managed path (security-gate component)
    // with known, distinctive content — this stands in for a user's real
    // pre-existing file.
    const sentinelPath = join(dir, 'plugins', 'gates', 'komainu.js');
    mkdirSync(join(dir, 'plugins', 'gates'), { recursive: true });
    writeFileSync(sentinelPath, SENTINEL_CONTENT);

    // Run 1: install overwrites the sentinel with the fleet's komainu.js,
    // backing up the original first.
    runInstaller(dir);

    const receiptPath = join(dir, '.furaide-install-receipt.json');
    expect(existsSync(receiptPath)).toBe(true);
    const receiptAfterRun1 = readJson(receiptPath);
    const backupRootAfterRun1 = receiptAfterRun1.backup.root;
    expect(backupRootAfterRun1).toBeTruthy();

    const installedContent = readFileSync(sentinelPath, 'utf8');
    expect(installedContent).not.toBe(SENTINEL_CONTENT);

    const backedUpSentinel = join(backupRootAfterRun1, 'plugins', 'gates', 'komainu.js');
    expect(existsSync(backedUpSentinel)).toBe(true);
    expect(readFileSync(backedUpSentinel, 'utf8')).toBe(SENTINEL_CONTENT);

    // Run 2: simulate re-running install later (e.g. to pick up an update).
    // The sentinel path now holds the fleet's own (run 1) content, not the
    // user's original — a naive re-run would back up *that* into a fresh
    // timestamped root and overwrite the receipt's backup.root pointer,
    // orphaning the true original from run 1.
    runInstaller(dir);

    const receiptAfterRun2 = readJson(receiptPath);
    const backupRootAfterRun2 = receiptAfterRun2.backup.root;

    // The backup root must be stable across repeat installs — reused, not
    // re-minted — and the original backup content must be untouched.
    expect(backupRootAfterRun2).toBe(backupRootAfterRun1);
    expect(readFileSync(backedUpSentinel, 'utf8')).toBe(SENTINEL_CONTENT);

    // Uninstall must restore the true original sentinel content, not the
    // intermediate fleet-merged state from run 1 or run 2.
    runUninstaller(dir);

    expect(existsSync(sentinelPath)).toBe(true);
    const restoredContent = readFileSync(sentinelPath, 'utf8');
    expect(restoredContent).toBe(SENTINEL_CONTENT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
