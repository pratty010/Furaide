import { test, expect } from 'bun:test';
import { acquire, release } from '../lib/state-lock.mjs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('exclusive: second acquire fails while held', async () => {
  const d = mkdtempSync(join(tmpdir(), 'lk'));
  const lp = join(d, '.lock');
  const h = await acquire(lp, { session: 's1', ttlMs: 5000 });
  await expect(
    acquire(lp, { session: 's2', ttlMs: 5000, retries: 0 })
  ).rejects.toThrow(/held/);
  await release(h);
  const h2 = await acquire(lp, { session: 's2', ttlMs: 5000 });
  expect(h2).toBeTruthy();
  await release(h2);
});

test('stale lease is stolen after expiry', async () => {
  const d = mkdtempSync(join(tmpdir(), 'lk'));
  const lp = join(d, '.lock');
  // Acquire with ttlMs=-1 so it's already expired
  await acquire(lp, { session: 'dead', ttlMs: -1 });
  const h = await acquire(lp, { session: 's2', ttlMs: 5000, retries: 1 });
  expect(h.session).toBe('s2');
  await release(h);
});
