import { afterEach, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveChain, nextModel, classify, __test_hookFor } from '../../plugins/failover/migawari.js';

const manifest = JSON.parse(readFileSync('docs/routing-manifest.json', 'utf8'));

const tempDirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'migawari-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

test('resolveChain returns primary + fallbacks in order', () => {
  const chain = resolveChain(manifest, 'oni--red-team-reviewer');
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

test('event hook ignores non-session.error events', async () => {
  const dir = tempDir();
  const logPath = join(dir, 'failover.jsonl');
  const hook = __test_hookFor({
    getWorkflowId: () => 'wf-23',
    resolveLogPath: () => logPath,
  });

  await expect(hook({ event: { type: 'session.idle', properties: {} } })).resolves.toBeUndefined();
  expect(() => readFileSync(logPath, 'utf8')).toThrow();
});

test('event hook skips logging when no workflow is active', async () => {
  const dir = tempDir();
  const logPath = join(dir, 'failover.jsonl');
  const hook = __test_hookFor({
    getWorkflowId: () => '',
    resolveLogPath: () => logPath,
  });

  await hook({
    event: {
      type: 'session.error',
      properties: { sessionID: 'ses_1', error: { name: 'APIError', data: { message: 'boom' } } },
    },
  });

  expect(() => readFileSync(logPath, 'utf8')).toThrow();
});

test('event hook logs session.error details to the failover log', async () => {
  const dir = tempDir();
  const logPath = join(dir, 'failover.jsonl');
  const hook = __test_hookFor({
    now: () => '2026-07-03T00:00:00.000Z',
    getWorkflowId: () => 'wf-23',
    resolveLogPath: () => logPath,
  });

  await hook({
    event: {
      type: 'session.error',
      properties: {
        sessionID: 'ses_abc',
        error: { name: 'APIError', data: { message: 'HTTP 429 rate limit exceeded', statusCode: 429, isRetryable: true } },
      },
    },
  });

  const entries = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    ts: '2026-07-03T00:00:00.000Z',
    sessionID: 'ses_abc',
    errorName: 'APIError',
    message: 'HTTP 429 rate limit exceeded',
    statusCode: 429,
    isRetryable: true,
  });
});

test('event hook does not throw when error is missing (defensive)', async () => {
  const dir = tempDir();
  const logPath = join(dir, 'failover.jsonl');
  const hook = __test_hookFor({
    getWorkflowId: () => 'wf-23',
    resolveLogPath: () => logPath,
  });

  await hook({ event: { type: 'session.error', properties: { sessionID: 'ses_2' } } });

  const entries = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(entries[0]).toMatchObject({ sessionID: 'ses_2', errorName: null, message: null });
});
