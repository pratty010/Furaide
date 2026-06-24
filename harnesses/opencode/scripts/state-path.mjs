#!/usr/bin/env node
/**
 * state-path.mjs
 * Computes the opencode state paths for a given working directory and workflow ID.
 *
 * Usage: bun state-path.mjs --cwd <path> --workflow <workflow-id>
 *
 * Slug rule: identical to memory-path.mjs — replace every "/" and "." with "-"
 *   e.g. /home/ace/proj → -home-ace-proj
 *
 * State location: $HOME/.local/share/opencode/state/<slug>/<workflow-id>/
 *   statePath   = <stateDir>/state.json
 *   journalPath = <stateDir>/journal.ndjson
 *   lockPath    = <stateDir>/.lock
 */

import { resolve, join } from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd' && argv[i + 1]) args.cwd = argv[++i];
    if (argv[i] === '--workflow' && argv[i + 1]) args.workflow = argv[++i];
  }
  return args;
}

function cwdToSlug(absolutePath) {
  return absolutePath.replace(/[/.]/g, '-');
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!args.workflow) {
    process.stderr.write('Fatal: --workflow is required\n');
    process.exit(1);
  }

  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || '/root';
  const workflowId = args.workflow;

  const slug = cwdToSlug(cwd);
  const stateDir = join(home, '.local', 'share', 'opencode', 'state', slug, workflowId);
  const statePath = join(stateDir, 'state.json');
  const journalPath = join(stateDir, 'journal.ndjson');
  const lockPath = join(stateDir, '.lock');

  const output = {
    cwd,
    slug,
    workflowId,
    stateDir,
    statePath,
    journalPath,
    lockPath,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
