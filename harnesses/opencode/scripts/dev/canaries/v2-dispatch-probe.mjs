#!/usr/bin/env node
/**
 * v2-dispatch-probe.mjs — spec "OpenCode Dispatch Constraint" probes (a)-(c).
 * (a) depth-2: primary -> _v2-impl -> _v2-leaf
 * (b) depth-3: primary -> _v2-spec -> _v2-impl -> _v2-leaf
 * (c) deny-enforcement: _v2-spec attempting _v2-leaf (denied) must fail
 * Exit 0 = all pass; exit 8 = depth-3 failed (fall back to hub-and-spoke);
 * exit 9 = deny-enforcement failed (BLOCKER: do not ship specialist dispatch).
 */
import { execFileSync } from 'node:child_process';

function run(prompt) {
  try {
    return execFileSync('opencode',
      ['run', '--dangerously-skip-permissions', prompt],
      { encoding: 'utf8', timeout: 240000 });
  } catch (e) {
    return `ERR:${(e.stderr || e.message || String(e)).slice(0, 400)}`;
  }
}

const d2 = run('Use the task tool to call @_v2-impl. Return exactly what it returns.');
const d3 = run('Use the task tool to call @_v2-spec with the word "chain". Return exactly what it returns.');
const dn = run('Use the task tool to call @_v2-spec with the word "blocked". Return exactly what it reports.');

const out = {
  a_depth2: /V2_LEAF_OK/.test(d2),
  b_depth3: /V2_LEAF_OK/.test(d3),
  c_deny_enforced: !/V2_LEAF_OK/.test(dn),
  samples: { d2: d2.slice(0, 300), d3: d3.slice(0, 300), dn: dn.slice(0, 300) },
};
console.log(JSON.stringify(out, null, 2));
process.exit(!out.c_deny_enforced ? 9 : out.b_depth3 && out.a_depth2 ? 0 : 8);
