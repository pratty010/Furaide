#!/usr/bin/env node
/**
 * pull-external-skills.mjs
 * Fetches external skills pinned in config/skills-manifest.json.
 *
 * Modes:
 *   --check   Verify each pinned SHA is reachable via `gh api`, report drift
 *             against already-installed copies.
 *   --pull    Shallow-clone each repo at the pinned commit into a temp dir,
 *             copy listed skill dirs into install_target, write receipt.json.
 *
 * Usage:
 *   node scripts/pull-external-skills.mjs --check
 *   node scripts/pull-external-skills.mjs --pull
 */

import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, lstatSync, symlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = join(HARNESS_ROOT, 'config/skills-manifest.json');

// ---------- helpers ----------

async function loadManifest() {
  // Reuse jsonc.mjs if it exists (our manifest is plain JSON but future-proof)
  const jsoncPath = join(HARNESS_ROOT, 'scripts/lib/jsonc.mjs');
  if (existsSync(jsoncPath)) {
    const { parseJsonc } = await importJsonc(jsoncPath);
    return parseJsonc(readFileSync(MANIFEST_PATH, 'utf8'));
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

// Dynamic import wrapper (top-level await not available in all runtimes)
function importJsonc(path) {
  return import(path);
}

function expandHome(p) {
  if (p.startsWith('~/')) {
    return join(process.env.HOME ?? process.env.USERPROFILE ?? '', p.slice(2));
  }
  return p;
}

function symlinkToClaudeSkills(skillName, agentsPoolDir) {
  const claudeSkillsDir = expandHome('~/.claude/skills');
  const linkPath = join(claudeSkillsDir, skillName);
  const targetPath = join(agentsPoolDir, skillName);
  mkdirSync(claudeSkillsDir, { recursive: true });
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      rmSync(linkPath, { force: true });
    } else {
      // A real (non-symlink) directory already exists — don't clobber it.
      log(`  skipped symlink at ${linkPath} — real directory already exists`);
      return false;
    }
  } catch {
    // linkPath doesn't exist yet — proceed to create it.
  }
  try {
    symlinkSync(targetPath, linkPath, 'dir');
  } catch (e) {
    err(`  failed to create symlink ${linkPath}: ${e.message}`);
    return false;
  }
  return true;
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
}

