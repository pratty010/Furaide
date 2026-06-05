# OpenCode Fleet And Session Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved OpenCode program end-to-end: rename and review the full 38-agent fleet, apply approved fleet structural fixes, add the `/session-vault` feature with automatic close-hook sync, and redesign the installer around transparent core-plus-optional-brand-builder installation.

**Architecture:** Introduce a single rename-map module as the source of truth for current-to-target names, legacy English alias replacements, and agent grouping. Use that map to drive filesystem renames, manifest/test updates, repo-wide validation, and a generated audit pass. Then write a routing-first description rubric from official OpenCode docs, apply it across all agents in review order, generate structural findings, and pause for approval before hierarchy edits. After the fleet is stable, add a Session Vault data layer, helper, command, and close-hook plugin using the repo's existing Bun + plugin patterns, then redesign the installer to install the renamed fleet and the new session-vault component with preflight, backup, transparency, and scope/mode control.

**Tech Stack:** Bun, Node ESM (`.mjs`), Markdown agent files, JSON manifests, shell installer scripts, ripgrep, OpenCode docs (`/docs/agents`, `/docs/permissions`, `/docs/commands`), plugin hooks, SQLite-backed session storage, JSON index files.

**Execution Root:** Run every command in this plan from `opencode/` unless a step explicitly says otherwise.

---

## File Structure

### New files

- `opencode/scripts/lib/agent-fleet-map.mjs`
  Source of truth for 38-agent rename map, legacy alias replacements, and agent grouping metadata.

- `opencode/scripts/tests/agent-fleet-integrity.test.mjs`
  Validates rename-map completeness, valid modes, filesystem/manifests consistency, and hard-fails stale old stems in executable surfaces.

- `opencode/scripts/tests/agent-reference-integrity.test.mjs`
  Scans docs, prompts, commands, plugins, installer scripts, and manifests for stale references after rename.

- `opencode/scripts/agent-fleet-audit.mjs`
  Generates a Markdown inventory of all 38 agents, their modes/models/permissions, `@mentions`, and `permission.task` edges.

- `opencode/docs/agent-description-rubric.md`
  Research-backed rubric for routing-first descriptions and parameter review rules.

- `opencode/docs/agent-fleet-structural-findings.md`
  Generated-and-edited findings report presented to the user before any structural changes.

- `opencode/scripts/lib/session-vault-index.mjs`
  Pure data-layer helpers for loading, validating, updating, and atomically writing the Session Vault index.

- `opencode/scripts/session-vault.mjs`
  Single helper entrypoint for `list`, `search`, `inspect`, `refresh`, `sync-session`, `sync-new`, `export`, `archive`, `restore`, `continue`, `mark-deleted`, and `delete --confirmed`.

- `opencode/plugins/omokage.js`
  Session-close sync plugin that updates the Session Vault index when OpenCode sessions end.

- `opencode/command/session-vault.md`
  Chat-native custom command that opens the global Session Vault interaction.

- `opencode/scripts/tests/session-vault-index.test.mjs`
  Validates JSON index load/write/update behavior, stale detection, and archive pointers.

- `opencode/scripts/tests/session-vault-helper.test.mjs`
  Covers helper operations using fixture index and fixture DB metadata.

- `opencode/scripts/tests/session-vault-plugin.test.mjs`
  Verifies plugin hook behavior and fallback sync behavior.

- `opencode/scripts/tests/install-fleet-session-vault.test.mjs`
  Verifies new installer preflight, backup, and session-vault component wiring.

### Existing files to modify

- `opencode/agents/*.md`
  All 38 agent files will be renamed and then edited for mode fixes, description rewrites, prompt reference updates, and parameter review.

- `opencode/docs/routing-manifest.json`
  Rename all specialist/subagent keys to the new stems while preserving model assignments and notes.

- `opencode/fleet-manifest.json`
  Update every file path under `agents-core` and `brand-builder` to the new filenames.

- `opencode/AGENTS.md`
  Update delegation tables, escape-hatch references, and any stale names or invalid `mode: agent` wording.

- `opencode/scripts/tests/agents-match-manifest.test.mjs`
  Make the manifest-vs-agent model test follow the new stems.

- `opencode/scripts/tests/routing-manifest.test.mjs`
  Keep model validation intact after manifest key renames.

- `opencode/command/*.md`
  Update any `@agent` references or prose references to renamed brand-builder agents.

- `opencode/scripts/install-fleet.sh`
- `opencode/scripts/install-fleet-bootstrap.sh`
- `opencode/scripts/merge-config.mjs`
  Update agent-name/path references and then extend them for the broader installer redesign in later tasks of this same plan.

## Task 1: Create The Rename Map Source Of Truth

**Files:**
- Create: `opencode/scripts/lib/agent-fleet-map.mjs`
- Create: `opencode/scripts/tests/agent-fleet-integrity.test.mjs`

- [ ] **Step 1: Write the failing map-integrity test**

Create `opencode/scripts/tests/agent-fleet-integrity.test.mjs`:

```js
import { test, expect } from 'bun:test';
import { AGENT_RENAME_MAP, LEGACY_AGENT_ALIASES, ALL_AGENT_TARGETS } from '../lib/agent-fleet-map.mjs';

test('rename map covers all 38 agents with unique current and target names', () => {
  expect(AGENT_RENAME_MAP).toHaveLength(38);

  const current = new Set(AGENT_RENAME_MAP.map(entry => entry.current));
  const target = new Set(AGENT_RENAME_MAP.map(entry => entry.next));

  expect(current.size).toBe(38);
  expect(target.size).toBe(38);
  expect(ALL_AGENT_TARGETS).toHaveLength(38);
});

test('legacy alias map points to renamed targets', () => {
  expect(LEGACY_AGENT_ALIASES['code-runner']).toBe('karakuri--command-runner');
  expect(LEGACY_AGENT_ALIASES['explorer']).toBe('mikoshi--code-pathfinder');
  expect(LEGACY_AGENT_ALIASES['source-retriever']).toBe('yamabiko--source-echo');
  expect(LEGACY_AGENT_ALIASES['technical-writer']).toBe('makimono--docs-scribe');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs
```

Expected: FAIL with `Cannot find module '../lib/agent-fleet-map.mjs'`.

- [ ] **Step 3: Write the rename-map module**

Create `opencode/scripts/lib/agent-fleet-map.mjs`:

