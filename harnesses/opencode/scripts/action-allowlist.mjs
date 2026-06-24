#!/usr/bin/env node
/**
 * action-allowlist.mjs
 * Checks proposed action is in the allowlist and has a rollback path.
 * Input: { action: string, allowlist: string[], rollback?: string }
 * Output: { verdict: "ok"|"critical", reasons: [] }
 */
import process from 'node:process';
const input = JSON.parse(process.argv[2] || '{}');
const { action = '', allowlist = [], rollback = null } = input;
const reasons = [];
let verdict = 'ok';
if (!allowlist.includes(action)) {
  reasons.push(`Action "${action}" is not in the allowlist`);
  verdict = 'critical';
} else if (!rollback) {
  reasons.push(`Action "${action}" has no rollback path`);
  verdict = 'critical';
}
process.stdout.write(JSON.stringify({ verdict, reasons }) + '\n');
