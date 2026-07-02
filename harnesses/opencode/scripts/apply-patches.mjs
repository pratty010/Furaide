#!/usr/bin/env node
/**
 * apply-patches.mjs
 * Applies unified diff patches from skill-patches/<skill-name>/*.patch
 * onto the installed skill copies.
 *
 * Modes:
 *   (default)    Apply all patches, skip if already applied
 *   --dry-run    List actions without applying
 *   --check      Verify patches would apply cleanly (exit 1 if any fail)
 *
 * Usage:
 *   bun scripts/apply-patches.mjs
 *   bun scripts/apply-patches.mjs --dry-run
 *   bun scripts/apply-patches.mjs --check
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = join(HARNESS_ROOT, 'config/skills-manifest.json');
const REPO_ROOT = resolve(HARNESS_ROOT, '../../');

// ---------- helpers ----------

function loadManifest() {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

function expandHome(p) {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function err(msg) {
  process.stderr.write('[apply-patches] ' + msg + '\n');
}

// Check if a patch is already applied to the target dir
function isAlreadyApplied(patchPath, targetDir) {
  const result = run(`git apply --directory="${targetDir}" --unsafe-paths --reverse --check < "${patchPath}"`, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  return result.status === 0;
}

// Check if a patch would apply cleanly
function wouldApplyCleanly(patchPath, targetDir) {
  const result = run(`git apply --directory="${targetDir}" --unsafe-paths --check < "${patchPath}"`, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  return result.status === 0;
}

// Apply a patch to the target dir
function applyPatch(patchPath, targetDir) {
  const result = run(`git apply --directory="${targetDir}" --unsafe-paths < "${patchPath}"`, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  return result.status === 0;
}

// ---------- main logic ----------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const checkMode = args.includes('--check');

  if (!existsSync(MANIFEST_PATH)) {
    err(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = loadManifest();
  const installTarget = expandHome(manifest.install_target);
  const patchesDirRelative = manifest.patches_dir;
  const patchesDir = join(REPO_ROOT, patchesDirRelative);

  if (!existsSync(patchesDir)) {
    log(`No patches directory found: ${patchesDir}`);
    log('Nothing to apply.');
    process.exit(0);
  }

  let allSuccess = true;
  let appliedCount = 0;
  let skippedCount = 0;

  // Iterate over skill directories in patches_dir
  let skillDirs = [];
  try {
    skillDirs = readdirSync(patchesDir).filter(f => {
      try {
        const stat = statSync(join(patchesDir, f));
        return stat.isDirectory();
      } catch {
        return false;
      }
    }).sort();
  } catch (e) {
    err(`Cannot read patches directory: ${e.message}`);
    process.exit(1);
  }

  for (const skillName of skillDirs) {
    const skillPatchesDir = join(patchesDir, skillName);
    const skillTarget = join(installTarget, skillName);

    // Find all .patch files
    let patchFiles = [];
    try {
      patchFiles = readdirSync(skillPatchesDir)
        .filter(f => f.endsWith('.patch'))
        .sort();
    } catch (e) {
      err(`Cannot read patch directory for ${skillName}: ${e.message}`);
      allSuccess = false;
      continue;
    }

    if (patchFiles.length === 0) {
      continue; // No patches for this skill
    }

    if (!existsSync(skillTarget)) {
      err(`Skill not installed: ${skillName} (expected at ${skillTarget})`);
      allSuccess = false;
      continue;
    }

    for (const patchFile of patchFiles) {
      const patchPath = join(skillPatchesDir, patchFile);

      // Check if already applied
      if (isAlreadyApplied(patchPath, skillTarget)) {
        if (!dryRun && !checkMode) {
          log(`⊘ ${skillName}/${patchFile} (already applied, skipping)`);
        }
        skippedCount++;
        continue;
      }

      // Check if would apply cleanly
      if (!wouldApplyCleanly(patchPath, skillTarget)) {
        err(`✗ ${skillName}/${patchFile} (would not apply cleanly)`);
        allSuccess = false;
        continue;
      }

      // Apply or dry-run
      if (dryRun) {
        log(`→ ${skillName}/${patchFile} (would apply)`);
      } else if (checkMode) {
        log(`✓ ${skillName}/${patchFile} (would apply cleanly)`);
      } else {
        if (applyPatch(patchPath, skillTarget)) {
          log(`✓ ${skillName}/${patchFile} (applied)`);
          appliedCount++;
        } else {
          err(`✗ ${skillName}/${patchFile} (apply failed)`);
          allSuccess = false;
        }
      }
    }
  }

  if (dryRun || checkMode) {
    log('');
    log('Dry-run/check complete.');
  } else if (appliedCount > 0 || skippedCount > 0) {
    log('');
    log(`Applied: ${appliedCount}, Skipped: ${skippedCount}`);
  }

  if (!allSuccess) {
    process.exit(1);
  }
}

main().catch(e => {
  err(String(e));
  process.exit(1);
});
