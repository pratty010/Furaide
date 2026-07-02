#!/usr/bin/env node

import process from 'node:process';
import {
  defaultArtifactRegistry,
  defaultBankManifest,
  defaultSourceRegistry,
  ensureSubjectDir,
  latestSourceRefreshByClass,
  parseArgs,
  readJson,
  readStdinJson,
  subjectStore,
  summarizeArtifactStatuses,
  validateBankEntry,
  writeJson,
  appendJsonLine,
} from './lib/finance-store.mjs';

function fail(error, details) {
  process.stdout.write(JSON.stringify({ error, ...(details ? { details } : {}) }, null, 2) + '\n');
  process.exit(1);
}

function buildStatus(store) {
  const manifest = readJson(store.bankManifestPath, defaultBankManifest(store.subject));
  const artifactRegistry = readJson(store.artifactRegistryPath, defaultArtifactRegistry());
  const sourceRegistry = readJson(store.sourceRegistryPath, defaultSourceRegistry());
  const audit = summarizeArtifactStatuses(artifactRegistry.artifacts, new Date().toISOString());

  return {
    subject: store.subject,
    subject_identity: manifest.subject_identity,
    last_run: manifest.last_run,
    available_artifacts: artifactRegistry.artifacts.map((artifact) => artifact.name),
    missing_artifacts: audit.summary.missing > 0 ? ['none', ...audit.artifacts.filter((artifact) => artifact.status === 'missing').map((artifact) => artifact.name).filter(Boolean)] : ['none'],
    stale_or_suspect_artifacts: audit.artifacts
      .filter((artifact) => artifact.status === 'stale' || artifact.status === 'suspect')
      .map((artifact) => artifact.name),
    last_source_refresh_by_class: latestSourceRefreshByClass(sourceRegistry.sources),
    current_thesis_status: manifest.thesis_status,
    known_conflicts_or_open_gaps: [...(manifest.known_conflicts || []), ...(manifest.open_gaps || [])],
    suggested_bank_queries: [
      'What changed since the last analysis?',
      'Which assumptions are still valid?',
      'Which artifacts need refresh before reuse?',
    ],
  };
}

function queryEntries(store, text) {
  const manifest = readJson(store.bankManifestPath, defaultBankManifest(store.subject));
  const entries = (manifest.entries || []).filter((entry) => {
    if (!text) {
      return true;
    }

    return JSON.stringify(entry).toLowerCase().includes(String(text).toLowerCase());
  });

  return {
    subject: store.subject,
    count: entries.length,
    entries,
  };
}

function prepareEntry(subject, entry, nowIso) {
  const normalized = {
    ...entry,
    subject,
    id: entry.id || `${subject}-entry-${Date.now()}`,
    proposed_at: entry.proposed_at || nowIso,
  };
  const validation = validateBankEntry(normalized);
  return { normalized, validation };
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
  const nowIso = new Date().toISOString();

  if (command === 'status') {
    process.stdout.write(JSON.stringify(buildStatus(store), null, 2) + '\n');
    process.exit(0);
  }

  if (command === 'query') {
    process.stdout.write(JSON.stringify(queryEntries(store, args.text), null, 2) + '\n');
    process.exit(0);
  }

  if (command !== 'propose' && command !== 'write') {
    fail(`unknown command: ${command}`);
  }

  let entry;
  try {
    entry = readStdinJson();
  } catch (error) {
    fail(`invalid JSON input: ${error.message}`);
  }

  if (!entry || typeof entry !== 'object') {
    fail('JSON entry required on stdin');
  }

  const { normalized, validation } = prepareEntry(args.subject, entry, nowIso);
  if (!validation.valid) {
    fail(`missing required metadata: ${validation.missing.join(', ')}`, validation.missing);
  }

  if (command === 'propose') {
    process.stdout.write(JSON.stringify({ valid: true, proposal: { subject: args.subject, entry: normalized } }, null, 2) + '\n');
    process.exit(0);
  }

  if (!args.approved) {
    fail('write requires --approved');
  }

  ensureSubjectDir(store);
  const manifest = readJson(store.bankManifestPath, defaultBankManifest(store.subject));
  manifest.entries = [...(manifest.entries || []), { ...normalized, written_at: nowIso }];
  manifest.last_run = {
    mode: 'direct_operation',
    operation: 'write',
    at: nowIso,
  };
  writeJson(store.bankManifestPath, manifest);
  appendJsonLine(store.bankUpdatesPath, { action: 'write', subject: store.subject, entry_id: normalized.id, at: nowIso });

  process.stdout.write(JSON.stringify({ written: true, subject: store.subject, entry: normalized }, null, 2) + '\n');
  process.exit(0);
}

main().catch((error) => fail(error.message));
