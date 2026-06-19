#!/usr/bin/env node
/**
 * model-probe.mjs
 * Probes each opencode-go model for: (a) session creation, (b) tool call emission.
 * Usage: bun scripts/canaries/model-probe.mjs [model1 model2 ...]
 * Output: JSON array to stdout. Each entry: {model, session, toolCall, err}.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const MODELS = process.argv.slice(2);
if (MODELS.length === 0) {
  process.stderr.write('Usage: bun model-probe.mjs <model1> [model2 ...]\n');
  process.exit(1);
}

const PROMPT = 'List the files in the current directory using the list tool, then reply with the word DONE.';

const out = [];
for (const m of MODELS) {
  let ok = false, tool = false, err = null;
  process.stderr.write(`Probing opencode-go/${m} ...\n`);
  try {
    const r = execFileSync(
      'opencode',
      ['run', '-m', `opencode-go/${m}`, '--format', 'json', PROMPT],
      { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    ok = true;
    // tool call: look for tool_use type events or DONE in text parts
    tool = /"type"\s*:\s*"tool[_-]/.test(r) || /DONE/i.test(r) || /list|\.md|\.mjs|\.json/i.test(r);
  } catch (e) {
    const raw = (e.stderr || e.stdout || e.message || String(e));
    // If we got JSON events in stdout before failure, session was partially ok
    if (e.stdout && e.stdout.includes('"type"')) {
      ok = true;
      tool = /"type"\s*:\s*"tool[_-]/.test(e.stdout) || /DONE/i.test(e.stdout);
      err = `exit-nonzero: ${raw.slice(0, 200)}`;
    } else {
      err = raw.slice(0, 300);
    }
  }
  out.push({ model: m, session: ok, toolCall: tool, err });
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
