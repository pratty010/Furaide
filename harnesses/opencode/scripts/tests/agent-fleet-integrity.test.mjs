import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { AGENT_RENAME_MAP, LEGACY_AGENT_ALIASES, ALL_AGENT_TARGETS } from '../lib/agent-fleet-map.mjs';

test('rename map covers all 39 agents with unique current and target names', () => {
  expect(AGENT_RENAME_MAP).toHaveLength(39);

  const current = new Set(AGENT_RENAME_MAP.map(entry => entry.current));
  const target = new Set(AGENT_RENAME_MAP.map(entry => entry.next));

  expect(current.size).toBe(39);
  expect(target.size).toBe(39);
  expect(ALL_AGENT_TARGETS).toHaveLength(39);
});

test('legacy alias map points to renamed targets', () => {
  expect(LEGACY_AGENT_ALIASES['code-runner']).toBe('karakuri--command-runner');
  expect(LEGACY_AGENT_ALIASES['explorer']).toBe('mikoshi--code-pathfinder');
  expect(LEGACY_AGENT_ALIASES['source-retriever']).toBe('yamabiko--source-echo');
  expect(LEGACY_AGENT_ALIASES['technical-writer']).toBe('makimono--docs-scribe');
});

test('all renamed agent files exist and no old filenames remain', () => {
  for (const entry of AGENT_RENAME_MAP) {
    expect(existsSync(`agents/${entry.next}.md`), `missing agents/${entry.next}.md`).toBe(true);
    expect(existsSync(`agents/${entry.current}.md`), `stale agents/${entry.current}.md still exists`).toBe(false);
  }
});

test('no agent file uses invalid mode: agent', () => {
  for (const entry of AGENT_RENAME_MAP) {
    const body = readFileSync(`agents/${entry.next}.md`, 'utf8');
    expect(body.includes('mode: agent'), `agents/${entry.next}.md still uses mode: agent`).toBe(false);
  }
});
