#!/usr/bin/env node
/**
 * coderunner-toolcall.mjs
 * Probes opencode-go/mimo-v2.5 for real tool-call capability.
 * The prompt requires the model to execute 3 concrete tool uses:
 *   1. list the current directory
 *   2. read a known file (package.json or opencode.jsonc)
 *   3. run `echo CR_OK` via bash
 * A plain-text response without actual tool execution cannot produce CR_OK.
 * Exit 0 = PASS, exit 7 = FAIL.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const MODEL = 'opencode-go/mimo-v2.5';
const PROMPT = [
  'You must perform these 3 steps using the available tools:',
  '1. Use the list tool to list the contents of the current directory. Include the result in your reply.',
  '2. Use the read tool to read the file opencode.jsonc. Include the first line of the file in your reply.',
  '3. Use the bash tool to run exactly: echo CR_OK. Include the output CR_OK in your reply.',
  'After completing all 3 steps with the actual tools, reply with: TOOL_SEQUENCE_COMPLETE'
].join('\n');

let result = '';
let passed = false;
let err = null;

try {
  result = execFileSync(
    'opencode',
    ['run', '--dangerously-skip-permissions', '-m', MODEL, PROMPT],
    { encoding: 'utf8', timeout: 120000 }
  );
  // CR_OK can only appear if bash tool actually ran
  passed = /CR_OK/.test(result) && /TOOL_SEQUENCE_COMPLETE/i.test(result);
} catch (e) {
  err = (e.stderr || e.message || String(e)).slice(0, 400);
}

const out = {
  model: MODEL,
  coderunner_mimo_ok: passed,
  has_CR_OK: /CR_OK/.test(result),
  has_complete: /TOOL_SEQUENCE_COMPLETE/i.test(result),
  err,
  sample: result.slice(0, 600),
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(passed ? 0 : 7);
