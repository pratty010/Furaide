import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const REQUIRED_BANK_METADATA = [
  'issuer',
  'period',
  'source_url',
  'retrieved_date',
  'currency_unit',
  'confidence',
  'validation_status',
  'producing_module',
];

const VERIFIED_STATUSES = new Set(['verified', 'validated', 'approved']);
const DEFAULT_STALE_DAYS = 30;

export function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2).replace(/-/g, '_');
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

export function subjectStore(rootPath, subject) {
  const root = resolve(rootPath || process.cwd());
  const subjectDir = join(root, 'research', 'financial', subject);

  return {
    root,
    subject,
    subjectDir,
    artifactsDir: join(subjectDir, 'artifacts'),
    artifactRegistryPath: join(subjectDir, 'artifact-registry.json'),
    bankManifestPath: join(subjectDir, 'bank-manifest.json'),
    bankUpdatesPath: join(subjectDir, 'bank-updates.jsonl'),
    dataManifestPath: join(subjectDir, 'data-manifest.json'),
    sourceRegistryPath: join(subjectDir, 'source-registry.json'),
  };
}

export function ensureSubjectDir(store) {
  mkdirSync(store.subjectDir, { recursive: true });
  mkdirSync(store.artifactsDir, { recursive: true });
}

export function readJson(path, fallback) {
  if (!existsSync(path)) {
    return structuredClone(fallback);
  }

  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function appendJsonLine(path, value) {
  appendFileSync(path, JSON.stringify(value) + '\n', 'utf8');
}

export function readStdinJson() {
  const raw = readFileSync(0, 'utf8').trim();
  if (!raw) {
    return null;
  }

  return JSON.parse(raw);
}

export function defaultBankManifest(subject) {
  return {
    subject,
    subject_identity: {},
    last_run: null,
    thesis_status: null,
    entries: [],
    known_conflicts: [],
    open_gaps: [],
  };
}

export function defaultArtifactRegistry() {
  return { artifacts: [] };
}

export function defaultSourceRegistry() {
  return { sources: [] };
}

export function defaultDataManifest() {
  return { artifacts: [] };
}

export function validateBankEntry(entry) {
  const missing = REQUIRED_BANK_METADATA.filter((field) => {
    const value = entry?.[field];
    return value === undefined || value === null || value === '';
  });

  return {
    valid: missing.length === 0,
    missing,
  };
}

export function validateSourceEntry(source) {
  const required = ['class', 'license', 'timestamp'];
  const missing = required.filter((field) => !source?.[field]);

  return {
    valid: missing.length === 0,
    missing,
  };
}

export function classifyArtifact(artifact, nowIso = new Date().toISOString(), staleDays = DEFAULT_STALE_DAYS) {
  if (!artifact) {
    return { status: 'missing', reason: 'artifact_missing' };
  }

  if (!VERIFIED_STATUSES.has(String(artifact.validation_status || '').toLowerCase())) {
    return { status: 'suspect', reason: `validation_status:${artifact.validation_status || 'unknown'}` };
  }

  const updatedAt = artifact.updated_at || artifact.promoted_at;
  if (!updatedAt) {
    return { status: 'suspect', reason: 'missing_updated_at' };
  }

  const ageMs = new Date(nowIso).getTime() - new Date(updatedAt).getTime();
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  if (Number.isFinite(ageMs) && ageMs > staleMs) {
    return { status: 'stale', reason: `older_than_${staleDays}_days` };
  }

  return { status: 'reusable', reason: 'validated_and_fresh' };
}

export function summarizeArtifactStatuses(artifacts, nowIso) {
  if (artifacts.length === 0) {
    return {
      artifacts: [{ status: 'missing', reason: 'no_artifacts_recorded' }],
      summary: { reusable: 0, stale: 0, suspect: 0, missing: 1 },
    };
  }

  const classified = artifacts.map((artifact) => ({
    ...artifact,
    ...classifyArtifact(artifact, nowIso),
  }));

  const summary = { reusable: 0, stale: 0, suspect: 0, missing: 0 };
  for (const artifact of classified) {
    summary[artifact.status] += 1;
  }

  return { artifacts: classified, summary };
}

export function latestSourceRefreshByClass(sources) {
  const output = {};

  for (const source of sources) {
    const current = output[source.class];
    if (!current || new Date(source.timestamp).getTime() > new Date(current).getTime()) {
      output[source.class] = source.timestamp;
    }
  }

  return output;
}

export function nextId(prefix, items) {
  return `${prefix}-${items.length + 1}`;
}

export function promoteArtifactFile(store, artifactPath, nowIso = new Date().toISOString()) {
  ensureSubjectDir(store);
  const fileName = basename(artifactPath);
  const targetPath = join(store.artifactsDir, fileName);
  copyFileSync(artifactPath, targetPath);

  return {
    name: fileName,
    path: `artifacts/${fileName}`,
    promoted_at: nowIso,
  };
}
