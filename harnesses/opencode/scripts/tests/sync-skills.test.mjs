#!/usr/bin/env node
/**
 * sync-skills.test.mjs — sync-skills.mjs receipt-and-populate behavior
 *
 * Verifies that running scripts/sync-skills.mjs against a temp $HOME writes
 * the furaide-skills-receipt.json receipt and populates the skills tree.
 *
 * Extracted from the former package-install.test.mjs (which exercised this
 * alongside a now-removed src/index.ts config-hook import). This file calls
 * scripts/sync-skills.mjs directly — no src/index.ts import.
 *
 * scripts/sync-skills.mjs resolves its SKILLS_SOURCE relative to the
 * script's own location (HARNESS_ROOT/skills), so it works regardless of
 * $HOME. The skills/ directory is now vendored into harnesses/opencode/skills/
 * so the receipt should always be written (this is no longer a "skip if
 * unavailable" scenario).
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

// ── helpers ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dir, '..', '..'); // harnesses/opencode/
const SCRIPTS_DIR = join(ROOT, 'scripts');
const SYNC_SKILLS = join(SCRIPTS_DIR, 'sync-skills.mjs');

const TMP_PREFIX = 'sync-skills-';
const TMP_ROOT = join(ROOT, '.test-tmp');

function tmp(dirname = TMP_PREFIX) {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, dirname));
}

// ── setup / teardown ─────────────────────────────────────────────────────────

let homeDir;

beforeAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

afterAll(() => {
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ── tests ────────────────────────────────────────────────────────────────────

test('sync-skills: receipt written and skills populated in a temp $HOME', { timeout: 60000 }, () => {
  homeDir = tmp();
  const opencodeCfgDir = join(homeDir, '.config', 'opencode');
  mkdirSync(opencodeCfgDir, { recursive: true });

  const skillsDir = join(homeDir, '.config', 'opencode', 'skills');
  const receiptPath = join(skillsDir, 'furaide-skills-receipt.json');

  execFileSync('bun', [SYNC_SKILLS], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir },
    timeout: 30000,
  });

  // SKILLS_SOURCE resolves relative to the script's own location
  // (harnesses/opencode/skills), which is vendored and always present, so
  // the receipt must exist after a run regardless of the temp $HOME.
  expect(existsSync(receiptPath)).toBe(true);

  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  expect(receipt).toHaveProperty('version');
  expect(receipt).toHaveProperty('skills');

  // Skills directory must contain at least one skill with a SKILL.md
  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  expect(skillDirs.length).toBeGreaterThan(0);
  const hasSkillMd = skillDirs.some((name) =>
    existsSync(join(skillsDir, name, 'SKILL.md')),
  );
  expect(hasSkillMd).toBe(true);
});
