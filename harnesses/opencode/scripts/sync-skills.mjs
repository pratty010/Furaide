#!/usr/bin/env node
/**
 * sync-skills.mjs
 * Idempotent sync of bundled skills from repo root into ~/.config/opencode/skills/.
 *
 * The script reads skills directories from skills/* at the repo root and copies
 * them to the install target. On subsequent runs, if the receipt version matches,
 * the sync is skipped (idempotent).
 *
 * Flags:
 *   --force    Re-sync even if receipt version matches
 *   --dry-run  Print what would be copied without doing it
 *
 * Usage:
 *   node scripts/sync-skills.mjs
 *   node scripts/sync-skills.mjs --force
 *   node scripts/sync-skills.mjs --dry-run
 */

import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HARNESS_VERSION = '2.0.0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(__dirname, '..');
// Skills source: repo root, 3 levels up from scripts/
const SKILLS_SOURCE = resolve(HARNESS_ROOT, '../../skills');

// Default install target: ~/.config/opencode/skills
function getInstallTarget() {
  return join(homedir(), '.config/opencode/skills');
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function err(msg) {
  process.stderr.write('[sync-skills] ' + msg + '\n');
}

/**
 * List all skill directories in the bundled skills source.
 * Returns array of skill names.
 */
function listBundledSkills() {
  if (!existsSync(SKILLS_SOURCE)) {
    return [];
  }

  const entries = readdirSync(SKILLS_SOURCE);
  const skills = [];

  for (const entry of entries) {
    const fullPath = join(SKILLS_SOURCE, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        skills.push(entry);
      }
    } catch {
      // Skip on stat error
    }
  }

  return skills;
}

/**
 * Read the existing receipt if it exists.
 */
function readReceipt(installTarget) {
  const receiptPath = join(installTarget, 'furaide-skills-receipt.json');
  if (!existsSync(receiptPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write receipt file to install target.
 */
function writeReceipt(installTarget, skills) {
  const receipt = {
    version: HARNESS_VERSION,
    skills,
    date: new Date().toISOString()
  };

  const receiptPath = join(installTarget, 'furaide-skills-receipt.json');
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
}

/**
 * Copy a single skill from source to destination.
 */
function copySkill(skillName, dryRun = false) {
  const installTarget = getInstallTarget();
  const srcPath = join(SKILLS_SOURCE, skillName);
  const destPath = join(installTarget, skillName);

  if (!existsSync(srcPath)) {
    throw new Error(`Skill source not found: ${srcPath}`);
  }

  if (dryRun) {
    log(`  [dry-run] would copy ${skillName} → ${destPath}`);
    return;
  }

  if (existsSync(destPath)) {
    rmSync(destPath, { recursive: true, force: true });
  }

  cpSync(srcPath, destPath, { recursive: true });
  log(`  copied ${skillName}`);
}

/**
 * Check if all bundled skills have been synced (SKILL.md exists in target).
 * Returns true if all are present, false if any are missing.
 */
function checkSkillsSynced(skills) {
  const installTarget = getInstallTarget();
  for (const skill of skills) {
    const skillMdPath = join(installTarget, skill, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      return false;
    }
  }
  return true;
}

/**
 * Main sync logic.
 */
async function main() {
  const args = process.argv.slice(2);
  const forceSync = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  if (dryRun && forceSync) {
    err('Cannot use --dry-run and --force together');
    process.exit(1);
  }

  const installTarget = getInstallTarget();
  const bundledSkills = listBundledSkills();

  if (bundledSkills.length === 0) {
    err(`No bundled skills found in ${SKILLS_SOURCE}`);
    process.exit(1);
  }

  // Check existing receipt
  const existing = readReceipt(installTarget);
  const shouldSync = !existing || existing.version !== HARNESS_VERSION || forceSync;

  if (!shouldSync) {
    log(`Bundled skills already synced (version ${HARNESS_VERSION}). Use --force to re-sync.`);

    // Still check if all skills are present; if not, hint about external skills
    if (!checkSkillsSynced(bundledSkills)) {
      log('External skills not installed. Run: bun scripts/pull-external-skills.mjs --pull');
    }

    process.exit(0);
  }

  if (dryRun) {
    log(`[dry-run] Would sync ${bundledSkills.length} bundled skills to ${installTarget}\n`);
    for (const skill of bundledSkills) {
      const destPath = join(installTarget, skill);
      log(`  [dry-run] would copy ${skill} → ${destPath}`);
    }
    log(`\n[dry-run] Would write receipt version ${HARNESS_VERSION}`);
    process.exit(0);
  }

  log(`Syncing ${bundledSkills.length} bundled skills to ${installTarget}…\n`);

  // Create install target if it doesn't exist
  mkdirSync(installTarget, { recursive: true });

  // Copy each skill
  try {
    for (const skill of bundledSkills) {
      copySkill(skill, false);
    }
  } catch (e) {
    err(`Failed to copy skills: ${e.message}`);
    process.exit(1);
  }

  // Write receipt
  writeReceipt(installTarget, bundledSkills);
  log(`\nreceipt version ${HARNESS_VERSION} written to ${installTarget}`);

  // Check if external skills need to be installed
  if (!checkSkillsSynced(bundledSkills)) {
    log('External skills not installed. Run: bun scripts/pull-external-skills.mjs --pull');
  }

  log('Done.');
  process.exit(0);
}

main().catch(e => {
  err(String(e));
  process.exit(1);
});
