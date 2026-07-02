#!/usr/bin/env node

import { existsSync } from 'node:fs';
import process from 'node:process';
import {
  defaultArtifactRegistry,
  defaultDataManifest,
  parseArgs,
  promoteArtifactFile,
  readJson,
  subjectStore,
  summarizeArtifactStatuses,
  writeJson,
  nextId,
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
  const nowIso = args.now || new Date().toISOString();

  if (command === 'audit') {
    const registry = readJson(store.artifactRegistryPath, defaultArtifactRegistry());
    const audit = summarizeArtifactStatuses(registry.artifacts || [], nowIso);
    process.stdout.write(JSON.stringify({ subject: store.subject, ...audit }, null, 2) + '\n');
    process.exit(0);
  }

  if (command !== 'promote') {
    fail(`unknown command: ${command}`);
  }

  if (!args.artifact || !args.kind || !args.validation_status || !args.producer) {
    fail('promote requires --artifact, --kind, --validation-status, and --producer');
  }

  if (!existsSync(args.artifact)) {
    fail(`artifact not found: ${args.artifact}`);
  }

  const copied = promoteArtifactFile(store, args.artifact, nowIso);
  const registry = readJson(store.artifactRegistryPath, defaultArtifactRegistry());
  const dataManifest = readJson(store.dataManifestPath, defaultDataManifest());

  const artifact = {
    id: nextId('artifact', registry.artifacts || []),
    name: copied.name,
    kind: args.kind,
    path: copied.path,
    updated_at: nowIso,
    promoted_at: nowIso,
    validation_status: args.validation_status,
    producer: args.producer,
  };

  registry.artifacts = [...(registry.artifacts || []), artifact];
  dataManifest.artifacts = [...(dataManifest.artifacts || []), artifact];

  writeJson(store.artifactRegistryPath, registry);
  writeJson(store.dataManifestPath, dataManifest);

  process.stdout.write(JSON.stringify({ promoted: true, subject: store.subject, artifact }, null, 2) + '\n');
  process.exit(0);
}

main().catch((error) => fail(error.message));
