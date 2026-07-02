#!/usr/bin/env node

import process from 'node:process';
import {
  defaultSourceRegistry,
  ensureSubjectDir,
  nextId,
  parseArgs,
  readJson,
  readStdinJson,
  subjectStore,
  validateSourceEntry,
  writeJson,
} from './lib/finance-store.mjs';

function fail(error, details) {
  process.stdout.write(JSON.stringify({ error, ...(details ? { details } : {}) }, null, 2) + '\n');
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!command) {
    fail('command required');
  }

  if (!args.subject) {
    fail('--subject is required');
  }

  const store = subjectStore(args.root, args.subject);

  if (command === 'list') {
    const registry = readJson(store.sourceRegistryPath, defaultSourceRegistry());
    process.stdout.write(JSON.stringify({ subject: store.subject, count: registry.sources.length, sources: registry.sources }, null, 2) + '\n');
    process.exit(0);
  }

  if (command !== 'add') {
    fail(`unknown command: ${command}`);
  }

  let source;
  try {
    source = readStdinJson();
  } catch (error) {
    fail(`invalid JSON input: ${error.message}`);
  }

  const validation = validateSourceEntry(source);
  if (!validation.valid) {
    fail(`missing required metadata: ${validation.missing.join(', ')}`, validation.missing);
  }

  ensureSubjectDir(store);
  const registry = readJson(store.sourceRegistryPath, defaultSourceRegistry());
  const record = {
    id: nextId('source', registry.sources || []),
    subject: store.subject,
    ...source,
  };
  registry.sources = [...(registry.sources || []), record];
  writeJson(store.sourceRegistryPath, registry);

  process.stdout.write(JSON.stringify({ added: true, subject: store.subject, source: record }, null, 2) + '\n');
  process.exit(0);
}

main().catch((error) => fail(error.message));
