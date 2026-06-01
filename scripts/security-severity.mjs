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
 * Labels:
 *   Critical  total >= 13 AND impact == 3 AND reachability >= 2
 *   High      total 10-12 OR (impact==3 AND reachability>=1)
 *   Medium    total 6-9
 *   Low       total <= 5
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
  return errors;
}

function scoreFinding(f) {
  const reachability = f.reachability;
  const attackerControl = f.attackerControl;
  const impact = f.impact;
  const preconditionsContrib = 3 - f.preconditions;
  const authGateContrib = 3 - f.authGate;

  const total = reachability + attackerControl + impact + preconditionsContrib + authGateContrib;

  let label;
  if (total >= 13 && impact === 3 && reachability >= 2) {
    label = 'Critical';
  } else if (total >= 10 || (impact === 3 && reachability >= 1)) {
    label = 'High';
  } else if (total >= 6) {
    label = 'Medium';
  } else {
    label = 'Low';
  }

  const note =
    label === 'Critical' || label === 'High'
      ? 'High/Critical findings require a PoC or documented reachability argument before escalation.'
      : null;

  return {
    total,
    label,
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
  findings.forEach((f, i) => allErrors.push(...validateFinding(f, i)));
  if (allErrors.length > 0) {
    const errOut = { valid: false, errors: allErrors };
    process.stdout.write(JSON.stringify(errOut, null, 2) + '\n');
    process.exit(2);
  }

  const results = findings.map((f) => scoreFinding(f));

  const output = Array.isArray(parsed) ? results : results[0];
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
