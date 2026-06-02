#!/usr/bin/env node
/**
 * playbook-check.mjs
 * Checks each obligation maps to a playbook clause.
 * Input: { obligations: [{id, clause?: string}] }
 * Output: { verdict: "ok"|"warn", reasons: [] }
 */
import process from 'node:process';
const input = JSON.parse(process.argv[2] || '{"obligations":[]}');
const obligations = input.obligations || [];
const reasons = [];
let verdict = 'ok';
for (const o of obligations) {
  if (!o.clause) {
    reasons.push(`Obligation "${o.id}" has no playbook clause`);
    verdict = 'warn';
  }
}
process.stdout.write(JSON.stringify({ verdict, reasons }) + '\n');
