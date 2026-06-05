import { test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_RENAME_MAP, LEGACY_AGENT_ALIASES, ALL_AGENT_TARGETS } from '../lib/agent-fleet-map.mjs';

const ROOTS = ['AGENTS.md', 'fleet-manifest.json', 'docs/routing-manifest.json', 'scripts/install-fleet.sh', 'scripts/install-fleet-bootstrap.sh', 'scripts/merge-config.mjs'];
const DIRS = ['agents', 'command', 'docs'];
const DOC_ALLOWLIST = new Set(['docs/agent-description-rubric.md', 'docs/agent-fleet-structural-findings.md']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('no stale old stems or legacy aliases remain outside approved historical docs', () => {
  const files = [...ROOTS, ...DIRS.flatMap(walk)].filter(file => !DOC_ALLOWLIST.has(file));
  const staleTokens = [
    ...AGENT_RENAME_MAP.map(entry => entry.current),
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
