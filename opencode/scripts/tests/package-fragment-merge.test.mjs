import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPTS_DIR = join(import.meta.dir, '..');
const MERGE = join(SCRIPTS_DIR, 'merge-package-fragment.mjs');
const UNMERGE = join(SCRIPTS_DIR, 'unmerge-package-fragment.mjs');
const FRAGMENT = join(SCRIPTS_DIR, '..', 'config', 'package.web-tools.json');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'pkg-merge-'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runMerge(target, fragment) {
  return execFileSync('bun', [MERGE, target, fragment], { encoding: 'utf8' });
}

function runUnmerge(target, fragment) {
  return execFileSync('bun', [UNMERGE, target, fragment], { encoding: 'utf8' });
}

test('merge-package-fragment adds @opencode-ai/plugin without dropping user deps', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    writeJson(pkg, { dependencies: { leftpad: '1.0.0' } });
    runMerge(pkg, FRAGMENT);
    const result = readJson(pkg);
    expect(result.dependencies.leftpad).toBe('1.0.0');
    expect(result.dependencies['@opencode-ai/plugin']).toBeTruthy();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge-package-fragment is idempotent', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    writeJson(pkg, { dependencies: {} });
    runMerge(pkg, FRAGMENT);
    const first = readFileSync(pkg, 'utf8');
    runMerge(pkg, FRAGMENT);
    const second = readFileSync(pkg, 'utf8');
    expect(second).toBe(first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge-package-fragment does not overwrite user dep version', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    writeJson(pkg, { dependencies: { '@opencode-ai/plugin': '0.1.0' } });
    runMerge(pkg, FRAGMENT);
    const result = readJson(pkg);
    expect(result.dependencies['@opencode-ai/plugin']).toBe('0.1.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unmerge-package-fragment removes fleet deps, preserves user deps', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    writeJson(pkg, {
      dependencies: {
        leftpad: '1.0.0',
        '@opencode-ai/plugin': '^0.0.0',
      },
    });
    runUnmerge(pkg, FRAGMENT);
    const result = readJson(pkg);
    expect(result.dependencies.leftpad).toBe('1.0.0');
    expect(result.dependencies['@opencode-ai/plugin']).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unmerge-package-fragment is idempotent', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    writeJson(pkg, { dependencies: { '@opencode-ai/plugin': '^0.0.0' } });
    runUnmerge(pkg, FRAGMENT);
    const first = readFileSync(pkg, 'utf8');
    runUnmerge(pkg, FRAGMENT);
    const second = readFileSync(pkg, 'utf8');
    expect(second).toBe(first);
    const result = readJson(pkg);
    expect(result.dependencies).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge/unmerge round-trip returns to original state', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    const original = {
      name: 'test',
      dependencies: { leftpad: '1.0.0' },
    };
    writeJson(pkg, original);
    runMerge(pkg, FRAGMENT);
    expect(readJson(pkg).dependencies['@opencode-ai/plugin']).toBeTruthy();
    runUnmerge(pkg, FRAGMENT);
    const final = readJson(pkg);
    expect(final.dependencies).toEqual({ leftpad: '1.0.0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge-package-fragment creates package.json if missing', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    runMerge(pkg, FRAGMENT);
    const result = readJson(pkg);
    expect(result.dependencies['@opencode-ai/plugin']).toBeTruthy();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unmerge-package-fragment with no deps section does not error', () => {
  const dir = tmp();
  try {
    const pkg = join(dir, 'package.json');
    writeJson(pkg, { name: 'test' });
    runUnmerge(pkg, FRAGMENT);
    const result = readJson(pkg);
    expect(result.name).toBe('test');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge handles devDependencies and peerDependencies', () => {
  const dir = tmp();
  try {
    const fragment = join(dir, 'fragment.json');
    writeJson(fragment, {
      devDependencies: { typescript: '^5.0.0' },
      peerDependencies: { react: '^18.0.0' },
    });
    const pkg = join(dir, 'package.json');
    writeJson(pkg, { dependencies: { leftpad: '1.0.0' } });
    runMerge(pkg, fragment);
    const result = readJson(pkg);
    expect(result.devDependencies.typescript).toBe('^5.0.0');
    expect(result.peerDependencies.react).toBe('^18.0.0');
    expect(result.dependencies.leftpad).toBe('1.0.0');
    runUnmerge(pkg, fragment);
    const after = readJson(pkg);
    expect(after.devDependencies).toBeUndefined();
    expect(after.peerDependencies).toBeUndefined();
    expect(after.dependencies).toEqual({ leftpad: '1.0.0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
