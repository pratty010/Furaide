import { test, expect } from 'bun:test';
import { stripJsoncComments, parseJsonc } from '../lib/jsonc.mjs';

test('stripJsoncComments: removes full-line // comments', () => {
  const input = `{
  // header comment
  "a": 1
}`;
  const stripped = stripJsoncComments(input);
  expect(stripped).not.toContain('// header comment');
  expect(stripped).toContain('"a": 1');
  expect(() => JSON.parse(stripped)).not.toThrow();
});

test('stripJsoncComments: removes trailing // comments', () => {
  const input = `{
  "a": 1, // trailing note
  "b": 2
}`;
  const stripped = stripJsoncComments(input);
  expect(stripped).not.toContain('trailing note');
  const obj = JSON.parse(stripped);
  expect(obj.a).toBe(1);
  expect(obj.b).toBe(2);
});

test('stripJsoncComments: removes /* block */ comments (single-line)', () => {
  const input = '{ /* a block */ "a": 1 }';
  const stripped = stripJsoncComments(input);
  expect(stripped).not.toContain('a block');
  expect(JSON.parse(stripped).a).toBe(1);
});

test('stripJsoncComments: removes /* multi-line block */ comments', () => {
  const input = `{
  /* this is
     a multi-line
     block comment */
  "a": 1
}`;
  const stripped = stripJsoncComments(input);
  expect(stripped).not.toContain('multi-line');
  expect(stripped).not.toContain('block comment');
  expect(JSON.parse(stripped).a).toBe(1);
});

test('stripJsoncComments: preserves "//" inside string values (URLs)', () => {
  const input = `{
  "url": "https://opencode.ai/config.json",
  "glob": "./rules/*.md"
}`;
  const stripped = stripJsoncComments(input);
  const obj = JSON.parse(stripped);
  expect(obj.url).toBe('https://opencode.ai/config.json');
  expect(obj.glob).toBe('./rules/*.md');
});

test('stripJsoncComments: preserves "/*" inside string values', () => {
  const input = `{
  "note": "use /* foo */ for inline docs",
  "a": 1
}`;
  const stripped = stripJsoncComments(input);
  const obj = JSON.parse(stripped);
  expect(obj.note).toBe('use /* foo */ for inline docs');
  expect(obj.a).toBe(1);
});

test('stripJsoncComments: strips // after a quoted key with trailing whitespace', () => {
  // The classic "opencode.jsonc with $schema on its own line" pattern.
  const input = `{
  "$schema": "https://opencode.ai/config.json", // provider whitelist schema
  "plugin": ["./plugins/nio.js"]
}`;
  const stripped = stripJsoncComments(input);
  const obj = JSON.parse(stripped);
  expect(obj.$schema).toBe('https://opencode.ai/config.json');
  expect(obj.plugin).toEqual(['./plugins/nio.js']);
});

test('stripJsoncComments: leaves plain JSON unchanged', () => {
  const input = '{"a": 1, "b": [2, 3]}';
  expect(stripJsoncComments(input)).toBe(input);
});

test('parseJsonc: returns parsed object for JSONC input', () => {
  const input = `{
  // comment
  "plugin": ["./plugins/nio.js"],
  "agent": {
    "oni--red-team-reviewer": { "model": "openai/gpt-5.5" }
  }
}`;
  const obj = parseJsonc(input);
  expect(obj.plugin).toEqual(['./plugins/nio.js']);
  expect(obj.agent['oni--red-team-reviewer'].model).toBe('openai/gpt-5.5');
});

test('parseJsonc: returns parsed object for plain JSON input', () => {
  const obj = parseJsonc('{"a": 1, "b": "two"}');
  expect(obj.a).toBe(1);
  expect(obj.b).toBe('two');
});

test('parseJsonc: throws on invalid input', () => {
  expect(() => parseJsonc('{ invalid json')).toThrow();
});