function ghApiPin(repo, pin) {
  const result = run(`gh api repos/${repo}/commits/${pin} --jq .sha`);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function err(msg) {
  process.stderr.write('[pull-external-skills] ' + msg + '\n');
}

// ---------- --check mode ----------

async function checkMode(manifest) {
  log('Checking pinned SHAs…\n');
  const installTarget = expandHome(manifest.install_target);
  let allOk = true;

  for (const src of manifest.sources) {
    log(`  repo: ${src.repo}  pin: ${src.pin.slice(0, 12)}…`);

    const resolved = ghApiPin(src.repo, src.pin);
    if (!resolved) {
      err(`  FAIL: ${src.repo}@${src.pin} not reachable via gh api`);
      allOk = false;
    } else if (resolved !== src.pin) {
      err(`  WARN: ${src.repo} resolved to different SHA ${resolved}`);
    } else {
      log(`    pin reachable ✓`);
    }

    for (const skill of src.skills) {
      const installed = join(installTarget, skill);
      if (!existsSync(installed)) {
        log(`    ${skill}: NOT INSTALLED`);
      } else {
        // Check receipt
        const receiptPath = join(installTarget, 'receipt.json');
        if (existsSync(receiptPath)) {
          const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
          const entry = receipt[skill];
          if (entry && entry.pin !== src.pin) {
            log(`    ${skill}: DRIFT (installed ${entry.pin?.slice(0, 12)}, manifest ${src.pin.slice(0, 12)})`);
          } else {
            log(`    ${skill}: ok`);
          }
        } else {
          log(`    ${skill}: installed (no receipt)`);
        }
      }
    }
    log('');
  }

  if (allOk) {
    log('All pins reachable.');
  } else {
    process.exit(1);
  }
}

// ---------- --pull mode ----------

// NOTE (migration, one-time): skills pulled before this change live under
// ~/.config/opencode/skills/. This version's install_target is
// ~/.agents/skills/ (the shared cross-tool pool). Re-running --pull writes
// the new location; it does NOT delete the old ~/.config/opencode/skills/
// copy — remove that manually if desired, or leave it (OpenCode's own skill
// loader also reads ~/.config/opencode/skills/, so a stale copy there is
// inert, not harmful, once ~/.agents/skills/ has the current version).

async function pullMode(manifest) {
  const installTarget = expandHome(manifest.install_target);
  mkdirSync(installTarget, { recursive: true });

  const receipt = existsSync(join(installTarget, 'receipt.json'))
    ? JSON.parse(readFileSync(join(installTarget, 'receipt.json'), 'utf8'))
    : {};

  for (const src of manifest.sources) {
    log(`\nPulling ${src.repo}@${src.pin.slice(0, 12)}…`);

    // Verify pin reachable
    const resolved = ghApiPin(src.repo, src.pin);
    if (!resolved) {
      err(`Cannot reach ${src.repo}@${src.pin} — skipping`);
      continue;
    }

    // Shallow clone into temp dir
    const tmpDir = join(tmpdir(), `pull-skills-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const cloneUrl = `https://github.com/${src.repo}.git`;
      // Clone without history; then checkout the exact pin
      const cloneResult = run(
        `git clone --depth 1 --no-single-branch ${cloneUrl} ${tmpDir}/repo`,
        { stdio: 'pipe' }
      );

      if (cloneResult.status !== 0) {
        // Fall back: full clone then checkout
        err(`Shallow clone failed, trying full clone: ${cloneResult.stderr?.trim()}`);
        rmSync(join(tmpDir, 'repo'), { recursive: true, force: true });
        const fullClone = run(`git clone ${cloneUrl} ${tmpDir}/repo`, { stdio: 'pipe' });
        if (fullClone.status !== 0) {
          err(`Failed to clone ${src.repo}: ${fullClone.stderr?.trim()}`);
          continue;
        }
      }

      // Checkout the exact pin
      const checkout = run(`git -C ${tmpDir}/repo checkout ${src.pin}`, { stdio: 'pipe' });
      if (checkout.status !== 0) {
        err(`Checkout failed for ${src.pin} in ${src.repo}, retrying with full clone: ${checkout.stderr?.trim()}`);
        // Fallback: try a full clone then retry checkout
        rmSync(join(tmpDir, 'repo'), { recursive: true, force: true });
        const fullCloneRetry = run(`git clone ${cloneUrl} ${tmpDir}/repo`, { stdio: 'pipe' });
        if (fullCloneRetry.status !== 0) {
          err(`Full clone retry failed for ${src.repo}: ${fullCloneRetry.stderr?.trim()}`);
          continue;
        }
        const checkoutRetry = run(`git -C ${tmpDir}/repo checkout ${src.pin}`, { stdio: 'pipe' });
        if (checkoutRetry.status !== 0) {
          err(`Checkout retry still failed for ${src.pin} in ${src.repo}: ${checkoutRetry.stderr?.trim()}`);
          continue;
        }
      }

      // Copy each skill dir/file into install_target
      const date = new Date().toISOString();
      for (const skill of src.skills) {
        // Skills may live as <skill>.md or <skill>/ directory
        const srcDir = join(tmpDir, 'repo', skill);
        const srcFile = join(tmpDir, 'repo', skill + '.md');
        const destDir = join(installTarget, skill);

        if (existsSync(srcDir)) {
          if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
          cpSync(srcDir, destDir, { recursive: true });
          log(`  copied ${skill}/ → ${installTarget}`);
        } else if (existsSync(srcFile)) {
          mkdirSync(destDir, { recursive: true });
          cpSync(srcFile, join(destDir, skill + '.md'));
          log(`  copied ${skill}.md → ${installTarget}/${skill}/`);
        } else {
          err(`  skill not found in repo: ${skill} (checked ${srcDir} and ${srcFile})`);
          continue;
        }

        if (symlinkToClaudeSkills(skill, installTarget)) {
          log(`  symlinked ~/.claude/skills/${skill} → ${installTarget}/${skill}`);
        }

        receipt[skill] = { repo: src.repo, pin: src.pin, date };
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  writeFileSync(join(installTarget, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  log(`\nreceipt.json written to ${installTarget}`);
  log('Done.');
}

// ---------- entry ----------

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];

  if (mode !== '--check' && mode !== '--pull') {
    err('Usage: pull-external-skills.mjs --check | --pull');
    process.exit(1);
  }

  if (!existsSync(MANIFEST_PATH)) {
    err(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = await loadManifest();

  if (mode === '--check') {
    await checkMode(manifest);
  } else {
    await pullMode(manifest);
  }
}

main().catch(e => {
  err(String(e));
  process.exit(1);
});
