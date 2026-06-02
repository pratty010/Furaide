#!/usr/bin/env node
/**
 * workflow-state.mjs
 * Sole writer for workflow state. Every specialist calls this at phase boundaries.
 * Never write state.json directly.
 *
 * Subcommands: init, read, advance, gate
 *
 * Exit codes:
 *   0 — success (state JSON on stdout)
 *   1 — general error
 *   2 — critical gate verdict
 *   5 — ownership rejection (wrong caller)
 *   9 — CAS conflict (stale expected-rev)
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
  fdatasyncSync,
  renameSync,
  appendFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import process from 'node:process';
import { acquire, release } from './lib/state-lock.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      a[k.slice(2)] = argv[++i];
    } else if (k.startsWith('--')) {
      a[k.slice(2)] = true;
    }
  }
  return a;
}

function cwdToSlug(absolutePath) {
  return absolutePath.replace(/[/.]/g, '-');
}

function resolvePaths(cwd, workflow) {
  const home = process.env.HOME || process.env.USERPROFILE || '/root';
  const slug = cwdToSlug(resolve(cwd));
  const stateDir = join(home, '.local', 'share', 'opencode', 'state', slug, workflow);
  const statePath = join(stateDir, 'state.json');
  const journalPath = join(stateDir, 'journal.ndjson');
  const lockPath = join(stateDir, '.lock');
  return { stateDir, statePath, journalPath, lockPath };
}

function readState(statePath) {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

/**
 * Atomically write state: write to tmp, fdatasync, rename.
 */
function writeStateAtomic(statePath, state) {
  const tmpPath = statePath + '.tmp.' + process.pid;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  const fd = openSync(tmpPath, 'r+');
  try {
    fdatasyncSync(fd);
  } finally {
    try { closeSync(fd); } catch {}
  }
  renameSync(tmpPath, statePath);
}

function appendJournal(journalPath, entry) {
  appendFileSync(journalPath, JSON.stringify(entry) + '\n', 'utf8');
}

class ExitError extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code;
  }
}

function die(msg, code = 1) {
  throw new ExitError(msg, code);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdInit(args) {
  const { cwd, workflow, specialist, phase, session } = args;
  if (!cwd || !workflow || !specialist || !phase || !session) {
    die('init requires --cwd, --workflow, --specialist, --phase, --session');
  }

  const { stateDir, statePath, journalPath, lockPath } = resolvePaths(cwd, workflow);
  mkdirSync(stateDir, { recursive: true });

  const handle = await acquire(lockPath, { session, ttlMs: 30000 });
  try {
    const state = {
      workflow_id: workflow,
      specialist,
      phase,
      decisions: {},
      artifacts: {},
      gate_verdicts: {},
      warn_counts: {},
      next_action: null,
      governing_file: null,
      rev: 1,
      sessions: [session],
    };

    writeStateAtomic(statePath, state);
    appendJournal(journalPath, {
      ts: new Date().toISOString(),
      op: 'init',
      session,
      caller: specialist,
      from: null,
      to: phase,
      rev: 1,
    });

    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  } finally {
    await release(handle);
  }
}

async function cmdRead(args) {
  const { cwd, workflow } = args;
  if (!cwd || !workflow) die('read requires --cwd and --workflow');

  const { statePath } = resolvePaths(cwd, workflow);
  const state = readState(statePath);
  if (!state) die('state.json not found — run init first');
  process.stdout.write(JSON.stringify(state, null, 2) + '\n');
}

async function cmdAdvance(args) {
  const { cwd, workflow, to, session, caller } = args;
  const expectedRev = args['expected-rev'] !== undefined ? parseInt(args['expected-rev'], 10) : undefined;

  if (!cwd || !workflow || !to || !session || !caller || expectedRev === undefined) {
    die('advance requires --cwd, --workflow, --to, --expected-rev, --session, --caller');
  }

  const { stateDir, statePath, journalPath, lockPath } = resolvePaths(cwd, workflow);
  mkdirSync(stateDir, { recursive: true });

  const handle = await acquire(lockPath, { session, ttlMs: 30000 });
  try {
    const state = readState(statePath);
    if (!state) die('state.json not found — run init first');

    // Ownership check
    if (caller !== state.specialist) {
      die(
        `ownership: caller="${caller}" is not the specialist "${state.specialist}"`,
        5,
      );
    }

    // CAS check
    if (expectedRev !== state.rev) {
      die(`conflict: expected rev=${expectedRev} but current rev=${state.rev}`, 9);
    }

    const fromPhase = state.phase;
    state.phase = to;
    if (!state.sessions.includes(session)) state.sessions.push(session);
    state.rev += 1;

    writeStateAtomic(statePath, state);
    appendJournal(journalPath, {
      ts: new Date().toISOString(),
      op: 'advance',
      session,
      caller,
      from: fromPhase,
      to,
      rev: state.rev,
    });

    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  } finally {
    await release(handle);
  }
}

async function cmdGate(args) {
  const { cwd, workflow, gate, verdict, session, caller } = args;
  const maxIterations = args['max-iterations'] !== undefined
    ? parseInt(args['max-iterations'], 10)
    : Infinity;

  if (!cwd || !workflow || !gate || !verdict || !session || !caller) {
    die('gate requires --cwd, --workflow, --gate, --verdict, --session, --caller');
  }

  const { stateDir, statePath, journalPath, lockPath } = resolvePaths(cwd, workflow);
  mkdirSync(stateDir, { recursive: true });

  const handle = await acquire(lockPath, { session, ttlMs: 30000 });
  try {
    const state = readState(statePath);
    if (!state) die('state.json not found — run init first');

    // Ownership check
    if (caller !== state.specialist) {
      die(
        `ownership: caller="${caller}" is not the specialist "${state.specialist}"`,
        5,
      );
    }

    if (!state.warn_counts) state.warn_counts = {};
    if (!state.gate_verdicts) state.gate_verdicts = {};

    if (verdict === 'warn') {
      state.warn_counts[gate] = (state.warn_counts[gate] || 0) + 1;
      if (state.warn_counts[gate] > maxIterations) {
        state.gate_verdicts[gate] = 'warn-unresolved';
        // Do not increment warn_counts further
        state.warn_counts[gate] = state.warn_counts[gate]; // already incremented above; cap it
      } else {
        state.gate_verdicts[gate] = verdict;
      }
    } else {
      state.gate_verdicts[gate] = verdict;
    }

    if (!state.sessions.includes(session)) state.sessions.push(session);
    state.rev += 1;

    writeStateAtomic(statePath, state);
    appendJournal(journalPath, {
      ts: new Date().toISOString(),
      op: 'gate',
      session,
      caller,
      gate,
      verdict: state.gate_verdicts[gate],
      rev: state.rev,
    });

    process.stdout.write(JSON.stringify(state, null, 2) + '\n');

    if (verdict === 'critical') die(`critical gate "${gate}" triggered`, 2);
  } finally {
    await release(handle);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (subcommand) {
    case 'init':    await cmdInit(args);    break;
    case 'read':    await cmdRead(args);    break;
    case 'advance': await cmdAdvance(args); break;
    case 'gate':    await cmdGate(args);    break;
    default:
      die(`Unknown subcommand: "${subcommand}". Valid: init, read, advance, gate`);
  }
}

main().catch((err) => {
  process.stderr.write(err instanceof ExitError ? err.message + '\n' : `Fatal: ${err.message}\n`);
  process.exit(err instanceof ExitError ? err.code : 1);
});
