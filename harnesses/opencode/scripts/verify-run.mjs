#!/usr/bin/env node
/**
 * verify-run.mjs
 * Runs a sequence of shell commands from a verify.json plan file and
 * reports per-command results plus a pass/fail summary.
 *
 * Usage: bun verify-run.mjs --plan <path-to-verify.json>
 *
 * verify.json shape: { "commands": ["cmd1", "cmd2", ...] }
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const MAX_OUTPUT = 2000;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' && argv[i + 1]) args.plan = argv[++i];
  }
  return args;
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n... [truncated ${str.length - max} chars]`;
}

function runCommand(command) {
  const start = Date.now();

  // Use shell so that things like "echo hi" and piped commands work
  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8,
  });

  const durationMs = Date.now() - start;

  return {
    command,
    exitCode: result.status ?? -1,
    stdout: truncate(result.stdout ?? '', MAX_OUTPUT),
    stderr: truncate(result.stderr ?? '', MAX_OUTPUT),
    durationMs,
    timedOut: result.signal === 'SIGTERM',
    error: result.error ? result.error.message : null,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!args.plan) {
    process.stderr.write('Error: --plan <path-to-verify.json> is required.\n');
    process.exit(1);
  }

  const planPath = resolve(args.plan);
  let plan;
  try {
    const raw = readFileSync(planPath, 'utf8');
    plan = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`Error reading plan file "${planPath}": ${e.message}\n`);
    process.exit(1);
  }

  if (!plan.commands || !Array.isArray(plan.commands)) {
    process.stderr.write('Error: plan JSON must have a "commands" array.\n');
    process.exit(1);
  }

  if (plan.commands.length === 0) {
    process.stderr.write('Warning: commands array is empty.\n');
    const output = { results: [], summary: { passed: 0, failed: 0 } };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(0);
  }

  const results = [];
  for (const cmd of plan.commands) {
    if (typeof cmd !== 'string' || !cmd.trim()) {
      results.push({
        command: cmd,
        exitCode: -1,
        stdout: '',
        stderr: 'Skipped: empty or non-string command.',
        durationMs: 0,
        error: 'invalid-command',
      });
      continue;
    }
    const result = runCommand(cmd);
    results.push(result);
  }

  const passed = results.filter((r) => r.exitCode === 0).length;
  const failed = results.length - passed;

  const output = {
    results,
    summary: { passed, failed },
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