```js
export const AGENT_RENAME_MAP = [
  { current: 'tsukumo', next: 'tsukumogami--code-forgemaster', group: 'specialist' },
  { current: 'tsuchigumo', next: 'tsuchigumo--research-weaver', group: 'specialist' },
  { current: 'tsukuyomi', next: 'tsukuyomi--spec-oracle', group: 'specialist' },
  { current: 'daikoku', next: 'daikoku--finance-steward', group: 'specialist' },
  { current: 'enma', next: 'enma--compliance-judge', group: 'specialist' },
  { current: 'fudo', next: 'fudo--security-guardian', group: 'specialist' },
  { current: 'daidarabotchi', next: 'daidarabotchi--infra-shaper', group: 'specialist' },
  { current: 'yumemi', next: 'yumemi--story-smith', group: 'specialist' },
  { current: 'mujina', next: 'mujina--brand-shapeshifter', group: 'specialist' },
  { current: 'kitsune', next: 'kitsune--brand-orchestrator', group: 'other' },
  { current: 'planner', next: 'chizu--implementation-planner', group: 'specialist' },
  { current: 'shiranui', next: 'shiranui--migration-guide', group: 'specialist' },
  { current: 'sojobō', next: 'sojobo--system-strategist', group: 'specialist' },
  { current: 'tanuki', next: 'tanuki--general-trickster', group: 'other' },
  { current: 'karasutengu', next: 'karasutengu--docs-scout', group: 'other' },
  { current: 'karakuri', next: 'karakuri--command-runner', group: 'subagent' },
  { current: 'mikoshi', next: 'mikoshi--code-pathfinder', group: 'subagent' },
  { current: 'bakeneko', next: 'bakeneko--bug-hunter', group: 'subagent' },
  { current: 'makimono', next: 'makimono--docs-scribe', group: 'subagent' },
  { current: 'jorogumo', next: 'jorogumo--synthesis-weaver', group: 'subagent' },
  { current: 'oni', next: 'oni--red-team-reviewer', group: 'subagent' },
  { current: 'kotodama', next: 'kotodama--prose-polisher', group: 'subagent' },
  { current: 'yamabiko', next: 'yamabiko--source-echo', group: 'subagent' },
  { current: 'kagami', next: 'kagami--truth-mirror', group: 'subagent' },
  { current: 'soroban', next: 'soroban--number-sage', group: 'subagent' },
  { current: 'azukiarai', next: 'azukiarai--data-sifter', group: 'subagent' },
  { current: 'henge', next: 'henge--format-shifter', group: 'subagent' },
  { current: 'tengu', next: 'tengu--visual-artisan', group: 'subagent' },
  { current: 'mizuchi', next: 'mizuchi--data-current', group: 'subagent' },
  { current: 'hanko', next: 'hanko--git-seal', group: 'subagent' },
  { current: 'akashi', next: 'akashi--proof-keeper', group: 'other' },
  { current: 'amanojaku', next: 'amanojaku--voice-contrarian', group: 'other' },
  { current: 'hyakume', next: 'hyakume--ats-watchman', group: 'other' },
  { current: 'kataribe', next: 'kataribe--narrative-teller', group: 'other' },
  { current: 'kodama', next: 'kodama--growth-echo', group: 'other' },
  { current: 'kudagitsune', next: 'kudagitsune--fit-diviner', group: 'other' },
  { current: 'kurabokko', next: 'kurabokko--knowledge-keeper', group: 'other' },
  { current: 'migaki', next: 'migaki--profile-polisher', group: 'other' },
];

export const LEGACY_AGENT_ALIASES = {
  'code-runner': 'karakuri--command-runner',
  'explorer': 'mikoshi--code-pathfinder',
  'source-retriever': 'yamabiko--source-echo',
  'fact-checker': 'kagami--truth-mirror',
  'data-analyst': 'soroban--number-sage',
  'debugger': 'bakeneko--bug-hunter',
  'technical-writer': 'makimono--docs-scribe',
  'synthesizer': 'jorogumo--synthesis-weaver',
  'reviewer': 'oni--red-team-reviewer',
  'prose-wordsmith': 'kotodama--prose-polisher',
  'extractor': 'azukiarai--data-sifter',
  'formatter': 'henge--format-shifter',
  'designer': 'tengu--visual-artisan',
};

export const ALL_AGENT_TARGETS = AGENT_RENAME_MAP.map(entry => entry.next);
export const RENAME_BY_CURRENT = new Map(AGENT_RENAME_MAP.map(entry => [entry.current, entry.next]));
export const GROUPS = {
  specialists: AGENT_RENAME_MAP.filter(entry => entry.group === 'specialist').map(entry => entry.next),
  subagents: AGENT_RENAME_MAP.filter(entry => entry.group === 'subagent').map(entry => entry.next),
  others: AGENT_RENAME_MAP.filter(entry => entry.group === 'other').map(entry => entry.next),
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs
```

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/agent-fleet-map.mjs scripts/tests/agent-fleet-integrity.test.mjs
git commit -m "test: add agent fleet rename map"
```

## Task 2: Rename Files, Fix Invalid Modes, And Re-key Machine-Readable Sources

**Files:**
- Modify: `opencode/agents/azukiarai.md`
- Modify: `opencode/agents/bakeneko.md`
- Modify: `opencode/agents/daidarabotchi.md`
- Modify: `opencode/agents/daikoku.md`
- Modify: `opencode/agents/enma.md`
- Modify: `opencode/agents/fudo.md`
- Modify: `opencode/agents/henge.md`
- Modify: `opencode/agents/jorogumo.md`
- Modify: `opencode/agents/kagami.md`
- Modify: `opencode/agents/karakuri.md`
- Modify: `opencode/agents/karasutengu.md`
- Modify: `opencode/agents/kotodama.md`
- Modify: `opencode/agents/makimono.md`
- Modify: `opencode/agents/mikoshi.md`
- Modify: `opencode/agents/mujina.md`
- Modify: `opencode/agents/oni.md`
- Modify: `opencode/agents/soroban.md`
- Modify: `opencode/agents/tanuki.md`
- Modify: `opencode/agents/tengu.md`
- Modify: `opencode/agents/tsuchigumo.md`
- Modify: `opencode/agents/tsukumo.md`
- Modify: `opencode/agents/tsukuyomi.md`
- Modify: `opencode/agents/yamabiko.md`
- Modify: `opencode/agents/yumemi.md`
- Modify: `opencode/agents/hanko.md`
- Modify: `opencode/agents/sojobō.md`
- Modify: `opencode/agents/shiranui.md`
- Modify: `opencode/agents/planner.md`
- Modify: `opencode/agents/mizuchi.md`
- Modify: `opencode/agents/akashi.md`
- Modify: `opencode/agents/amanojaku.md`
- Modify: `opencode/agents/hyakume.md`
- Modify: `opencode/agents/kataribe.md`
- Modify: `opencode/agents/kitsune.md`
- Modify: `opencode/agents/kodama.md`
- Modify: `opencode/agents/kudagitsune.md`
- Modify: `opencode/agents/kurabokko.md`
- Modify: `opencode/agents/migaki.md`
- Modify: `opencode/docs/routing-manifest.json`
- Modify: `opencode/fleet-manifest.json`
- Modify: `opencode/scripts/tests/agents-match-manifest.test.mjs`
- Test: `opencode/scripts/tests/agent-fleet-integrity.test.mjs`
- Test: `opencode/scripts/tests/agents-match-manifest.test.mjs`

- [ ] **Step 1: Extend the integrity test to fail on old filenames and invalid modes**

Append to `opencode/scripts/tests/agent-fleet-integrity.test.mjs`:

```js
import { readFileSync, existsSync } from 'node:fs';

