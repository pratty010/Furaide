import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { AGENT_RENAME_MAP, LEGACY_AGENT_ALIASES, INTERIM_V2_FLEET } from '../lib/agent-fleet-map.mjs';

test('rename map covers the interim v2 fleet with unique current and target names', () => {
  expect(AGENT_RENAME_MAP).toHaveLength(INTERIM_V2_FLEET.length);

  const current = new Set(AGENT_RENAME_MAP.map(entry => entry.current));
  const target = new Set(AGENT_RENAME_MAP.map(entry => entry.next));

  expect(current.size).toBe(INTERIM_V2_FLEET.length);
  expect(target.size).toBe(INTERIM_V2_FLEET.length);
});

test('legacy alias map points to interim v2 targets', () => {
  expect(LEGACY_AGENT_ALIASES['code-runner']).toBe('general');
  expect(LEGACY_AGENT_ALIASES['explorer']).toBe('explore');
  expect(LEGACY_AGENT_ALIASES['debugger']).toBe('bakeneko--bug-hunter');
});

test('all interim agent files exist', () => {
  for (const name of INTERIM_V2_FLEET) {
    expect(existsSync(`agents/${name}.md`), `missing agents/${name}.md`).toBe(true);
  }
});

test('no agent file uses invalid mode: agent', () => {
  for (const name of INTERIM_V2_FLEET) {
    const body = readFileSync(`agents/${name}.md`, 'utf8');
    expect(body.includes('mode: agent'), `agents/${name}.md still uses mode: agent`).toBe(false);
  }
});
