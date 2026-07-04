#!/usr/bin/env node
/**
 * security-severity.mjs
 * Computes a severity label for security findings using a weighted dimension model.
 *
 * Dimensions (each 0-3):
 *   reachability      — how reachable is the vulnerable code path
 *   attackerControl   — how much control does the attacker have over the trigger
 *   impact            — potential blast radius / data loss / privilege gain
 *   preconditions     — prerequisites the attacker must satisfy (REVERSED: fewer = riskier)
 *   authGate          — authentication/authorization required (REVERSED: weaker = riskier)
 *
 * Total = reachability + attackerControl + impact + (3 - preconditions) + (3 - authGate)
 * Max = 3+3+3+3+3 = 15
 *
 * Verdicts:
 *   escalate  total >= 13 AND impact == 3 AND reachability >= 2
 *   critical  total 10-12 OR (impact==3 AND reachability>=1)
 *   warn      total 6-9
 *   ok        total <= 5
 *
 * Usage:
 *   echo '<json>' | bun security-severity.mjs
 *   bun security-severity.mjs --finding '<json>'
 */

import { createInterface } from 'node:readline';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--finding' && argv[i + 1]) args.finding = argv[++i];
  }
  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n').trim() || null;
}

const DIMENSIONS = ['reachability', 'attackerControl', 'impact', 'preconditions', 'authGate'];
const ALLOWED_VERDICTS = new Set(['ok', 'warn', 'critical', 'escalate']);
const ALLOWED_REQUIRED_ACTIONS = new Set([
  'fix-in-place',
  'scout-alternative',
  'accept-risk-pending-approval',
]);
const LEGACY_MIGRATIONS = {
  'alternative-required': 'scout-alternative',
  'escalate-security': 'escalate',
  'accepted-risk': 'accept-risk-pending-approval',
};

function migrationHint(field, legacyValue) {
  return `Finding field "${field}" uses legacy value "${legacyValue}"; migrate to "${LEGACY_MIGRATIONS[legacyValue]}".`;
}

function validateFinding(f, index) {
  const errors = [];
  for (const dim of DIMENSIONS) {
    if (!(dim in f)) {
      errors.push(`Finding[${index}]: missing required field "${dim}"`);
      continue;
    }
    const v = f[dim];
    if (!Number.isInteger(v) || v < 0 || v > 3) {
      errors.push(`Finding[${index}].${dim} = ${JSON.stringify(v)} — must be integer 0-3`);
    }
  }

  if ('verdict' in f) {
    if (f.verdict in LEGACY_MIGRATIONS) {
      errors.push(`Finding[${index}].verdict: ${migrationHint('verdict', f.verdict)}`);
    } else if (!ALLOWED_VERDICTS.has(f.verdict)) {
      errors.push(`Finding[${index}].verdict = ${JSON.stringify(f.verdict)} — must be one of ok|warn|critical|escalate`);
    }
  }

  if ('required_action' in f) {
    if (f.required_action in LEGACY_MIGRATIONS) {
      errors.push(`Finding[${index}].required_action: ${migrationHint('required_action', f.required_action)}`);
    } else if (!ALLOWED_REQUIRED_ACTIONS.has(f.required_action)) {
      errors.push(
        `Finding[${index}].required_action = ${JSON.stringify(f.required_action)} — must be one of fix-in-place|scout-alternative|accept-risk-pending-approval`,
      );
    }
  }

  return errors;
}

function scoreFinding(f) {
  const reachability = f.reachability;
  const attackerControl = f.attackerControl;
  const impact = f.impact;
  const preconditionsContrib = 3 - f.preconditions;
  const authGateContrib = 3 - f.authGate;

  const total = reachability + attackerControl + impact + preconditionsContrib + authGateContrib;

  let verdict;
  if (total >= 13 && impact === 3 && reachability >= 2) {
    verdict = 'escalate';
  } else if (total >= 10 || (impact === 3 && reachability >= 1)) {
    verdict = 'critical';
  } else if (total >= 6) {
    verdict = 'warn';
  } else {
    verdict = 'ok';
  }

  const required_action = verdict === 'critical' ? f.required_action ?? 'fix-in-place' : undefined;
  const note =
    verdict === 'critical' || verdict === 'escalate'
      ? 'High/Critical findings require a PoC or documented reachability argument before escalation.'
      : null;

  if (verdict !== 'critical' && 'required_action' in f) {
    throw new Error('required_action is only allowed when the emitted verdict is "critical"');
  }

  return {
    total,
    verdict,
    ...(required_action ? { required_action } : {}),
    breakdown: {
      reachability,
      attackerControl,
      impact,
      preconditionsContrib,
      authGateContrib,
    },
    note,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  let raw = args.finding ?? null;
  if (!raw) {
    raw = await readStdin();
  }
  if (!raw) {
    process.stderr.write('Error: Provide findings via --finding \'<json>\' or stdin.\n');
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`Error: Invalid JSON — ${e.message}\n`);
    process.exit(2);
  }

  const findings = Array.isArray(parsed) ? parsed : [parsed];

  // Validate all first
  const allErrors = [];
  findings.forEach((f, i) => {
    allErrors.push(...validateFinding(f, i));
  });
  if (allErrors.length > 0) {
    const errOut = { valid: false, errors: allErrors };
    process.stdout.write(JSON.stringify(errOut, null, 2) + '\n');
    process.exit(2);
  }

  let results;
  try {
    results = findings.map((f) => scoreFinding(f));
  } catch (error) {
    const errOut = { valid: false, errors: [error.message] };
    process.stdout.write(JSON.stringify(errOut, null, 2) + '\n');
    process.exit(2);
  }

  const output = Array.isArray(parsed) ? results : results[0];
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
