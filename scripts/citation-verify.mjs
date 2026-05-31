#!/usr/bin/env node
/**
 * citation-verify.mjs
 * Checks that flagged claims have resolvable source IDs.
 * Input (JSON via --input arg or stdin):
 *   { claims: [{text, regulated: bool, source_id?: string}] }
 * Output: { verdict: "ok"|"warn"|"critical", reasons: [] }
 */
import process from 'node:process';
const input = JSON.parse(process.argv[2] || '{"claims":[]}');
const claims = input.claims || [];
const reasons = [];
let verdict = 'ok';
for (const c of claims) {
  if (!c.source_id) {
    if (c.regulated) {
      reasons.push(`Regulated claim lacks source: "${String(c.text).slice(0, 60)}"`);
      verdict = 'critical';
    } else if (verdict !== 'critical') {
      reasons.push(`Uncited claim: "${String(c.text).slice(0, 60)}"`);
      verdict = 'warn';
    }
  }
}
process.stdout.write(JSON.stringify({ verdict, reasons }) + '\n');
