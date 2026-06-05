import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('fleet-manifest.json', 'utf8'));

test('fleet manifest includes a session-vault component', () => {
  const component = manifest.components.find(entry => entry.id === 'session-vault');
  expect(component).toBeDefined();
  expect(component.default_on).toBe(true);
  expect(component.target_subdirs.includes('command')).toBe(true);
  expect(component.target_subdirs.includes('plugins')).toBe(true);
});
