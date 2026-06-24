#!/usr/bin/env node
/**
 * ctx7-docs.mjs
 * Fetch library docs via the ctx7 CLI (falls back to bunx ctx7@latest).
 * Usage: bun ctx7-docs.mjs --library <name> --question "<q>" [--version <v>]
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library' && argv[i + 1]) args.library = argv[++i];
    else if (argv[i] === '--question' && argv[i + 1]) args.question = argv[++i];
    else if (argv[i] === '--version' && argv[i + 1]) args.version = argv[++i];
  }
  return args;
}

function findExecutable(name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() !== '';
}

/**
 * Run a CLI command synchronously and return its output.
 * Returns { stdout, stderr, status, timedOut }.
 */
function runCommand(cmd, args, { timeout = 30000 } = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024 * 4,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
    timedOut: result.signal === 'SIGTERM',
    error: result.error ? result.error.message : null,
  };
}

function buildCtx7Args(library, question, version) {
  // ctx7 CLI typical usage: ctx7 resolve <lib> [--version <v>], ctx7 docs <lib> <question>
  // We attempt: ctx7 docs <library> "<question>" [--version <version>]
  const args = ['docs', library, question];
  if (version) args.push('--version', version);
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!args.library) {
    process.stderr.write('Error: --library <name> is required.\n');
    process.exit(1);
  }
  if (!args.question) {
    process.stderr.write('Error: --question "<q>" is required.\n');
    process.exit(1);
  }

  const ctx7Args = buildCtx7Args(args.library, args.question, args.version);
  const commandsRun = [];
  let status = 'ctx7-unavailable';
  let docsExcerpt = null;
  let rawResult = null;

  // Attempt 1: use ctx7 directly if on PATH
  const ctx7OnPath = findExecutable('ctx7');

  if (ctx7OnPath) {
    const cmd = `ctx7 ${ctx7Args.join(' ')}`;
    commandsRun.push(cmd);
    rawResult = runCommand('ctx7', ctx7Args);

    if (rawResult.error && /ENOENT/.test(rawResult.error)) {
      // Binary not actually runnable despite being found
    } else if (rawResult.status === 0) {
      status = 'ok';
      docsExcerpt = rawResult.stdout.trim().slice(0, 3000) || '(empty response)';
    } else if (rawResult.status === 4 || /not found|no library/i.test(rawResult.stderr + rawResult.stdout)) {
      status = 'missing-library';
    } else {
      // Non-zero but not a missing-library error — still try bunx
    }
  }

  // Attempt 2: retry with bunx ctx7@latest if ctx7 not on PATH or first attempt failed
  if (status === 'ctx7-unavailable') {
    const bunxAvailable = findExecutable('bunx') || findExecutable('bun');
    const runner = findExecutable('bunx') ? 'bunx' : 'bun';
    const runnerArgs = runner === 'bun'
      ? ['x', 'ctx7@latest', ...ctx7Args]
      : ['ctx7@latest', ...ctx7Args];
    const cmd = `${runner} ${runnerArgs.join(' ')}`;
    commandsRun.push(cmd);

    if (!bunxAvailable) {
      // Nothing more we can do
    } else {
      rawResult = runCommand(runner, runnerArgs, { timeout: 60000 });

      if (rawResult.error && /ENOENT/.test(rawResult.error)) {
        // runner not found — unavailable
      } else if (rawResult.status === 0) {
        status = 'ok';
        docsExcerpt = rawResult.stdout.trim().slice(0, 3000) || '(empty response)';
      } else if (/not found|no library/i.test(rawResult.stderr + rawResult.stdout)) {
        status = 'missing-library';
      }
      // If still failed, status stays ctx7-unavailable
    }
  }

  const output = {
    status,
    library: args.library,
    version: args.version ?? null,
    commands: commandsRun,
    docsExcerpt,
  };

  if (rawResult && status !== 'ok') {
    output.debugStderr = (rawResult.stderr ?? '').slice(0, 500);
    output.debugStdout = (rawResult.stdout ?? '').slice(0, 500);
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');

  if (status === 'ok') process.exit(0);
  if (status === 'missing-library') process.exit(4);
  process.exit(3); // ctx7-unavailable
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
