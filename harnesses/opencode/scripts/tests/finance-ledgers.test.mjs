import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HARNESS_ROOT = '/d/Everything/Furaidē/.worktrees/opencode-harness-v2/harnesses/opencode';
const SUBJECT = 'acme';

function makeRepoRoot() {
  return mkdtempSync(join(tmpdir(), 'finance-ledgers-'));
}

function subjectDir(root, subject = SUBJECT) {
  return join(root, 'research', 'financial', subject);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function runCli(scriptName, args, options = {}) {
  const fullArgs = [join(HARNESS_ROOT, 'scripts', scriptName), ...args];
  if (options.root) {
    fullArgs.push('--root', options.root);
  }

  const result = spawnSync('bun', fullArgs, {
    cwd: HARNESS_ROOT,
    input: options.stdin ? JSON.stringify(options.stdin) : undefined,
    encoding: 'utf8',
  });

  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();

  return {
    status: result.status ?? 1,
    json: stdout ? JSON.parse(stdout) : null,
    stderr,
  };
}

function seedStatusFixture(root) {
  const dir = subjectDir(root);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'bank-manifest.json'), {
    subject_identity: {
      company: 'Acme Corp',
      ticker: 'ACME',
      exchange: 'NYSE',
      jurisdiction: 'US',
      currency: 'USD',
    },
    last_run: {
      mode: 'quick_update',
      operation: 'bank_status',
      at: '2026-07-01T12:00:00.000Z',
    },
    thesis_status: 'monitoring',
    entries: [
      {
        id: 'entry-1',
        subject: SUBJECT,
        title: 'Revenue up',
        issuer: 'Acme Corp',
        period: 'FY2025',
        source_url: 'https://example.com/filing',
        retrieved_date: '2026-07-01',
        currency_unit: 'USD_millions',
        confidence: 'high',
        validation_status: 'verified',
        producing_module: 'finance_xbrl_extract',
      },
    ],
    known_conflicts: ['Margin guidance differs from transcript'],
    open_gaps: ['No peer comps refresh'],
  });
  writeJson(join(dir, 'artifact-registry.json'), {
    artifacts: [
      {
        id: 'artifact-1',
        name: 'latest-filing.json',
        kind: 'filing',
        path: 'artifacts/latest-filing.json',
        updated_at: '2026-07-01T10:00:00.000Z',
        validation_status: 'verified',
      },
      {
        id: 'artifact-2',
        name: 'old-model.json',
        kind: 'model',
        path: 'artifacts/old-model.json',
        updated_at: '2026-01-01T10:00:00.000Z',
        validation_status: 'verified',
      },
      {
        id: 'artifact-3',
        name: 'draft-notes.md',
        kind: 'notes',
        path: 'artifacts/draft-notes.md',
        updated_at: '2026-07-01T10:00:00.000Z',
        validation_status: 'failed',
      },
    ],
  });
  writeJson(join(dir, 'source-registry.json'), {
    sources: [
      {
        id: 'src-1',
        class: 'issuer',
        license: 'public',
        timestamp: '2026-07-01T09:00:00.000Z',
        url: 'https://example.com/filing',
      },
      {
        id: 'src-2',
        class: 'market_data',
        license: 'licensed',
        timestamp: '2026-06-30T09:00:00.000Z',
        url: 'https://example.com/price',
      },
    ],
  });
}

