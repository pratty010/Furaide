import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveChain, nextModel, classify } from '../../plugins/model-failover.js';

const manifest = JSON.parse(readFileSync('docs/routing-manifest.json', 'utf8'));

test('resolveChain returns primary + fallbacks in order', () => {
  const chain = resolveChain(manifest, 'reviewer');
  expect(chain[0]).toBe('openai/gpt-5.5');
  expect(chain.length).toBeGreaterThan(1);
});

test('resolveChain returns null for unknown agent', () => {
  expect(resolveChain(manifest, 'nonexistent')).toBeNull();
});

test('nextModel returns next in chain', () => {
  const chain = ['A', 'B', 'C'];
  expect(nextModel(chain, 'A')).toBe('B');
  expect(nextModel(chain, 'B')).toBe('C');
});

test('nextModel returns null at end of chain', () => {
  expect(nextModel(['A', 'B'], 'B')).toBeNull();
});

test('nextModel returns null for unknown current', () => {
  expect(nextModel(['A', 'B'], 'X')).toBeNull();
});

test('classify: 429 is retryable', () => {
  expect(classify(new Error('HTTP 429 rate limit exceeded'))).toBe('retryable');
});

test('classify: 401 is fatal', () => {
  expect(classify(new Error('HTTP 401 Unauthorized'))).toBe('fatal');
});

test('classify: timeout is retryable', () => {
  expect(classify(new Error('Request timeout after 30s'))).toBe('retryable');
});
