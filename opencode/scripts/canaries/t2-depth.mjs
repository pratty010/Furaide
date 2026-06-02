#!/usr/bin/env node
/**
 * t2-depth.mjs
 * Tests whether opencode supports subagent→subagent dispatch (depth-2).
 * A primary session dispatches _t1-canary, which dispatches _t2-canary.
 * If T2_REACHED propagates back, 3-level dispatch is proven.
 * Exit 0 = GO (depth2 supported), exit 8 = NO-GO.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const PROMPT = 'Use the task tool to call @_t1-canary. Return exactly what it returns.';

let result = '';
let err = null;
let depth2 = false;

try {
  result = execFileSync(
    'opencode',
    ['run', '--dangerously-skip-permissions', PROMPT],
    { encoding: 'utf8', timeout: 180000 }
  );
  depth2 = /T2_REACHED/.test(result);
} catch (e) {
  err = (e.stderr || e.message || String(e)).slice(0, 400);
}

const out = {
  depth2_dispatch: depth2,
  T2_REACHED_found: /T2_REACHED/.test(result),
  err,
  sample: result.slice(0, 600),
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(depth2 ? 0 : 8);