test('knowledge-bank-finance status emits the bank status card fields', () => {
  const root = makeRepoRoot();
  try {
    seedStatusFixture(root);

    const result = runCli('knowledge-bank-finance.mjs', ['status', '--subject', SUBJECT], { root });

    expect(result.status).toBe(0);
    expect(result.json.subject_identity).toEqual({
      company: 'Acme Corp',
      ticker: 'ACME',
      exchange: 'NYSE',
      jurisdiction: 'US',
      currency: 'USD',
    });
    expect(result.json.last_run).toEqual({
      mode: 'quick_update',
      operation: 'bank_status',
      at: '2026-07-01T12:00:00.000Z',
    });
    expect(result.json.available_artifacts).toContain('latest-filing.json');
    expect(result.json.missing_artifacts).toContain('none');
    expect(result.json.stale_or_suspect_artifacts).toEqual(expect.arrayContaining(['old-model.json', 'draft-notes.md']));
    expect(result.json.last_source_refresh_by_class).toEqual({
      issuer: '2026-07-01T09:00:00.000Z',
      market_data: '2026-06-30T09:00:00.000Z',
    });
    expect(result.json.current_thesis_status).toBe('monitoring');
    expect(result.json.known_conflicts_or_open_gaps).toEqual([
      'Margin guidance differs from transcript',
      'No peer comps refresh',
    ]);
    expect(result.json.suggested_bank_queries.length).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('knowledge-bank-finance query reads existing entries', () => {
  const root = makeRepoRoot();
  try {
    seedStatusFixture(root);

    const result = runCli('knowledge-bank-finance.mjs', ['query', '--subject', SUBJECT, '--text', 'Revenue'], { root });

    expect(result.status).toBe(0);
    expect(result.json.count).toBe(1);
    expect(result.json.entries[0].title).toBe('Revenue up');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('knowledge-bank-finance propose validates metadata and write requires approval', () => {
  const root = makeRepoRoot();
  const baseEntry = {
    subject: SUBJECT,
    title: 'Q2 model refreshed',
    issuer: 'Acme Corp',
    period: 'Q2-2026',
    source_url: 'https://example.com/q2',
    retrieved_date: '2026-07-02',
    currency_unit: 'USD_millions',
    confidence: 'medium',
    validation_status: 'verified',
    producing_module: 'finance_statement_normalize',
  };

  try {
    const invalid = runCli('knowledge-bank-finance.mjs', ['propose', '--subject', SUBJECT], {
      root,
      stdin: { ...baseEntry, confidence: undefined },
    });
    expect(invalid.status).toBe(1);
    expect(invalid.json.error).toContain('missing required metadata');

    const proposal = runCli('knowledge-bank-finance.mjs', ['propose', '--subject', SUBJECT], { root, stdin: baseEntry });
    expect(proposal.status).toBe(0);
    expect(proposal.json.valid).toBe(true);
    expect(proposal.json.proposal.entry.title).toBe('Q2 model refreshed');

    const deniedWrite = runCli('knowledge-bank-finance.mjs', ['write', '--subject', SUBJECT], { root, stdin: baseEntry });
    expect(deniedWrite.status).toBe(1);
    expect(deniedWrite.json.error).toContain('--approved');

    const approvedWrite = runCli('knowledge-bank-finance.mjs', ['write', '--subject', SUBJECT, '--approved'], {
      root,
      stdin: baseEntry,
    });
    expect(approvedWrite.status).toBe(0);
    expect(approvedWrite.json.written).toBe(true);

    const manifest = JSON.parse(readFileSync(join(subjectDir(root), 'bank-manifest.json'), 'utf8'));
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].producing_module).toBe('finance_statement_normalize');
    const updatesLog = readFileSync(join(subjectDir(root), 'bank-updates.jsonl'), 'utf8').trim().split('\n');
    expect(updatesLog).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finance-artifact-registry audit classifies reusable, stale, suspect, and missing artifacts', () => {
  const root = makeRepoRoot();
  try {
    seedStatusFixture(root);

    const withArtifacts = runCli('finance-artifact-registry.mjs', ['audit', '--subject', SUBJECT, '--now', '2026-07-02T00:00:00.000Z'], { root });
    expect(withArtifacts.status).toBe(0);
    expect(withArtifacts.json.summary.reusable).toBe(1);
    expect(withArtifacts.json.summary.stale).toBe(1);
    expect(withArtifacts.json.summary.suspect).toBe(1);
    expect(withArtifacts.json.artifacts.map((artifact) => artifact.status)).toEqual(
      expect.arrayContaining(['reusable', 'stale', 'suspect'])
    );

    const missingRoot = makeRepoRoot();
    try {
      const missing = runCli('finance-artifact-registry.mjs', ['audit', '--subject', 'blank'], { root: missingRoot });
      expect(missing.status).toBe(0);
      expect(missing.json.summary.missing).toBe(1);
    } finally {
      rmSync(missingRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finance-artifact-registry promote copies artifact into the finance store and ledgers it', () => {
  const root = makeRepoRoot();
  try {
    const tempArtifact = join(root, 'tmp-artifact.json');
    writeFileSync(tempArtifact, '{"ok":true}\n');

    const result = runCli(
      'finance-artifact-registry.mjs',
      [
        'promote',
        '--subject', SUBJECT,
        '--artifact', tempArtifact,
        '--kind', 'model-output',
        '--validation-status', 'verified',
        '--producer', 'finance_model_compute',
      ],
      { root }
    );

    expect(result.status).toBe(0);
    expect(result.json.promoted).toBe(true);
    expect(result.json.artifact.path).toBe('artifacts/tmp-artifact.json');
    expect(existsSync(join(subjectDir(root), 'artifacts', 'tmp-artifact.json'))).toBe(true);

    const registry = JSON.parse(readFileSync(join(subjectDir(root), 'artifact-registry.json'), 'utf8'));
    expect(registry.artifacts).toHaveLength(1);
    expect(registry.artifacts[0].producer).toBe('finance_model_compute');

    const manifest = JSON.parse(readFileSync(join(subjectDir(root), 'data-manifest.json'), 'utf8'));
    expect(manifest.artifacts[0].kind).toBe('model-output');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finance-source-registry add and list require class, license, and timestamp', () => {
  const root = makeRepoRoot();
  try {
    const invalid = runCli('finance-source-registry.mjs', ['add', '--subject', SUBJECT], {
      root,
      stdin: { url: 'https://example.com/source', class: 'issuer', license: 'public' },
    });
    expect(invalid.status).toBe(1);
    expect(invalid.json.error).toContain('timestamp');

    const added = runCli('finance-source-registry.mjs', ['add', '--subject', SUBJECT], {
      root,
      stdin: {
        url: 'https://example.com/source',
        class: 'issuer',
        license: 'public',
        timestamp: '2026-07-02T10:00:00.000Z',
      },
    });
    expect(added.status).toBe(0);
    expect(added.json.added).toBe(true);

    const listed = runCli('finance-source-registry.mjs', ['list', '--subject', SUBJECT], { root });
    expect(listed.status).toBe(0);
    expect(listed.json.sources).toHaveLength(1);
    expect(listed.json.sources[0].class).toBe('issuer');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
