import { test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_RENAME_MAP, LEGACY_AGENT_ALIASES, ALL_AGENT_TARGETS } from '../lib/agent-fleet-map.mjs';

const ROOTS = ['config/AGENTS.md', 'docs/routing-manifest.json'];
const DIRS = ['agents', 'commands'];
const ACTIVE_DOC_SUBDIRS = ['docs/manifest-schema.md', 'docs/workflows.md', 'docs/routing-manifest.json'];
const DOC_ALLOWLIST = new Set(['docs/archive/agent-fleet-structural-findings.md', 'agents/chizu--implementation-planner.md', 'agents/shiranui--migration-guide.md', 'agents/sojobo--system-strategist.md']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function collectActiveDocs() {
  // Only check active fleet docs; historical specs/plans under docs/superpowers/ may contain legacy references
  const out = [];
  for (const item of ACTIVE_DOC_SUBDIRS) {
    try {
      const st = statSync(item);
      if (st.isDirectory()) out.push(...walk(item));
      else out.push(item);
    } catch {}
  }
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('no stale old stems or legacy aliases remain outside approved historical docs', () => {
  const files = [...ROOTS, ...DIRS.flatMap(walk), ...collectActiveDocs()].filter(file => !DOC_ALLOWLIST.has(file));
  const staleTokens = [
    ...AGENT_RENAME_MAP.filter(entry => entry.current !== entry.next).map(entry => entry.current),
    ...Object.keys(LEGACY_AGENT_ALIASES),
  ];

  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    for (const token of staleTokens) {
      const escaped = escapeRegex(token);
      const re = new RegExp(`(?<![a-z0-9-])@?${escaped}(?![a-z0-9-])`);
      expect(re.test(body), `${file} still contains stale token ${token}`).toBe(false);
    }
  }
});

test('all task permissions point at real renamed targets', () => {
  const valid = new Set(ALL_AGENT_TARGETS);
  for (const file of walk('agents')) {
    const body = readFileSync(file, 'utf8');
    const lines = body.split('\n');
    let inTaskBlock = false;
    for (const line of lines) {
      if (/^  task:\s*$/.test(line)) {
        inTaskBlock = true;
        continue;
      }
      if (inTaskBlock && /^  [^ ]/.test(line)) {
        inTaskBlock = false;
      }
      if (!inTaskBlock) continue;
      const m = line.match(/^\s{4}"?([a-z0-9-]+)"?:\s*allow\s*$/);
      if (m && m[1] !== '*') {
        expect(valid.has(m[1]), `${file} permission.task target ${m[1]} is not a renamed agent stem`).toBe(true);
      }
    }
  }
});