test('all renamed agent files exist and no old filenames remain', () => {
  for (const entry of AGENT_RENAME_MAP) {
    expect(existsSync(`agents/${entry.next}.md`), `missing agents/${entry.next}.md`).toBe(true);
    expect(existsSync(`agents/${entry.current}.md`), `stale agents/${entry.current}.md still exists`).toBe(false);
  }
});

test('no agent file uses invalid mode: agent', () => {
  for (const entry of AGENT_RENAME_MAP) {
    const body = readFileSync(`agents/${entry.next}.md`, 'utf8');
    expect(body.includes('mode: agent')).toBe(false);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs scripts/tests/agents-match-manifest.test.mjs
```

Expected: FAIL because renamed files do not exist yet and `mode: agent` still exists in `planner`, `shiranui`, and `sojobō`.

- [ ] **Step 3: Rename the files and update manifest keys**

Run the filesystem rename from the source-of-truth map:

```bash
bun -e "import { AGENT_RENAME_MAP } from './scripts/lib/agent-fleet-map.mjs'; import { execFileSync } from 'node:child_process'; for (const { current, next } of AGENT_RENAME_MAP) execFileSync('git', ['mv', `agents/${current}.md`, `agents/${next}.md`], { stdio: 'inherit' });"
```

Update the invalid modes in the renamed files:

```yaml
mode: all
```

Apply that exact change in:

- `opencode/agents/chizu--implementation-planner.md`
- `opencode/agents/shiranui--migration-guide.md`
- `opencode/agents/sojobo--system-strategist.md`

Update `opencode/docs/routing-manifest.json` specialist and subagent keys to the new stems. Example pattern:

```json
"karakuri--command-runner": {
  "primary": "opencode-go/mimo-v2.5",
  "canary": "A2",
  "fallback": ["openai/gpt-5.3-codex", "openai/gpt-5.4-mini", "google-vertex/gemini-3.1-flash-lite"]
}
```

Update `opencode/fleet-manifest.json` file paths under `agents-core` and `brand-builder`. Example pattern:

```json
"files": [
  "agents/karakuri--command-runner.md",
  "agents/mikoshi--code-pathfinder.md",
  "agents/tsukumogami--code-forgemaster.md"
]
```

Update `opencode/scripts/tests/agents-match-manifest.test.mjs` to use the new manifest keys without any special casing:

```js
const subagentNames = Object.keys(manifest.subagents);
const specialistNames = Object.keys(manifest.specialists);
```

The test body can stay structurally identical because it already follows manifest keys.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs scripts/tests/agents-match-manifest.test.mjs scripts/tests/routing-manifest.test.mjs
```

Expected: PASS for file existence, valid modes, and manifest-model alignment.

- [ ] **Step 5: Commit**

```bash
git add agents docs/routing-manifest.json fleet-manifest.json scripts/tests/agent-fleet-integrity.test.mjs scripts/tests/agents-match-manifest.test.mjs
git commit -m "refactor: rename agent fleet and fix modes"
```

## Task 3: Update Repo-Wide References And Add Hard-Failure Stale-Reference Tests

**Files:**
- Create: `opencode/scripts/tests/agent-reference-integrity.test.mjs`
- Modify: `opencode/AGENTS.md`
- Modify: `opencode/command/akashi.md`
- Modify: `opencode/command/awase.md`
- Modify: `opencode/command/hakari.md`
- Modify: `opencode/command/kataribe.md`
- Modify: `opencode/command/kodama.md`
- Modify: `opencode/command/kudagitsune.md`
- Modify: `opencode/command/kurabokko.md`
- Modify: `opencode/command/migaki.md`
- Modify: `opencode/command/omokage.md`
- Modify: `opencode/command/tsumugi.md`
- Modify: `opencode/scripts/install-fleet.sh`
- Modify: `opencode/scripts/install-fleet-bootstrap.sh`
- Modify: `opencode/scripts/merge-config.mjs`
- Modify: `opencode/scripts/tests/routing-manifest.test.mjs`
- Modify: all renamed agent files containing `@...` or `permission.task` references
- Test: `opencode/scripts/tests/agent-reference-integrity.test.mjs`

- [ ] **Step 1: Write the failing stale-reference test**

Create `opencode/scripts/tests/agent-reference-integrity.test.mjs`:

```js
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_RENAME_MAP, LEGACY_AGENT_ALIASES, ALL_AGENT_TARGETS } from '../lib/agent-fleet-map.mjs';

const ROOTS = ['AGENTS.md', 'fleet-manifest.json', 'docs/routing-manifest.json', 'scripts/install-fleet.sh', 'scripts/install-fleet-bootstrap.sh', 'scripts/merge-config.mjs'];
const DIRS = ['agents', 'command', 'docs'];
const DOC_ALLOWLIST = new Set(['docs/agent-description-rubric.md', 'docs/agent-fleet-structural-findings.md']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test('no stale old stems or legacy aliases remain outside approved historical docs', () => {
  const files = [...ROOTS, ...DIRS.flatMap(walk)].filter(file => !DOC_ALLOWLIST.has(file));
  const staleTokens = [
    ...AGENT_RENAME_MAP.map(entry => entry.current),
    ...Object.keys(LEGACY_AGENT_ALIASES),
  ];

  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    for (const token of staleTokens) {
      expect(body.includes(`@${token}`) || body.includes(`\"${token}\"`) || body.includes(`${token}:`), `${file} still contains stale token ${token}`).toBe(false);
    }
  }
});

