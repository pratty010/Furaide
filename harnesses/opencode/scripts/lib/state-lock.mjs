import { openSync, writeSync, closeSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function acquire(lockPath, { session, ttlMs = 30000, retries = 50, backoffMs = 100 } = {}) {
  // ensure parent dir exists
  mkdirSync(dirname(lockPath), { recursive: true });

  for (let i = 0; i <= retries; i++) {
    try {
      const fd = openSync(lockPath, 'wx'); // O_CREAT|O_EXCL — atomic
      const lease = { pid: process.pid, session, acquired: Date.now(), expires: Date.now() + ttlMs };
      writeSync(fd, JSON.stringify(lease));
      closeSync(fd);
      return { lockPath, ...lease };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Try to read current lock
      let cur = null;
      try { cur = JSON.parse(readFileSync(lockPath, 'utf8')); } catch {}
      // Steal stale lock
      if (cur && Date.now() > cur.expires) {
        try { unlinkSync(lockPath); } catch {}
        continue;
      }
      if (i === retries) {
        throw new Error(`lock held by pid=${cur?.pid} session=${cur?.session}`);
      }
      await sleep(backoffMs);
    }
  }
}

export async function release(h) {
  if (h && existsSync(h.lockPath)) {
    try { unlinkSync(h.lockPath); } catch {}
  }
}
