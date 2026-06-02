#!/usr/bin/env node
/**
 * history-roundtrip.mjs
 * Informational probe: test whether cross-vendor handoffs produce errors.
 * Runs two independent sessions (not actual cross-model handoff — opencode
 * doesn't expose raw history between sessions). Instead we probe:
 *   (a) MiniMax can complete a multi-turn reasoning task (KEEP rule intact)
 *   (b) Qwen can complete a follow-up reasoning task (STRIP rule intact)
 * If either degrades, the serializer is mandatory.
 * This canary never blocks (exit always 0). The result is recorded in RESULTS.md
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

function run(model, prompt) {
  try {
    const r = execFileSync(
      'opencode',
      ['run', '-m', model, '--dangerously-skip-permissions', prompt],
      { encoding: 'utf8', timeout: 150000 }
    );
    return { ok: true, output: r.slice(0, 400), err: null };
  } catch (e) {
    return { ok: false, output: '', err: (e.stderr || e.message || '').slice(0, 200) };
  }
}

// MiniMax: structured extraction (tests KEEP-think multi-step reasoning)
const mmResult = run(
  'opencode-go/minimax-m2.7',
  'Extract the 3 main section headings from this text and reply as a JSON array: "Introduction. Background. Methodology. Results. Conclusion." Give me only the first 3 as a JSON array.'
);

// Qwen: follow-up reasoning after receiving structured data (tests STRIP-think next-turn)
const qwResult = run(
  'opencode-go/qwen3.6-plus',
  'Given the JSON array ["Introduction","Background","Methodology"], count the elements, state the count, then reply DONE.'
);

const minimax_ok = mmResult.ok && /\[/.test(mmResult.output);
const qwen_followup_ok = qwResult.ok && /DONE/.test(qwResult.output);
const serializer_mandatory = !minimax_ok || !qwen_followup_ok;

const out = {
  minimax_extraction_ok: minimax_ok,
  qwen_followup_ok,
  serializer_mandatory,
  recommendation: serializer_mandatory
    ? 'history-serializer.mjs is MANDATORY before cross-vendor handoffs ship'
    : 'history-serializer.mjs is recommended (preventive) but no acute failure detected',
  minimax_sample: mmResult.output,
  qwen_sample: qwResult.output,
  minimax_err: mmResult.err,
  qwen_err: qwResult.err,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(0); // always informational