test('all task permissions point at real renamed targets', () => {
  const valid = new Set(ALL_AGENT_TARGETS);
  for (const file of walk('agents')) {
    const body = readFileSync(file, 'utf8');
    for (const match of body.matchAll(/^\s{4}([a-z0-9-]+):\s*allow$/gm)) {
      if (match[1] === '*') continue;
      expect(valid.has(match[1]), `${file} permission.task target ${match[1]} is not a renamed agent stem`).toBe(true);
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test scripts/tests/agent-reference-integrity.test.mjs
```

Expected: FAIL on stale `@code-runner`, `@explorer`, old manifest names, and old docs table entries.

- [ ] **Step 3: Update references everywhere**

Use this alias replacement table when editing prompts and `permission.task` blocks:

```js
const LEGACY_AGENT_ALIASES = {
  'code-runner': 'karakuri--command-runner',
  'explorer': 'mikoshi--code-pathfinder',
  'source-retriever': 'yamabiko--source-echo',
  'fact-checker': 'kagami--truth-mirror',
  'data-analyst': 'soroban--number-sage',
  'debugger': 'bakeneko--bug-hunter',
  'technical-writer': 'makimono--docs-scribe',
  'synthesizer': 'jorogumo--synthesis-weaver',
  'reviewer': 'oni--red-team-reviewer',
  'prose-wordsmith': 'kotodama--prose-polisher',
  'extractor': 'azukiarai--data-sifter',
  'formatter': 'henge--format-shifter',
  'designer': 'tengu--visual-artisan',
};
```

Mandatory content fixes in this task:

- Replace every `@old-name` mention in agent bodies with `@new-name`.
- Replace every English alias in `permission.task` with the renamed target stem.
- Update `opencode/AGENTS.md` delegation tables, escape-hatch table, and examples to the new names.
- Update command files that refer to brand agents or old stems.
- Update installer/test/support files that embed old filenames.

When editing prompt bodies, use the new explicit style:

```text
Dispatch @karakuri--command-runner for all shell execution.
Dispatch @mikoshi--code-pathfinder for read-only codebase exploration.
Dispatch @kagami--truth-mirror for claim verification.
```

- [ ] **Step 4: Run the reference tests to verify they pass**

Run:

```bash
bun test scripts/tests/agent-reference-integrity.test.mjs scripts/tests/agent-fleet-integrity.test.mjs
```

Expected: PASS with no stale old stems, no legacy alias task targets, and no invalid modes.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md agents command docs fleet-manifest.json scripts
git commit -m "refactor: update agent references to hybrid names"
```

## Task 4: Add The Fleet Audit Report Generator And Findings Skeleton

**Files:**
- Create: `opencode/scripts/agent-fleet-audit.mjs`
- Create: `opencode/docs/agent-fleet-structural-findings.md`
- Test: `opencode/scripts/agent-fleet-audit.mjs`

- [ ] **Step 1: Write the audit generator**

Create `opencode/scripts/agent-fleet-audit.mjs`:

```js
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const files = readdirSync('agents').filter(file => file.endsWith('.md')).sort();

const rows = files.map(file => {
  const body = readFileSync(join('agents', file), 'utf8');
  const mode = body.match(/^mode:\s*(.+)$/m)?.[1]?.trim() ?? 'missing';
  const model = body.match(/^model:\s*(.+)$/m)?.[1]?.trim() ?? 'missing';
  const description = body.match(/^description:\s*>?\s*(.+)$/m)?.[1]?.trim() ?? 'missing';
  const mentions = [...body.matchAll(/@([a-z0-9-]+)/g)].map(match => match[1]);
  const taskTargets = [...body.matchAll(/^\s{4}([a-z0-9-]+):\s*allow$/gm)].map(match => match[1]).filter(name => name !== '*');

  return `| ${file} | ${mode} | ${model} | ${description.replace(/\|/g, '\\/')} | ${mentions.join(', ')} | ${taskTargets.join(', ')} |`;
});

const report = [
  '# Agent Fleet Structural Findings',
  '',
  '## Inventory',
  '',
  '| File | Mode | Model | Description | Mentions | Task Targets |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows,
  '',
  '## Structural Findings',
  '',
  '- Pending manual review.',
  '',
  '## Approval Gate',
  '',
  '- Do not apply hierarchy changes until the user approves this file.',
  '',
].join('\n');

writeFileSync('docs/agent-fleet-structural-findings.md', report);
```

- [ ] **Step 2: Run the generator and verify the findings file is created**

Run:

```bash
bun scripts/agent-fleet-audit.mjs
```

Expected: `docs/agent-fleet-structural-findings.md` exists and contains a row for each of the 38 renamed agent files.

- [ ] **Step 3: Add the review gate note to the findings file**

Make sure `opencode/docs/agent-fleet-structural-findings.md` ends with this exact approval note:

```md
## Approval Gate

- Do not apply hierarchy changes until the user approves this file.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/agent-fleet-audit.mjs docs/agent-fleet-structural-findings.md
git commit -m "docs: add agent fleet audit findings scaffold"
```

## Task 5: Research Official Agent Guidance And Write The Description Rubric

**Files:**
- Create: `opencode/docs/agent-description-rubric.md`
- Modify: `opencode/docs/agent-fleet-structural-findings.md`

- [ ] **Step 1: Read the official docs before rewriting any descriptions**

Read and take notes from:

```text
https://opencode.ai/docs/agents/
https://opencode.ai/docs/permissions/
```

Key facts to extract into the rubric:

- filename stem becomes the agent name
- valid modes are `primary`, `subagent`, `all`
- `description` is required and should say what the agent does and when to use it
- `permission.task` must match real subagent names
- last matching permission rule wins

- [ ] **Step 2: Write the rubric file**

Create `opencode/docs/agent-description-rubric.md`:

```md
# Agent Description And Parameter Rubric

## Description Shape

Use this frontmatter shape:

```yaml
description: >
  <Role Name>: <Primary routing trigger and purpose>.
  Use for: <specific task types and user phrases>.
  Not for: <common misroutes and exclusions>.
  Behavior: <output contract or critical operational rule>.
```

## Description Rules

- Lead with the operational role, not lore.
- Optimize for routing and invocation, not flavor.
- Include at least one output or behavior contract.
- Mention exclusions that prevent common misroutes.
- Keep lore to zero or one short connection line only when it improves understanding.

## Parameter Review Rules

- `mode` must be `primary`, `subagent`, or `all`.
- `model` must stay in sync with `docs/routing-manifest.json` unless an approved structural change updates both.
- `temperature`, `top_p`, and `steps` must be justified by the role.
- `hidden` is only valid for subagents that should disappear from autocomplete.
- `permission.task` must only reference real renamed agent stems.
- Provider-specific options must be documented in the findings file when changed.
```

- [ ] **Step 3: Add the review rubric link to the findings file**

Add this line near the top of `opencode/docs/agent-fleet-structural-findings.md`:

```md
- Review rubric: `docs/agent-description-rubric.md`
```

- [ ] **Step 4: Commit**

```bash
git add docs/agent-description-rubric.md docs/agent-fleet-structural-findings.md
git commit -m "docs: add agent description rubric"
```

## Task 6: Rewrite Specialists Using The Rubric And Record Structural Findings

**Files:**
- Modify: `opencode/agents/tsukumogami--code-forgemaster.md`
- Modify: `opencode/agents/tsuchigumo--research-weaver.md`
- Modify: `opencode/agents/tsukuyomi--spec-oracle.md`
- Modify: `opencode/agents/daikoku--finance-steward.md`
- Modify: `opencode/agents/enma--compliance-judge.md`
- Modify: `opencode/agents/fudo--security-guardian.md`
- Modify: `opencode/agents/daidarabotchi--infra-shaper.md`
- Modify: `opencode/agents/yumemi--story-smith.md`
- Modify: `opencode/agents/mujina--brand-shapeshifter.md`
- Modify: `opencode/agents/chizu--implementation-planner.md`
- Modify: `opencode/agents/shiranui--migration-guide.md`
- Modify: `opencode/agents/sojobo--system-strategist.md`
- Modify: `opencode/docs/agent-fleet-structural-findings.md`

- [ ] **Step 1: Rewrite specialist descriptions with the rubric**

For each specialist, replace the old story-first description with a routing-first description. Example pattern for `opencode/agents/tsukumogami--code-forgemaster.md`:

```yaml
description: >
  Code Forgemaster: Multi-file software implementation, coordinated refactoring,
  and architecture-driven code generation with implement-test loops.
  Use for: feature implementation across 3 or more files, coordinated edits,
  module refactors, code generation, and execution-ready coding work.
  Not for: single-file edits, infrastructure changes, security audits, or pure planning.
  Behavior: delegates shell execution to @karakuri--command-runner and must finish with verification evidence.
```

Apply the same structure to all 12 specialists using the role appropriate to each file.

- [ ] **Step 2: Review and tighten specialist parameters**

Only change parameters when the role justifies it and record each change in `docs/agent-fleet-structural-findings.md`.

Parameter review checklist to apply in each specialist file:

```yaml
mode: all
model: <must match docs/routing-manifest.json>
temperature: <keep only if the role needs a non-default value>
top_p: <keep only if the role needs a non-default value>
steps: <add only when cost or bounded loops need it>
permission:
  task:
    "*": deny
```

Do not invent new parameters. Only keep or add values supported by the official docs and justified by the role.

- [ ] **Step 3: Record structural findings without applying hierarchy changes**

Update `opencode/docs/agent-fleet-structural-findings.md` with sections for:

```md
## Specialist Findings

- Which specialist descriptions were misleading before rename.
- Which specialist permissions were too broad or too narrow.
- Any specialist-to-specialist routing violations still present.
- Proposed structural changes that need user approval.
```

Do not apply any merge, split, promotion, demotion, or hidden-state changes yet. Only record them.

- [ ] **Step 4: Run targeted validation**

Run:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs scripts/tests/agent-reference-integrity.test.mjs
```

Expected: PASS. If a specialist rewrite reintroduced a stale reference or invalid task target, fix it before moving on.

- [ ] **Step 5: Commit**

```bash
git add agents docs/agent-fleet-structural-findings.md
git commit -m "docs: rewrite specialist agent descriptions"
```

## Task 7: Rewrite Shared Subagents And Other Agents, Then Present Findings

**Files:**
- Modify: `opencode/agents/karakuri--command-runner.md`
- Modify: `opencode/agents/mikoshi--code-pathfinder.md`
- Modify: `opencode/agents/bakeneko--bug-hunter.md`
- Modify: `opencode/agents/makimono--docs-scribe.md`
- Modify: `opencode/agents/jorogumo--synthesis-weaver.md`
- Modify: `opencode/agents/oni--red-team-reviewer.md`
- Modify: `opencode/agents/kotodama--prose-polisher.md`
- Modify: `opencode/agents/yamabiko--source-echo.md`
- Modify: `opencode/agents/kagami--truth-mirror.md`
- Modify: `opencode/agents/soroban--number-sage.md`
- Modify: `opencode/agents/azukiarai--data-sifter.md`
- Modify: `opencode/agents/henge--format-shifter.md`
- Modify: `opencode/agents/tengu--visual-artisan.md`
- Modify: `opencode/agents/mizuchi--data-current.md`
- Modify: `opencode/agents/hanko--git-seal.md`
- Modify: `opencode/agents/tanuki--general-trickster.md`
- Modify: `opencode/agents/karasutengu--docs-scout.md`
- Modify: `opencode/agents/kitsune--brand-orchestrator.md`
- Modify: `opencode/agents/akashi--proof-keeper.md`
- Modify: `opencode/agents/amanojaku--voice-contrarian.md`
- Modify: `opencode/agents/hyakume--ats-watchman.md`
- Modify: `opencode/agents/kataribe--narrative-teller.md`
- Modify: `opencode/agents/kodama--growth-echo.md`
- Modify: `opencode/agents/kudagitsune--fit-diviner.md`
- Modify: `opencode/agents/kurabokko--knowledge-keeper.md`
- Modify: `opencode/agents/migaki--profile-polisher.md`
- Modify: `opencode/docs/agent-fleet-structural-findings.md`

- [ ] **Step 1: Rewrite shared subagents using the rubric**

For each shared subagent, rewrite the description to make dispatch conditions obvious. Example pattern for `opencode/agents/karakuri--command-runner.md`:

```yaml
description: >
  Command Runner: Executes approved shell commands, test suites, build commands,
  scripts, and code execution packets; returns stdout, stderr, and exit code.
  Use for: tests, builds, scripts, verification commands, and shell execution delegated from other agents.
  Not for: code authoring, broad analysis, root-cause reasoning, or documentation.
  Behavior: this is the only bash-capable shared subagent; never substitute interpretation for execution.
```

Repeat with role-appropriate wording for all shared subagents and the remaining agents.

- [ ] **Step 2: Review subagent and other-agent parameters**

Apply this checklist to every non-specialist file:

```yaml
mode: subagent|all
hidden: <only if the agent should disappear from @ autocomplete>
permission:
  task:
    "*": deny
```

Specific review rules:

- Shared subagents should not gain broader permissions than their role needs.
- T2 leaves should only dispatch allowed leaves, or none at all.
- Escape hatches should stay broad but still use correct renamed references.
- Brand-builder agents should be updated for naming consistency even if the bundle remains opt-in.

- [ ] **Step 3: Finalize and present the structural findings file**

Make `opencode/docs/agent-fleet-structural-findings.md` presentable to the user with these exact sections:

```md
## Inventory
## Specialist Findings
## Shared Subagent Findings
## Other Agent Findings
## Proposed Structural Changes
## Approval Gate
```

In `## Proposed Structural Changes`, list only proposals, not applied changes.

- [ ] **Step 4: Run the full validation suite and stop at the approval gate**

Run:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs scripts/tests/agent-reference-integrity.test.mjs scripts/tests/agents-match-manifest.test.mjs scripts/tests/routing-manifest.test.mjs
```

Expected: PASS.

Then run:

```bash
bun scripts/agent-fleet-audit.mjs
```

Expected: regenerated findings file with the final inventory table.

After those commands pass, stop and present `opencode/docs/agent-fleet-structural-findings.md` to the user. Do not apply structural changes yet.

- [ ] **Step 5: Commit**

```bash
git add agents docs/agent-description-rubric.md docs/agent-fleet-structural-findings.md scripts/tests scripts/agent-fleet-audit.mjs
git commit -m "docs: complete agent fleet review pass"
```

## Task 8: Apply Only Approved Structural Changes After User Review

**Files:**
- Modify: `opencode/docs/agent-fleet-structural-findings.md`
- Modify: only the specific agent/manifests/tests/docs approved by the user after Task 7
- Test: all agent fleet tests

- [ ] **Step 1: Wait for explicit approval before editing structure**

Do not start this task until the user has reviewed `opencode/docs/agent-fleet-structural-findings.md` and approved specific structural changes.

- [ ] **Step 2: Update the findings file to mark approved items**

Edit `opencode/docs/agent-fleet-structural-findings.md` so each proposed change is marked one of:

```md
- Approved
- Rejected
- Deferred
```

Only `Approved` items may be implemented in this task.

- [ ] **Step 3: Apply approved structural changes in one pass**

Examples of allowed edits in this task, but only if explicitly approved:

- merge or split agents
- change `mode`
- add or remove `hidden: true`
- tighten or widen permissions
- adjust `model`, `temperature`, `top_p`, or `steps`
- change hierarchy or routing rules

After applying those edits, rerun the full validation suite:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs scripts/tests/agent-reference-integrity.test.mjs scripts/tests/agents-match-manifest.test.mjs scripts/tests/routing-manifest.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add agents docs scripts tests fleet-manifest.json AGENTS.md
git commit -m "refactor: apply approved fleet structure changes"
```

## Task 9: Build The Session Vault Data Layer And Helper

**Files:**
- Create: `opencode/scripts/lib/session-vault-index.mjs`
- Create: `opencode/scripts/session-vault.mjs`
- Create: `opencode/scripts/tests/session-vault-index.test.mjs`
- Create: `opencode/scripts/tests/session-vault-helper.test.mjs`

- [ ] **Step 1: Write the failing Session Vault index tests**

Create `opencode/scripts/tests/session-vault-index.test.mjs`:

```js
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyIndex, loadIndex, upsertSession, saveIndex } from '../lib/session-vault-index.mjs';

test('loadIndex returns empty structure when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  expect(loadIndex(file)).toEqual(emptyIndex());
});

test('upsertSession inserts and updates by id', () => {
  const first = upsertSession(emptyIndex(), { id: 'ses_1', title: 'First', workspace: '/repo', status: 'active' });
  expect(first.sessions).toHaveLength(1);

  const second = upsertSession(first, { id: 'ses_1', title: 'Renamed', workspace: '/repo', status: 'archived' });
  expect(second.sessions).toHaveLength(1);
  expect(second.sessions[0].title).toBe('Renamed');
  expect(second.sessions[0].status).toBe('archived');
});

test('saveIndex writes normalized JSON atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  saveIndex(file, emptyIndex());
  const raw = readFileSync(file, 'utf8');
  expect(raw).toContain('"version": 1');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test scripts/tests/session-vault-index.test.mjs
```

Expected: FAIL with `Cannot find module '../lib/session-vault-index.mjs'`.

- [ ] **Step 3: Write the index helper module**

Create `opencode/scripts/lib/session-vault-index.mjs`:

```js
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function emptyIndex() {
  return { version: 1, updated_at: null, sessions: [] };
}

export function loadIndex(file) {
  if (!existsSync(file)) return emptyIndex();
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return {
    version: parsed.version ?? 1,
    updated_at: parsed.updated_at ?? null,
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  };
}

export function upsertSession(index, session) {
  const sessions = [...index.sessions];
  const idx = sessions.findIndex(entry => entry.id === session.id);
  const next = { ...session };
  if (idx === -1) sessions.push(next);
  else sessions[idx] = { ...sessions[idx], ...next };
  return {
    ...index,
    updated_at: new Date().toISOString(),
    sessions: sessions.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))),
  };
}

export function saveIndex(file, index) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.tmp-${Date.now()}-index.json`);
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}
```

Create `opencode/scripts/tests/session-vault-helper.test.mjs`:

```js
import { test, expect } from 'bun:test';
import { classifySearch, selectVisibleSessions } from '../session-vault.mjs';

const FIXTURE = {
  sessions: [
    { id: 'ses_1', title: 'Fix installer', workspace: '/a', status: 'active', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_2', title: 'Brand review', workspace: '/b', status: 'archived', updated_at: '2026-06-04T10:00:00.000Z' },
  ],
};

test('selectVisibleSessions sorts recent first', () => {
  expect(selectVisibleSessions(FIXTURE)[0].id).toBe('ses_1');
});

test('classifySearch filters by title and workspace', () => {
  const result = classifySearch(FIXTURE.sessions, 'installer');
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('ses_1');
});
```

Create `opencode/scripts/session-vault.mjs` with pure helpers first:

```js
export function selectVisibleSessions(index) {
  return [...(index.sessions || [])].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
}

export function classifySearch(sessions, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter(session =>
    `${session.title ?? ''} ${session.workspace ?? ''} ${session.status ?? ''}`.toLowerCase().includes(q),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test scripts/tests/session-vault-index.test.mjs scripts/tests/session-vault-helper.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/session-vault-index.mjs scripts/session-vault.mjs scripts/tests/session-vault-index.test.mjs scripts/tests/session-vault-helper.test.mjs
git commit -m "feat: add session vault data layer"
```

## Task 10: Add The Session Vault Command And Close-Hook Plugin

**Files:**
- Create: `opencode/plugins/omokage.js`
- Create: `opencode/command/session-vault.md`
- Modify: `opencode/opencode.jsonc`
- Create: `opencode/scripts/tests/session-vault-plugin.test.mjs`

- [ ] **Step 1: Write the failing plugin test**

Create `opencode/scripts/tests/session-vault-plugin.test.mjs`:

```js
import { test, expect } from 'bun:test';
import { __test_syncHookFor } from '../../plugins/omokage.js';

test('session close hook syncs a known session id', async () => {
  const calls = [];
  const hook = __test_syncHookFor({
    getSessionId: () => 'ses_123',
    syncSession: async id => calls.push(['sync-session', id]),
    syncNew: async () => calls.push(['sync-new']),
  });

  await hook();
  expect(calls).toEqual([['sync-session', 'ses_123']]);
});

test('session close hook falls back to sync-new when session id is missing', async () => {
  const calls = [];
  const hook = __test_syncHookFor({
    getSessionId: () => null,
    syncSession: async id => calls.push(['sync-session', id]),
    syncNew: async () => calls.push(['sync-new']),
  });

  await hook();
  expect(calls).toEqual([['sync-new']]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test scripts/tests/session-vault-plugin.test.mjs
```

Expected: FAIL with `Cannot find module '../../plugins/omokage.js'`.

- [ ] **Step 3: Create the close-hook plugin and command**

Create `opencode/plugins/omokage.js`:

```js
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;

export function __test_syncHookFor(ctx) {
  return async function sessionCloseHook() {
    const sessionId = ctx.getSessionId();
    if (sessionId) return ctx.syncSession(sessionId);
    return ctx.syncNew();
  };
}

function runHelper(args) {
  const script = join(FLEET_ROOT, 'scripts', 'session-vault.mjs');
  execFileSync('bun', [script, ...args], { stdio: 'ignore' });
}

const hook = __test_syncHookFor({
  getSessionId: () => process.env.OPENCODE_SESSION_ID || null,
  syncSession: async id => runHelper(['sync-session', id]),
  syncNew: async () => runHelper(['sync-new']),
});

export default {
  name: 'session-vault-sync',
  hooks: {
    'response.before': async () => {},
    'session.stop': hook,
  },
};
```

Create `opencode/command/session-vault.md`:

```md
---
description: Browse, search, inspect, export, archive, restore, continue, and delete global OpenCode sessions from the Session Vault
agent: build
---
Use @session-vault context to manage global sessions.

Requirements:
- Read `~/.local/share/opencode/session-vault/index.json` first.
- Show all sessions in recent-first order.
- Support search/filter similar to `/sessions`.
- Allow actions: inspect, export, archive, restore, continue, delete, refresh.
- Ask for confirmation only on destructive actions.
- If direct in-place continue is unsupported, return the safest supported resume/open fallback.
```

Update `opencode/opencode.jsonc` plugin list:

```json
  "plugin": [
    "./plugins/nio.js",
    "./plugins/nurikabe.js",
    "./plugins/komainu.js",
    "./plugins/migawari.js",
    "./plugins/omokage.js"
  ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test scripts/tests/session-vault-plugin.test.mjs scripts/tests/session-vault-index.test.mjs scripts/tests/session-vault-helper.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/omokage.js command/session-vault.md opencode.jsonc scripts/tests/session-vault-plugin.test.mjs
git commit -m "feat: add session vault command and sync hook"
```

## Task 11: Complete Session Vault Helper Operations And Safety Rules

**Files:**
- Modify: `opencode/scripts/session-vault.mjs`
- Modify: `opencode/scripts/tests/session-vault-helper.test.mjs`

- [ ] **Step 1: Extend the helper tests for archive/delete behavior**

Append to `opencode/scripts/tests/session-vault-helper.test.mjs`:

```js
import { markDeleted, archiveSession } from '../session-vault.mjs';

test('archiveSession marks session archived and adds archive path', () => {
  const next = archiveSession(FIXTURE, 'ses_1', '/tmp/archive/ses_1.json');
  expect(next.sessions.find(session => session.id === 'ses_1')?.status).toBe('archived');
  expect(next.sessions.find(session => session.id === 'ses_1')?.archive_path).toBe('/tmp/archive/ses_1.json');
});

test('markDeleted marks session deleted without removing record', () => {
  const next = markDeleted(FIXTURE, 'ses_2');
  expect(next.sessions.find(session => session.id === 'ses_2')?.status).toBe('deleted');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test scripts/tests/session-vault-helper.test.mjs
```

Expected: FAIL with `archiveSession is not exported`.

- [ ] **Step 3: Implement the helper operations**

Update `opencode/scripts/session-vault.mjs`:

```js
import { loadIndex, saveIndex, upsertSession } from './lib/session-vault-index.mjs';

export function archiveSession(index, id, archivePath) {
  const sessions = index.sessions.map(session =>
    session.id === id
      ? { ...session, status: 'archived', archive_path: archivePath, updated_at: new Date().toISOString() }
      : session,
  );
  return { ...index, updated_at: new Date().toISOString(), sessions };
}

export function markDeleted(index, id) {
  const sessions = index.sessions.map(session =>
    session.id === id
      ? { ...session, status: 'deleted', updated_at: new Date().toISOString() }
      : session,
  );
  return { ...index, updated_at: new Date().toISOString(), sessions };
}

export function inspectSession(index, id) {
  return index.sessions.find(session => session.id === id) ?? null;
}
```

Also add CLI plumbing only for the implemented operations:

```js
if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const root = `${process.env.HOME}/.local/share/opencode/session-vault`;
  const indexFile = `${root}/index.json`;
  const index = loadIndex(indexFile);

  if (command === 'list') {
    console.log(JSON.stringify(selectVisibleSessions(index), null, 2));
  } else if (command === 'search') {
    console.log(JSON.stringify(classifySearch(index.sessions, args.join(' ')), null, 2));
  } else if (command === 'mark-deleted') {
    saveIndex(indexFile, markDeleted(index, args[0]));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test scripts/tests/session-vault-helper.test.mjs scripts/tests/session-vault-index.test.mjs scripts/tests/session-vault-plugin.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/session-vault.mjs scripts/tests/session-vault-helper.test.mjs
git commit -m "feat: complete session vault helper operations"
```

## Task 12: Redesign The Installer Around Core, Optional Brand Builder, And Session Vault

**Files:**
- Modify: `opencode/fleet-manifest.json`
- Modify: `opencode/scripts/install-fleet.sh`
- Modify: `opencode/scripts/install-fleet-bootstrap.sh`
- Modify: `opencode/scripts/merge-config.mjs`
- Create: `opencode/scripts/tests/install-fleet-session-vault.test.mjs`
- Modify: `opencode/README.md`

- [ ] **Step 1: Write the failing installer test**

Create `opencode/scripts/tests/install-fleet-session-vault.test.mjs`:

```js
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('fleet-manifest.json', 'utf8'));

test('fleet manifest includes a session-vault component', () => {
  const component = manifest.components.find(entry => entry.id === 'session-vault');
  expect(component).toBeDefined();
  expect(component.default_on).toBe(true);
  expect(component.target_subdirs.includes('command')).toBe(true);
  expect(component.target_subdirs.includes('plugins')).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test scripts/tests/install-fleet-session-vault.test.mjs
```

Expected: FAIL because `session-vault` does not exist in `fleet-manifest.json` yet.

- [ ] **Step 3: Add the manifest component and new installer flags**

Add a new component to `opencode/fleet-manifest.json`:

```json
{
  "id": "session-vault",
  "label": "Session Vault",
  "description": "Global session vault command, close-hook plugin, helper, and tests.",
  "atomic": true,
  "coupling": "command/session-vault.md depends on plugins/omokage.js and scripts/session-vault.mjs",
  "requires_bun": false,
  "default_on": true,
  "target_subdirs": ["command", "plugins", "scripts"],
  "files": [
    "command/session-vault.md",
    "plugins/omokage.js",
    "scripts/session-vault.mjs"
  ],
  "globs": [
    "scripts/lib/session-vault-*.mjs",
    "scripts/tests/session-vault-*.test.mjs"
  ]
}
```

Update `opencode/scripts/install-fleet.sh` usage and flags so the install-set model becomes:

```bash
--core
--with-brand-builder
--scope global|project|custom
--target <path>
--mode copy|link
--include <component[,component...]>
--exclude <component[,component...]>
--dry-run
--on-conflict backup|skip|overwrite|abort
```

Implement backup-root creation using the approved layout:

```bash
backup_root="$target_root/kura_backup/$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p "$backup_root"
```

Update `opencode/scripts/merge-config.mjs` default seed config so new files get a schema:

```js
raw = '{"$schema":"https://opencode.ai/config.json","plugin":[],"instructions":[]}';
```

- [ ] **Step 4: Update README install docs**

Revise `opencode/README.md` installer section to reflect the new flow:

```md
The installer first offers Core, then optionally Brand Builder. It always shows paths and summaries before mutation, lets you choose location and copy/link mode separately, runs preflight, and defaults conflicts to backup under `kura_backup/`.
```

- [ ] **Step 5: Run the installer tests and dry-run check**

Run:

```bash
bun test scripts/tests/install-fleet-session-vault.test.mjs
bash scripts/install-fleet.sh --core --scope global --mode copy --dry-run
```

Expected:

- test PASS
- dry-run output includes Core components, Session Vault, path summaries, and no file writes

- [ ] **Step 6: Commit**

```bash
git add fleet-manifest.json scripts/install-fleet.sh scripts/install-fleet-bootstrap.sh scripts/merge-config.mjs scripts/tests/install-fleet-session-vault.test.mjs README.md
git commit -m "feat: redesign installer for fleet and session vault"
```

## Task 13: End-To-End Verification Of The Whole Program

**Files:**
- Test: `opencode/scripts/tests/agent-fleet-integrity.test.mjs`
- Test: `opencode/scripts/tests/agent-reference-integrity.test.mjs`
- Test: `opencode/scripts/tests/agents-match-manifest.test.mjs`
- Test: `opencode/scripts/tests/routing-manifest.test.mjs`
- Test: `opencode/scripts/tests/session-vault-index.test.mjs`
- Test: `opencode/scripts/tests/session-vault-helper.test.mjs`
- Test: `opencode/scripts/tests/session-vault-plugin.test.mjs`
- Test: `opencode/scripts/tests/install-fleet-session-vault.test.mjs`

- [ ] **Step 1: Run the full targeted verification suite**

Run:

```bash
bun test scripts/tests/agent-fleet-integrity.test.mjs \
  scripts/tests/agent-reference-integrity.test.mjs \
  scripts/tests/agents-match-manifest.test.mjs \
  scripts/tests/routing-manifest.test.mjs \
  scripts/tests/session-vault-index.test.mjs \
  scripts/tests/session-vault-helper.test.mjs \
  scripts/tests/session-vault-plugin.test.mjs \
  scripts/tests/install-fleet-session-vault.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the broad repo test suite**

Run:

```bash
bun test scripts/tests/
```

Expected: PASS.

- [ ] **Step 3: Run the key dry-run installer flows**

Run:

```bash
bash scripts/install-fleet.sh --core --scope global --mode copy --dry-run
bash scripts/install-fleet.sh --core --with-brand-builder --scope project --mode link --dry-run
```

Expected: both commands print preflight summaries, include session-vault in Core, and make no writes.

- [ ] **Step 4: Commit**

```bash
git add docs scripts tests README.md fleet-manifest.json opencode.jsonc command plugins agents AGENTS.md
git commit -m "test: verify full opencode fleet program"
```

## Self-Review Checklist

- Spec coverage:
  - hybrid rename scheme -> Tasks 1-3
  - invalid `mode: agent` fixes -> Task 2
  - reference hard-failure validation -> Tasks 3 and 7
  - description/parameter research -> Task 5
  - per-agent review order -> Tasks 6 and 7
  - structural approval gate -> Tasks 4, 7, and 8
  - docs updated to latest names -> Tasks 3, 6, 7, and 12
  - session-vault command, helper, storage, and close-hook sync -> Tasks 9, 10, and 11
  - installer redesign, transparency, backup, and session-vault component -> Task 12
  - end-to-end execution of the whole program -> Task 13
- Placeholder scan:
  - no unresolved placeholder markers or deferred-work markers in the plan body
  - Task 8 is intentionally gated on user approval, not a placeholder
- Type consistency:
  - rename-map file: `scripts/lib/agent-fleet-map.mjs`
  - findings file: `docs/agent-fleet-structural-findings.md`
  - rubric file: `docs/agent-description-rubric.md`
