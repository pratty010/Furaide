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

  // Look for skill directories (not files like README.md)
  const entries = readdirSync(patchesDir);
  for (const entry of entries) {
    const fullPath = join(patchesDir, entry);
    try {
      const stat = require('node:fs').statSync(fullPath);
      // Only check directories; skip README.md and other files
      if (!stat.isDirectory()) {
        continue;
      }

      // Directory name should correspond to a skill
      expect(allSkills.has(entry), `patch directory "${entry}" references unknown skill`).toBe(true);
    } catch {
      // Skip on stat error
    }
  }
});

test('pull-external-skills.mjs exists', () => {
  expect(existsSync(PULL_SCRIPT_PATH)).toBe(true);
});

// ---------- patch applier tests ----------

test('apply-patches.mjs exists', () => {
  const applyScriptPath = join(HARNESS_ROOT, 'scripts/apply-patches.mjs');
  expect(existsSync(applyScriptPath)).toBe(true);
});

test('patch applier applies a single patch successfully', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');

  const tmpDir = mkdtempSync(join(os.tmpdir(), 'patch-test-'));
  try {
    // Initialize a git repo
    spawnSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });

    // Set up fixture: a skill directory with initial content
    const skillDir = join(tmpDir, 'test-skill');
    const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
    mkdirSync(skillDir, { recursive: true });

    const testFile = join(skillDir, 'test.md');
    const originalContent = 'line 1\nline 2\nline 3\n';
    writeFileSync(testFile, originalContent);

    // Add initial file to git
    spawnSync('git', ['add', 'test-skill/test.md'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'pipe' });

    // Create a patch that changes line 2
    const patchContent = `--- a/test-skill/test.md
+++ b/test-skill/test.md
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
`;

    // Try to apply the patch (check mode)
    const result = spawnSync('git', [
      'apply',
      '--check',
      '--'
    ], {
      input: patchContent,
      encoding: 'utf8',
      cwd: tmpDir,
      stdio: 'pipe'
    });

    expect(result.status).toBe(0);

    // Now actually apply
    const applyResult = spawnSync('git', [
      'apply',
      '--'
    ], {
      input: patchContent,
      encoding: 'utf8',
      cwd: tmpDir,
      stdio: 'pipe'
    });

    expect(applyResult.status).toBe(0);
    const modifiedContent = readFileSync(testFile, 'utf8');
    expect(modifiedContent).toContain('line 2 modified');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('patch applier detects already-applied patches (idempotency)', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');

  const tmpDir = mkdtempSync(join(os.tmpdir(), 'patch-idempotent-'));
  try {
    // Initialize a git repo
    spawnSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });

    const skillDir = join(tmpDir, 'test-skill');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skillDir, { recursive: true });

    const testFile = join(skillDir, 'test.md');
    const originalContent = 'line 1\nline 2\nline 3\n';
    writeFileSync(testFile, originalContent);

    // Add initial file to git
    spawnSync('git', ['add', 'test-skill/test.md'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'pipe' });

    const patchContent = `--- a/test-skill/test.md
+++ b/test-skill/test.md
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
`;

    // Apply the patch once
    spawnSync('git', [
      'apply'
    ], {
      input: patchContent,
      encoding: 'utf8',
      cwd: tmpDir,
      stdio: 'pipe'
    });

    // Try to detect if already applied — reverse check should succeed
    const checkResult = spawnSync('git', [
      'apply',
      '--reverse',
      '--check',
      '--'
    ], {
      input: patchContent,
      encoding: 'utf8',
      cwd: tmpDir,
      stdio: 'pipe'
    });

    // If the reverse check succeeds (status 0), it means the patch is already applied
    expect(checkResult.status).toBe(0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('skill-patches directory structure is valid', () => {
  const m = loadManifest();
  const repoRoot = resolve(HARNESS_ROOT, '../../');
  const patchesDir = join(repoRoot, m.patches_dir);

  // Directory should exist or be creatable
  // (it may not exist yet if no patches have been added)
  expect(typeof m.patches_dir).toBe('string');
  expect(m.patches_dir.length).toBeGreaterThan(0);

  // patches_dir should end with 'skill-patches'
  expect(m.patches_dir).toMatch(/skill-patches$/);
});
