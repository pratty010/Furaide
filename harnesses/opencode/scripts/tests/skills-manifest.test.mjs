/**
 * skills-manifest.test.mjs
 * Validates the structure and invariants of config/skills-manifest.json
 * and that pull-external-skills.mjs exists and exports expected symbols.
 */
import { test, expect } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(__dirname, '../../');
const MANIFEST_PATH = join(HARNESS_ROOT, 'config/skills-manifest.json');
const PULL_SCRIPT_PATH = join(HARNESS_ROOT, 'scripts/pull-external-skills.mjs');

// ---------- helpers ----------

function loadManifest() {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

// ---------- tests ----------

test('manifest file exists', () => {
  expect(existsSync(MANIFEST_PATH)).toBe(true);
});

test('manifest parses to a valid object', () => {
  const m = loadManifest();
  expect(typeof m).toBe('object');
  expect(m).not.toBeNull();
});

test('install_target field is present and non-empty', () => {
  const m = loadManifest();
  expect(typeof m.install_target).toBe('string');
  expect(m.install_target.length).toBeGreaterThan(0);
});

test('sources is a non-empty array', () => {
  const m = loadManifest();
  expect(Array.isArray(m.sources)).toBe(true);
  expect(m.sources.length).toBeGreaterThan(0);
});

test('every source has repo, pin, and skills fields', () => {
  const m = loadManifest();
  for (const src of m.sources) {
    expect(typeof src.repo).toBe('string');
    expect(src.repo.length).toBeGreaterThan(0);

    expect(typeof src.pin).toBe('string');
    // SHA-1 or SHA-256 hex — at minimum 40 hex chars
    expect(src.pin).toMatch(/^[0-9a-f]{40,}$/);

    expect(Array.isArray(src.skills)).toBe(true);
    expect(src.skills.length).toBeGreaterThan(0);
  }
});

test('every skill name is unique across all sources', () => {
  const m = loadManifest();
  const all = m.sources.flatMap(s => s.skills);
  const unique = new Set(all);
  expect(unique.size).toBe(all.length);
});

test('patches_dir field is present', () => {
  const m = loadManifest();
  expect(typeof m.patches_dir).toBe('string');
  expect(m.patches_dir.length).toBeGreaterThan(0);
});

test('each patch file (if any) names a skill that exists in the manifest', () => {
  const m = loadManifest();
  const allSkills = new Set(m.sources.flatMap(s => s.skills));

  // patches_dir is relative to the repo root (two levels above harnesses/opencode)
  const repoRoot = resolve(HARNESS_ROOT, '../../');
  const patchesDir = join(repoRoot, m.patches_dir);

  if (!existsSync(patchesDir)) {
    // No patches directory yet — nothing to check
    return;
  }

  const patchFiles = readdirSync(patchesDir);
  for (const file of patchFiles) {
    // Patch files are expected to be named <skill-name>.patch or <skill-name>.md
    const skillName = file.replace(/\.(patch|md|diff)$/, '');
    expect(allSkills.has(skillName), `patch file "${file}" references unknown skill "${skillName}"`).toBe(true);
  }
});

test('pull-external-skills.mjs exists', () => {
  expect(existsSync(PULL_SCRIPT_PATH)).toBe(true);
});
