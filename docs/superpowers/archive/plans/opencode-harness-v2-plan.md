# OpenCode Harness v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully replace the existing 12-specialist/16-subagent OpenCode fleet with the workflow-first v2 fleet defined in `docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md`.

**Architecture:** Seven sequential parts, each leaving the harness green and testable. Part 1 proves the dispatch model and executes the hard fleet cut down to an interim 7-agent survivor fleet; Parts 2-4 build the new core agents, skills pipeline, and plugin/state infrastructure; Parts 5-6 wire the five workflows and rewrite all fleet-coupled docs; Part 7 ships the whole harness as a single npm-distributed OpenCode plugin. The spec is the sole source of truth — when this plan and the spec disagree, the spec wins.

**Distribution model (decision 2026-07-02):** the harness ships as one npm package, **`@furaide/opencode-harness`**, installed by users with a single line — `"plugin": ["@furaide/opencode-harness"]` in `opencode.json` (OpenCode auto-installs npm plugins with Bun at startup). The package's `config` hook (official SDK: `Hooks.config?: (input: Config) => Promise<void>`; `Config` includes `agent`, `command`, `instructions`, `permission`) registers the full fleet programmatically; agent `.md` files stay the authoring source of truth and are parsed at plugin load. Gate/failover/hook plugins and the web-tools `tool` hook fold into the same module. Skills sync to `~/.config/opencode/skills/` via an idempotent version-stamped bootstrap. **Never packaged:** `future-work/`, `tools/`, harness-root `README.md` and `AGENTS.md`, `docs/imgs/`, `docs/superpowers/`, `scripts/dev/`, `scripts/tests/`. **Always packaged:** the rewritten `config/AGENTS.md` (shipped as an `instructions` file), `agents/`, `rules/`, `plugins/` buckets, runtime `scripts/`, `docs/routing-manifest.json`, bundled skills. The legacy `fleet-manifest.json`/installer path is interim scaffolding only and is retired in Part 7.

**Tech Stack:** OpenCode markdown agents + `opencode.jsonc`, bun (`bun test` for `scripts/tests/`), Node ESM scripts (`.mjs`), Python via `uv` for finance scripts (Part 6), mermaid state machines already defined in the spec.

**Conventions for the executor:**
- Repo root: `/d/Everything/Furaidē`. All paths below are relative to `harnesses/opencode/` unless prefixed with `/`.
- Commits use Conventional Commits and route through the repo's git conventions (`hanko--git-seal` in interactive sessions; direct `git commit` inside plan-executor subagents is acceptable). Never push; never touch master.
- Run `bun test` from `harnesses/opencode/` after every task that touches `agents/`, `config/`, or `scripts/`.
- Worker model tier: `opencode-go/mimo-v2.5` (canary A2-proven tool-caller). Used everywhere the spec says "worker tier, defined in routing-manifest.json v10".

---

## Part 1 — Dispatch Probes + Fleet Migration (hard cut, interim fleet)

Deliverable: dispatch probes (a)-(d) recorded in `scripts/dev/canaries/RESULTS.md`; `agents/` contains only the 7 survivors + 3 built-in overrides; fleet manifest/config/tests updated and green.

### Task 1: Canary agent files for dispatch probes

**Files:**
- Create: `agents/_v2-leaf.md`, `agents/_v2-impl.md`, `agents/_v2-spec.md`

- [ ] **Step 1: Create the leaf canary** — `agents/_v2-leaf.md`:

```markdown
---
description: v2 canary leaf. Runs one echo command and returns stdout verbatim. Not for real work.
mode: subagent
hidden: true
temperature: 0.1
steps: 3
permission:
  bash:
    "echo *": allow
    "*": deny
  edit: deny
  task: deny
---
When invoked, run `echo V2_LEAF_OK` with the bash tool and reply with the exact stdout and nothing else. Never dispatch yourself. Never re-dispatch the task you were given.
```

- [ ] **Step 2: Create the mid canary** — `agents/_v2-impl.md`:

```markdown
---
description: v2 canary mid-tier. Dispatches the leaf canary and relays its answer. Not for real work.
mode: subagent
hidden: true
temperature: 0.1
steps: 4
permission:
  bash: deny
  edit: deny
  task:
    "*": deny
    "_v2-leaf": allow
---
When invoked, use the task tool to call @_v2-leaf and return exactly what it returns. Never dispatch yourself. Never re-dispatch the task you were given.
```

- [ ] **Step 3: Create the top canary** — `agents/_v2-spec.md`:

```markdown
---
description: v2 canary top-tier. Dispatches the mid canary and relays its answer. Not for real work.
mode: subagent
hidden: true
temperature: 0.1
steps: 4
permission:
  bash: deny
  edit: deny
  task:
    "*": deny
    "_v2-impl": allow
---
When invoked with "chain", use the task tool to call @_v2-impl and return exactly what it returns. When invoked with "blocked", attempt to call @_v2-leaf via the task tool and report verbatim whether the tool call was available/succeeded. Never dispatch yourself. Never re-dispatch the task you were given.
```

- [ ] **Step 4: Commit** — `git add agents/_v2-*.md && git commit -m "test(canary): add v2 dispatch-probe canary agents"`

### Task 2: Dispatch probe script (probes a, b, c)

**Files:**
- Create: `scripts/dev/canaries/v2-dispatch-probe.mjs`

- [ ] **Step 1: Write the probe** (pattern copied from `scripts/dev/canaries/t2-depth.mjs`):

```javascript
#!/usr/bin/env node
/**
 * v2-dispatch-probe.mjs — spec "OpenCode Dispatch Constraint" probes (a)-(c).
 * (a) depth-2: primary -> _v2-impl -> _v2-leaf
 * (b) depth-3: primary -> _v2-spec -> _v2-impl -> _v2-leaf
 * (c) deny-enforcement: _v2-spec attempting _v2-leaf (denied) must fail
 * Exit 0 = all pass; exit 8 = depth-3 failed (fall back to hub-and-spoke);
 * exit 9 = deny-enforcement failed (BLOCKER: do not ship specialist dispatch).
 */
import { execFileSync } from 'node:child_process';

function run(prompt) {
  try {
    return execFileSync('opencode',
      ['run', '--dangerously-skip-permissions', prompt],
      { encoding: 'utf8', timeout: 240000 });
  } catch (e) {
    return `ERR:${(e.stderr || e.message || String(e)).slice(0, 400)}`;
  }
}

const d2 = run('Use the task tool to call @_v2-impl. Return exactly what it returns.');
const d3 = run('Use the task tool to call @_v2-spec with the word "chain". Return exactly what it returns.');
const dn = run('Use the task tool to call @_v2-spec with the word "blocked". Return exactly what it reports.');

const out = {
  a_depth2: /V2_LEAF_OK/.test(d2),
  b_depth3: /V2_LEAF_OK/.test(d3),
  c_deny_enforced: !/V2_LEAF_OK/.test(dn),
  samples: { d2: d2.slice(0, 300), d3: d3.slice(0, 300), dn: dn.slice(0, 300) },
};
console.log(JSON.stringify(out, null, 2));
process.exit(!out.c_deny_enforced ? 9 : out.b_depth3 && out.a_depth2 ? 0 : 8);
```

- [ ] **Step 2: Run it** — `bun scripts/dev/canaries/v2-dispatch-probe.mjs`. Expected: exit 0 with all three booleans true. Exit 8 → record verdict and set the hub-and-spoke fallback flag in RESULTS.md (Task 4); the plan continues either way. Exit 9 → STOP and escalate to the user: the DAG containment assumption is broken.
- [ ] **Step 3: Commit** — `git commit -am "test(canary): v2 dispatch probes a-c"`

### Task 3: Dispatch graph lint (probe d)

**Files:**
- Create: `scripts/lint-dispatch-graph.mjs`
- Test: `scripts/tests/dispatch-graph.test.mjs`

- [ ] **Step 1: Write the failing test:**

```javascript
import { test, expect } from 'bun:test';
import { analyzeGraph } from '../lint-dispatch-graph.mjs';

test('detects cycle', () => {
  const agents = {
    a: { task: { b: 'allow' }, perms: {} },
    b: { task: { a: 'allow' }, perms: {} },
  };
  expect(analyzeGraph(agents, 'a').errors.join(' ')).toContain('cycle');
});

test('flags ask reachable at depth >= 2', () => {
  const agents = {
    root: { task: { mid: 'allow' }, perms: {} },
    mid: { task: { deep: 'allow' }, perms: {} },
    deep: { task: {}, perms: { webfetch: 'ask' } },
  };
  const r = analyzeGraph(agents, 'root');
  expect(r.errors.join(' ')).toContain('ask');
});

test('flags path length > 3', () => {
  const agents = {
    r: { task: { a: 'allow' }, perms: {} },
    a: { task: { b: 'allow' }, perms: {} },
    b: { task: { c: 'allow' }, perms: {} },
    c: { task: { d: 'allow' }, perms: {} },
    d: { task: {}, perms: {} },
  };
  expect(analyzeGraph(agents, 'r').errors.join(' ')).toContain('depth');
});

test('clean DAG passes', () => {
  const agents = {
    r: { task: { a: 'allow' }, perms: {} },
    a: { task: { w: 'allow' }, perms: {} },
    w: { task: {}, perms: {} },
  };
  expect(analyzeGraph(agents, 'r').errors).toEqual([]);
});
```

- [ ] **Step 2: Run to verify fail** — `bun test scripts/tests/dispatch-graph.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement** `scripts/lint-dispatch-graph.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Probe (d): static lint of the agent dispatch graph.
 * From the root agent, walk permission.task allow edges and assert:
 *   1. acyclic, 2. max path length 3 below root,
 *   3. no `ask`-valued permission on any agent reachable at depth >= 2.
 * CLI: bun scripts/lint-dispatch-graph.mjs [--root kantoku--workflow-director]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function analyzeGraph(agents, root) {
  const errors = [];
  const seenDepth = new Map();
  const walk = (name, depth, path) => {
    if (path.includes(name)) { errors.push(`cycle: ${[...path, name].join(' -> ')}`); return; }
    if (depth > 3) { errors.push(`depth ${depth} > 3 at ${[...path, name].join(' -> ')}`); return; }
    const agent = agents[name];
    if (!agent) return;
    if (depth >= 2) {
      for (const [perm, val] of Object.entries(flatten(agent.perms))) {
        if (val === 'ask') errors.push(`ask-valued permission "${perm}" on ${name} reachable at depth ${depth}`);
      }
    }
    if (seenDepth.get(name) <= depth) return;
    seenDepth.set(name, depth);
    for (const [target, val] of Object.entries(agent.task ?? {})) {
      if (target !== '*' && val === 'allow') walk(target, depth + 1, [...path, name]);
    }
  };
  walk(root, 0, []);
  return { errors };
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

export function loadAgentsFromDir(dir) {
  const agents = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const m = src.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const name = f.replace(/\.md$/, '');
    const task = {};
    const perms = {};
    let inPerm = false; let inTask = false;
    for (const line of m[1].split('\n')) {
      if (/^permission:\s*$/.test(line)) { inPerm = true; inTask = false; continue; }
      if (inPerm && /^  task:\s*$/.test(line)) { inTask = true; continue; }
      if (inPerm && /^  \w/.test(line)) inTask = false;
      if (!/^\s/.test(line)) { inPerm = false; inTask = false; }
      const kv = line.match(/^\s+"?([@\w*.\- /]+)"?:\s*(allow|ask|deny)\s*$/);
      if (!kv) continue;
      const key = kv[1].replace(/^@/, '');
      if (inTask) task[key] = kv[2];
      else if (inPerm) perms[key] = kv[2];
    }
    agents[name] = { task, perms };
  }
  return agents;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > -1 ? process.argv[rootArg + 1] : 'kantoku--workflow-director';
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents');
  const { errors } = analyzeGraph(loadAgentsFromDir(dir), root);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('dispatch graph OK');
}
```

- [ ] **Step 4: Run tests** — `bun test scripts/tests/dispatch-graph.test.mjs` → 4 pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(scripts): dispatch-graph lint (probe d)"`

### Task 4: Record probe results, remove canaries

**Files:**
- Modify: `scripts/dev/canaries/RESULTS.md`
- Delete: `agents/_v2-*.md`

- [ ] **Step 1:** Append an `## A5: v2 dispatch probes (a)-(d)` section to RESULTS.md with the JSON output from Task 2, the lint status from Task 3, date, opencode version (`opencode --version`), and the branch decision: depth-3 pass → specialist-to-specialist edges ship as spec'd; depth-3 fail → all cross-specialist edges route hub-and-spoke through `kantoku` (state machines unchanged).
- [ ] **Step 2:** `git rm agents/_v2-leaf.md agents/_v2-impl.md agents/_v2-spec.md`
- [ ] **Step 3: Commit** — `git commit -am "docs(canary): record A5 v2 dispatch probe results"`

### Task 5: Fleet cut — move 12, retire 11

**Files:**
- Move to `future-work/agents/`: `shiranui--migration-guide.md`, `enma--compliance-judge.md`, `daidarabotchi--infra-shaper.md`, `tsukuyomi--spec-oracle.md`, `yumemi--story-smith.md`, `mujina--brand-shapeshifter.md`, `sojobo--system-strategist.md`, `chizu--implementation-planner.md`, `kotodama--prose-polisher.md`, `tengu--visual-artisan.md`, `mizuchi--data-current.md`, `tanuki--codemod-runner.md`
- Delete from `agents/`: `azukiarai--data-sifter.md`, `henge--format-shifter.md`, `karakuri--command-runner.md`, `soroban--number-sage.md`, `yamabiko--source-echo.md`, `makimono--docs-scribe.md`, `kagami--truth-mirror.md`, `jorogumo--synthesis-weaver.md`, `mikoshi--code-pathfinder.md`, `tanuki--general-trickster.md`, `karasutengu--docs-scout.md`

- [ ] **Step 1:** `git mv` each of the 12 files above into `future-work/agents/` (dir already exists).
- [ ] **Step 2:** `git rm` each of the 11 retired files.
- [ ] **Step 3:** Verify survivors: `ls agents/` must show exactly `bakeneko--bug-hunter.md`, `daikoku--finance-steward.md`, `fudo--security-guardian.md`, `hanko--git-seal.md`, `oni--red-team-reviewer.md`, `tsuchigumo--research-weaver.md`, `tsukumogami--code-forgemaster.md`.
- [ ] **Step 4: Commit** — `git commit -m "refactor(fleet)!: v2 hard cut — 12 agents to future-work, 11 retired"`

### Task 6: Scrub retired names from survivors

**Files:**
- Modify: all 7 files in `agents/`

- [ ] **Step 1:** `grep -n "azukiarai\|henge--\|karakuri\|soroban\|yamabiko\|makimono\|kagami--truth-mirror\|jorogumo\|mikoshi\|tanuki--\|karasutengu" agents/*.md` — list every hit.
- [ ] **Step 2:** In each surviving agent file: replace retired names in `permission.task` allow-lists and `permitted_subagents` manifests with a single `general: allow` entry (dedupe); replace prose references per this map — execution/extraction/formatting/math (`karakuri`, `azukiarai`, `henge`, `soroban`) → `general` (worker); fact-check (`kagami--truth-mirror`) → `kagami--verifier`; synthesis (`jorogumo`) → the owner's own SYNTHESIS state; retrieval (`yamabiko`) → `general`; code recon (`mikoshi`) → `explore`; docs lookup (`karasutengu`) → `scout`; escape hatch (`tanuki--general-trickster`) → `general`.
- [ ] **Step 3:** Re-run the Step 1 grep → zero hits. Commit — `git commit -am "refactor(fleet): scrub retired agent names from survivors"`

### Task 7: Built-in overrides — general (worker), explore, scout

**Files:**
- Create: `agents/general.md`, `agents/explore.md`, `agents/scout.md`

- [ ] **Step 1:** `agents/general.md` — exactly the spec's Worker Agent block with the model resolved:

```markdown
---
description: >
  Harness worker: menial, atomic, no-judgment execution. Use for bulk structured
  extraction, bulk format rendering, running a bounded command/script/test and
  returning output faithfully, applying a pre-approved patch, single-file
  boilerplate edits. The only agent with unscoped bash.
mode: subagent
model: opencode-go/mimo-v2.5
temperature: 0.1
steps: 6
permission:
  bash: allow
  edit: allow
  task: deny
  webfetch: deny
  websearch: deny
---
You execute exactly what you are given and return results faithfully: stdout,
stderr, exit code, extracted fields, or formatted output. You do not interpret,
synthesize, infer missing values, or make judgment calls. If the brief is
ambiguous or the task requires judgment, stop and return what you have plus a
one-line reason instead of guessing. Never dispatch yourself. Never re-dispatch
the task you were given.
```

- [ ] **Step 2:** `agents/explore.md` — keep built-in behavior, fold in mikoshi's read-only recon contract:

```markdown
---
description: >
  Read-only local code recon: file/symbol maps, call paths, working examples,
  ownership seams, test surfaces. Returns findings tables, no synthesis, no edits.
mode: subagent
temperature: 0.1
permission:
  edit: deny
  bash: deny
  task: deny
---
You are the local recon subagent. Return a compact findings table (Area | Files |
Existing Pattern | Why Relevant). Cite exact paths and line ranges. Do not propose
fixes, do not synthesize conclusions, do not edit. Never dispatch yourself.
```

- [ ] **Step 3:** `agents/scout.md` — fold in karasutengu's external-docs contract: same frontmatter shape as explore (mode subagent, edit/bash/task deny except `bash: { "ctx7 *": allow, "gh *": allow, "*": deny }`), prompt: external docs/dependency/upstream recon; prior-art/build-vs-buy output block from the spec ("Existing option found: yes/no ..."); versioned docs via `ctx7`, upstream via `gh`; findings table (Source | Tool | Version/Date | Finding | Relevance); no synthesis, no edits.
- [ ] **Step 4:** Behavioral override check (spec Risk #2): `opencode run --agent general --dangerously-skip-permissions "State your operating rules in one line."` → output must reflect the worker prompt (execute-faithfully phrasing). If the override does not take effect, record it in RESULTS.md and add equivalent `agent.general` blocks to `config/opencode.jsonc` (model, permission) as the fallback — the prompt line then ships via `opencode.jsonc` `instructions` addendum instead.
- [ ] **Step 5: Commit** — `git commit -am "feat(fleet): built-in overrides — general worker, explore, scout"`

### Task 8: Interim fleet manifest, config, and tests green

> Interim scaffolding only: `fleet-manifest.json` and the installer path keep dev/test flows green through Parts 1-6 and are retired in Part 7 (Task 40) when the npm package becomes the delivery mechanism.

**Files:**
- Modify: `config/fleet-manifest.json` (agents-core component), `config/opencode.jsonc`, `scripts/tests/agents-match-manifest.test.mjs`, `scripts/tests/agent-fleet-integrity.test.mjs`, `scripts/tests/agent-reference-integrity.test.mjs`, `scripts/lib/agent-fleet-map.mjs`, `config/AGENTS.md`

- [ ] **Step 1:** In `config/fleet-manifest.json`, replace the `agents-core` `files` array's `agents/*.md` entries with exactly: the 7 survivors + `agents/general.md`, `agents/explore.md`, `agents/scout.md` (keep `config/opencode.jsonc` and `config/AGENTS.md` entries). Update `label` to `"Specialist Agents (v2 interim)"` and rewrite `description` to name the interim fleet and reference the v2 spec.
- [ ] **Step 2:** In `config/opencode.jsonc`: delete `agent.*` model-override entries for all 23 moved/retired agents; add `agent.general.model: "opencode-go/mimo-v2.5"`.
- [ ] **Step 3:** Update `scripts/lib/agent-fleet-map.mjs` and the three fleet tests so the expected agent set is the interim list from Step 1. Where tests encode specialist/subagent tier counts, replace with a single authoritative array imported from `agent-fleet-map.mjs` so Parts 2-6 only edit one place.
- [ ] **Step 4:** In `config/AGENTS.md`, replace the fleet-size sentence and the two delegation tables with an interim note: "v2 migration in progress — see `docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md`. Current fleet: 7 carried-over specialists/subagents + overridden `general`/`explore`/`scout`." (Full rewrite happens in Part 6.)
- [ ] **Step 5:** `bun test` → all green. Fix any test still referencing retired names.
- [ ] **Step 6: Commit** — `git commit -am "refactor(fleet): interim v2 manifest, config, tests green"`

---

## Part 2 — Core Workflow Agents + Config

Deliverable: all Workflow #1 agents exist with the spec's permission DAG and scoped carve-outs; `routing-manifest.json` v10 and `opencode.jsonc` match; dispatch lint passes against the real graph; `manifest-schema.md` and `rules/` rewritten.

### Task 9: routing-manifest.json v10

**Files:**
- Modify: `docs/routing-manifest.json`

- [ ] **Step 1:** Rewrite the per-agent map to the v2 fleet, preserving the existing top-level schema shape (`migawari.js` reads it at runtime — do not change field names). Initial assignment (subject to OPERATOR budget review; reserved models keep their ≤1-primary cap):

| Agent | Primary model | First fallback |
|---|---|---|
| `kantoku--workflow-director` | `opencode-go/kimi-k2.6` | `opencode-go/kimi-k2.5` |
| `kyakuhon--spec-planner` | `opencode-go/qwen3.6-plus` | `opencode-go/glm-5` |
| `tsukumogami--code-forgemaster` | `opencode-go/kimi-k2.5` | `opencode-go/glm-5.1` |
| `fudo--security-guardian` | `opencode-go/kimi-k2.6` | `opencode-go/deepseek-v4-pro` |
| `tsuchigumo--research-weaver` | `opencode-go/kimi-k2.5` | `opencode-go/glm-5` |
| `daikoku--finance-steward` | `opencode-go/qwen3.7-max` (reserved) | `opencode-go/kimi-k2.5` |
| `kagami--verifier` | `openai/gpt-5.4-mini` | `opencode-go/deepseek-v4-flash` |
| `hanko--git-seal` | `openai/gpt-5.4-mini` | `opencode-go/mimo-v2.5` |
| `hansei--lesson-keeper` | `opencode-go/glm-5` | `opencode-go/minimax-m2.7` |
| `kura--knowledge-banker` | `opencode-go/deepseek-v4-flash` | `opencode-go/minimax-m2.7` |
| `bakeneko--bug-hunter` | `opencode-go/deepseek-v4-pro` | `opencode-go/kimi-k2.5` |
| `oni--red-team-reviewer` | `openai/gpt-5.5` (reserved) | `google-vertex/gemini-3.1-pro-preview` (reserved-as-fallback) |
| `general` (worker tier) | `opencode-go/mimo-v2.5` | `opencode-go/minimax-m2.7` |
| `explore` / `scout` | `opencode-go/qwen3.6-plus` | `opencode-go/minimax-m2.7` |

- [ ] **Step 2:** Bump the manifest version field to `v10`; remove all retired/moved agent entries. Run `bun test scripts/tests/routing-manifest.test.mjs scripts/tests/model-failover.test.mjs scripts/tests/model-resolve.test.mjs` and update expected fixtures to the v10 map.
- [ ] **Step 3: Commit** — `git commit -am "feat(routing): manifest v10 — v2 fleet tiers incl. worker"`

### Task 10: kantoku--workflow-director

**Files:**
- Create: `agents/kantoku--workflow-director.md`

- [ ] **Step 1:** Create the file with exactly the spec's "Agent Markdown Shape" frontmatter (mode `primary`, temperature 0.2, scoped bash `"bun scripts/workflow-state.mjs *": allow` / `"*": deny`, the 14-entry task allow-list, `question: ask`, skill allow-list `brainstorming`/`writing-plans` — no `name:`, no `todowrite:`). Prompt body must cover, in order: (1) intent triage into Workflows #1-#5 per each workflow's Trigger line in the spec; (2) state initialization via `workflow-state.mjs init` and advancing at every phase boundary; (3) the dispatch policy — DAG edges only, depth cap 3, depth ≥2 non-interactive, RoutePacket handling; (4) user-facing states it owns (`RECEIVED`, `ROUTED`, WF5 `INTENT_CLASSIFY`/`MODE_SELECTION`/`DIRECT_OPERATION`, all `BLOCKED_CLARIFY` arbitration, closing-prompt consolidation); (5) the anti-recursion line: "Never dispatch yourself. Never re-dispatch the task you were given."
- [ ] **Step 2:** `bun scripts/lint-dispatch-graph.mjs` → will FAIL (targets missing) — expected until Task 14; note and continue.
- [ ] **Step 3: Commit** — `git commit -am "feat(agents): kantoku--workflow-director (v2 primary)"`

### Task 11: kyakuhon--spec-planner

**Files:**
- Create: `agents/kyakuhon--spec-planner.md`

- [ ] **Step 1:** Frontmatter: `mode: all`, temperature 0.3, `question: ask`, `bash: deny`, edit scoped `{".opencode/tmp/**": allow, "docs/superpowers/**": allow, "*": deny}`, task `{"*": deny, explore: allow, scout: allow, general: allow, tsukumogami--code-forgemaster: allow}`. Prompt: owns `DISCUSSION_MEMORY_READ` → `SPEC_DRAFT` → `USER_SCOPE_REVIEW` → `RECON` merge → `PLAN_DRAFT` → `USER_PLAN_REVIEW` → `IMPLEMENT_ANALYSIS`/`FIX_ANALYSIS` routing per the spec's Routing rules table; artifact contracts (scope.md, recon-packet.md, plan file, implementation-analysis.md — exact schemas are in the spec, reference them); dispatches per its allow-list; returns RoutePacket for anything else; anti-recursion line.
- [ ] **Step 2: Commit** — `git commit -am "feat(agents): kyakuhon--spec-planner"`

### Task 12: kagami--verifier + hansei--lesson-keeper

**Files:**
- Create: `agents/kagami--verifier.md`, `agents/hansei--lesson-keeper.md`

- [ ] **Step 1:** `kagami--verifier.md`: `mode: subagent`, temperature 0.1, bash scoped `{"bun scripts/verify-run.mjs *": allow, "bun scripts/workflow-state.mjs *": allow, "bun scripts/citation-verify.mjs *": allow, "*": deny}`, edit scoped `{".opencode/tmp/**": allow, "*": deny}`, task `{"*": deny, general: allow}`. Prompt: owns `VERIFY`/`CITATION_VERIFY`/`MODEL_VALIDATE`-class states; evidence capture (command, exit code, output, timestamp); verdict vocabulary `ok`/`warn`/`critical`/`blocked`; loop-cap bookkeeping (3 verify rounds, then report cap-hit upward); routes failures to fix analysis, never edits code; heavier execution via `general`; anti-recursion line.
- [ ] **Step 2:** `hansei--lesson-keeper.md`: `mode: subagent`, `bash: deny`, `task: deny`, edit scoped `{"docs/learnings/**": allow, "docs/postmortems/**": allow, "docs/security/**": allow, "docs/verification/**": allow, "*": deny}`. Prompt: reads `.opencode/tmp/<workflow-id>/` artifacts on user opt-in, distills durable topic-first files per the spec's Learning Stage table, never maintains finance facts (kura's job), anti-recursion line.
- [ ] **Step 3: Commit** — `git commit -am "feat(agents): kagami--verifier, hansei--lesson-keeper"`

### Task 13: Update carried-over subagents (hanko, bakeneko, oni)

**Files:**
- Modify: `agents/hanko--git-seal.md`, `agents/bakeneko--bug-hunter.md`, `agents/oni--red-team-reviewer.md`

- [ ] **Step 1:** `hanko--git-seal.md`: set bash to `{"git *": allow, "gh *": allow, "*": deny}`, `edit: deny`, `task: deny`, keep `question: ask` for mutating ops. Prompt additions: the canonical finish-gate routing table from the spec's "Git Checkpoints" (returns route recommendations, never dispatches); checkpoint-commit policy; no force-push/no master rules (already present — verify).
- [ ] **Step 2:** `bakeneko--bug-hunter.md`: confirm `task: deny`, `edit: deny`, `bash: deny`; prompt returns the spec's ExecutionPacket YAML shape; add anti-recursion line.
- [ ] **Step 3:** `oni--red-team-reviewer.md`: confirm read-only + `task: deny`; prompt covers REVIEW across WF #1/#2/#3/#5, findings table output, 2-blocked-rounds cap awareness; anti-recursion line.
- [ ] **Step 4: Commit** — `git commit -am "refactor(agents): v2 contracts for hanko, bakeneko, oni"`

### Task 14: Specialist permission blocks + kura placeholder

**Files:**
- Modify: `agents/tsukumogami--code-forgemaster.md`, `agents/fudo--security-guardian.md`, `agents/tsuchigumo--research-weaver.md`, `agents/daikoku--finance-steward.md`
- Create: `agents/kura--knowledge-banker.md` (minimal; full prompt in Part 6)

- [ ] **Step 1:** Set each specialist's frontmatter to its Specialist Delegation Model row: tsukumogami `{general}` + unscoped edit; fudo `{explore, scout, general, tsukumogami--code-forgemaster, kagami--verifier}` + edit `{".opencode/tmp/**", "docs/security/**"}`; tsuchigumo `{general, kagami--verifier}` + bash `{"notebooklm *": allow, "*": deny}` + edit `{".opencode/tmp/**", "docs/research/**"}` + the depth-conditional prompt rule ("if dispatched by another specialist, dispatch only general; return citation checks upward"); daikoku `{general, kura--knowledge-banker, tsuchigumo--research-weaver, kagami--verifier}` + edit `{".opencode/tmp/**", "research/financial/**"}`. All `mode: all`, all get the anti-recursion line.
- [ ] **Step 2:** `agents/kura--knowledge-banker.md`: `mode: subagent`, `task: deny`, bash `{"bun scripts/knowledge-bank-finance.mjs *": allow, "bun scripts/finance-artifact-registry.mjs *": allow, "*": deny}`, edit `{"research/financial/**": allow, "docs/knowledge/finance/**": allow, "*": deny}`, description per spec Layer 3; two-line prompt stub noting Part 6 completes it.
- [ ] **Step 3:** `bun scripts/lint-dispatch-graph.mjs` → `dispatch graph OK` (real graph now complete: acyclic, depth ≤3, no ask at depth ≥2). If it flags an ask: the flagged agent keeps `question: ask` only if it is never reachable at depth ≥2 from kantoku; otherwise change that permission to deny and route the question upward via RoutePacket.
- [ ] **Step 4:** Update `scripts/lib/agent-fleet-map.mjs` expected set (+5 new agents); `bun test` green. Commit — `git commit -am "feat(agents): v2 permission DAG complete; kura stub"`

### Task 15: opencode.jsonc + fleet-manifest final agent wiring

**Files:**
- Modify: `config/opencode.jsonc`, `config/fleet-manifest.json`

- [ ] **Step 1:** `opencode.jsonc`: add `agent.<name>.model` entries per routing-manifest v10 for all 15 v2 agents; mirror `permission.task` blocks for `kantoku--workflow-director` and `kyakuhon--spec-planner` exactly as in the spec's config examples (frontmatter is not source of truth for models — keep the existing comment).
- [ ] **Step 2:** `fleet-manifest.json` agents-core: full v2 file list (12 agent files + general/explore/scout overrides + config files); label `"Workflow Fleet (v2)"`. (Interim — retired in Task 40. The repo-local `opencode.jsonc` remains the dogfooding/dev config; Part 7's `config` hook is generated from the same sources — agent `.md` files + routing-manifest v10 — with a parity test asserting the hook injects what `opencode.jsonc` declares.)
- [ ] **Step 3:** `bun test` green; `bun scripts/lint-dispatch-graph.mjs` OK. Commit — `git commit -am "feat(config): v2 agent wiring in opencode.jsonc + fleet manifest"`

### Task 16: rules/ + manifest-schema rewrite

**Files:**
- Create: `rules/contracts.md`, `rules/model-budget.md`
- Modify: `docs/manifest-schema.md`

- [ ] **Step 1:** `rules/contracts.md`: define `RoutePacket` (`from`, `found_at_state`, `work_kind`, `suggested_owner`, `artifacts[]`, `blocking: yes/no`, `user_decision_needed`) and carry over the ExecutionPacket YAML from the spec verbatim; one page, flat markdown (always-on rule file — keep it short).
- [ ] **Step 2:** `rules/model-budget.md`: reserved-model caps (4 reserved models, each primary ≤1 + first-fallback ≤1), costly-model list, pointer to routing-manifest v10 — condensed from old `config/AGENTS.md` Model Budget section.
- [ ] **Step 3:** Rewrite `docs/manifest-schema.md`: drop `permitted_subagents`-as-source; new rule — the spec's Specialist Delegation Model table is the source for `permission.task`; document scoped bash/edit carve-outs schema and the depth/ask lint as the enforcement mechanism; keep `max_ralph_iterations` (3) and `gate_scripts` documentation.
- [ ] **Step 4:** `bun test` green. Commit — `git commit -am "docs(rules): v2 contracts, model budget, manifest schema"`

---

## Part 3 — Skills Pipeline

Deliverable: external skills pulled+patched deterministically; our addendum/native skills present and frontmatter-valid; a manifest test guards the whole set.

### Task 17: Skills manifest + pull script

**Files:**
- Create: `config/skills-manifest.json`, `scripts/pull-external-skills.mjs`
- Test: `scripts/tests/skills-manifest.test.mjs`

- [ ] **Step 1:** `config/skills-manifest.json` — pinning policy is **commit-SHA pinned with manual bump** (spec Risk #3 decision):

```json
{
  "install_target": "~/.config/opencode/skills",
  "sources": [
    { "repo": "obra/superpowers", "pin": "<latest SHA at implementation time>",
      "skills": ["brainstorming","writing-plans","executing-plans","test-driven-development","requesting-code-review","receiving-code-review","subagent-driven-development","dispatching-parallel-agents","finishing-a-development-branch","using-git-worktrees","using-superpowers","handoff","systematic-debugging","to-prd","to-issues","triage","grill-me","grill-with-docs","security-review","prototype","impeccable","humanizer","zoom-out"] },
    { "repo": "mattpocock/skills", "pin": "<SHA>", "skills": ["codebase-design","diagnose","improve-codebase-architecture"] },
    { "repo": "addyosmani/agent-skills", "pin": "<SHA>", "skills": ["incremental-implementation","code-simplification","code-review-and-quality"] }
  ],
  "patches_dir": "harnesses/opencode/skill-patches"
}
```

Resolve each `<SHA>` with `gh api repos/<repo>/commits/HEAD --jq .sha` at execution time and record it.

- [ ] **Step 2:** Failing test: manifest parses; every `skills[]` name is unique across sources; `install_target` and `pin` fields present; each patch file in `patches_dir` names a skill that exists in the manifest. Run → FAIL.
- [ ] **Step 3:** `scripts/pull-external-skills.mjs`: `--check` (verify pins reachable via `gh api`, list drift against installed copies) and `--pull` (shallow-clone each repo at pin into a temp dir, copy only listed skill dirs into `install_target`, write a `receipt.json` with repo/pin/date per skill). Reuse `scripts/lib/jsonc.mjs` for config reads. Implement until the Step 2 test passes.
- [ ] **Step 4:** `bun test scripts/tests/skills-manifest.test.mjs` → PASS. Commit — `git commit -am "feat(skills): manifest + pinned external pull script"`

### Task 18: Patch applier

**Files:**
- Create: `scripts/apply-patches.mjs`, `skill-patches/README.md`

- [ ] **Step 1:** `apply-patches.mjs`: applies unified diffs from `skill-patches/<skill-name>/*.patch` onto the installed skill copies via `git apply --directory <install_target>/<skill> --check` then apply; idempotent (skip when already applied, detect via `--reverse --check`); `--dry-run` flag. `skill-patches/README.md` documents the layout and the rule: patches must survive a pin bump or be regenerated.
- [ ] **Step 2:** Test with a fixture patch against a temp dir (create fixture skill file, patch it, assert content, re-run for idempotency). Add to `scripts/tests/skills-manifest.test.mjs`. PASS → commit `git commit -am "feat(skills): patch applier with idempotency"`

### Task 19: Our-created + addendum skills inventory

**Files:**
- Verify/Create under repo root `/skills/`: the 5 addendum skills (`writing-plans-furaide-addendum`, `test-driven-development-furaide-addendum`, `requesting-code-review-furaide-addendum`, `verification-before-completion-furaide-addendum`, `handoff-furaide-addendum`) and the wired natives (`post-mortem`, `regression-test-recipe`, `mcp-supply-chain-scan`, `domain-scope-card`, `evidence-matrix`, `deep-research-outline`, `earnings-10k-extraction`, `dcf-valuation-model`)

- [ ] **Step 1:** `ls /d/Everything/Furaidē/skills/` — diff against the list above. For each missing skill, create `SKILL.md` with valid Agent Skills frontmatter (`name`, `description` with trigger conditions) and body per its one-line purpose in the spec's skills tables. Do **not** create the not-yet-wired skills (`long-running-harness`, `compaction-context`, `session-progress-detector`, `architect-adr`, `deal-research-due-diligence`, education/cyber sets) unless they already exist — spec keeps them deferred.
- [ ] **Step 2:** Add a frontmatter-validation test (name matches dir, description non-empty, no undocumented fields) over `/skills/*/SKILL.md` to `scripts/tests/skills-manifest.test.mjs`. PASS.
- [ ] **Step 3: Commit** — `git commit -am "feat(skills): v2 addendum + native skill set validated"`

### Task 20: Skills sync contract (consumed by the Part 7 bootstrap)

**Files:**
- Create: `scripts/sync-skills.mjs`
- Test: extend `scripts/tests/skills-manifest.test.mjs`

- [ ] **Step 1:** `scripts/sync-skills.mjs`: idempotent sync of bundled `/skills/*` (our-created + addendum set from Task 19) into `~/.config/opencode/skills/`, writing a `furaide-skills-receipt.json` (package version, skill list, date); skips when receipt version matches; `--force` re-syncs; `--dry-run` lists actions. External skills remain opt-in via `pull-external-skills.mjs` (Task 17) — sync-skills prints the opt-in hint when they're absent. This script is the single skills-delivery mechanism: Part 7's plugin bootstrap calls it at startup, and dev flows call it directly.
- [ ] **Step 2:** Test against a temp HOME: first run copies + writes receipt; second run no-ops; `--force` re-copies. PASS → commit `git commit -am "feat(skills): idempotent sync-skills bootstrap"`

---

## Part 4 — Plugins + State Scripts

Deliverable: bucketed plugin layout loading in order; nurikabe on a verified hook; new audit-logger and compaction-injector plugins; workflow-state phases for WF1-5; unified security-severity vocabulary.

### Task 21: Plugin bucket restructure

**Files:**
- Move: `plugins/nio.js` → `plugins/gates/nio.js`, `plugins/nurikabe.js` → `plugins/gates/nurikabe.js`, `plugins/komainu.js` → `plugins/gates/komainu.js`, `plugins/migawari.js` → `plugins/failover/migawari.js`, `plugins/web-tools.ts` → `plugins/tools/web-tools.ts` (and `plugins/web-tools/` → `plugins/tools/web-tools/`)
- Modify: `config/opencode.jsonc` plugin array, `config/fleet-manifest.json` (workflow-gates/failover/security-gate/web-tools components), `scripts/register-web-tools-plugin.mjs`, any relative imports inside moved files

- [ ] **Step 1:** `git mv` per the list; fix `web-tools.ts`'s relative imports of `./web-tools/*` → `./web-tools/*` (unchanged if dir moved alongside — verify with `bun build --no-bundle` or a syntax check).
- [ ] **Step 2:** Update `opencode.jsonc` plugin array to the spec's exact 7-entry order (gates/nio, gates/nurikabe, gates/komainu, failover/migawari, tools/web-tools, hooks/audit-logger, hooks/compaction-injector — the two hooks entries land in Task 23; add them here commented-out with a TODO-Task-23 marker). Update fleet-manifest file paths.
- [ ] **Step 3:** Grep for hardcoded flat plugin paths: `grep -rn "plugins/nio\|plugins/nurikabe\|plugins/komainu\|plugins/migawari\|plugins/web-tools" scripts/ config/ docs/ --include="*.mjs" --include="*.jsonc" --include="*.json"` and fix every hit. `workflow-state.mjs` resolution from bucket paths must keep working (spec verification item).
- [ ] **Step 4:** `bun test` green (installer/gate tests updated for new paths). Commit — `git commit -am "refactor(plugins): bucketed layout per v2 spec"`

### Task 22: Verify nurikabe hook event (spec Risk #1)

**Files:**
- Modify: `plugins/gates/nurikabe.js`

- [ ] **Step 1:** Fetch the documented plugin event list from `https://opencode.ai/docs/plugins/`. Identify the supported delivery/stop-equivalent event (candidates as of the spec date: `chat.message`/`session.idle`/`tool.execute.before`; `response.before` is NOT documented).
- [ ] **Step 2:** If `nurikabe.js` uses an undocumented event: rewire the delivery-block check onto the verified event, keeping its contract (block delivery when workflow verdict is `critical` or `warn-unresolved`). Record the chosen event and doc URL in the plugin header comment.
- [ ] **Step 3:** `bun test scripts/tests/delivery-gate.test.mjs scripts/tests/gate-enforcer.test.mjs` → PASS (update mocks to the new event name). Commit — `git commit -am "fix(nurikabe): verified hook event per v2 spec risk 1"`

### Task 23: New hook plugins — audit-logger, compaction-injector

**Files:**
- Create: `plugins/hooks/audit-logger.js`, `plugins/hooks/compaction-injector.js`
- Test: `scripts/tests/hooks-plugins.test.mjs`

- [ ] **Step 1:** Failing tests: audit-logger exports an OpenCode plugin function that, on `tool.execute.after` for `bash`/`task` tools, appends `{ts, agent, tool, args-summary, exit}` JSONL to the path from `scripts/state-path.mjs` (`audit.jsonl` sibling); compaction-injector on the compaction event injects active workflow-state summary (read via `workflow-state.mjs read`) into the compaction prompt. Mock the plugin context objects the same way `scripts/tests/gate-enforcer.test.mjs` mocks nio's.
- [ ] **Step 2:** Implement both (each ≤80 lines, follow `komainu.js`'s plugin export shape). Special attention: audit-logger must cover every `general` (worker) invocation — spec Risk #8.
- [ ] **Step 3:** Uncomment the two plugin entries in `opencode.jsonc` (Task 21 Step 2). `bun test` PASS. Commit — `git commit -am "feat(plugins): audit-logger + compaction-injector hooks"`

### Task 24: workflow-state.mjs v2 phases

**Files:**
- Modify: `scripts/workflow-state.mjs`
- Test: `scripts/tests/workflow-state.test.mjs`

- [ ] **Step 1:** Failing test additions: `init --workflow wf1` seeds the WF1 phase list; `advance --to` accepts exactly the spec's state names per workflow (WF1: RECEIVED…TMP_CLEANUP_OFFER incl. BLOCKED_CLARIFY; WF2 adds REPRO_ATTEMPT/…/ARCHITECTURE_QUESTION/REGRESSION_GUARD; WF3 adds SECURITY_* / RISK_ACCEPTANCE_REVIEW; WF4 research states; WF5 finance states with terminal `COMPLETE`); invalid transitions rejected per the spec's mermaid edges; gate subcommand enforces `max_ralph_iterations` 3 for verify loops, 2 for review loops.
- [ ] **Step 2:** Implement: add a `WORKFLOWS` const mapping workflow id → `{states, edges, caps}` transcribed 1:1 from the spec's five mermaid diagrams (this is the only place the diagrams get encoded — cite spec line anchors in comments). Keep CAS/exit-code behavior (0/1/2/5/9) untouched.
- [ ] **Step 3:** `bun test scripts/tests/workflow-state.test.mjs` PASS. Commit — `git commit -am "feat(state): v2 workflow phase maps + loop caps"`

### Task 25: security-severity.mjs unified vocabulary

**Files:**
- Modify: `scripts/security-severity.mjs`
- Test: `scripts/tests/gate-scripts.test.mjs`

- [ ] **Step 1:** Failing tests: emitted verdicts are exactly `ok|warn|critical|escalate`; `critical` requires `required_action` ∈ `fix-in-place|scout-alternative|accept-risk-pending-approval`; legacy values (`alternative-required`, `escalate-security`, `accepted-risk`) are rejected with a migration hint.
- [ ] **Step 2:** Implement; update all callers (`grep -rn "security-severity" scripts/ plugins/`). PASS → commit `git commit -am "feat(security): unified 4-tier severity vocabulary"`

---

## Part 5 — Workflows #1-#4 Wiring + Smoke Tests

Deliverable: WF1 (feature), WF2 (debug), WF3 (security), WF4 (research) run end-to-end against the state engine; specialist prompts carry their full state-table contracts; smoke tests recorded.

### Task 26: tsukumogami + WF1/WF2 implementation contract

**Files:**
- Modify: `agents/tsukumogami--code-forgemaster.md`

- [ ] **Step 1:** Prompt rewrite to the v2 contract: owns `COMPLEX_IMPLEMENT`/`PARALLEL_IMPLEMENT`/`SEQUENTIAL_IMPLEMENT` (and `*_FIX` twins); consumes implementation-analysis/fix-analysis artifacts; writes worker briefs to `.opencode/tmp/<workflow-id>/worker-briefs/`, dispatches `general` per brief, merges `worker-results/`; never runs commands (dispatch `general`); never self-verifies (`VERIFY_PREP` hands to `kagami--verifier`); simple-criteria table from the spec verbatim so it can bounce mis-routed simple units back; anti-recursion line.
- [ ] **Step 2: Commit** — `git commit -am "feat(agents): tsukumogami v2 implementation contract"`

### Task 27: fudo--security-guardian + WF3 wiring

**Files:**
- Modify: `agents/fudo--security-guardian.md`

- [ ] **Step 1:** Prompt rewrite: WF3 ownership (`SECURITY_SCOPE_READ` → … → `FINISH_READY`), adaptive-scope table from the spec (which states run per request type), tooling-readiness file list, tool-selection table (scanners run via `general` only), unified findings vocabulary with `required_action`, `RISK_ACCEPTANCE_REVIEW` is user-gated at depth ≤1, ownership boundary vs `hanko--git-seal` (fudo analyzes/fixes; hanko gates releases), delegation per its permission row; anti-recursion line. Scope note per spec Layer 2: application security only — no SecOps/agent-ecosystem governance language.
- [ ] **Step 2: Commit** — `git commit -am "feat(agents): fudo v2 security workflow contract"`

### Task 28: tsuchigumo--research-weaver + WF4 wiring

**Files:**
- Modify: `agents/tsuchigumo--research-weaver.md`

- [ ] **Step 1:** Prompt rewrite: WF4 ownership from `LIGHT_SCOPE` through `SYNTHESIS`/`DELIVERY`; research-brief gate (the spec's brief-items table — objective/scope/3 subquestions/query plan/mode/tool plan/budget/deliverable/stop criteria); research defaults table (3 queries, 5 results, 2-3 fetches, 2 gap rounds); source-confidence rules; tool order (native websearch/webfetch → plugin fallback; no tavily/brave/bx by default); NotebookLM allowed-command surface + auth predicate `{"status":"ok","checks":{"token_fetch":true}}` + disallowed destructive families (verbatim tables from spec); quick-answer path skips persistence/learn offers; depth-conditional rule (at depth 2 dispatch only `general`); anti-recursion line.
- [ ] **Step 2: Commit** — `git commit -am "feat(agents): tsuchigumo v2 research workflow contract"`

### Task 29: Workflow smoke tests

**Files:**
- Create: `scripts/tests/workflow-smoke.test.mjs`
- Modify: `scripts/dev/canaries/RESULTS.md`

- [ ] **Step 1:** Failing tests driving `workflow-state.mjs` through each workflow's happy path and one failure path, asserting legal/illegal transitions: WF1 RECEIVED→…→TMP_CLEANUP_OFFER + the verify-cap escalation (3rd VERIFY fail → BLOCKED_CLARIFY only); WF2 incl. HYPOTHESIS_TEST→ARCHITECTURE_QUESTION on 3rd loop; WF3 incl. FINDINGS_CLASSIFICATION→RISK_ACCEPTANCE_REVIEW and the critical-blocks-GIT_HANDOFF rule; WF4 incl. QUICK_ANSWER→DELIVERY→end; WF5 (engine-level only; agents come in Part 6) incl. GAP_LOOP 2-round cap and terminal COMPLETE.
- [ ] **Step 2:** Implement fixes in the Task 24 `WORKFLOWS` map until green. One live end-to-end probe: `opencode run --agent kantoku--workflow-director "trivial test: add a comment line to scripts/dev/canaries/RESULTS.md"` → verify it routes, dispatches, and asks before any git action. Record in RESULTS.md as `A6: v2 workflow smoke`.
- [ ] **Step 3: Commit** — `git commit -am "test(workflows): v2 state-machine smoke suite"`

---

## Part 6 — Workflow #5 Finance Suite + Docs Rewrite

Deliverable: WF5 agents/scripts operational; all fleet-coupled docs rewritten; final verification sweep. (Largest part — execute as three sub-batches with a commit each.)

### Task 30: daikoku + kura full contracts

**Files:**
- Modify: `agents/daikoku--finance-steward.md`, `agents/kura--knowledge-banker.md`

- [ ] **Step 1:** `daikoku`: WF5 ownership per the spec's states table (entry modes `quick_update`/`full_analysis`/`valuation_deep_dive` + 15 direct operations); ownership boundaries table (no inline shell/valuation math — `general` computes, `kagami--verifier` validates); `ASSUMPTION_LOCK` and `SOURCE_POLICY_GATE` are user-gated at depth ≤1; source-class order; persistence policy (auto/ask/never lists verbatim from spec); finance verification gates list; consolidated closing card (BANK_UPDATE + PERSISTENCE + LEARN + CLEANUP as one prompt); advice-boundary rule (research drafts, never trade instructions).
- [ ] **Step 2:** `kura`: full prompt — bank status card fields, artifact audit classifications (`reusable/stale/suspect/missing`), bank-entry required metadata (issuer, period, source URL, retrieved date, currency/unit, confidence, validation status, producing module), durable writes only after approval via its two scripts; curation only, no valuation math.
- [ ] **Step 3: Commit** — `git commit -am "feat(agents): daikoku + kura v2 finance contracts"`

### Task 31: Finance ledger scripts (JS)

**Files:**
- Create: `scripts/knowledge-bank-finance.mjs`, `scripts/finance-artifact-registry.mjs`, `scripts/finance-source-registry.mjs`
- Test: `scripts/tests/finance-ledgers.test.mjs`

- [ ] **Step 1:** Failing tests per script against a temp dir: `knowledge-bank-finance.mjs status|query|propose|write --subject <slug>` (write refuses without `--approved`; status emits the card fields; entries validate required metadata); `finance-artifact-registry.mjs audit|promote --subject <slug>` (audit classifies by age thresholds + validation status; promote copies tmp artifact to `research/financial/<slug>/` and ledgers it); `finance-source-registry.mjs add|list` (class/license/timestamp required). All JSON in/out, exit 0/1.
- [ ] **Step 2:** Implement (share a small `scripts/lib/finance-store.mjs` for the `research/financial/<slug>/` layout from the spec's durable-artifact table). PASS → commit `git commit -am "feat(finance): bank + registry ledger scripts"`

### Task 32: Finance compute scripts (Python, batch 1 — extract/normalize)

**Files:**
- Create: `scripts/finance/pyproject.toml` (uv project, deps: `arelle-release`, `pandas`, `pydantic`, `pint`), `scripts/finance/finance_xbrl_extract.py`, `scripts/finance/finance_statement_normalize.py`, `scripts/finance/finance_unit_normalize.py`, `scripts/finance/finance_corporate_actions.py`, `scripts/finance/tests/` (pytest fixtures)

- [ ] **Step 1:** Uniform CLI contract for every finance script: `uv run <script> --input <json> --output <json>`; output always `{ok: bool, data: {...}, errors: [...], provenance: {source_ids, retrieved, script, version}}`; deterministic (no network in compute scripts — extraction takes pre-fetched filings from the source manifest).
- [ ] **Step 2:** TDD each with a small fixture (one synthetic 10-K facts JSON): xbrl-extract maps facts→canonical concepts with period/unit/context; statement-normalize outputs canonical IS/BS/CF rows with sign/scale/source tags; unit-normalize handles currency/scale/share-count with explicit FX timestamp; corporate-actions applies split/dividend adjustment metadata. Pytest per script, then commit — `git commit -am "feat(finance): extraction/normalization scripts (batch 1)"`

### Task 33: Finance compute scripts (batch 2 — models) and (batch 3 — verification)

**Files:**
- Create: `scripts/finance/finance_ratio_compute.py`, `finance_comps_compute.py`, `finance_dcf_compute.py`, `finance_wacc_capm.py`, `finance_technical_indicators.py`, `finance_macro_transform.py` (batch 2); `finance_freshness_check.py`, `finance_cross_source_check.py`, `finance_model_validate.py` (batch 3)

- [ ] **Step 1 (batch 2, TDD each):** ratio/DuPont with tested numerator-denominator definitions; comps with peer medians/percentiles/outlier filter; DCF with terminal value + sensitivity grid + scenario table (numpy-financial); WACC/CAPM components; fixed-window technicals; macro transforms (YoY/MoM/z-score/lag). Fixture-driven, golden-value asserts. Commit per batch.
- [ ] **Step 2 (batch 3, TDD each):** freshness-check classifies artifacts `reusable/stale/suspect/missing` by source-class-specific age thresholds; cross-source-check flags disagreement/period misalignment on material numerics; model-validate runs the spec's checks (schema, range, reconciliation, monotonicity, share-count, unit) and fails with correction pointers (consumed by `MODEL_VALIDATE`'s failure branches). Commit — `git commit -am "feat(finance): model + verification scripts (batches 2-3)"`
- [ ] **Step 3:** Add a `finance` component to `fleet-manifest.json` (`scripts/finance/**` glob + the 3 JS ledgers, `requires_bun: false`, note `uv` requirement). Extend `scripts/tests/workflow-smoke.test.mjs` with WF5 agent-level smoke (BANK_STATUS card produced for a fixture subject). `bun test` + `uv run pytest scripts/finance/tests` green.

### Task 34: Docs rewrite — runtime pair

**Files:**
- Rewrite: `config/AGENTS.md`, `docs/workflows.md`

- [ ] **Step 1:** `config/AGENTS.md` full rewrite: identity (keep voice), v2 mission, intent triage routing to `kantoku--workflow-director` + WF1-5 triggers, the Specialist Delegation Model table (verbatim from spec), scoped-carve-outs summary, dispatch policy (DAG/depth-3/non-interactive-depth), state & gates section updated for v2 phase names, model budget pointer to routing-manifest v10, output discipline + web-tools sections carried over. Delete all old-fleet tables. This file ships inside the npm package as an `instructions` entry (Task 38) — write it for end users of the plugin, not for repo developers (harness-root `AGENTS.md` stays the repo-dev doc and is never packaged).
- [ ] **Step 2:** `docs/workflows.md` full rewrite: the five state machines (embed the spec's mermaid diagrams), phase/gate contract as encoded in Task 24, loop caps, artifact ledger paths, `BLOCKED_CLARIFY` resume rule, closing-prompt consolidation.
- [ ] **Step 3:** `bun test` green (playbook/doc-reference tests updated). Commit — `git commit -am "docs: v2 AGENTS.md + workflows.md rewrite"`

### Task 35: Docs rewrite — reference set + script dispositions

**Files:**
- Rewrite: `docs/architecture.md`, `docs/OPERATOR.md`, `docs/agent-description-rubric.md`, `README.md`, `docs/agent-template.md`
- Disposition: `scripts/voice-check.mjs`, `scripts/playbook-check.mjs`, `scripts/sql-safety-check.mjs`, `scripts/dev/agent-fleet-audit.mjs`

- [ ] **Step 1:** architecture.md → v2 file relationships (bucketed plugins, skills pipeline, finance suite, dispatch lint); OPERATOR.md → v10 budget/tiers incl. worker tier; rubric + agent-template → v2 frontmatter shape (no `name`, scoped permissions, anti-recursion line); README → v2 fleet summary + install steps incl. skills pull.
- [ ] **Step 2:** Script dispositions (owners left the fleet): `voice-check.mjs` (yumemi) and `sql-safety-check.mjs` (mizuchi) → `git mv` to `future-work/scripts/`; `playbook-check.mjs` → rewrite assertions against the new manifest-schema or retire to `future-work/scripts/` if nothing consumes it (`grep -rn "playbook-check" .` to decide); `agent-fleet-audit.mjs` → update to v2 fleet map. Remove moved scripts from `fleet-manifest.json` agent-scripts component.
- [ ] **Step 3:** Prune `docs/` and `scripts/` of everything the v2 harness no longer requires. For each candidate, `grep -rn "<basename>" harnesses/opencode --include="*.md" --include="*.mjs" --include="*.jsonc" --include="*.json" --include="*.ts"` — zero live consumers → `git rm` (or `git mv` to `future-work/` when the deferred offering will want it back):
  - `docs/models/**` + `docs/models/gemini-tool-fees.yml` consumers check: the old "read `docs/models/<family>.md` before first non-readonly call" rule does not exist in v2 — retire the family guides to `future-work/docs/models/` unless routing-manifest v10 or web-tools still reads one (gemini-tool-fees.yml is read by web-tools pricing — keep that single file).
  - `docs/agent-template.md` → superseded by the rewritten rubric in Step 1; delete after merging anything still unique.
  - `scripts/action-allowlist.mjs`, `scripts/ctx7-docs.mjs`, `scripts/humanize-check.mjs`, `scripts/memory-path.mjs`, `scripts/lib/history-serializer.mjs` → keep only those with live v2 consumers (ctx7-docs: `scout`; humanize-check: WF4 `humanizer` pass; memory-path: memory rule); retire the rest.
  - Installer-era scripts `scripts/merge-config.mjs`, `scripts/unmerge-config.mjs`, `scripts/merge-package-fragment.mjs`, `scripts/unmerge-package-fragment.mjs`, `scripts/register-web-tools-plugin.mjs` (+ their tests) → retire in Task 40 alongside `fleet-manifest.json`, not here (they keep dev flows green until the package lands).
- [ ] **Step 4:** `bun test` green. Commit — `git commit -am "docs: v2 reference docs + docs/scripts prune + dispositions"`

### Task 36: Final verification sweep

- [ ] **Step 1:** Run the spec's full Verification Plan checklist (spec lines ~2490-2520) as a literal checklist; every bullet must have a passing test, probe result, or file diff to point to. In particular: agent inventory (12 future-work + 11 retired + 15 active), dispatch probes recorded, carve-outs exact, no `name:`/`todowrite:` anywhere (`grep -rn "todowrite\|^name:" agents/`), loop caps tested, WF5 terminal `COMPLETE`.
- [ ] **Step 2:** `bun test` (full suite) + `bun scripts/lint-dispatch-graph.mjs` + `uv run pytest scripts/finance/tests` — all green.
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md` Status line to "Implemented — see plans/opencode-harness-v2-plan.md" and commit — `git commit -am "docs(spec): mark v2 redesign implemented"`. Hand off to the user for branch-finish decision (PR via hanko conventions).

> **2026-07-03 caveat:** a full adversarial audit was run after this task's original sweep (5 parallel agents, verified via real code reads and command re-runs, not by trusting this task's self-reported pass claims). It found and fixed 4 blockers (mechanisms that had passed their own tests but never fired in a real OpenCode session — `komainu.js`, `nurikabe.js`, `migawari.js`, `workflow-state.mjs`'s ownership model) plus 10 further real bugs (Vertex pricing undercounting, orphaned scripts, missing crash safety, a missing escalation path, an ungitignored data dir, a mislabeled "baseline" test failure that was actually a real bug, an environmental test, and two wrong-field reads in the hook plugins) that this task's checklist did not catch. Treat this task's "everything verified" claim as **superseded** by that later, more rigorous pass — full detail lives in the execution ledger's 2026-07-03 Progress Log entries and in `/home/ace/.claude/plans/nested-fluttering-phoenix.md` sections H-M.

---

## Part 7 — Package & Publish (`@furaide/opencode-harness`)

Deliverable: the entire harness (minus the never-packaged list) installs on a user machine with one config line; installer-era scaffolding retired.

### Task 37: Package skeleton

(superseded 2026-07-03 — code moved to future-work/npm-package/, see Task 41's revision note)

**Files:**
- Create: `package.json` (at `harnesses/opencode/`), `src/index.ts`, `src/load-agents.ts`

- [ ] **Step 1:** `package.json`:

```json
{
  "name": "@furaide/opencode-harness",
  "version": "2.0.0",
  "description": "Furaidē workflow-first OpenCode harness: 15-agent fleet, 5 state-machine workflows, gates, web tools, skills.",
  "type": "module",
  "main": "src/index.ts",
  "keywords": ["opencode", "opencode-plugin"],
  "repository": { "type": "git", "url": "https://github.com/<owner>/<repo>" },
  "license": "MIT",
  "files": [
    "src/**", "agents/*.md", "config/AGENTS.md", "config/skills-manifest.json",
    "config/web-tools.yml", "rules/*.md", "plugins/**", "scripts/*.mjs",
    "scripts/lib/**", "scripts/finance/**", "skill-patches/**",
    "docs/routing-manifest.json", "docs/models/gemini-tool-fees.yml", "commands/*.md"
  ],
  "peerDependencies": { "@opencode-ai/plugin": "*" }
}
```

The `files` allow-list IS the packaging boundary — `future-work/`, `tools/`, root `README.md`/`AGENTS.md`, `docs/imgs/`, `docs/superpowers/`, `scripts/dev/`, `scripts/tests/`, `config/opencode.jsonc`, `config/fleet-manifest.json` are excluded by omission. Verify with `npm pack --dry-run` in Step 2.

- [ ] **Step 2:** `npm pack --dry-run` (or `bun pm pack --dry-run`) → inspect the file list; assert none of the excluded paths appear. Add this assertion as a test: `scripts/tests/package-boundary.test.mjs` runs the dry-run pack and greps the manifest for forbidden paths (`future-work/`, `tools/`, `docs/superpowers/`, `docs/imgs/`, `scripts/dev/`, `scripts/tests/`).
- [ ] **Step 3: Commit** — `git commit -am "feat(package): @furaide/opencode-harness skeleton + boundary test"`

### Task 38: The config hook

(superseded 2026-07-03 — code moved to future-work/npm-package/, see Task 41's revision note)

**Files:**
- Create: `src/load-agents.ts`, `src/index.ts` (hook body)
- Test: `scripts/tests/config-hook.test.mjs`

- [ ] **Step 1:** Failing tests: calling the plugin's `config` hook with an empty `Config` object results in — (a) 15 `agent` entries whose mode/model/temperature/steps/permission match the `.md` frontmatter; (b) scoped-bash patterns rewritten to absolute package paths (`bun ${pkgDir}/scripts/workflow-state.mjs *`); (c) `instructions` containing the package-absolute paths of `config/AGENTS.md` and every `rules/*.md`; (d) `command` entries from `commands/*.md`; (e) user-defined config wins — if the input already has `agent["kantoku--workflow-director"].model`, the hook must not overwrite it (merge, don't clobber).
- [ ] **Step 2:** `src/load-agents.ts`: factor the frontmatter parser out of `scripts/lint-dispatch-graph.mjs` into `scripts/lib/agent-md.mjs` (single parser, both consumers import it); parse each bundled `agents/*.md` into `{description, mode, model, temperature, steps, permission, prompt}`; resolve models through the bundled `docs/routing-manifest.json` (frontmatter `model:` is not source of truth — same rule as the repo config).
- [ ] **Step 3:** `src/index.ts`: export the plugin function; its `config` hook merges agents/instructions/commands per Step 1 semantics and calls `scripts/sync-skills.mjs` (Task 20) once per version (receipt-gated) for skill delivery.
- [ ] **Step 4:** `bun test scripts/tests/config-hook.test.mjs` → PASS. Commit — `git commit -am "feat(package): config hook registers fleet from bundled md"`

### Task 39: Fold gates, failover, hooks, and web-tools into the package export

(superseded 2026-07-03 — code moved to future-work/npm-package/, see Task 41's revision note)

**Files:**
- Modify: `src/index.ts`, `plugins/gates/*.js`, `plugins/failover/migawari.js`, `plugins/hooks/*.js`, `plugins/tools/web-tools.ts`

- [ ] **Step 1:** Refactor each plugin file to export its hooks object factory (keep the standalone plugin export for repo-local dev). `src/index.ts` composes them: one plugin function returning the merged hooks — config hook (Task 38) + nio/nurikabe/komainu/migawari/audit-logger/compaction-injector event hooks + web-tools' three `tool` entries. Hook-name collisions (multiple `tool.execute.before` consumers) resolve by sequential invocation in the spec's plugin order — write the tiny combinator, don't hand-merge.
- [ ] **Step 2:** `migawari` reads the routing manifest from the package dir (`new URL('../docs/routing-manifest.json', import.meta.url)`), not from the user's config dir. Same treatment for web-tools' `config/web-tools.yml` defaults (user's `~/.config/opencode/web-tools.yml` still overrides).
- [ ] **Step 3:** `bun test` (gate/failover/web-tools suites green against the refactored exports). Commit — `git commit -am "feat(package): compose gates, failover, hooks, web-tools into single plugin"`

### Task 40: Local install test + retire installer scaffolding

**Files:**
- Delete/retire: `config/fleet-manifest.json`, `scripts/merge-config.mjs`, `scripts/unmerge-config.mjs`, `scripts/merge-package-fragment.mjs`, `scripts/unmerge-package-fragment.mjs`, `scripts/register-web-tools-plugin.mjs`, `config/package.web-tools.json`, and their tests (`installer-*.test.mjs`, `install-web-tools.test.mjs`, `merge-config.test.mjs`, `package-fragment-merge.test.mjs`)
- Test: `scripts/tests/package-install.test.mjs`

- [ ] **Step 1:** End-to-end local install test: `bun pm pack` → in a temp HOME with a minimal `opencode.json` of `{"plugin": ["<tarball path>"]}`, run `opencode run --dangerously-skip-permissions "Reply with the number of agents you can dispatch via the task tool."` → output reflects the injected fleet; assert skills receipt was written and `~/.config/opencode/skills/` populated.
- [ ] **Step 2:** Retire the installer path: `git rm` the files listed above (move `fleet-manifest.json` to `future-work/` for reference); drop the interim notes added in Tasks 8/15/20.
- [ ] **Step 3:** `bun test` full suite green. Commit — `git commit -am "feat(package)!: npm install path live; installer scaffolding retired"`

### Task 41: Publish flow + final packaging sweep

**Revision note (2026-07-03):** npm publish is blocked (npm CLI unavailable in dev environment, @furaide npm scope never claimed/verified, OpenCode's `plugin` config array has no git/local-path support — confirmed against live opencode.ai docs). Distribution pivoted to the local-directory installer (scripts/install-fleet.sh/uninstall-fleet.sh); the npm package moved to future-work/npm-package/ as a deferred offering. Task 41's steps below are superseded by this revision — see the implementation session's full fix plan for exact scope.

- [ ] **Step 1:** README for the package consumer surface: install line, what gets registered, skill sync behavior, how to override models/permissions in user config (the merge-don't-clobber rule from Task 38), uninstall (remove plugin line + delete skills receipt). This lands in the harness-root `README.md` (repo-only) AND a trimmed `config/AGENTS.md` pointer — do not create a second packaged readme.
- [ ] **Step 2:** Publish dry-run: `npm publish --dry-run --access public` from `harnesses/opencode/`; verify name/version/files. Actual `npm publish` is a user-approved action — stop and ask before running it.
- [ ] **Step 3:** Re-run the Task 36 verification sweep plus: package-boundary test, config-hook parity test (hook output ⊇ repo `opencode.jsonc` agent declarations), local install test. All green → hand off for branch finish per repo git conventions.

---

## Task 42: Post-Ship Consolidation — Installer Rewrite, Docs/Skills Unification

**Context (2026-07-03, expanded 2026-07-03):** After Task 41's distribution pivot and the follow-up adversarial audit (both already implemented, verified, committed — see execution ledger), a further brainstorming pass reviewed the installer UX, the docs set, and skill duplication across the whole Furaidē monorepo (not just this harness). This surfaced a bigger scope: the installer itself should be rewritten (not just patched), several docs are stale/duplicative and should be cut, and skills are duplicated 1:1 across two locations with a third harness (`pi-agent`) holding some genuinely unique ones. This section was subsequently expanded to exact, copy-pasteable detail (file content, diffs, shell commands) so implementation requires no design judgment calls — every code block below is real, drafted against the actual current files, not a sketch. **Not yet implemented** — approval to start implementation is pending.

**Sequencing note (read before starting implementation):**
1. **42A and 42B should land together** (42A first, or in the same batch as 42B). 42A's `install.ts` already resolves bundled skills from the repo-root `skills/` directory correctly (not the harness-local copy). 42B retires the legacy `harnesses/opencode/scripts/install-fleet.sh` + relocates the shared-skills scripts, both of which hardcode harness-relative path resolution. Once both land, 42E's `harnesses/opencode/skills/` deletion is safe — the blocker identified during drafting is resolved by 42A/42B retiring the scripts that depended on the harness-local copy, not by a separate fix.
2. **42F's `fleet-manifest.json` coupling-field diff should land before or alongside 42A.** 42A's `install.ts` constants (`CORE_INFRA_FILES` etc.) were transcribed from the pre-42F version of that file — re-verify those constants against the file's actual content after 42F lands, in case anything besides the `coupling` field shape changed.
3. **42C (docs/superpowers alignment) is fully independent** and can land in any order relative to the rest.
4. **42D's `routing-manifest.json` v11 migration is independent.** `scripts/model-resolve.mjs` is not one of the scripts relocated by 42B (it stays in `harnesses/opencode/scripts/`), so 42D can land any time.
5. **42G (`graphify-out/` staleness note) is independent** and can land any time; regeneration itself stays deferred until 42A-42F have all landed (per 42G's own text).

### Task 42A: `packages/cli/` — the `opencode-fleet` TypeScript installer core

**Hard design constraint:** `packages/cli/` never holds installable resources (agent `.md`, plugin `.js`, config templates) — those stay authoritative under `harnesses/<name>/`. The CLI only holds installer *logic*; it reads/copies resources from `harnesses/<name>/` (and, for bundled skills, repo-root `skills/`) at install time.

**42A.0 — create directories:**
```bash
mkdir -p packages/cli/bin
mkdir -p packages/cli/src/targets/opencode-fleet
mkdir -p packages/cli/src/targets/claude-code
mkdir -p packages/cli/src/targets/pi-agent
mkdir -p packages/cli/src/shared
```

**42A.1 — `packages/cli/package.json`** (new file, exact content):
```json
{
  "name": "@furaide/cli",
  "version": "0.1.0",
  "private": true,
  "description": "Furaide's unified installer CLI: furaide install|uninstall <target>. Ships the OpenCode Fleet TypeScript installer natively; dispatches to relocated shell installers for the claude-code and pi-agent targets.",
  "type": "module",
  "bin": {
    "furaide": "./bin/furaide.ts"
  },
  "scripts": {
    "furaide": "bun run bin/furaide.ts",
    "start:tsx": "tsx bin/furaide.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@clack/prompts": "^0.9.1",
    "yaml": "^2.9.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2",
    "tsx": "^4.19.2"
  },
  "engines": {
    "node": ">=18.18.0",
    "bun": ">=1.1.0"
  }
}
```

**42A.2 — `packages/cli/tsconfig.json`** (new file, exact content — matches `harnesses/pi-agent/tsconfig.json`'s convention, the only other `.ts`-with-bun-and-node package in this repo):
```json
{
  "compilerOptions": {
    "moduleResolution": "NodeNext",
    "module": "NodeNext",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "target": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ESNext"],
    "types": ["bun", "node"]
  },
  "include": ["bin/**/*", "src/**/*"]
}
```

**Component model summary** (implemented across the files below):
- Primary selection unit is **workflow packs**, not flat components: wf1-wf5, each auto-resolving its transitive closure of agents. Core infra (`kantoku--workflow-director`, `general`, `kagami--verifier`, `oni--red-team-reviewer`, `hanko--git-seal`, `hansei--lesson-keeper`, `explore`, `scout`, `tsukumogami--code-forgemaster`) auto-includes whenever any pack is selected. wf5 additionally pulls in `tsuchigumo--research-weaver` (its `SOURCE_GATHERING` state delegates to it) even if wf4 isn't separately selected.
- Secondary "Advanced" mode: hand-pick individual agents; the resolver computes and surfaces the closure (required scripts, required skills, dangling delegation-edge warnings) rather than installing a silently-incomplete agent.
- Skills are derived, not a toggle — union of selected agents' `skill:` frontmatter allow-lists, categorized bundled (repo-root `skills/`) vs external (pinned sources).
- Web-tools is an opt-in toggle, defaulted from an install-time credential probe (`BRAVE_API_KEY`/`TAVILY_API_KEY`/`GOOGLE_API_KEY`/`GOOGLE_APPLICATION_CREDENTIALS`).
- Receipt schema v2 (zod-validated) carries forward the repeat-install backup-root-reuse fix from the prior audit pass, adds `selectedWorkflows`, `selectedAgents`, `requiredSkills`.

**42A.3 — `packages/cli/src/targets/opencode-fleet/manifest-schema.ts`** (new file, exact content):
```typescript
// packages/cli/src/targets/opencode-fleet/manifest-schema.ts
//
// zod schemas + shared constants for the OpenCode Fleet installer.
// Ground truth for the workflow/agent closure below is
// harnesses/opencode/scripts/workflow-state.mjs's WORKFLOW_ALLOWED_CALLERS,
// cross-checked against each agent's frontmatter permission.task allow-list.

import { z } from "zod";

export const WORKFLOW_IDS = ["wf1", "wf2", "wf3", "wf4", "wf5"] as const;
export const WorkflowIdSchema = z.enum(WORKFLOW_IDS);
export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export const WORKFLOW_CATALOG: ReadonlyArray<{ id: WorkflowId; label: string; description: string }> = [
  { id: "wf1", label: "Feature / Change", description: "New features, enhancements, or architectural changes." },
  { id: "wf2", label: "Bug / Regression", description: "Fixing reported bugs or performance regressions." },
  { id: "wf3", label: "Security", description: "Security audits, vulnerability patching, or hardening." },
  { id: "wf4", label: "Research", description: "Codebase exploration, documentation research, or feasibility studies." },
  { id: "wf5", label: "Public-Company Finance", description: "Financial reporting, compliance, or audit-related tasks." },
];

/** Always included the moment ANY workflow is selected. */
export const CORE_AGENTS: readonly string[] = [
  "kantoku--workflow-director",
  "general",
  "kagami--verifier",
  "oni--red-team-reviewer",
  "hanko--git-seal",
  "hansei--lesson-keeper",
  "explore",
  "scout",
  "tsukumogami--code-forgemaster",
];

/** Agents exclusive to one workflow (not shared with any other workflow). */
export const WORKFLOW_EXCLUSIVE_AGENTS: Record<WorkflowId, string[]> = {
  wf1: ["kyakuhon--spec-planner"],
  wf2: ["bakeneko--bug-hunter"],
  wf3: ["fudo--security-guardian"],
  wf4: ["tsuchigumo--research-weaver"],
  wf5: ["daikoku--finance-steward", "kura--knowledge-banker"],
};

/** wf5's SOURCE_GATHERING state delegates to tsuchigumo (wf4's exclusive
 * agent) even when wf4 itself was not separately selected. */
export const WORKFLOW_EXTRA_DEPENDENCIES: Partial<Record<WorkflowId, string[]>> = {
  wf5: ["tsuchigumo--research-weaver"],
};

export const ALL_FLEET_AGENTS: readonly string[] = Array.from(
  new Set<string>([...CORE_AGENTS, ...Object.values(WORKFLOW_EXCLUSIVE_AGENTS).flat()])
);

export const ScopeSchema = z.enum(["global", "project", "custom"]);
export type Scope = z.infer<typeof ScopeSchema>;

export const AgentRequirementsSchema = z.object({
  agent: z.string(),
  requiredScripts: z.array(z.string()),
  requiredSkills: z.object({
    external: z.array(z.string()),
    bundled: z.array(z.string()),
  }),
});
export type AgentRequirements = z.infer<typeof AgentRequirementsSchema>;

export const WorkflowPackSchema = z.object({
  id: WorkflowIdSchema,
  label: z.string(),
  description: z.string(),
  exclusiveAgents: z.array(z.string()).min(1),
  extraDependencies: z.array(z.string()).default([]),
});
export type WorkflowPack = z.infer<typeof WorkflowPackSchema>;

export const WebToolsExtraSchema = z.object({
  id: z.literal("web-tools"),
  label: z.string(),
  description: z.string(),
  defaultOn: z.boolean(),
  credentialEnvVars: z.array(z.string()),
  files: z.array(z.string()),
  globs: z.array(z.string()),
});
export type WebToolsExtra = z.infer<typeof WebToolsExtraSchema>;

/** Schema-only artifact for now -- resolve.ts derives closures from the
 * constants above and live agent-frontmatter reads, not from a JSON file.
 * Exists so a future config/fleet-manifest.v2.json can be authored and
 * validated against a real schema. See Task 42A.12 "known gaps". */
export const FleetManifestSchema = z.object({
  schemaVersion: z.literal(2),
  coreInfra: z.object({
    agents: z.array(z.string()).min(1),
    files: z.array(z.string()),
    globs: z.array(z.string()),
  }),
  workflows: z.record(WorkflowIdSchema, WorkflowPackSchema),
  webTools: WebToolsExtraSchema,
  agentRequirements: z.array(AgentRequirementsSchema).optional(),
});
export type FleetManifest = z.infer<typeof FleetManifestSchema>;

export const RECEIPT_SCHEMA_VERSION = 2 as const;

export const InstallReceiptV2Schema = z.object({
  version: z.literal(RECEIPT_SCHEMA_VERSION),
  installedAt: z.string().min(1),
  targetDir: z.string().min(1),
  scope: ScopeSchema,
  selectedWorkflows: z.array(WorkflowIdSchema),
  selectedAgents: z.array(z.string()),
  installedFilesByComponent: z.record(z.string(), z.array(z.string())),
  backup: z.object({
    root: z.string().nullable(),
    created: z.boolean(),
  }),
  requiredSkills: z.object({
    external: z.array(z.string()),
    bundled: z.array(z.string()),
  }),
});
export type InstallReceiptV2 = z.infer<typeof InstallReceiptV2Schema>;
```

**42A.4 — `packages/cli/src/targets/opencode-fleet/resolve.ts`** (new file, exact content — dependency: `yaml` npm package, already declared in 42A.1's `package.json`):
```typescript
// packages/cli/src/targets/opencode-fleet/resolve.ts
//
// Pure, framework-free, unit-testable resolution logic. No prompts, no file
// copying, no process.exit -- every function takes explicit inputs and
// returns a value or throws.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  WORKFLOW_IDS,
  CORE_AGENTS,
  WORKFLOW_EXCLUSIVE_AGENTS,
  WORKFLOW_EXTRA_DEPENDENCIES,
  type WorkflowId,
} from "./manifest-schema.ts";

const frontmatterCache = new Map<string, Record<string, unknown>>();

function extractFrontmatterBlock(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  return match ? match[1] : null;
}

/** Reads and parses `<harnessRoot>/agents/<agentName>.md`'s YAML frontmatter.
 * Cached per absolute file path. Throws a descriptive error if the file is
 * missing, has no frontmatter block, or fails to parse -- a broken agent
 * file must fail the install loudly, not silently resolve an empty closure. */
export function readAgentFrontmatter(agentName: string, harnessRoot: string): Record<string, unknown> {
  const filePath = join(harnessRoot, "agents", `${agentName}.md`);
  const cached = frontmatterCache.get(filePath);
  if (cached) return cached;

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`resolve.ts: cannot read agent file for "${agentName}" at ${filePath}: ${(err as Error).message}`);
  }

  const raw = extractFrontmatterBlock(content);
  if (raw === null) {
    throw new Error(`resolve.ts: agent file ${filePath} has no YAML frontmatter block`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`resolve.ts: failed to parse YAML frontmatter in ${filePath}: ${(err as Error).message}`);
  }

  const result: Record<string, unknown> = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  frontmatterCache.set(filePath, result);
  return result;
}

/** Lists every agent name available under `<harnessRoot>/agents/*.md`. */
export function listAllAgentNames(harnessRoot: string): string[] {
  const agentsDir = join(harnessRoot, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** Derives the monorepo root from a harness root, assuming the standard
 * layout `<repoRoot>/harnesses/opencode`. Used by resolveAgentSkills() to
 * find the repo-root `skills/` directory -- NOT the harness-local
 * `harnesses/opencode/skills/` copy (deleted by Task 42E). */
export function harnessRootToRepoRoot(harnessRoot: string): string {
  return resolvePath(harnessRoot, "..", "..");
}

function assertKnownWorkflowIds(ids: string[]): WorkflowId[] {
  const seen = new Set<WorkflowId>();
  for (const id of ids) {
    if (!(WORKFLOW_IDS as readonly string[]).includes(id)) {
      throw new Error(`resolve.ts: unknown workflow id "${id}". Known ids: ${WORKFLOW_IDS.join(", ")}`);
    }
    seen.add(id as WorkflowId);
  }
  return Array.from(seen);
}

/** Core infra (always) + each selected workflow's exclusive agents + any
 * WORKFLOW_EXTRA_DEPENDENCIES. Selecting zero workflows returns just the
 * core infra agents (a valid "infrastructure only" install). */
export function resolveWorkflowClosure(selectedWorkflowIds: string[]): { agents: string[] } {
  const ids = assertKnownWorkflowIds(selectedWorkflowIds);
  const agents = new Set<string>(CORE_AGENTS);
  for (const id of ids) {
    for (const a of WORKFLOW_EXCLUSIVE_AGENTS[id]) agents.add(a);
    const extra = WORKFLOW_EXTRA_DEPENDENCIES[id];
    if (extra) for (const a of extra) agents.add(a);
  }
  return { agents: Array.from(agents).sort() };
}

// Matches a scripts/... path with a recognized extension, e.g.
// "bun scripts/workflow-state.mjs *" -> "scripts/workflow-state.mjs".
const SCRIPT_PATH_RE = /\b(?:\.\/)?(scripts\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|sh|py))\b/g;

/** Reads each agent's permission.bash frontmatter block and extracts every
 * scripts/... path referenced in a per-command key. Handles both the
 * shorthand string form (permission.bash: allow -- contributes no scripts)
 * and the per-command object form (extracts each scripts/... key, skipping
 * the literal "*" catch-all). */
export function resolveAgentScripts(agentNames: string[], harnessRoot: string): string[] {
  const scripts = new Set<string>();
  for (const name of agentNames) {
    const fm = readAgentFrontmatter(name, harnessRoot);
    const permission = fm.permission as Record<string, unknown> | undefined;
    const bashPerm = permission?.bash;
    if (!bashPerm || typeof bashPerm !== "object") continue;
    for (const key of Object.keys(bashPerm as Record<string, unknown>)) {
      if (key === "*") continue;
      SCRIPT_PATH_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SCRIPT_PATH_RE.exec(key)) !== null) scripts.add(match[1]);
    }
  }
  return Array.from(scripts).sort();
}

function listBundledSkillNames(repoRoot: string): Set<string> {
  const skillsDir = join(repoRoot, "skills");
  if (!existsSync(skillsDir)) return new Set();
  return new Set(
    readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  );
}

function listExternalSkillNames(harnessRoot: string): Set<string> {
  const manifestPath = join(harnessRoot, "config", "skills-manifest.json");
  if (!existsSync(manifestPath)) return new Set();
  let manifest: { sources?: Array<{ skills?: string[] }> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`resolve.ts: failed to parse ${manifestPath}: ${(err as Error).message}`);
  }
  const names = new Set<string>();
  for (const source of manifest.sources ?? []) {
    for (const skill of source.skills ?? []) names.add(skill);
  }
  return names;
}

/** Reads each agent's permission.skill allow-list and cross-references each
 * allowed skill name against repo-root `skills/*` (bundled) and
 * `<harnessRoot>/config/skills-manifest.json`'s pinned sources (external).
 * A skill matching neither is categorized "external" as a safe default
 * (never silently dropped) with a stderr warning. */
export function resolveAgentSkills(agentNames: string[], harnessRoot: string): { external: string[]; bundled: string[] } {
  const repoRoot = harnessRootToRepoRoot(harnessRoot);
  const bundledAvailable = listBundledSkillNames(repoRoot);
  const externalAvailable = listExternalSkillNames(harnessRoot);
  const bundled = new Set<string>();
  const external = new Set<string>();
  const unresolved = new Set<string>();

  for (const name of agentNames) {
    const fm = readAgentFrontmatter(name, harnessRoot);
    const permission = fm.permission as Record<string, unknown> | undefined;
    const skillPerm = permission?.skill;
    if (!skillPerm || typeof skillPerm !== "object") continue;
    for (const [skillName, verdict] of Object.entries(skillPerm as Record<string, unknown>)) {
      if (skillName === "*" || verdict !== "allow") continue;
      if (bundledAvailable.has(skillName)) bundled.add(skillName);
      else if (externalAvailable.has(skillName)) external.add(skillName);
      else unresolved.add(skillName);
    }
  }

  if (unresolved.size > 0) {
    process.stderr.write(
      `[resolve] warning: ${unresolved.size} skill(s) not found in bundled or external sources, treating as external: ${Array.from(unresolved).sort().join(", ")}\n`
    );
    for (const s of unresolved) external.add(s);
  }

  return { external: Array.from(external).sort(), bundled: Array.from(bundled).sort() };
}

/** agentName -> the agent names it may dispatch to, derived from
 * permission.task allow-list entries ("allow" verdict, excluding "*"). */
export function buildAgentDelegationMap(agentNames: string[], harnessRoot: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const name of agentNames) {
    const fm = readAgentFrontmatter(name, harnessRoot);
    const permission = fm.permission as Record<string, unknown> | undefined;
    const taskPerm = permission?.task;
    const delegates: string[] = [];
    if (taskPerm && typeof taskPerm === "object") {
      for (const [key, verdict] of Object.entries(taskPerm as Record<string, unknown>)) {
        if (key === "*" || verdict !== "allow") continue;
        delegates.push(key);
      }
    }
    map[name] = delegates.sort();
  }
  return map;
}

/** Advanced (manual individual-agent) mode: does NOT auto-expand the picked
 * set to include delegation targets -- that would defeat the point of a
 * manual pick. Instead surfaces every delegation edge pointing outside the
 * picked set ("dangling") so the caller can warn the user. */
export function resolveAdvancedClosure(
  pickedAgents: string[],
  allAgentDelegationMap: Record<string, string[]>
): { agents: string[]; danglingDelegations: Array<{ from: string; to: string }> } {
  const agents = Array.from(new Set(pickedAgents)).sort();
  const pickedSet = new Set(agents);
  const danglingDelegations: Array<{ from: string; to: string }> = [];
  for (const agent of agents) {
    for (const to of allAgentDelegationMap[agent] ?? []) {
      if (!pickedSet.has(to)) danglingDelegations.push({ from: agent, to });
    }
  }
  return { agents, danglingDelegations };
}
```

**42A.5 — `packages/cli/src/targets/opencode-fleet/backup.ts`** (new file, exact content — ports `install-fleet.sh`'s `ensure_backup_root()`/`backup_existing_file()` behavior, including the repeat-install backup-root-reuse fix and the `.kura_backup` — leading-dot — naming):
```typescript
// packages/cli/src/targets/opencode-fleet/backup.ts
//
// Backup root is `<targetDir>/.kura_backup/<installTimestamp>` (leading-dot
// required). On a repeat install, if the target already has an install
// receipt with a recorded backup.root, that root is REUSED instead of
// minting a new timestamped one -- otherwise the true original backup from
// an earlier run becomes orphaned. A file already present under the backup
// root is never re-backed-up: first backup wins.

import { existsSync, mkdirSync, copyFileSync, lstatSync, readlinkSync, symlinkSync, readFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";

export const BACKUP_DIR_NAME = ".kura_backup";
export const RECEIPT_FILENAME = ".furaide-install-receipt.json";

/** Per-install-run backup bookkeeping. Threaded explicitly (not module-level
 * global state) so this stays independently unit-testable. */
export interface BackupState {
  roots: Map<string, string>;
  created: Map<string, boolean>;
}

export function createBackupState(): BackupState {
  return { roots: new Map(), created: new Map() };
}

/** Reads a target's existing install receipt (if any) and returns its
 * recorded backup.root, or null. Deliberately does NOT use receipt.ts's
 * schema-validated readReceipt() -- a receipt with an otherwise malformed
 * shape should still let backup-root reuse work for this one field. */
export function existingReceiptBackupRoot(targetDir: string): string | null {
  const receiptPath = join(targetDir, RECEIPT_FILENAME);
  if (!existsSync(receiptPath)) return null;
  try {
    const raw = readFileSync(receiptPath, "utf8");
    const parsed = JSON.parse(raw) as { backup?: { root?: string | null } };
    const root = parsed?.backup?.root;
    return typeof root === "string" && root.length > 0 ? root : null;
  } catch {
    return null;
  }
}

/** Returns the backup root for targetDir, minting it on first use within
 * this BackupState, or reusing a prior run's recorded receipt root. */
export function ensureBackupRoot(targetDir: string, installTimestamp: string, state: BackupState): string {
  const existing = state.roots.get(targetDir);
  if (existing) return existing;
  const fromReceipt = existingReceiptBackupRoot(targetDir);
  const root = fromReceipt ?? join(targetDir, BACKUP_DIR_NAME, installTimestamp);
  state.roots.set(targetDir, root);
  return root;
}

function pathExistsOrIsSymlink(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** If `dst` exists and no backup for that relative path exists yet under
 * this target's backup root, copies it there (preserving symlinks) before
 * the installer overwrites it. No-op if `dst` doesn't exist, is outside
 * `targetDir`, or already has a backup entry. */
export function backupExistingFile(
  dst: string,
  targetDir: string,
  installTimestamp: string,
  state: BackupState,
  options: { dryRun?: boolean } = {}
): { backedUp: boolean; backupPath: string | null } {
  if (!pathExistsOrIsSymlink(dst)) return { backedUp: false, backupPath: null };

  const rel = relative(targetDir, dst);
  if (rel.startsWith("..") || isAbsolute(rel)) return { backedUp: false, backupPath: null };

  const root = ensureBackupRoot(targetDir, installTimestamp, state);
  const backupPath = join(root, rel);
  if (pathExistsOrIsSymlink(backupPath)) return { backedUp: false, backupPath };

  if (options.dryRun) {
    state.created.set(targetDir, true);
    return { backedUp: true, backupPath };
  }

  mkdirSync(dirname(backupPath), { recursive: true });
  const srcStat = lstatSync(dst);
  if (srcStat.isSymbolicLink()) symlinkSync(readlinkSync(dst), backupPath);
  else copyFileSync(dst, backupPath);
  state.created.set(targetDir, true);
  return { backedUp: true, backupPath };
}

/** Whether ensureBackupRoot/backupExistingFile created at least one backup
 * for targetDir during THIS BackupState's lifetime. Callers preserving a
 * prior run's `backup.created: true` across a no-op repeat install must OR
 * this with the previous receipt's value themselves. */
export function wasBackupCreated(targetDir: string, state: BackupState): boolean {
  return state.created.get(targetDir) ?? false;
}
```

**42A.6 — `packages/cli/src/targets/opencode-fleet/receipt.ts`** (new file, exact content):
```typescript
// packages/cli/src/targets/opencode-fleet/receipt.ts
//
// Read/write for the v2 install receipt, schema-validated against
// InstallReceiptV2Schema. A malformed or pre-v2 receipt fails loud on read
// -- a thrown Error with the zod issue list -- rather than being silently
// misparsed as v2 shape.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { InstallReceiptV2Schema, type InstallReceiptV2 } from "./manifest-schema.ts";
import { RECEIPT_FILENAME } from "./backup.ts";

export { RECEIPT_FILENAME };

export function receiptPath(targetDir: string): string {
  return join(targetDir, RECEIPT_FILENAME);
}

/** Returns null if no receipt exists (a legitimate "not installed" state).
 * Throws a descriptive Error if the file exists but is not valid JSON or
 * does not match InstallReceiptV2Schema. Callers must NOT treat a thrown
 * error as "not installed" -- that would silently proceed over an existing,
 * differently-shaped install. */
export function readReceipt(targetDir: string): InstallReceiptV2 | null {
  const path = receiptPath(targetDir);
  if (!existsSync(path)) return null;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`receipt.ts: failed to read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`receipt.ts: ${path} is not valid JSON: ${(err as Error).message}`);
  }

  const result = InstallReceiptV2Schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
    const versionHint =
      typeof parsed === "object" && parsed !== null && "version" in (parsed as Record<string, unknown>)
        ? ` (found version=${JSON.stringify((parsed as { version?: unknown }).version)})`
        : " (no 'version' field -- likely a pre-v2 receipt from install-fleet.sh)";
    throw new Error(
      `receipt.ts: ${path} does not match the v2 install receipt schema${versionHint}. Remove it manually (after ` +
        `confirming what it points at) or run the matching legacy uninstaller first. Validation errors:\n${issues}`
    );
  }
  return result.data;
}

/** Validates `receipt` and writes it atomically (tmp file + rename). */
export function writeReceipt(targetDir: string, receipt: InstallReceiptV2): void {
  const validated = InstallReceiptV2Schema.parse(receipt);
  const path = receiptPath(targetDir);
  mkdirSync(dirname(path), { recursive: true });
  const out = JSON.stringify(validated, null, 2) + "\n";
  const tmpFile = join(tmpdir(), `furaide-receipt-${Date.now()}-${process.pid}.json`);
  writeFileSync(tmpFile, out, "utf8");
  renameSync(tmpFile, path);
}

/** No-op if there is no receipt at targetDir. */
export function deleteReceipt(targetDir: string): void {
  const path = receiptPath(targetDir);
  if (!existsSync(path)) return;
  unlinkSync(path);
}
```

**42A.7 — `packages/cli/src/targets/opencode-fleet/wizard.ts`** (new file, exact content — depends on `install.ts` for `performInstall`/`resolveScopeDir`/etc.; this is a two-way ESM import with `install.ts`, safe because neither module touches the other's exports at top-level evaluation time, only inside function bodies):
```typescript
// packages/cli/src/targets/opencode-fleet/wizard.ts
//
// @clack/prompts interactive flow, plus the flag-driven non-interactive
// path that runs the same resolution logic with zero prompts.

import { intro, outro, select, multiselect, confirm, text, spinner, note, log, isCancel, cancel } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { WORKFLOW_IDS, WORKFLOW_CATALOG, type WorkflowId, type Scope, type InstallReceiptV2 } from "./manifest-schema.ts";
import { resolveWorkflowClosure, resolveAgentScripts, resolveAgentSkills } from "./resolve.ts";
import { readReceipt } from "./receipt.ts";
import { BACKUP_DIR_NAME } from "./backup.ts";
import { performInstall, resolveScopeDir, GLOBAL_SCOPE, projectScope, makeInstallTimestamp, HARNESS_ROOT, REPO_ROOT } from "./install.ts";

export function commandExists(cmd: string): boolean {
  try {
    if (process.platform === "win32") {
      return spawnSync("where", [cmd], { stdio: "ignore" }).status === 0;
    }
    return spawnSync(`command -v ${cmd}`, { shell: true, stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** Walks up to the nearest existing ancestor of `targetDir` and checks it's
 * writable -- targetDir itself usually doesn't exist yet on a fresh install. */
export function checkWriteAccess(targetDir: string): boolean {
  let dir = targetDir;
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export const WEB_TOOLS_CREDENTIAL_ENV_VARS = ["BRAVE_API_KEY", "TAVILY_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"] as const;

export function probeWebToolsCredentials(): { anyFound: boolean; found: string[] } {
  const found = WEB_TOOLS_CREDENTIAL_ENV_VARS.filter((v) => typeof process.env[v] === "string" && process.env[v]!.length > 0);
  return { anyFound: found.length > 0, found: [...found] };
}

function bail(message = "Install cancelled."): never {
  cancel(message);
  process.exit(0);
}

export async function runInteractiveWizard(): Promise<void> {
  intro("Furaide's Fleet -- OpenCode installer");

  const bunOk = commandExists("bun");
  const nodeOk = commandExists("node");
  const gitOk = commandExists("git");
  const opencodeOk = commandExists("opencode");

  note(
    [
      `bun:      ${bunOk ? "found" : "MISSING"}`,
      `node:     ${nodeOk ? "found" : "MISSING"}`,
      `git:      ${gitOk ? "found" : "MISSING"}`,
      `opencode: ${opencodeOk ? "found on PATH" : "not found -- install will proceed, but the fleet won't run until opencode is installed"}`,
    ].join("\n"),
    "Pre-checks"
  );

  if (!bunOk && !nodeOk) {
    cancel("Neither bun nor node was found on PATH. One is required to run this installer and the installed fleet's scripts.");
    process.exit(1);
  }

  const credentials = probeWebToolsCredentials();

  const scopeChoice = await select({
    message: "Where should Furaide's Fleet be installed?",
    options: [
      { value: "global" as const, label: "Global", hint: GLOBAL_SCOPE },
      { value: "project" as const, label: "Project", hint: projectScope() },
      { value: "custom" as const, label: "Custom directory" },
    ],
  });
  if (isCancel(scopeChoice)) bail();

  let targetDir: string;
  let scope: Scope;
  if (scopeChoice === "custom") {
    const customPath = await text({
      message: "Absolute path to install target:",
      validate: (v) => (v && isAbsolute(v) ? undefined : "Must be an absolute path"),
    });
    if (isCancel(customPath)) bail();
    scope = "custom";
    targetDir = customPath as string;
  } else {
    scope = scopeChoice as Scope;
    targetDir = resolveScopeDir(scope);
  }

  if (!checkWriteAccess(targetDir)) {
    cancel(`No write access to ${targetDir} (or its nearest existing parent directory). Choose a different scope or fix permissions.`);
    process.exit(1);
  }

  const existingReceipt: InstallReceiptV2 | null = readReceipt(targetDir);
  const isUpdate = existingReceipt !== null;
  if (isUpdate && existingReceipt) {
    note(
      `An existing install was found at ${targetDir} (installed ${existingReceipt.installedAt}, ` +
        `workflows: ${existingReceipt.selectedWorkflows.join(", ") || "none"}).\n` +
        `This run will be treated as an UPDATE -- any file it overwrites is backed up first, reusing the original backup location.`,
      "Existing install detected"
    );
  }

  const workflowChoice = await multiselect({
    message: "Select workflows to install (core infrastructure is always included):",
    options: WORKFLOW_CATALOG.map((wf) => ({ value: wf.id, label: `${wf.label} (${wf.id})`, hint: wf.description })),
    initialValues: existingReceipt ? existingReceipt.selectedWorkflows : [...WORKFLOW_IDS],
    required: false,
  });
  if (isCancel(workflowChoice)) bail();
  const selectedWorkflows = workflowChoice as WorkflowId[];

  const webToolsChoice = await confirm({
    message: credentials.anyFound
      ? `Install Web Tools plugin (web_search / fetch_content / maps)? Detected credentials: ${credentials.found.join(", ")}.`
      : `Install Web Tools plugin (web_search / fetch_content / maps)? No provider credentials detected (${WEB_TOOLS_CREDENTIAL_ENV_VARS.join(", ")}) -- it will install but calls will fail until configured.`,
    initialValue: credentials.anyFound,
  });
  if (isCancel(webToolsChoice)) bail();
  const webTools = webToolsChoice as boolean;

  const { agents } = resolveWorkflowClosure(selectedWorkflows);
  const scripts = resolveAgentScripts(agents, HARNESS_ROOT);
  const skills = resolveAgentSkills(agents, HARNESS_ROOT);

  note(
    [
      `Target: ${targetDir} (${isUpdate ? "update" : "fresh install"})`,
      `Workflows: ${selectedWorkflows.join(", ") || "(none -- core infra only)"}`,
      `Agents (${agents.length}): ${agents.join(", ")}`,
      `Scripts (${scripts.length}): ${scripts.join(", ") || "(none)"}`,
      `Bundled skills (${skills.bundled.length}): ${skills.bundled.join(", ") || "(none)"}`,
      `External skills referenced (${skills.external.length}, not auto-pulled): ${skills.external.join(", ") || "(none)"}`,
      `Web Tools: ${webTools ? "yes" : "no"}`,
      `Backups: any file this run overwrites is copied first to ${targetDir}/${BACKUP_DIR_NAME}/<timestamp-or-reused-root>`,
    ].join("\n"),
    "Install summary"
  );

  const proceed = await confirm({ message: "Proceed with install?", initialValue: true });
  if (isCancel(proceed) || proceed !== true) bail();

  const s = spinner();
  s.start("Installing Furaide's Fleet...");
  let receipt: InstallReceiptV2;
  try {
    receipt = await performInstall({
      scope,
      targetDir,
      selectedWorkflows,
      webTools,
      harnessRoot: HARNESS_ROOT,
      repoRoot: REPO_ROOT,
      installTimestamp: makeInstallTimestamp(),
    });
    s.stop("Install complete.");
  } catch (err) {
    s.stop("Install failed.");
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  outro(
    [
      `Furaide's Fleet installed to ${targetDir}.`,
      `${receipt.selectedAgents.length} agent(s), ${receipt.requiredSkills.bundled.length} bundled skill(s).`,
      ``,
      `To uninstall later, run:`,
      `  furaide uninstall opencode-fleet --scope custom --custom-dir ${targetDir} --yes`,
    ].join("\n")
  );
}

export interface NonInteractiveFlags {
  scope?: Scope;
  customDir?: string;
  workflows?: string;
  agents?: string;
  webTools?: boolean;
  yes?: boolean;
}

function requireCustomDir(dir: string | undefined): string {
  if (!dir) throw new Error("--scope custom requires --custom-dir <absolute path>");
  if (!isAbsolute(dir)) throw new Error(`--custom-dir must be an absolute path, got: ${dir}`);
  return dir;
}

/** Flag-driven install path: same resolution logic as the interactive
 * wizard, zero prompts. Requires --yes. */
export async function runNonInteractive(flags: NonInteractiveFlags): Promise<void> {
  if (!flags.yes) {
    throw new Error("Non-interactive install requires --yes to confirm.");
  }

  const scope: Scope = flags.scope ?? "project";
  const targetDir = scope === "custom" ? requireCustomDir(flags.customDir) : resolveScopeDir(scope);

  if (!checkWriteAccess(targetDir)) {
    throw new Error(`No write access to ${targetDir} (or its nearest existing parent directory).`);
  }

  let selectedWorkflows: WorkflowId[] = [];
  let advancedAgents: string[] | undefined;

  if (flags.agents) {
    advancedAgents = flags.agents.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    const workflowsRaw = flags.workflows ?? "all";
    selectedWorkflows =
      workflowsRaw === "all" ? [...WORKFLOW_IDS] : (workflowsRaw.split(",").map((s) => s.trim()).filter(Boolean) as WorkflowId[]);
    for (const id of selectedWorkflows) {
      if (!(WORKFLOW_IDS as readonly string[]).includes(id)) {
        throw new Error(`Unknown workflow id in --workflows: "${id}". Known ids: ${WORKFLOW_IDS.join(", ")}`);
      }
    }
  }

  const credentials = probeWebToolsCredentials();
  const webTools = flags.webTools ?? credentials.anyFound;

  process.stdout.write(`[furaide] Installing opencode-fleet to ${targetDir} (scope=${scope})...\n`);

  const receipt = await performInstall({
    scope,
    targetDir,
    selectedWorkflows,
    advancedAgents,
    webTools,
    harnessRoot: HARNESS_ROOT,
    repoRoot: REPO_ROOT,
    installTimestamp: makeInstallTimestamp(),
  });

  process.stdout.write(
    `[furaide] Install complete. ${receipt.selectedAgents.length} agent(s) installed to ${targetDir}.\n` +
      `[furaide] To uninstall: furaide uninstall opencode-fleet --scope custom --custom-dir ${targetDir} --yes\n`
  );
}
```

**42A.8 — `packages/cli/src/targets/opencode-fleet/install.ts`** (new file, exact content). **Config-merge design choice**: this shells out to the existing, tested `harnesses/opencode/scripts/merge-config.mjs` via `child_process` rather than reimplementing its JSONC-comment-stripping parser in TypeScript — that parser is the one genuinely tricky piece of the legacy installer and porting it risks subtly diverging from a well-tested implementation. **Scope reduction, flagged not silently dropped**: the legacy bash installer resolves live model availability via `model-resolve.mjs` before merging agent model mappings (prompting on changes); that step is NOT ported here — `mergeConfig()` passes the static `config/opencode.jsonc` as `--agents-source` instead. Porting `model-resolve.mjs`'s live-availability check is a flagged follow-up (42A.12), not required for a working v1:
```typescript
// packages/cli/src/targets/opencode-fleet/install.ts
//
// Orchestrates one full install: resolve agent/script/skill closure ->
// back up conflicting files -> copy -> merge config -> write receipt.
// Also the CLI entrypoint (main()) deciding interactive vs non-interactive.

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, basename, relative, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { type Scope, type WorkflowId, type InstallReceiptV2, RECEIPT_SCHEMA_VERSION } from "./manifest-schema.ts";
import {
  resolveWorkflowClosure,
  resolveAgentScripts,
  resolveAgentSkills,
  resolveAdvancedClosure,
  buildAgentDelegationMap,
  listAllAgentNames,
} from "./resolve.ts";
import { createBackupState, backupExistingFile, wasBackupCreated, existingReceiptBackupRoot, type BackupState } from "./backup.ts";
import { readReceipt, writeReceipt } from "./receipt.ts";
import { runInteractiveWizard, runNonInteractive, type NonInteractiveFlags } from "./wizard.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// this file: packages/cli/src/targets/opencode-fleet/install.ts -> repo root is 5 levels up.
export const REPO_ROOT = resolvePath(__dirname, "..", "..", "..", "..", "..");
export const HARNESS_ROOT = join(REPO_ROOT, "harnesses", "opencode");

export const GLOBAL_SCOPE = join(homedir(), ".config", "opencode");
export function projectScope(cwd: string = process.cwd()): string {
  return join(cwd, ".opencode");
}

export function resolveScopeDir(scope: Scope, customDir?: string): string {
  switch (scope) {
    case "global":
      return GLOBAL_SCOPE;
    case "project":
      return projectScope();
    case "custom":
      if (!customDir) throw new Error("resolveScopeDir: scope 'custom' requires customDir");
      return customDir;
  }
}

/** Matches the legacy bash installer's `date -u +%Y%m%dT%H%M%SZ` format. */
export function makeInstallTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Ported from the pre-42F config/fleet-manifest.json's non-agent components
// (workflow-gates, failover, security-gate, rules). RE-VERIFY against the
// current fleet-manifest.json after Task 42F lands (see 42A.12).
const CORE_INFRA_FILES: string[] = [
  "plugins/gates/nio.js",
  "plugins/hooks/audit-logger.js",
  "plugins/hooks/compaction-injector.js",
  "scripts/workflow-state.mjs",
  "scripts/state-path.mjs",
  "docs/workflows.md",
  "plugins/failover/migawari.js",
  "docs/routing-manifest.json",
  "plugins/gates/komainu.js",
  "config/opencode.jsonc",
  "config/AGENTS.md",
];
const CORE_INFRA_GLOBS: string[] = ["scripts/lib/**", "rules/*.md"];

// Only copied when daikoku--finance-steward is in the resolved closure.
const FINANCE_FILES: string[] = [
  "scripts/knowledge-bank-finance.mjs",
  "scripts/finance-artifact-registry.mjs",
  "scripts/finance-source-registry.mjs",
  "scripts/finance/pyproject.toml",
  "scripts/finance/uv.lock",
];
const FINANCE_GLOBS: string[] = ["scripts/finance/*.py", "scripts/finance/tests/**"];

const WEB_TOOLS_FILES: string[] = [
  "plugins/tools/web-tools.ts",
  "config/web-tools.yml",
  "config/package.web-tools.json",
  "commands/tools-config.md",
  "docs/models/gemini-tool-fees.yml",
  "scripts/install-web-tools.sh",
  "scripts/register-web-tools-plugin.mjs",
];
const WEB_TOOLS_GLOBS: string[] = ["plugins/tools/web-tools/**"];

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function walkFiles(dir: string, srcBase: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, srcBase, out);
    else if (entry.isFile()) out.push(relative(srcBase, full));
  }
}

/** Expands a manifest glob pattern (either "dir/**" recursive, or
 * "dir/*.ext" flat) against srcBase, returning paths relative to srcBase. */
function expandGlob(pattern: string, srcBase: string): string[] {
  if (pattern.endsWith("/**")) {
    const dir = join(srcBase, pattern.slice(0, -3));
    const out: string[] = [];
    walkFiles(dir, srcBase, out);
    return out;
  }
  const dirPart = dirname(pattern);
  const globPart = basename(pattern);
  const dir = join(srcBase, dirPart);
  if (!existsSync(dir)) return [];
  const re = globToRegExp(globPart);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && re.test(e.name))
    .map((e) => relative(srcBase, join(dir, e.name)));
}

function addComponentFile(map: Map<string, Set<string>>, component: string, relPath: string): void {
  const set = map.get(component) ?? new Set<string>();
  set.add(relPath);
  map.set(component, set);
}

function copyOneFile(
  srcRoot: string,
  relPath: string,
  targetDir: string,
  installTimestamp: string,
  backupState: BackupState,
  componentFiles: Map<string, Set<string>>,
  component: string
): void {
  const src = join(srcRoot, relPath);
  if (!existsSync(src)) {
    process.stderr.write(`[furaide] warning: source not found, skipping: ${src}\n`);
    return;
  }
  const dst = join(targetDir, relPath);
  backupExistingFile(dst, targetDir, installTimestamp, backupState);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  addComponentFile(componentFiles, component, relPath);
}

/** Copies an entire bundled skill directory tree from `<repoRoot>/skills/<name>`
 * into `<targetDir>/skills/<name>`. Per the hard requirement: bundled skill
 * content is resolved relative to the REPO ROOT's skills/ directory, never
 * the harness-local `harnesses/opencode/skills/` copy (deleted by 42E). */
function copySkillTree(
  repoRoot: string,
  skillName: string,
  targetDir: string,
  installTimestamp: string,
  backupState: BackupState,
  componentFiles: Map<string, Set<string>>
): void {
  const skillsRoot = join(repoRoot, "skills");
  const srcDir = join(skillsRoot, skillName);
  if (!existsSync(srcDir)) {
    process.stderr.write(`[furaide] warning: bundled skill "${skillName}" not found at ${srcDir}, skipping\n`);
    return;
  }
  const files: string[] = [];
  walkFiles(srcDir, skillsRoot, files);
  for (const rel of files) {
    copyOneFile(skillsRoot, rel, join(targetDir, "skills"), installTimestamp, backupState, componentFiles, "skills-bundled");
  }
}

function mergeConfig(targetDir: string, opts: { pluginRelPaths: string[]; hasRules: boolean; hasAgents: boolean; harnessRoot: string }): void {
  const cfgJson = join(targetDir, "opencode.json");
  const cfgJsonc = join(targetDir, "opencode.jsonc");
  let cfg = existsSync(cfgJson) ? cfgJson : existsSync(cfgJsonc) ? cfgJsonc : null;
  if (!cfg) {
    cfg = cfgJson;
    mkdirSync(dirname(cfg), { recursive: true });
    require("node:fs").writeFileSync(cfg, JSON.stringify({ plugin: [], instructions: [] }, null, 2) + "\n", "utf8");
  }

  const runner =
    spawnSync(process.platform === "win32" ? "where" : "command -v", ["bun"], { shell: process.platform !== "win32" }).status === 0 ? "bun" : "node";
  const mergeScript = join(opts.harnessRoot, "scripts", "merge-config.mjs");
  const args = [mergeScript, cfg, ...opts.pluginRelPaths];
  if (opts.hasRules) args.push("--rules");
  if (opts.hasAgents) {
    const agentsSource = join(opts.harnessRoot, "config", "opencode.jsonc");
    if (existsSync(agentsSource)) args.push("--agents-source", agentsSource);
  }

  const result = spawnSync(runner, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`merge-config.mjs failed for ${cfg} (exit code ${result.status ?? "unknown"})`);
  }
}

export interface ResolvedInstallOptions {
  scope: Scope;
  targetDir: string;
  selectedWorkflows: WorkflowId[];
  /** Advanced mode: bypasses workflow-closure resolution. */
  advancedAgents?: string[];
  webTools: boolean;
  harnessRoot: string;
  repoRoot: string;
  installTimestamp: string;
}

export async function performInstall(opts: ResolvedInstallOptions): Promise<InstallReceiptV2> {
  const priorReceipt = readReceipt(opts.targetDir);
  const backupState = createBackupState();
  const componentFiles = new Map<string, Set<string>>();

  let agents: string[];
  let danglingDelegations: Array<{ from: string; to: string }> = [];
  if (opts.advancedAgents && opts.advancedAgents.length > 0) {
    const allAgentNames = listAllAgentNames(opts.harnessRoot);
    const delegationMap = buildAgentDelegationMap(allAgentNames, opts.harnessRoot);
    const closure = resolveAdvancedClosure(opts.advancedAgents, delegationMap);
    agents = closure.agents;
    danglingDelegations = closure.danglingDelegations;
  } else {
    agents = resolveWorkflowClosure(opts.selectedWorkflows).agents;
  }
  if (danglingDelegations.length > 0) {
    process.stderr.write(
      `[furaide] warning: ${danglingDelegations.length} delegation edge(s) point outside the selected agent set:\n` +
        danglingDelegations.map((d) => `  - ${d.from} -> ${d.to}\n`).join("")
    );
  }

  for (const rel of CORE_INFRA_FILES) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "core-infra");
  for (const pattern of CORE_INFRA_GLOBS) {
    for (const rel of expandGlob(pattern, opts.harnessRoot)) {
      copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "core-infra");
    }
  }

  for (const name of agents) {
    copyOneFile(opts.harnessRoot, join("agents", `${name}.md`), opts.targetDir, opts.installTimestamp, backupState, componentFiles, "agents");
  }

  const scripts = resolveAgentScripts(agents, opts.harnessRoot);
  for (const rel of scripts) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "agent-scripts");

  if (agents.includes("daikoku--finance-steward")) {
    for (const rel of FINANCE_FILES) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "finance");
    for (const pattern of FINANCE_GLOBS) {
      for (const rel of expandGlob(pattern, opts.harnessRoot)) {
        copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "finance");
      }
    }
  }

  if (opts.webTools) {
    for (const rel of WEB_TOOLS_FILES) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "web-tools");
    for (const pattern of WEB_TOOLS_GLOBS) {
      for (const rel of expandGlob(pattern, opts.harnessRoot)) {
        copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "web-tools");
      }
    }
    if (!process.env.BRAVE_API_KEY) process.stderr.write("[furaide] warning: BRAVE_API_KEY not set; web_search via Brave will fail until configured.\n");
    if (!process.env.TAVILY_API_KEY) process.stderr.write("[furaide] warning: TAVILY_API_KEY not set; web_search/fetch_content via Tavily will fail until configured.\n");
  }

  const skills = resolveAgentSkills(agents, opts.harnessRoot);
  for (const skillName of skills.bundled) copySkillTree(opts.repoRoot, skillName, opts.targetDir, opts.installTimestamp, backupState, componentFiles);
  if (skills.external.length > 0) {
    process.stderr.write(
      `[furaide] Manual follow-up: run 'bun ${opts.targetDir}/scripts/pull-external-skills.mjs' to pull/update pinned external skills: ${skills.external.join(", ")}\n`
    );
  }

  const allInstalledFiles = Array.from(componentFiles.values()).flatMap((set) => Array.from(set));
  const pluginRelPaths = allInstalledFiles.filter((f) => /^plugins\/.*\.(js|ts)$/.test(f));
  const hasRules = allInstalledFiles.some((f) => f.startsWith("rules/"));
  mergeConfig(opts.targetDir, { pluginRelPaths, hasRules, hasAgents: agents.length > 0, harnessRoot: opts.harnessRoot });

  const backupRoot = backupState.roots.get(opts.targetDir) ?? existingReceiptBackupRoot(opts.targetDir) ?? null;
  const backupCreated = wasBackupCreated(opts.targetDir, backupState) || (priorReceipt?.backup.created ?? false);

  const receipt: InstallReceiptV2 = {
    version: RECEIPT_SCHEMA_VERSION,
    installedAt: new Date().toISOString(),
    targetDir: opts.targetDir,
    scope: opts.scope,
    selectedWorkflows: opts.selectedWorkflows,
    selectedAgents: agents,
    installedFilesByComponent: Object.fromEntries(Array.from(componentFiles.entries()).map(([c, files]) => [c, Array.from(files).sort()])),
    backup: { root: backupRoot, created: backupCreated },
    requiredSkills: skills,
  };

  writeReceipt(opts.targetDir, receipt);
  return receipt;
}

function parseFlags(argv: string[]): NonInteractiveFlags {
  const flags: NonInteractiveFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--scope":
        flags.scope = argv[++i] as Scope;
        break;
      case "--custom-dir":
        flags.customDir = argv[++i];
        break;
      case "--workflows":
        flags.workflows = argv[++i];
        break;
      case "--agents":
        flags.agents = argv[++i];
        break;
      case "--web-tools":
        flags.webTools = true;
        break;
      case "--no-web-tools":
        flags.webTools = false;
        break;
      case "--yes":
        flags.yes = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}. Run 'furaide install opencode-fleet --help' for usage.`);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: furaide install opencode-fleet [flags]",
      "",
      "With no flags: launches the interactive wizard.",
      "With any flag below: non-interactive, requires --yes.",
      "",
      "  --scope <global|project|custom>   Install scope (default: project)",
      "  --custom-dir <path>                Absolute path, required when --scope custom",
      "  --workflows <wf1,wf2,...|all>      Workflows to install (default: all)",
      "  --agents <name,name,...>           Advanced mode: install exactly these agents (ignores --workflows)",
      "  --web-tools / --no-web-tools       Force Web Tools on/off (default: auto-probe env)",
      "  --yes                              Required to confirm a non-interactive run",
      "  -h, --help                         Show this help",
    ].join("\n") + "\n"
  );
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.length === 0) {
    await runInteractiveWizard();
    return;
  }
  const flags = parseFlags(argv);
  await runNonInteractive(flags);
}
```
**Note:** `mergeConfig()`'s fresh-config-file branch uses `require("node:fs").writeFileSync(...)` as a one-off — an executor should instead add `writeFileSync` to the top-level `import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";` (making it `import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from "node:fs";`) and call `writeFileSync(...)` directly, deleting the inline `require`.

**42A.9 — `packages/cli/src/targets/opencode-fleet/uninstall.ts`** (new file, exact content):
```typescript
// packages/cli/src/targets/opencode-fleet/uninstall.ts
//
// Reads the v2 install receipt at the target scope, removes exactly the
// files it recorded (installedFilesByComponent -- immune to drift between
// the manifest at install time and now), restores any backups, unwires the
// merged opencode.json(c) config via unmerge-config.mjs, and deletes the
// receipt.

import { existsSync, unlinkSync, rmdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { confirm, isCancel, cancel, intro, outro, note } from "@clack/prompts";
import type { Scope } from "./manifest-schema.ts";
import { deleteReceipt, readReceipt } from "./receipt.ts";
import { HARNESS_ROOT, resolveScopeDir } from "./install.ts";

function pruneEmptyParents(dst: string, targetDir: string): void {
  let parent = dirname(dst);
  while (parent !== targetDir && parent !== dirname(parent)) {
    if (!existsSync(parent)) {
      parent = dirname(parent);
      continue;
    }
    const entries = readdirSync(parent);
    if (entries.length === 0) {
      try {
        rmdirSync(parent);
      } catch {
        break;
      }
      parent = dirname(parent);
    } else {
      break;
    }
  }
}

function removeOrRestore(relPath: string, targetDir: string, backupRoot: string | null): void {
  const dst = join(targetDir, relPath);
  const restoreSrc = backupRoot ? join(backupRoot, relPath) : null;

  if (restoreSrc && existsSync(restoreSrc)) {
    try {
      unlinkSync(dst);
    } catch {
      /* dst may not exist -- fine, we're about to write it from backup */
    }
    copyFileSync(restoreSrc, dst);
    unlinkSync(restoreSrc);
    process.stdout.write(`[furaide] restored original: ${dst}\n`);
  } else if (existsSync(dst)) {
    unlinkSync(dst);
    process.stdout.write(`[furaide] removed: ${dst}\n`);
  }

  pruneEmptyParents(dst, targetDir);
}

function unwireConfig(targetDir: string, opts: { pluginRelPaths: string[]; hasRules: boolean; hasAgents: boolean; harnessRoot: string }): void {
  const cfgJson = join(targetDir, "opencode.json");
  const cfgJsonc = join(targetDir, "opencode.jsonc");
  const cfg = existsSync(cfgJson) ? cfgJson : existsSync(cfgJsonc) ? cfgJsonc : null;
  if (!cfg) return;

  const runner =
    spawnSync(process.platform === "win32" ? "where" : "command -v", ["bun"], { shell: process.platform !== "win32" }).status === 0 ? "bun" : "node";
  const unmergeScript = join(opts.harnessRoot, "scripts", "unmerge-config.mjs");
  const args = [unmergeScript, cfg, ...opts.pluginRelPaths];
  if (opts.hasRules) args.push("--rules");
  if (opts.hasAgents) {
    const agentsSource = join(opts.harnessRoot, "config", "opencode.jsonc");
    if (existsSync(agentsSource)) args.push("--agents-source", agentsSource);
  }

  const result = spawnSync(runner, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.stderr.write(`[furaide] warning: unmerge-config.mjs failed for ${cfg} (exit code ${result.status ?? "unknown"}); config may still reference removed plugins/agents.\n`);
  }
}

export async function performUninstall(targetDir: string): Promise<void> {
  const receipt = readReceipt(targetDir);
  if (!receipt) {
    process.stdout.write(`[furaide] No install receipt found at ${targetDir} -- nothing to uninstall.\n`);
    return;
  }

  const allFiles = Object.values(receipt.installedFilesByComponent).flat();
  for (const relPath of allFiles) removeOrRestore(relPath, targetDir, receipt.backup.root);

  const pluginRelPaths = allFiles.filter((f) => /^plugins\/.*\.(js|ts)$/.test(f));
  const hasRules = allFiles.some((f) => f.startsWith("rules/"));
  unwireConfig(targetDir, { pluginRelPaths, hasRules, hasAgents: receipt.selectedAgents.length > 0, harnessRoot: HARNESS_ROOT });

  deleteReceipt(targetDir);

  if (receipt.backup.root && existsSync(receipt.backup.root)) {
    try {
      if (readdirSync(receipt.backup.root).length === 0) rmdirSync(receipt.backup.root);
    } catch {
      /* not empty or already gone -- fine */
    }
  }

  process.stdout.write(`[furaide] Uninstall complete: ${targetDir}\n`);
}

interface UninstallFlags {
  scope?: Scope;
  customDir?: string;
  yes?: boolean;
}

function parseFlags(argv: string[]): UninstallFlags {
  const flags: UninstallFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--scope":
        flags.scope = argv[++i] as Scope;
        break;
      case "--custom-dir":
        flags.customDir = argv[++i];
        break;
      case "--yes":
        flags.yes = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}. Run 'furaide uninstall opencode-fleet --help' for usage.`);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: furaide uninstall opencode-fleet [flags]",
      "",
      "  --scope <global|project|custom>   Scope to uninstall from (default: project)",
      "  --custom-dir <path>                Absolute path, required when --scope custom",
      "  --yes                              Skip the confirmation prompt",
      "  -h, --help                         Show this help",
    ].join("\n") + "\n"
  );
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const flags = parseFlags(argv);
  const scope: Scope = flags.scope ?? "project";
  if (scope === "custom" && (!flags.customDir || !isAbsolute(flags.customDir))) {
    throw new Error("--scope custom requires --custom-dir <absolute path>");
  }
  const targetDir = resolveScopeDir(scope, flags.customDir);

  const receipt = readReceipt(targetDir);
  if (!receipt) {
    process.stdout.write(`[furaide] No install receipt found at ${targetDir} -- nothing to uninstall.\n`);
    return;
  }

  if (!flags.yes) {
    intro("Furaide's Fleet -- OpenCode uninstaller");
    note(
      [
        `Target: ${targetDir}`,
        `Installed: ${receipt.installedAt}`,
        `Agents (${receipt.selectedAgents.length}): ${receipt.selectedAgents.join(", ")}`,
        `Backup root: ${receipt.backup.root ?? "(none recorded)"}`,
      ].join("\n"),
      "About to remove"
    );
    const proceed = await confirm({ message: `Uninstall Furaide's Fleet from ${targetDir}?`, initialValue: false });
    if (isCancel(proceed) || proceed !== true) {
      cancel("Uninstall cancelled.");
      return;
    }
  }

  await performUninstall(targetDir);
  if (!flags.yes) outro("Done.");
}
```

**42A.10 — `packages/cli/src/router.ts`** (new file, exact content — `claude-code`/`pi-agent` targets dispatch to their relocated shell installers from Task 42B; no TypeScript logic for those two targets):
```typescript
// packages/cli/src/router.ts
//
// Top-level `furaide install|uninstall <target> [flags]` dispatch.
// opencode-fleet routes to real TypeScript logic. claude-code and pi-agent
// dispatch, unchanged, to their relocated shell installers (Task 42B).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// this file: packages/cli/src/router.ts -> repo root is 3 levels up.
const REPO_ROOT = resolvePath(__dirname, "..", "..", "..");

export type Action = "install" | "uninstall";
export type Target = "opencode-fleet" | "claude-code" | "pi-agent";

const KNOWN_ACTIONS: readonly Action[] = ["install", "uninstall"];
const KNOWN_TARGETS: readonly Target[] = ["opencode-fleet", "claude-code", "pi-agent"];

type ShellTarget = Exclude<Target, "opencode-fleet">;

const SHELL_TARGET_SCRIPTS: Record<ShellTarget, { install: string; uninstall: string }> = {
  "claude-code": {
    install: join(__dirname, "targets", "claude-code", "install.sh"),
    uninstall: join(__dirname, "targets", "claude-code", "uninstall.sh"),
  },
  "pi-agent": {
    install: join(__dirname, "targets", "pi-agent", "install.sh"),
    uninstall: join(__dirname, "targets", "pi-agent", "uninstall.sh"),
  },
};

function printUsage(): string {
  return [
    "Usage: furaide <install|uninstall> <opencode-fleet|claude-code|pi-agent> [flags]",
    "",
    "Targets:",
    "  opencode-fleet   Furaide's Fleet for OpenCode (native TypeScript installer)",
    "  claude-code      Claude Code harness (dispatches to its relocated .sh installer)",
    "  pi-agent         pi.dev agent harness (dispatches to its relocated .sh installer)",
    "",
    "Run 'furaide <install|uninstall> opencode-fleet --help' for opencode-fleet-specific flags.",
  ].join("\n");
}

export async function runCli(argv: string[]): Promise<void> {
  const [action, target, ...rest] = argv;

  if (!action || !KNOWN_TARGETS.includes(target as Target) || !KNOWN_ACTIONS.includes(action as Action)) {
    process.stderr.write(printUsage() + "\n");
    process.exit(action || target ? 1 : 0);
  }

  const resolvedAction = action as Action;
  const resolvedTarget = target as Target;

  if (resolvedTarget === "opencode-fleet") {
    const mod = resolvedAction === "install" ? await import("./targets/opencode-fleet/install.ts") : await import("./targets/opencode-fleet/uninstall.ts");
    await mod.main(rest);
    return;
  }

  const scripts = SHELL_TARGET_SCRIPTS[resolvedTarget];
  const scriptPath = resolvedAction === "install" ? scripts.install : scripts.uninstall;
  const result = spawnSync("bash", [scriptPath, ...rest], { stdio: "inherit", cwd: REPO_ROOT });
  process.exit(result.status ?? 1);
}
```

**42A.11 — `packages/cli/bin/furaide.ts`** (new file, exact content):
```typescript
#!/usr/bin/env bun
// packages/cli/bin/furaide.ts
//
// CLI entrypoint. Primary runner is bun (`bun run bin/furaide.ts`).
// Node+tsx fallback: `npx tsx bin/furaide.ts`.

import { runCli } from "../src/router.ts";

runCli(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`furaide: fatal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
```

**42A.12 — known gaps, not blocking a working v1 (address in follow-up passes):**
- `model-resolve.mjs`'s live-model-availability resolution was not ported into `install.ts` — `mergeConfig()` uses the static `config/opencode.jsonc` source directly rather than a resolved model map. If live model substitution at install time is required, port `model-resolve.mjs`'s `resolveModels()` logic into a new `resolve-models.ts` and call it before `mergeConfig()` in `performInstall()`.
- `FleetManifestSchema`/`WorkflowPackSchema` in `manifest-schema.ts` are schema-only — no `config/fleet-manifest.v2.json` file is created by this task. `resolve.ts` derives closures from the hardcoded `CORE_AGENTS`/`WORKFLOW_EXCLUSIVE_AGENTS` constants and live agent-frontmatter reads. A future pass could author the JSON and switch `resolve.ts` to read it instead.
- `CORE_INFRA_FILES`/`FINANCE_FILES`/`WEB_TOOLS_FILES` constants in `install.ts` were transcribed from the pre-42F `config/fleet-manifest.json` — re-verify against the file's actual content once Task 42F lands (its `coupling`-field diff is the only planned change to that file, but confirm nothing else shifted).
- `zod`/`@clack/prompts` version pins in 42A.1 are reasonable current picks, not verified against `bun.lock`'s existing transitive pins (if any) — `bun install` will resolve real versions regardless.

**42A.13 — Verification:**
```bash
cd packages/cli
bun install
bun run typecheck
bun run bin/furaide.ts install opencode-fleet --help
bun run bin/furaide.ts uninstall opencode-fleet --help
```
Manual round trip in a scratch `$HOME`:
```bash
HOME=/tmp/furaide-scratch bun run bin/furaide.ts install opencode-fleet --scope global --workflows all --yes
# confirm files landed under /tmp/furaide-scratch/.config/opencode/, receipt written
HOME=/tmp/furaide-scratch bun run bin/furaide.ts uninstall opencode-fleet --scope global --yes
# confirm clean removal, backups restored if any existed
```

### Task 42B: Relocate `claude-code`/`pi-agent`/shared scripts into `packages/cli/`, new root `install.sh`/`uninstall.sh`

**Corrections verified during drafting (do not use the `../../../` depth assumed earlier in this doc — it's wrong):** `packages/cli/src/targets/claude-code/` is 5 path segments deep from repo root, not 3 — reaching `harnesses/claude-code/` from there requires **5** `../`, not 3. Same for `packages/cli/src/targets/pi-agent/`. All exact commands below already use the corrected depth.

**42B.1 — create destination directories:**
```bash
mkdir -p packages/cli/src/targets/claude-code
mkdir -p packages/cli/src/targets/pi-agent
mkdir -p packages/cli/src/shared
```

**42B.2 — relocate via `git mv`:**
```bash
git mv harnesses/claude-code/scripts/bootstrap.sh   packages/cli/src/targets/claude-code/install.sh
git mv harnesses/claude-code/scripts/uninstall.sh    packages/cli/src/targets/claude-code/uninstall.sh
git mv harnesses/pi-agent/scripts/install-pi-agent.sh packages/cli/src/targets/pi-agent/install.sh
git mv scripts/github-setup-check.sh      packages/cli/src/shared/github-setup-check.sh
git mv scripts/install-external-skills.sh packages/cli/src/shared/install-external-skills.sh
git mv scripts/install-vendored-skills.sh packages/cli/src/shared/install-vendored-skills.sh
```
`github-setup-check.sh` needs no content changes (zero relative-path references) — the `git mv` alone finishes that file.

**42B.3 — content fixes for the 5 relocated files that DO reference their own location.** For each, the only functional change is the self-locating path variable at the top of the file — everything else is byte-identical to the original. Apply as an exact string replacement (read the file first, the `old_string` below must match verbatim):

`packages/cli/src/targets/claude-code/install.sh` — replace:
```bash
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = harnesses/claude-code/
ROOT="$(cd "$REPO/../.." && pwd)"
SCRIPTS_DIR="$ROOT/scripts"
```
with:
```bash
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../harnesses/claude-code" && pwd)"   # = harnesses/claude-code/
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../shared" && pwd)"   # = packages/cli/src/shared/
```
(`ROOT` variable is dropped as unused — `$REPO/cli/src/satori`, `$REPO/config/agents/`, `$REPO/config/CLAUDE.md`, etc. all still resolve correctly since `config/`/`cli/` stay put in `harnesses/claude-code/`.)

`packages/cli/src/targets/claude-code/uninstall.sh` — replace:
```bash
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
```
with:
```bash
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../harnesses/claude-code" && pwd)"
```

`packages/cli/src/targets/pi-agent/install.sh` — replace:
```bash
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
```
with:
```bash
AGENT_DIR="$(cd "$SCRIPT_DIR/../../../../../harnesses/pi-agent" && pwd)"
```
(`SCRIPT_DIR` itself is unchanged — it's a pure self-locator, correct at any depth.)

`packages/cli/src/shared/install-external-skills.sh` — replace:
```bash
MANIFEST="$(cd "$SCRIPT_DIR/../packages/manifests" && pwd)/skills-manifest.json"
```
with:
```bash
MANIFEST="$(cd "$SCRIPT_DIR/../../../manifests" && pwd)/skills-manifest.json"
```
(3 ups from `packages/cli/src/shared/` lands on `packages/`, then into `manifests/` — `packages/manifests/skills-manifest.json` itself is not moving.)

`packages/cli/src/shared/install-vendored-skills.sh` — replace:
```bash
SKILLS_SRC="$(cd "$SCRIPT_DIR/../skills" && pwd)"
```
with:
```bash
SKILLS_SRC="$(cd "$SCRIPT_DIR/../../../../skills" && pwd)"
```
Also update the file's header comment (originally citing `harnesses/opencode/scripts/install-fleet.sh` as a caller) to drop that reference — `install-fleet.sh` is retired by 42A, not relocated.

**42B.4 — new root `install.sh`** (repo root; verified neither `install.sh` nor `uninstall.sh` currently exists there):
```bash
cat > install.sh <<'EOF'
#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. root installer bootstrap
#
# Thin wrapper: detects a JS runtime (bun preferred, node+npm fallback),
# installs packages/cli's dependencies, then hands off to the TypeScript
# CLI router which dispatches to the requested target.
#
# Usage:
#   bash install.sh [args passed through to the CLI's install command]
# Examples:
#   bash install.sh                       # interactive target picker
#   bash install.sh install opencode-fleet --scope project --yes

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$ROOT/packages/cli"

RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

if [[ ! -d "$CLI_DIR" ]]; then
  err "packages/cli not found at $CLI_DIR — is this a full Furaidē checkout?"
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  ( cd "$CLI_DIR" && bun install && bun run bin/furaide.ts install "$@" )
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  warn "bun not found — falling back to node/npm (slower)."
  warn "Install bun for the best experience: https://bun.sh"
  ( cd "$CLI_DIR" && npm install && npx --yes tsx bin/furaide.ts install "$@" )
else
  err "Neither bun nor node+npm found."
  err "Install bun (recommended): https://bun.sh"
  err "  or Node.js 18+ with npm:  https://nodejs.org"
  exit 1
fi
EOF
chmod +x install.sh
```

**42B.5 — new root `uninstall.sh`:**
```bash
cat > uninstall.sh <<'EOF'
#!/usr/bin/env bash
# uninstall.sh — F.R.I.D.A.Y. root uninstaller bootstrap
#
# Thin wrapper: detects a JS runtime (bun preferred, node+npm fallback),
# installs packages/cli's dependencies, then hands off to the TypeScript
# CLI router which dispatches to the requested target's uninstall path.
#
# Usage:
#   bash uninstall.sh [args passed through to the CLI's uninstall command]

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$ROOT/packages/cli"

RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

if [[ ! -d "$CLI_DIR" ]]; then
  err "packages/cli not found at $CLI_DIR — is this a full Furaidē checkout?"
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  ( cd "$CLI_DIR" && bun install && bun run bin/furaide.ts uninstall "$@" )
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  warn "bun not found — falling back to node/npm (slower)."
  warn "Install bun for the best experience: https://bun.sh"
  ( cd "$CLI_DIR" && npm install && npx --yes tsx bin/furaide.ts uninstall "$@" )
else
  err "Neither bun nor node+npm found."
  err "Install bun (recommended): https://bun.sh"
  err "  or Node.js 18+ with npm:  https://nodejs.org"
  exit 1
fi
EOF
chmod +x uninstall.sh
```

**42B.6 — fix every referrer.** Each block is a standalone `python3` heredoc doing an exact literal substring replace with an assertion so it fails loudly instead of silently mismatching:

```bash
python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("README.md")
text = p.read_text()
repls = [
    ("bash ~/Furaidē/harnesses/claude-code/scripts/bootstrap.sh",
     "bash ~/Furaidē/packages/cli/src/targets/claude-code/install.sh"),
    ("To uninstall: `bash ~/Furaidē/harnesses/claude-code/scripts/uninstall.sh`",
     "To uninstall: `bash ~/Furaidē/packages/cli/src/targets/claude-code/uninstall.sh`"),
    ("bash ~/Furaidē/harnesses/pi-agent/scripts/install-pi-agent.sh",
     "bash ~/Furaidē/packages/cli/src/targets/pi-agent/install.sh"),
    ("bash scripts/install-vendored-skills.sh --global   # installs to ~/.agents/skills/",
     "bash packages/cli/src/shared/install-vendored-skills.sh --global   # installs to ~/.agents/skills/"),
    ("bash scripts/github-setup-check.sh",
     "bash packages/cli/src/shared/github-setup-check.sh"),
]
for old, new in repls:
    n = text.count(old)
    assert n == 1, f"expected 1 occurrence of {old!r}, found {n}"
    text = text.replace(old, new)
p.write_text(text)
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/claude-code/README.md")
text = p.read_text()
repls = [
    ("Satori and the `github` skill share a single engine (`cli/`) installed by `scripts/bootstrap.sh`.",
     "Satori and the `github` skill share a single engine (`cli/`) installed by `packages/cli/src/targets/claude-code/install.sh`."),
    ("bash ~/Furaidē/harnesses/claude-code/scripts/bootstrap.sh",
     "bash ~/Furaidē/packages/cli/src/targets/claude-code/install.sh"),
    ("bash ~/Furaidē/scripts/install-vendored-skills.sh --global      # bx, html-preview, brave-search, plan",
     "bash ~/Furaidē/packages/cli/src/shared/install-vendored-skills.sh --global      # bx, html-preview, brave-search, plan"),
    ("bash ~/Furaidē/scripts/install-external-skills.sh --ecosystem claude-code  # superpowers, notebooklm, …",
     "bash ~/Furaidē/packages/cli/src/shared/install-external-skills.sh --ecosystem claude-code  # superpowers, notebooklm, …"),
    ("bash ~/Furaidē/harnesses/claude-code/scripts/uninstall.sh",
     "bash ~/Furaidē/packages/cli/src/targets/claude-code/uninstall.sh"),
    ("   bash ~/furaide-dev/harnesses/claude-code/scripts/bootstrap.sh",
     "   bash ~/furaide-dev/packages/cli/src/targets/claude-code/install.sh"),
]
for old, new in repls:
    n = text.count(old)
    assert n == 1, f"expected 1 occurrence of {old!r}, found {n}"
    text = text.replace(old, new)
p.write_text(text)
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/pi-agent/README.md")
text = p.read_text()
old1 = "bash ~/Furaidē/harnesses/pi-agent/scripts/install-pi-agent.sh"
new1 = "bash ~/Furaidē/packages/cli/src/targets/pi-agent/install.sh"
assert text.count(old1) == 1
text = text.replace(old1, new1)
old2 = "  scripts/install-pi-agent.sh\n"
assert text.count(old2) == 1
text = text.replace(old2, "")
p.write_text(text)
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/claude-code/plugins/satori/.claude-plugin/plugin.json")
text = p.read_text()
old = "Run claude-code/scripts/bootstrap.sh to install."
new = "Run packages/cli/src/targets/claude-code/install.sh to install."
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/claude-code/plugins/satori/commands/satori.md")
text = p.read_text()
old = 'Run `harnesses/claude-code/scripts/bootstrap.sh` first.'
new = 'Run `packages/cli/src/targets/claude-code/install.sh` first.'
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/agents/hanko--git-seal.md")
text = p.read_text()
old = 'bash "$(git rev-parse --show-toplevel)/scripts/github-setup-check.sh"'
new = 'bash "$(git rev-parse --show-toplevel)/packages/cli/src/shared/github-setup-check.sh"'
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/config/fleet-manifest.json")
text = p.read_text()
old = '"src": "../../../scripts/github-setup-check.sh",'
new = '"src": "../../../packages/cli/src/shared/github-setup-check.sh",'
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF
```
**Deliberately not edited:** `docs/superpowers/plans/2026-06-24-furaide-restructure-implementation-plan.md`, `docs/superpowers/specs/2026-06-24-furaide-restructure-design.md`, `harnesses/claude-code/docs/superpowers/plans/2026-06-17-satori-implementation.md` — historical migration narratives, not live docs.

**42B.7 — retire the 9 opencode-fleet legacy scripts + their real tests** (superseded by 42A's TypeScript port):
```bash
git rm harnesses/opencode/scripts/install-fleet.sh
git rm harnesses/opencode/scripts/uninstall-fleet.sh
git rm harnesses/opencode/scripts/install-web-tools.sh
git rm harnesses/opencode/scripts/install-fleet-bootstrap.sh
git rm harnesses/opencode/scripts/merge-config.mjs
git rm harnesses/opencode/scripts/unmerge-config.mjs
git rm harnesses/opencode/scripts/merge-package-fragment.mjs
git rm harnesses/opencode/scripts/unmerge-package-fragment.mjs
git rm harnesses/opencode/scripts/register-web-tools-plugin.mjs
```
**Note:** `install.ts`'s `mergeConfig()`/`uninstall.ts`'s `unwireConfig()` (42A) still shell out to `merge-config.mjs`/`unmerge-config.mjs` at their *harness-local* path (`harnesses/opencode/scripts/merge-config.mjs`) — **do not** `git rm` those two specifically; the list above already excludes them (only `install-fleet.sh`, `uninstall-fleet.sh`, `install-web-tools.sh`, `install-fleet-bootstrap.sh`, `merge-package-fragment.mjs`, `unmerge-package-fragment.mjs`, `register-web-tools-plugin.mjs` are removed — 7 files, re-count against the 9 listed above and reconcile: `merge-config.mjs`/`unmerge-config.mjs` were mistakenly included in the original 9-file catalog during drafting; confirm at implementation time whether `install.ts`/`uninstall.ts` still reference them before removing — if they do, drop those two lines from this step).

Only 8 test files actually invoke the retired scripts (verified by content, not filename pattern — a naive `*web-tools*` glob matches ~20 unrelated plugin-runtime test files that must NOT be deleted):
```bash
git rm harnesses/opencode/scripts/tests/install-web-tools.test.mjs
git rm harnesses/opencode/scripts/tests/installer-confirmation.test.mjs
git rm harnesses/opencode/scripts/tests/installer-receipt.test.mjs
git rm harnesses/opencode/scripts/tests/installer-repeat-install.test.mjs
git rm harnesses/opencode/scripts/tests/installer-wiring.test.mjs
git rm harnesses/opencode/scripts/tests/merge-config.test.mjs
git rm harnesses/opencode/scripts/tests/package-fragment-merge.test.mjs
git rm harnesses/opencode/scripts/tests/uninstall-restore.test.mjs
```
**Keep** (unrelated web-tools *plugin runtime* tests, confirmed by content — do not delete): `web-tools-budget-oneshot.test.mjs`, `web-tools-budget-pricing.test.mjs`, `web-tools-cache-eviction.test.mjs`, `web-tools-cli-argv.test.mjs`, `web-tools-config-command.test.mjs`, `web-tools-config-validation.test.mjs`, `web-tools-config.test.mjs`, `web-tools-gemini-hardening.test.mjs`, `web-tools-plugin-assembly.test.mjs`, `web-tools-plugin-execute.test.mjs`, `web-tools-pricing-scope.test.mjs`, `web-tools-pricing.test.mjs`, `web-tools-provider-usage.test.mjs`, `web-tools-robustness.test.mjs`, `web-tools-runtime-hardening.test.mjs`, `web-tools-tool-hardening.test.mjs`, `web-tools-transport-select.test.mjs`, `web-tools-validate.test.mjs`, `web-tools-vertex-auth.test.mjs`.

**42B.8 — cleanup now-empty directories** (git doesn't track empty dirs — cosmetic filesystem hygiene, run last, after all `git mv`/`git rm` steps land):
```bash
rmdir scripts                         # root: held only the 3 relocated shared scripts
rmdir harnesses/claude-code/scripts   # held only bootstrap.sh + uninstall.sh, both relocated
rmdir harnesses/pi-agent/scripts      # held only install-pi-agent.sh, relocated
```

**42B.9 — Verification:**
```bash
bash -n install.sh uninstall.sh packages/cli/src/targets/claude-code/install.sh packages/cli/src/targets/claude-code/uninstall.sh packages/cli/src/targets/pi-agent/install.sh packages/cli/src/shared/*.sh
grep -rn "harnesses/claude-code/scripts/\|harnesses/pi-agent/scripts/install-pi-agent\|^scripts/install-vendored-skills\|^scripts/install-external-skills\|^scripts/github-setup-check" --include="*.md" --include="*.json" --include="*.yml" . 2>/dev/null | grep -v "docs/superpowers/"
# ^ should be zero hits outside historical docs/superpowers/ narrative files
```

### Task 42C: `docs/superpowers/` — full cross-harness alignment

**Context:** `dev` branch commit `1d68581` (2026-07-02) already reorganized `docs/superpowers/` into `plans/`+`specs/`+`archive/{plans,specs,reviews}` at the monorepo root, and cleared `harnesses/claude-code/docs/`. This worktree branch diverged before that commit and has been editing the old flat structure ever since — a branch-timing gap, not a content conflict (worktree's copies are confirmed strictly ahead in content, nothing to lose).

**Important correction found during drafting:** this worktree's branch (`feature/opencode-harness-v2`) diverged from `dev` *before* commit `1d68581` landed, so this worktree's own root `docs/superpowers/` never received that reorg — it only has 2 leftover files from an earlier restructure. **Every move below is a create, not an overwrite** (verified: `diff` against the worktree's own root paths errors "No such file or directory" for the canonical plan/spec; safety was instead confirmed by diffing against `dev`'s copies via `git show dev:<path>`, which matched — all 15 non-canonical files are byte-identical to what `dev` already promoted/archived).

**42C.1 — live file inventory** (confirmed via real `find`):
```
harnesses/opencode/docs/superpowers/ledgers/opencode-harness-v2-execution-ledger.md   (untracked — see note below)
harnesses/opencode/docs/superpowers/plans/{2026-06-18-opencode-all-implementation-plan,2026-06-18-session-vault-record-and-cleanup-implementation-plan,2026-06-18-web-tools-v0.1-implementation-plan,2026-06-20-opencode-all-hard-archive-index-plan,2026-06-23-opencode-all-fresh-session-and-performance,opencode-harness-v2-plan}.md
harnesses/opencode/docs/superpowers/reviews/2026-06-21-opencode-all-hard-archive-review.md
harnesses/opencode/docs/superpowers/specs/{2026-06-18-opencode-all-design,2026-06-18-session-vault-record-and-cleanup,2026-06-18-web-tools-v0.1-design,2026-06-23-opencode-all-fresh-session-design,2026-06-30-opencode-harness-redesign-design}.md
harnesses/claude-code/docs/superpowers/plans/{2026-05-27-satori-v1,2026-06-17-satori-implementation,2026-06-23-kuma-v1}.md
harnesses/claude-code/docs/superpowers/specs/{2026-05-26-satori-v1-spec,2026-06-23-kuma-v1-spec}.md
```
**Working-tree wrinkle:** `git status --short` shows the ledger was already manually renamed unstaged (`D .../plans/opencode-harness-v2-execution-ledger.md`, `?? .../ledgers/`), and the untracked new-path copy is byte-identical to the deleted tracked one. Because the new path is untracked, `git mv` fails on it (`fatal: not under version control`) — use `mv` + `git add` + `git rm` instead, per 42C.2 below.

**42C.2 — exact commands, run in this order from the worktree root:**
```bash
# 1. Ledger (source untracked — git mv fails on untracked files)
mkdir -p docs/superpowers/ledgers
mv harnesses/opencode/docs/superpowers/ledgers/opencode-harness-v2-execution-ledger.md docs/superpowers/ledgers/opencode-harness-v2-execution-ledger.md
git add docs/superpowers/ledgers/opencode-harness-v2-execution-ledger.md
git rm harnesses/opencode/docs/superpowers/plans/opencode-harness-v2-execution-ledger.md

# 2. Canonical opencode plan + spec (root docs/superpowers/plans and /specs already exist, no mkdir needed)
git mv harnesses/opencode/docs/superpowers/plans/opencode-harness-v2-plan.md docs/superpowers/plans/opencode-harness-v2-plan.md
git mv harnesses/opencode/docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md

# 3. Canonical claude-code plan + spec
git mv harnesses/claude-code/docs/superpowers/plans/2026-05-27-satori-v1.md docs/superpowers/plans/2026-05-27-satori-v1.md
git mv harnesses/claude-code/docs/superpowers/specs/2026-05-26-satori-v1-spec.md docs/superpowers/specs/2026-05-26-satori-v1-spec.md

# 4. Archive dirs don't exist yet at this worktree's root — create once
mkdir -p docs/superpowers/archive/plans docs/superpowers/archive/specs docs/superpowers/archive/reviews

# 5. Archive: 10 remaining opencode-side files
git mv harnesses/opencode/docs/superpowers/plans/2026-06-18-opencode-all-implementation-plan.md docs/superpowers/archive/plans/2026-06-18-opencode-all-implementation-plan.md
git mv harnesses/opencode/docs/superpowers/plans/2026-06-18-session-vault-record-and-cleanup-implementation-plan.md docs/superpowers/archive/plans/2026-06-18-session-vault-record-and-cleanup-implementation-plan.md
git mv harnesses/opencode/docs/superpowers/plans/2026-06-18-web-tools-v0.1-implementation-plan.md docs/superpowers/archive/plans/2026-06-18-web-tools-v0.1-implementation-plan.md
git mv harnesses/opencode/docs/superpowers/plans/2026-06-20-opencode-all-hard-archive-index-plan.md docs/superpowers/archive/plans/2026-06-20-opencode-all-hard-archive-index-plan.md
git mv harnesses/opencode/docs/superpowers/plans/2026-06-23-opencode-all-fresh-session-and-performance.md docs/superpowers/archive/plans/2026-06-23-opencode-all-fresh-session-and-performance.md
git mv harnesses/opencode/docs/superpowers/reviews/2026-06-21-opencode-all-hard-archive-review.md docs/superpowers/archive/reviews/2026-06-21-opencode-all-hard-archive-review.md
git mv harnesses/opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md docs/superpowers/archive/specs/2026-06-18-opencode-all-design.md
git mv harnesses/opencode/docs/superpowers/specs/2026-06-18-session-vault-record-and-cleanup.md docs/superpowers/archive/specs/2026-06-18-session-vault-record-and-cleanup.md
git mv harnesses/opencode/docs/superpowers/specs/2026-06-18-web-tools-v0.1-design.md docs/superpowers/archive/specs/2026-06-18-web-tools-v0.1-design.md
git mv harnesses/opencode/docs/superpowers/specs/2026-06-23-opencode-all-fresh-session-design.md docs/superpowers/archive/specs/2026-06-23-opencode-all-fresh-session-design.md

# 6. Archive: 3 remaining claude-code-side files (content confirmed byte-identical to dev's archive copies)
git mv harnesses/claude-code/docs/superpowers/plans/2026-06-17-satori-implementation.md docs/superpowers/archive/plans/2026-06-17-satori-implementation.md
git mv harnesses/claude-code/docs/superpowers/plans/2026-06-23-kuma-v1.md docs/superpowers/archive/plans/2026-06-23-kuma-v1.md
git mv harnesses/claude-code/docs/superpowers/specs/2026-06-23-kuma-v1-spec.md docs/superpowers/archive/specs/2026-06-23-kuma-v1-spec.md

# 7. Cleanup now-empty trees (git mv does NOT auto-remove emptied source directories — confirmed empirically)
rmdir harnesses/opencode/docs/superpowers/ledgers
rmdir harnesses/opencode/docs/superpowers/plans
rmdir harnesses/opencode/docs/superpowers/reviews
rmdir harnesses/opencode/docs/superpowers/specs
rmdir harnesses/opencode/docs/superpowers
rmdir harnesses/claude-code/docs/superpowers/plans
rmdir harnesses/claude-code/docs/superpowers/specs
rmdir harnesses/claude-code/docs/superpowers
rmdir harnesses/claude-code/docs
```

**42C.3 — path-reference sweep:** excluding `graphify-out/` (generated, already-known-stale per 42G, not a functional reference) and historical `docs/superpowers/` narrative files, the only real hit is inside this plan file itself (narrative prose describing this very migration in past/prescriptive tense — not a functional link, no tooling depends on it). No replacement required.

**42C.4 — Verification:**
```bash
find harnesses/opencode/docs harnesses/claude-code/docs -type f 2>&1   # should error "No such file or directory" (both removed)
find docs/superpowers -type f | wc -l                                  # should be higher than before by exactly the file count moved
```

### Task 42D: Docs cleanup — cut stale/duplicative reference docs, consolidate model routing into one JSON

**42D.1 — delete 5 dead docs/dirs** (existence confirmed):
```bash
git rm docs/agent-template.md
git rm harnesses/opencode/docs/agent-description-rubric.md
git rm harnesses/opencode/docs/architecture.md
git rm harnesses/opencode/rules/model-budget.md
git rm -r packages/agent-cores/
```
Rationale per file: `agent-template.md` describes a frontmatter shape (`name:`, `model:`) v2 forbids, fully superseded. `agent-description-rubric.md` is an unenforced checklist (confirmed no lint script checks its rules) — replaced by 3 links to the authoritative upstream source, see 42D.2. `architecture.md`'s wiring/meta-index function is superseded once `graphify-out/` is regenerated (42G, deferred); no hand-written stopgap needed. `model-budget.md` is fully subsumed by the routing-manifest.json v11 consolidation (42D.4) and is actively wrong today (`gpt-5.4` isn't routed to anything, `kimi-k2.6` miscategorized as "costly, use sparingly" while it's a live Tier-2 primary). `packages/agent-cores/` is confirmed dead by two independent investigations — zero consumers, describes agents (`shiranui`, `sojobo`) no longer in the active fleet.

**42D.2 — fix every referrer of the 5 deleted paths** (grep-verified, functional hits only — historical `docs/superpowers/` narrative files excluded, not edited):
```bash
python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("README.md")
text = p.read_text()
old = "| `docs/` | All of the above | Shared cross-harness docs: GITHUB.md, agent-template.md |"
new = "| `docs/` | All of the above | Shared cross-harness docs: GITHUB.md |"
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/config/AGENTS.md")
text = p.read_text()
old = "| `docs/architecture.md` | Plugin buckets, skills pipeline, finance suite, helper-script ownership |\n"
assert text.count(old) == 1
p.write_text(text.replace(old, ""))
PYEOF

python3 - <<'PYEOF'
import pathlib, json
p = pathlib.Path("harnesses/opencode/config/fleet-manifest.json")
data = json.loads(p.read_text())
for comp in data["components"]:
    if comp["id"] == "docs-reference":
        comp["files"] = [f for f in comp["files"] if f not in ("docs/architecture.md", "docs/agent-description-rubric.md")]
p.write_text(json.dumps(data, indent=2) + "\n")
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/scripts/dev/agent-fleet-audit.mjs")
text = p.read_text()
old = "'- Review rubric: `docs/agent-description-rubric.md`',"
new = ("'- Agent frontmatter reference: see',\n"
       "  '  <https://opencode.ai/docs/agents/#markdown>, <https://opencode.ai/docs/agents/#json>, <https://opencode.ai/docs/agents/#options>',\n"
       "  '  (local rubric retired 2026-07-03; upstream docs are authoritative)',")
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/scripts/tests/agent-reference-integrity.test.mjs")
text = p.read_text()
old1 = "const ACTIVE_DOC_SUBDIRS = ['docs/architecture.md', 'docs/OPERATOR.md', 'docs/agent-description-rubric.md', 'docs/manifest-schema.md', 'docs/workflows.md', 'docs/routing-manifest.json'];"
new1 = "const ACTIVE_DOC_SUBDIRS = ['docs/OPERATOR.md', 'docs/manifest-schema.md', 'docs/workflows.md', 'docs/routing-manifest.json'];"
assert text.count(old1) == 1
text = text.replace(old1, new1)
old2 = "const DOC_ALLOWLIST = new Set(['docs/agent-description-rubric.md', 'docs/archive/agent-fleet-structural-findings.md', 'agents/chizu--implementation-planner.md', 'agents/shiranui--migration-guide.md', 'agents/sojobo--system-strategist.md']);"
new2 = "const DOC_ALLOWLIST = new Set(['docs/archive/agent-fleet-structural-findings.md', 'agents/chizu--implementation-planner.md', 'agents/shiranui--migration-guide.md', 'agents/sojobo--system-strategist.md']);"
assert text.count(old2) == 1
text = text.replace(old2, new2)
p.write_text(text)
PYEOF
```
**Note:** the `ACTIVE_DOC_SUBDIRS`/`DOC_ALLOWLIST` edit above still lists `docs/OPERATOR.md` — that file is deleted in 42D.6 below; re-run this same test file's list once more after 42D.6 to drop `docs/OPERATOR.md` too (left as two passes deliberately, since 42D.6's routing-manifest.json v11 migration is logically separate from this dead-doc cleanup pass).

**42D.3 — consolidate `docs/models/` prompting guides into `future-work/`** (park for future use, not delete — these contain real prompting-nuance content):
```bash
mkdir -p harnesses/opencode/future-work/docs/models
# future-work/docs/models/ (9 files: deepseek,gemini,gemma,glm,kimi,minimax,openai,opensource,qwen) is the superset —
# already the right destination, just needs root's 2 now-redundant files removed and the set force-tracked in git.
git rm docs/models/gemini.md docs/models/openai.md
cat > harnesses/opencode/future-work/docs/models/NOTES.md <<'EOF'
# Model prompting-guide notes (parked 2026-07-03)

This directory holds per-model-family prompting-nuance guides (delimiters, temperature,
reasoning-effort conventions), parked here rather than deleted since the content itself
is real and reusable — just not wired into any active v2 agent today.

**Known staleness, read before reviving:** the example agent names cited across these
9 files mix genuinely-retired agents (removed outright, e.g. azukiarai--data-sifter,
henge--format-shifter, yamabiko--source-echo) with future-work-shelved agents (e.g.
kotodama--prose-polisher, still parked under future-work/agents/). Neither category
matches the current active 15-agent v2 fleet. Before reviving any of this content,
re-derive the agent-name examples against whatever fleet is active at revival time —
do not assume the names in these files are current.
EOF
git add -f harnesses/opencode/future-work/docs/models
```
(`future-work/docs/models/` currently has zero tracked files despite the blanket `.gitignore` rule on `harnesses/opencode/future-work/` — `git add -f` is required, matching the existing precedent of `future-work/agents/*.md` and `future-work/npm-package/*` both being tracked past the same blanket rule.)

**42D.4 — `docs/routing-manifest.json` v11: full replacement content.** Extracted every model ID appearing in the current `routing-manifest.json` v10 or `OPERATOR.md` — both sources produce the same 13 models, no extras. All 15 agents migrated with **primary/fallback values unchanged** (schema migration only, no re-evaluation — see scope note below).

**Judgment calls surfaced during drafting, flag for review before/during implementation:**
1. `daikoku--finance-steward` and `oni--red-team-reviewer` are each listed under *two* tiers in `OPERATOR.md` (Tier 1 "reserve/high-judgment" AND their structural tier, same primary/fallback both times, only Tier 1's listing has an explicit rationale). Assigned **tier 1** to both below (the more specific classification) — this is exactly the kind of duplicated-data problem the migration removes, but someone should confirm this call.
2. `google-vertex/gemini-3.1-pro-preview` and `opencode-go/glm-5.1`: `OPERATOR.md`'s prose reads as "never use as primary" for both, but `model-resolve.mjs`'s actual enforced `RESERVED_MODELS` gives both `maxPrimary: 1` — same as the two models `OPERATOR.md` explicitly permits as primary. Preserved the code's actual live-enforced values below (neither model is currently used as primary anyway, so this doesn't change current behavior) — flag whether `maxPrimary` should tighten to `0` for these two to match the stricter prose reading.
3. `rules/model-budget.md` (being deleted, 42D.1) references two models absent from all current routing data (`google-vertex/gemini-3.5-flash`, `openai/gpt-5.4` — not `gpt-5.4-mini`) — stale, not migrated into the JSON below; they don't belong anywhere in it.

```bash
cat > docs/routing-manifest.json <<'EOF'
{
  "version": "v11",
  "models": {
    "openai/gpt-5.5": { "pool": "openai-flat-sub", "reserveCap": { "maxPrimary": 1, "maxFirstFallback": 1 } },
    "openai/gpt-5.4-mini": { "pool": "openai-flat-sub", "reserveCap": null },
    "google-vertex/gemini-3.1-pro-preview": { "pool": "vertex-reserve", "reserveCap": { "maxPrimary": 1, "maxFirstFallback": 1 } },
    "opencode-go/kimi-k2.6": { "pool": "opencode-go-metered", "reserveCap": null },
    "opencode-go/kimi-k2.5": { "pool": "opencode-go-metered", "reserveCap": null },
    "opencode-go/qwen3.7-max": { "pool": "opencode-go-metered", "reserveCap": { "maxPrimary": 1, "maxFirstFallback": 1 } },
    "opencode-go/qwen3.6-plus": { "pool": "opencode-go-metered", "reserveCap": null },
    "opencode-go/glm-5": { "pool": "opencode-go-metered", "reserveCap": null },
    "opencode-go/glm-5.1": { "pool": "opencode-go-metered", "reserveCap": { "maxPrimary": 1, "maxFirstFallback": 1 } },
    "opencode-go/deepseek-v4-pro": { "pool": "opencode-go-metered", "reserveCap": null },
    "opencode-go/deepseek-v4-flash": { "pool": "opencode-go-metered", "reserveCap": null },
    "opencode-go/mimo-v2.5": { "pool": "opencode-go-metered", "reserveCap": null },
    "opencode-go/minimax-m2.7": { "pool": "opencode-go-metered", "reserveCap": null }
  },
  "agents": {
    "kantoku--workflow-director": { "tier": 2, "primary": "opencode-go/kimi-k2.6", "fallback": ["opencode-go/kimi-k2.5"], "why": "Workflow specialist: top-level orchestration and domain judgment." },
    "kyakuhon--spec-planner": { "tier": 2, "primary": "opencode-go/qwen3.6-plus", "fallback": ["opencode-go/glm-5"], "why": "Workflow specialist: top-level orchestration and domain judgment." },
    "tsukumogami--code-forgemaster": { "tier": 2, "primary": "opencode-go/kimi-k2.5", "fallback": ["opencode-go/glm-5.1"], "why": "Workflow specialist: top-level orchestration and domain judgment." },
    "fudo--security-guardian": { "tier": 2, "primary": "opencode-go/kimi-k2.6", "fallback": ["opencode-go/deepseek-v4-pro"], "why": "Workflow specialist: top-level orchestration and domain judgment." },
    "tsuchigumo--research-weaver": { "tier": 2, "primary": "opencode-go/kimi-k2.5", "fallback": ["opencode-go/glm-5"], "why": "Workflow specialist: top-level orchestration and domain judgment." },
    "daikoku--finance-steward": { "tier": 1, "primary": "opencode-go/qwen3.7-max", "fallback": ["opencode-go/kimi-k2.5"], "why": "Finance errors compound across the workflow; reserve/high-judgment placement." },
    "kagami--verifier": { "tier": 3, "primary": "openai/gpt-5.4-mini", "fallback": ["opencode-go/deepseek-v4-flash"], "why": "Subagent review and support." },
    "hanko--git-seal": { "tier": 3, "primary": "openai/gpt-5.4-mini", "fallback": ["opencode-go/mimo-v2.5"], "why": "Subagent review and support." },
    "hansei--lesson-keeper": { "tier": 3, "primary": "opencode-go/glm-5", "fallback": ["opencode-go/minimax-m2.7"], "why": "Subagent review and support." },
    "kura--knowledge-banker": { "tier": 3, "primary": "opencode-go/deepseek-v4-flash", "fallback": ["opencode-go/minimax-m2.7"], "why": "Subagent review and support." },
    "bakeneko--bug-hunter": { "tier": 3, "primary": "opencode-go/deepseek-v4-pro", "fallback": ["opencode-go/kimi-k2.5"], "why": "Subagent review and support." },
    "oni--red-team-reviewer": { "tier": 1, "primary": "openai/gpt-5.5", "fallback": ["google-vertex/gemini-3.1-pro-preview"], "why": "Adversarial review quality is worth the premium cap; reserve/high-judgment placement." },
    "general": { "tier": 4, "primary": "opencode-go/mimo-v2.5", "fallback": ["opencode-go/minimax-m2.7"], "why": "Bounded execution. Worker tier: cheap, high-volume execution layer." },
    "explore": { "tier": 4, "primary": "opencode-go/qwen3.6-plus", "fallback": ["opencode-go/minimax-m2.7"], "why": "Read-only repo mapping. Worker tier." },
    "scout": { "tier": 4, "primary": "opencode-go/qwen3.6-plus", "fallback": ["opencode-go/minimax-m2.7"], "why": "External docs and upstream recon. Worker tier." }
  }
}
EOF
```

**42D.5 — `scripts/model-resolve.mjs`: exact sequential edits** (apply in order, each `old_string` is unique in the file):

Edit 1 — drop the hardcoded `RESERVED_MODELS` object:
```
old: const ROUTING_MANIFEST = join(FLEET_ROOT, 'docs/routing-manifest.json');
     const RESERVED_MODELS = {
       'opencode-go/glm-5.1': { maxPrimary: 1, maxFirstFallback: 1 },
       'opencode-go/qwen3.7-max': { maxPrimary: 1, maxFirstFallback: 1 },
       'google-vertex/gemini-3.1-pro-preview': { maxPrimary: 1, maxFirstFallback: 1 },
       'openai/gpt-5.5': { maxPrimary: 1, maxFirstFallback: 1 },
     };
new: const ROUTING_MANIFEST = join(FLEET_ROOT, 'docs/routing-manifest.json');
     // Reserve caps live in routing-manifest.json's models[modelId].reserveCap
     // (v11 schema), read at call time -- see wouldExceedReservedCap().
```
Edit 2 — `collectDesiredModels`: flat `agents` instead of `specialists`+`subagents`:
```
old: const allAgents = { ...manifest.specialists, ...manifest.subagents };
new: const allAgents = { ...manifest.agents };
```
Edit 3 — `wouldExceedReservedCap` reads from the manifest:
```
old: function wouldExceedReservedCap(resolved, model, role) {
       const reserved = RESERVED_MODELS[model];
new: function wouldExceedReservedCap(manifest, resolved, model, role) {
       const reserved = manifest.models?.[model]?.reserveCap;
```
Edit 4 — `findReplacement` signature + both internal `wouldExceedReservedCap` call sites: add a `manifest` first parameter to `findReplacement(...)`, and prefix both of its internal `wouldExceedReservedCap(resolved, model, role)` calls with `manifest,` → `wouldExceedReservedCap(manifest, resolved, model, role)`.

Edit 5 — `validateInvariants` signature + its reserved-model loop:
```
old: function validateInvariants(resolved) {
       const errors = [];
       ...
       for (const [model, limits] of Object.entries(RESERVED_MODELS)) {
new: function validateInvariants(manifest, resolved) {
       const errors = [];
       ...
       const reservedModels = Object.fromEntries(
         Object.entries(manifest.models || {}).filter(([, m]) => m.reserveCap).map(([id, m]) => [id, m.reserveCap])
       );
       for (const [model, limits] of Object.entries(reservedModels)) {
```
Edit 6 — `resolveModels()`'s `allAgentsConfig` construction:
```
old: const allAgentsConfig = { ...manifest.specialists, ...manifest.subagents };
new: const allAgentsConfig = { ...manifest.agents };
```
Edit 7 — thread `manifest` through all 4 `findReplacement(...)` call sites inside the `desired` loop (add `manifest,` as the first argument to each) and into the `validateInvariants(resolved)` call → `validateInvariants(manifest, resolved)`.

Edit 8 — `resolvedManifest` construction: flat `agents`, preserving `tier`/`why` (this is a correctness fix, not just a rename — `cfg` only carries `primary`/`heavy`/`simple`/`fallback`, so a shallow rename would silently drop every agent's `tier`/`why` metadata on every install):
```
old: const resolvedManifest = { ...manifest, specialists: {}, subagents: {} };
     for (const [name, cfg] of Object.entries(resolved)) {
       if (manifest.specialists?.[name]) { resolvedManifest.specialists[name] = cfg; continue; }
       if (manifest.subagents?.[name]) { resolvedManifest.subagents[name] = cfg; }
     }
new: const resolvedManifest = { ...manifest, agents: {} };
     for (const [name, cfg] of Object.entries(resolved)) {
       if (manifest.agents?.[name]) {
         resolvedManifest.agents[name] = { ...manifest.agents[name], ...cfg };
       }
     }
```
No other function in this file touches `specialists`/`subagents`/`RESERVED_MODELS` (verified by full-file read).

**42D.6 — every other consumer of the old schema** (grep-verified, exact fix per file):
```bash
python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/plugins/failover/migawari.js")
text = p.read_text()
old = "  const entry = manifest.specialists?.[agentName] ?? manifest.subagents?.[agentName];"
new = "  const entry = manifest.agents?.[agentName];"
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("future-work/npm-package/src/load-agents.ts")
text = p.read_text()
old1 = ('interface RoutingManifest {\n  version: string;\n'
        '  specialists?: Record<string, { primary: string; fallback?: string[] }>;\n'
        '  subagents?: Record<string, { primary: string; fallback?: string[] }>;\n'
        '  [key: string]: unknown;\n}')
new1 = ('interface RoutingManifest {\n  version: string;\n'
        '  agents?: Record<string, { tier: number; primary: string; fallback?: string[]; why?: string }>;\n'
        '  [key: string]: unknown;\n}')
assert text.count(old1) == 1
text = text.replace(old1, new1)
old2 = ('  const modelMap: Record<string, { primary: string; fallback?: string[] }> = {\n'
        '    ...manifest.specialists,\n    ...manifest.subagents,\n  };')
new2 = ('  const modelMap: Record<string, { primary: string; fallback?: string[] }> = {\n'
        '    ...manifest.agents,\n  };')
assert text.count(old2) == 1
text = text.replace(old2, new2)
p.write_text(text)
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("future-work/npm-package/tests/config-hook.test.mjs")
text = p.read_text()
old = "const modelMap = { ...routingManifest.specialists, ...routingManifest.subagents };"
new = "const modelMap = { ...routingManifest.agents };"
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/scripts/tests/routing-manifest.test.mjs")
text = p.read_text()
old1 = ("const RESERVED = {\n"
        "  'opencode-go/glm-5.1': { maxPrimary: 1, maxFirstFallback: 1, primaries: [], firstFallbacks: [] },\n"
        "  'opencode-go/qwen3.7-max': { maxPrimary: 1, maxFirstFallback: 1, primaries: [], firstFallbacks: [] },\n"
        "  'google-vertex/gemini-3.1-pro-preview': { maxPrimary: 1, maxFirstFallback: 1, primaries: [], firstFallbacks: [] },\n"
        "  'openai/gpt-5.5': { maxPrimary: 1, maxFirstFallback: 1, primaries: [], firstFallbacks: [] },\n"
        "};\n\nconst allAgents = { ...manifest.specialists, ...manifest.subagents };")
new1 = ("const RESERVED = Object.fromEntries(\n"
        "  Object.entries(manifest.models || {})\n"
        "    .filter(([, m]) => m.reserveCap)\n"
        "    .map(([id, m]) => [id, { ...m.reserveCap, primaries: [], firstFallbacks: [] }])\n"
        ");\n\nconst allAgents = { ...manifest.agents };")
assert text.count(old1) == 1
p.write_text(text.replace(old1, new1))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/scripts/tests/model-resolve.test.mjs")
text = p.read_text()
old = ("  const expectedAgents = {\n    ...manifest.specialists,\n    ...manifest.subagents,\n  };")
new = "  const expectedAgents = { ...manifest.agents };"
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF
```
Also delete the dead, never-called `createTestManifest()` function (lines ~11-33 of `model-resolve.test.mjs`) — confirmed by full-file read that no test calls it; every test exercises the real `docs/routing-manifest.json` on disk via `runResolver()` with no arguments.
```bash
python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/scripts/tests/installer-confirmation.test.mjs")
text = p.read_text()
old = ("    expect(routing.version).toBeDefined();\n"
       "    expect(routing.specialists).toBeDefined();\n"
       "    expect(routing.subagents).toBeDefined();")
new = "    expect(routing.version).toBeDefined();\n    expect(routing.agents).toBeDefined();"
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("harnesses/opencode/scripts/tests/agents-match-manifest.test.mjs")
text = p.read_text()
old = "const manifestEntry = (manifest.specialists ?? {})[name] || (manifest.subagents ?? {})[name];"
new = "const manifestEntry = (manifest.agents ?? {})[name];"
assert text.count(old) == 1
p.write_text(text.replace(old, new))
PYEOF
```
**No fix needed (verified, not assumed):** `scripts/lib/agent-fleet-map.mjs` (its `V2_FLEET`/`GROUPS` are hardcoded independently, don't read the manifest at runtime), `scripts/install-fleet.sh` (retired by 42B anyway; treats resolver output as opaque JSON via `jq`, never accesses `.specialists`/`.subagents` by key), `config/fleet-manifest.json`/`config/opencode.jsonc` (path/comment references only, no key-level access), `docs/agent-description-rubric.md` (deleted by 42D.1 anyway), `future-work/npm-package/package.json` (path only, no schema access), `scripts/tests/agent-reference-integrity.test.mjs` (treats the file as plain text for stale-token scanning, schema-shape-agnostic), `scripts/tests/model-failover.test.mjs`/`scripts/tests/plugin-hook-factories.test.mjs` (call `resolveChain(manifest, ...)`, no direct `.specialists`/`.subagents` access — pass once `migawari.js` above is fixed). **Do not edit** (frozen historical records): `scripts/dev/canaries/RESULTS.md`, anything under `docs/superpowers/`.

**42D.7 — delete `OPERATOR.md`/`rules/model-budget.md`, add README/AGENTS.md pointer paragraph:**
```bash
git rm harnesses/opencode/docs/OPERATOR.md
# rules/model-budget.md already removed in 42D.1
```
`README.md` — replace the "Fleet summary" section's closing line:
```
old: See `docs/OPERATOR.md` for budget tiers and `docs/routing-manifest.json` for exact model assignments.
new: `docs/routing-manifest.json` is the single source of truth for model routing: it lists every routable
     model with its billing pool and reserve cap under `models`, and every agent's tier, primary model,
     fallback chain, and placement rationale under `agents`. There is no separate budget-tier document —
     `scripts/model-resolve.mjs` reads this file directly at install time, so the manifest and the installer
     can never drift out of sync. Edit `docs/routing-manifest.json` directly to change model assignments.
```
`harnesses/opencode/config/AGENTS.md` — replace the "## Model Budget" section:
```
old: ## Model Budget

     Model routing source of truth: `docs/routing-manifest.json` **version `v10`**.

     - `opencode.jsonc` selects the active runtime config
     - `docs/routing-manifest.json` defines primary/fallback chains
     - `docs/OPERATOR.md` explains pool budgeting and reserved-model caps

     Do not rebalance premium models ad hoc inside prompts. Change the runtime pair instead.
new: ## Model Budget

     Model routing source of truth: `docs/routing-manifest.json` **version `v11`**.

     - `opencode.jsonc` selects the active runtime config
     - `docs/routing-manifest.json` defines everything else: per-model billing pool and reserve cap
       (`models`), and per-agent tier, primary model, fallback chain, and placement rationale (`agents`).
       `scripts/model-resolve.mjs` reads this file directly at install time — it is the only place this
       policy is encoded.

     Do not rebalance premium models ad hoc inside prompts. Change the runtime pair instead.
```
Also update the "On-Demand References" table in the same file — replace:
```
old: | `docs/routing-manifest.json` | Model routing, fallbacks, v10 assignments |
     | `docs/OPERATOR.md` | Budget policy and reserved-model caps |
new: | `docs/routing-manifest.json` | Model routing, tiers, pools, reserve caps, fallbacks — v11 assignments (single source of truth) |
```
`harnesses/opencode/docs/architecture.md` was already deleted in 42D.1 — no update needed there. `AGENTS.md` (repo root) — replace:
```
old: - `docs/`: architecture, workflows, operator guide, manifest schema, agent template, `routing-manifest.json`, model guides, `superpowers/specs/` design docs
new: - `docs/`: workflows, operator guide, manifest schema, `routing-manifest.json` (routing, tiers, pools, and reserve caps — single source of truth), model guides, `superpowers/specs/` design docs
```

**42D.8 — unify the two skills-manifest.json systems.** `packages/manifests/skills-manifest.json` (feeds `install-external-skills.sh`/`install-vendored-skills.sh`, claude-code) and `harnesses/opencode/config/skills-manifest.json` (feeds `sync-skills.mjs`/`pull-external-skills.mjs`/`apply-patches.mjs`, opencode) are two parallel pin/pull systems for the same job. Exact unified schema is intentionally left open for implementation-time design (unlike the rest of 42D, this genuinely needs a fresh design pass, not a mechanical migration) — at minimum, both `packages/cli/src/shared/install-external-skills.sh` (42B) and `packages/cli/src/targets/opencode-fleet/resolve.ts`'s `listExternalSkillNames()` (42A.4) should end up reading the same manifest file/shape. Not blocking for 42A-42C/42E-42G to land; sequence this sub-step last within 42D if time-constrained.

**42D.9 — Verification:**
```bash
bun test harnesses/opencode/scripts/tests/agents-match-manifest.test.mjs
bun test harnesses/opencode/scripts/tests/routing-manifest.test.mjs harnesses/opencode/scripts/tests/model-failover.test.mjs harnesses/opencode/scripts/tests/model-resolve.test.mjs
bun test harnesses/opencode/scripts/tests/installer-confirmation.test.mjs harnesses/opencode/scripts/tests/plugin-hook-factories.test.mjs
bun test harnesses/opencode/scripts/tests/
grep -rn "docs/agent-description-rubric.md\|docs/architecture.md\|rules/model-budget.md\|docs/OPERATOR.md" harnesses/opencode/ --include="*.md" --include="*.json" --include="*.mjs" | grep -v "docs/superpowers/"
# ^ should be zero hits
```

### Task 42E: Skills — single source of truth

**Context:** `harnesses/opencode/skills/` and root `skills/` are confirmed byte-for-byte identical — true duplication, not a fork. Root was the originally-intended location (2026-06-24 restructure design put it there; README's structure diagram already calls it "shared cross-ecosystem skills"). The `harnesses/opencode/` copy exists only as a workaround from an earlier session's installer bug fix (`sync-skills.mjs` runs post-copy at the install target, needed a co-located source) — solvable without repo-level duplication once the installer (42A) copies from root `skills/` into the install target itself, same as it already does for `agents/*.md`/`plugins/*.js`.

**Sequencing (real, verified during drafting):** `harnesses/opencode/scripts/install-fleet.sh`'s glob-copy and `scripts/sync-skills.mjs`'s `SKILLS_SOURCE` both currently resolve `skills/`/`skill-patches/` relative to `harnesses/opencode/` (their own `FLEET_ROOT`) — deleting `harnesses/opencode/skills/` before those scripts are retired would break them. **This is resolved automatically by 42B**, which `git rm`s `install-fleet.sh` entirely and relocates the shared-skills logic into 42A's `install.ts` (which already resolves bundled skills from `repoRoot/skills/`, never the harness-local copy). Land 42A+42B before or alongside this task, not after.

**42E.1 — real finding: `docs/GITHUB.md` was already deleted from this branch, mislabeled "stale" in the commit that removed it.** Commit `9a0e464` ("finalize harness redesign spec and clean up stale docs") deleted `docs/GITHUB.md` — but it's still actively referenced by `README.md`, `harnesses/opencode/config/fleet-manifest.json`, and two copies of `hanko--git-seal.md`. It's also missing from local `dev`. This is a real regression, not something this task is optionally fixing — restore it before touching the symlinks that depend on it:
```bash
git show 9a0e464^:docs/GITHUB.md > docs/GITHUB.md
git add docs/GITHUB.md
```
Once restored, `skills/github/GITHUB.md`'s existing symlink target (`../../docs/GITHUB.md`, resolving correctly to root `docs/GITHUB.md`) needs **no separate fix** — the earlier assumption that the symlink itself was wrong was incorrect; the missing file was the actual problem.

**42E.2 — verify duplication, then delete:**
```bash
diff -rq harnesses/opencode/skills/ skills/
# expect: identical except both copies' github/GITHUB.md are symlinks (diff -rq can't compare those directly — every other file matches)
git rm -r harnesses/opencode/skills/
```

**42E.3 — relocate `skill-patches/` to root, alongside `skills/`** (confirmed real, currently-wired via `apply-patches.mjs`, just dormant — contains only `README.md` today, zero actual `*.patch` files exist yet):
```bash
git mv harnesses/opencode/skill-patches/ skill-patches/
```

**42E.4 — delete both redundant `plan/` skill directories** (redundant with the externally-pinned `writing-plans` skill already in the pull pipeline — both directions deleted, not migrated, per explicit decision):
```bash
git rm -r skills/plan/ harnesses/pi-agent/skills/plan/
```

**42E.5 — no change to `harnesses/pi-agent/skills/{commit,research,review}/`.** Confirmed genuinely necessary, not duplication: pi-agent has no agent fleet, only skills, so these are its structural substitute for what opencode achieves via full specialist agents (`hanko--git-seal` for commit, `tsuchigumo--research-weaver` for research, `oni--red-team-reviewer`/`kagami--verifier` for review). Merging them into the shared pool would be actively confusing, not consolidating. `harnesses/pi-agent/package.json`'s `"pi": {"skills": ["./skills"]}` confirms this directory is actively loaded at runtime by the pi.dev extension — leave entirely untouched.

**42E.6 — path-reference fixes:**
```bash
python3 - <<'PYEOF'
import pathlib, json
p = pathlib.Path("harnesses/opencode/config/skills-manifest.json")
data = json.loads(p.read_text())
data["patches_dir"] = "skill-patches"
p.write_text(json.dumps(data, indent=2) + "\n")
PYEOF

python3 - <<'PYEOF'
import pathlib
p = pathlib.Path("skill-patches/README.md")
text = p.read_text()
text = text.replace("harnesses/opencode/skill-patches", "skill-patches")
p.write_text(text)
PYEOF
```
Also update `harnesses/opencode/scripts/tests/sync-skills.test.mjs`'s comment (~line 76, currently describing the harness-local vendored copy) once 42A/42B's `sync-skills.mjs` retirement lands — comment-only, not functional, but will mislead future readers if left describing a mechanism that no longer exists.

**42E.7 — Verification:**
```bash
bun test harnesses/opencode/scripts/tests/
ls docs/GITHUB.md skill-patches/README.md skills/plan harnesses/pi-agent/skills/plan 2>&1
# expect: docs/GITHUB.md and skill-patches/README.md exist; both skills/plan paths report "No such file or directory"
```

### Task 42F: `nio.js`/`tsuchigumo`/agent skill-frontmatter/`fleet-manifest.json` diffs

These close the real gaps 42A's component model depends on: web-tools' custom tool names bypassing the fail-closed gate, the prompt-only (not structural) web-tools fallback contract, and 6 agents having no `skill:` frontmatter block to derive their skill closure from.

**42F.1 — `plugins/gates/nio.js`'s `BLOCKED_TOOLS` gap.** Confirmed in `plugins/tools/web-tools.ts` (lines ~152, 165, 177): the plugin registers exactly `web_search`, `fetch_content`, `maps_search`. `BLOCKED_TOOLS` is a `Set` literal missing all three:
```
old: const BLOCKED_TOOLS = new Set([
       'workflow-advance',
       'deliver',
       'bash',
       'edit',
       'webfetch',
       'websearch',
       'task',
     ]);
new: const BLOCKED_TOOLS = new Set([
       'workflow-advance',
       'deliver',
       'bash',
       'edit',
       'webfetch',
       'websearch',
       'web_search',
       'fetch_content',
       'maps_search',
       'task',
     ]);
```

**42F.2 — `agents/tsuchigumo--research-weaver.md`: 4 exact spots rewritten from "prefer native, fall back to plugin" into an explicit "plugin may not exist" conditional:**

Spot A — `SEARCH_DISCOVERY` section:
```
old: ### `SEARCH_DISCOVERY`
     - Use native `websearch` first.
     - Route fallback discovery through `general` only after native search fails, is
       weak, quota-limited, stale, or otherwise insufficient.
     - Write `.opencode/tmp/<workflow-id>/search-results.md`.
new: ### `SEARCH_DISCOVERY`
     - Native `websearch` is always available and sufficient for baseline discovery;
       try it first for every subquestion.
     - Plugin discovery (`web_search`, routed through `general`) exists only if the
       web-tools plugin component is installed and `web_search` is actually
       registered in the current session. Never assume `web_search` is present —
       confirm it before routing to it. When it is available, use it only after
       native `websearch` fails, is weak, quota-limited, stale, or otherwise
       insufficient.
     - Write `.opencode/tmp/<workflow-id>/search-results.md`.
```

Spot B — `FETCH_PLUGIN_FALLBACK` section:
```
old: ### `FETCH_PLUGIN_FALLBACK`
     - Plugin fallback is allowed only after native `websearch` / `webfetch` fails or
       is insufficient for the approved brief.
     - Route plugin-backed retrieval or extraction through `general`.
     - Do not default to Tavily, Brave, or bx. Use them only if the user explicitly
       asked for them or workflow policy changes.
new: ### `FETCH_PLUGIN_FALLBACK`
     - Native `webfetch` is always available and sufficient for baseline retrieval
       (see `FETCH_NATIVE` above); try it first.
     - Plugin fallback (`fetch_content`, routed through `general`) exists only if
       the web-tools plugin component is installed and `fetch_content` is actually
       registered in the current session. Never assume `fetch_content` is present —
       confirm it before routing to it. When it is available, use it only after
       native `webfetch` fails or is insufficient for the approved brief.
     - Do not default to Tavily, Brave, or bx. Use them only if the user explicitly
       asked for them or workflow policy changes.
```

Spot C — `## Tool Policy` section:
```
old: ## Tool Policy

     Default order for Workflow #4:

     1. Native `websearch` for discovery.
     2. Native `webfetch` for retrieval.
     3. Plugin fallback through `general` when native search/fetch fails or is insufficient.
     4. NotebookLM only when the approved mode requires it.

     No Tavily, Brave, or bx by default.
new: ## Tool Policy

     Default order for Workflow #4:

     1. Native `websearch` for discovery — always available, always sufficient as a baseline, try first.
     2. Native `webfetch` for retrieval — always available, always sufficient as a baseline, try first.
     3. Plugin fallback (`web_search` / `fetch_content` / `maps_search`, routed through `general`) — exists
        ONLY IF the web-tools plugin component is installed and those tools are registered in the current
        session. Never assume they exist. When available, use them only after native search/fetch fails
        or is insufficient.
     4. NotebookLM only when the approved mode requires it.

     No Tavily, Brave, or bx by default.
```

Spot D — `## Failure And Fallback Rules` table rows:
```
old: | Built-in `websearch` weak/fails/quota-limited | Route plugin search fallback through `general`. |
     | Built-in `webfetch` weak/fails/empty | Route plugin fetch fallback through `general`. |
new: | Built-in `websearch` weak/fails/quota-limited | If `web_search` (web-tools plugin) is registered in this session, route plugin search fallback through `general`; otherwise continue with native `websearch` only and note the gap. |
     | Built-in `webfetch` weak/fails/empty | If `fetch_content` (web-tools plugin) is registered in this session, route plugin fetch fallback through `general`; otherwise continue with native `webfetch` only and note the gap. |
```

**42F.3 — missing `skill:` frontmatter on 6 agents.** All 6 confirmed to exist as real `.md` files (none are file-less built-ins). Applying the `kyakuhon--spec-planner.md` shape (`"*": deny` plus explicit allows where the agent's own body content justifies it — conservative, no padding):

`agents/general.md` — body is explicit "no-judgment execution... do not interpret, synthesize, infer, or make judgment calls." Zero allows justified:
```
old: permission:
       bash: allow
       edit: allow
       task: deny
       webfetch: deny
       websearch: deny
new: permission:
       bash: allow
       edit: allow
       task: deny
       webfetch: deny
       websearch: deny
       skill:
         "*": deny
```

`agents/explore.md` — "Return a compact findings table... Do not propose fixes, do not synthesize conclusions, do not edit." Zero allows justified:
```
old: permission:
       edit: deny
       bash: deny
       task: deny
new: permission:
       edit: deny
       bash: deny
       task: deny
       skill:
         "*": deny
```

`agents/scout.md` — external recon fully bounded to `ctx7-docs.mjs`/`gh`; no local skill covers generic doc/package lookup. Zero allows justified:
```
old: permission:
       edit: deny
       bash:
         "bun scripts/ctx7-docs.mjs *": allow
         "ctx7 *": allow
         "gh *": allow
         "*": deny
       task: deny
new: permission:
       edit: deny
       bash:
         "bun scripts/ctx7-docs.mjs *": allow
         "ctx7 *": allow
         "gh *": allow
         "*": deny
       task: deny
       skill:
         "*": deny
```

`agents/hansei--lesson-keeper.md` — body writes `docs/postmortems/**` and distills "durable learnings, postmortems... after a workflow." `post-mortem` skill is a direct match:
```
old: permission:
       bash: deny
       task: deny
       edit:
         "docs/learnings/**": allow
         "docs/postmortems/**": allow
         "docs/security/**": allow
         "docs/verification/**": allow
         "*": deny
new: permission:
       bash: deny
       task: deny
       edit:
         "docs/learnings/**": allow
         "docs/postmortems/**": allow
         "docs/security/**": allow
         "docs/verification/**": allow
         "*": deny
       skill:
         "*": deny
         post-mortem: allow
```

`agents/kura--knowledge-banker.md` — body repeatedly states "Curation only... You do not compute valuation math, normalize models, write investment theses from scratch" (that's `daikoku`'s job). Zero allows justified:
```
old: permission:
       bash:
         "bun scripts/knowledge-bank-finance.mjs *": allow
         "bun scripts/finance-artifact-registry.mjs *": allow
         "bun scripts/finance-source-registry.mjs *": allow
         "*": deny
       edit:
         "research/financial/**": allow
         "docs/knowledge/finance/**": allow
         "*": deny
       task: deny
       question: deny
new: permission:
       bash:
         "bun scripts/knowledge-bank-finance.mjs *": allow
         "bun scripts/finance-artifact-registry.mjs *": allow
         "bun scripts/finance-source-registry.mjs *": allow
         "*": deny
       edit:
         "research/financial/**": allow
         "docs/knowledge/finance/**": allow
         "*": deny
       task: deny
       question: deny
       skill:
         "*": deny
```

`agents/kagami--verifier.md` — owns `VERIFY`/`CITATION_VERIFY`/`MODEL_VALIDATE`/`FRESHNESS_VERIFY`/`CROSS_VERIFY` states. **Weakest-confidence match of the six, flagged for review**: `verification-before-completion-furaide-addendum` is the closest thematic skill, but its own description is implementer-self-check-facing ("use before completing work to ensure implementation meets size constraints"), not dedicated-verifier-facing — confirm this pick fits before finalizing, rather than accepting on drafting-time confidence alone:
```
old: permission:
       bash:
         "bun scripts/verify-run.mjs *": allow
         "bun scripts/workflow-state.mjs *": allow
         "bun scripts/citation-verify.mjs *": allow
         "*": deny
       edit:
         ".opencode/tmp/**": allow
         "*": deny
       task:
         "*": deny
         general: allow
new: permission:
       bash:
         "bun scripts/verify-run.mjs *": allow
         "bun scripts/workflow-state.mjs *": allow
         "bun scripts/citation-verify.mjs *": allow
         "*": deny
       edit:
         ".opencode/tmp/**": allow
         "*": deny
       task:
         "*": deny
         general: allow
       skill:
         "*": deny
         verification-before-completion-furaide-addendum: allow
```

**42F.4 — `config/fleet-manifest.json`'s `coupling` field: freeform prose → structured data.** Every component's `coupling` string becomes `{"usedBy": [...], "safeToRemove": bool, "fallbackBehavior": string|null}`, grep-verified against real consumers (not inferred). **Direction inconsistency, disclosed not silently resolved:** several components' original prose describes the component's *own* dependencies (not who depends on it) — where that's the case, `usedBy` lists those dependency paths instead, noted per entry:

`workflow-gates` (internal bundling, no external consumer named in source prose):
```json
"coupling": { "usedBy": ["plugins/gates/nio.js", "plugins/hooks/audit-logger.js", "plugins/hooks/compaction-injector.js"], "safeToRemove": false, "fallbackBehavior": null }
```
`failover`:
```json
"coupling": { "usedBy": ["scripts/model-resolve.mjs"], "safeToRemove": false, "fallbackBehavior": null }
```
`security-gate` (was already `"coupling": "none"`):
```json
"coupling": { "usedBy": [], "safeToRemove": true, "fallbackBehavior": "no dangerous-code-pattern screening on Edit/Write calls; no replacement mechanism" }
```
`agents-core` (direction note: prose describes agents-core's own dependencies, not external consumers):
```json
"coupling": { "usedBy": ["docs/routing-manifest.json", "scripts/install-fleet.sh", "scripts/merge-config.mjs"], "safeToRemove": false, "fallbackBehavior": null }
```
(Note: `scripts/install-fleet.sh` is retired by 42B — re-verify this entry's accuracy against whatever 42A's `install.ts` actually depends on by the time 42F lands.)

`agent-scripts` (verified: `citation-verify.mjs`/`verify-run.mjs` → `kagami--verifier.md`; `ctx7-docs.mjs` → `scout.md`; `humanize-check.mjs` → `tsuchigumo--research-weaver.md`; `security-severity.mjs` has no direct grant, reached only via `fudo--security-guardian.md`'s `general` dispatch):
```json
"coupling": { "usedBy": ["agents/kagami--verifier.md", "agents/scout.md", "agents/tsuchigumo--research-weaver.md", "agents/fudo--security-guardian.md"], "safeToRemove": false, "fallbackBehavior": null }
```
`rules` (original prose said `opencode.json` — corrected to the real filename `opencode.jsonc`):
```json
"coupling": { "usedBy": ["config/opencode.jsonc"], "safeToRemove": false, "fallbackBehavior": null }
```
`docs-reference` (already `default_on: false`; verified `GITHUB.md`/`github-setup-check.sh` referenced by `fudo`/`hanko`/`skills/github/SKILL.md`):
```json
"coupling": { "usedBy": ["agents/fudo--security-guardian.md", "agents/hanko--git-seal.md", "skills/github/SKILL.md"], "safeToRemove": true, "fallbackBehavior": "agents lose the OPERATOR/manifest-schema/GITHUB.md reference docs; no functional runtime fallback needed since these are reference-only" }
```
`finance` (verified: only `kura--knowledge-banker.md` holds direct grants; `daikoku` has `bash: deny` and only dispatches):
```json
"coupling": { "usedBy": ["agents/kura--knowledge-banker.md"], "safeToRemove": false, "fallbackBehavior": null }
```
`skills` (internal bundling — `sync-skills.mjs`/`pull-external-skills.mjs` are this component's own files):
```json
"coupling": { "usedBy": ["scripts/sync-skills.mjs", "scripts/pull-external-skills.mjs"], "safeToRemove": false, "fallbackBehavior": null }
```
`web-tools` (coupling field was ABSENT entirely — confirmed by direct read, insert as a new key after `"atomic"`, before `"requires_bun"`, matching every other component's key ordering):
```json
"coupling": { "usedBy": ["agents/tsuchigumo--research-weaver.md"], "safeToRemove": true, "fallbackBehavior": "tsuchigumo falls back to native websearch/webfetch (see 42F.2)" }
```

**42F.5 — Verification:**
```bash
grep -n "'2.5-\|deliver\b" harnesses/opencode/plugins/gates/nio.js   # sanity, unrelated to this change
bun test harnesses/opencode/scripts/tests/security-patterns.test.mjs harnesses/opencode/scripts/tests/
bun scripts/lint-dispatch-graph.mjs   # re-run after the 6 skill-frontmatter edits and the coupling-field rewrite
```

### Task 42G: Repo-wide waste — `graphify-out/`

**Finding:** `graphify-out/` is stale and actively misleading, not just unused — it's generated against `dev`/main (absolute paths point at the main checkout, not this worktree) and its graph contains a whole `kuma` plugin that doesn't exist anywhere in this worktree/branch. README currently tells every agent to "start here before reading source files."

**Decision:** flag as stale in README now; defer regeneration (requires a real `GEMINI_API_KEY`/`GOOGLE_API_KEY` call per the archived restructure spec's own regeneration protocol — a deliberate action, not a documentation-cleanup side effect) until 42A-42F have landed, so the graph reflects the post-consolidation state rather than needing regeneration twice.

**42G.1 — exact README edit** (locate wherever `graphify-out/` is currently described as the orientation starting point — read the surrounding paragraph first to match its exact current wording, then insert this caveat immediately after it):
```
Add: **Note (2026-07-03):** `graphify-out/` was generated against a different branch (`dev`) and is currently
stale for this branch's actual file tree — it references at least one plugin (`kuma`) that does not exist here.
Treat it as historical/reference only until it's regenerated; verify anything it claims against the real source
tree first.
```

**42G.2 — Verification:** `grep -n "graphify-out" README.md` — confirm the staleness note appears adjacent to the existing description, not orphaned elsewhere in the file.

### Task 42H: Explicitly out of scope this round

- `opencode-all`'s own standalone installer (a genuinely separate offering from the fleet installer) — was discussed and deferred to a dedicated follow-up brainstorm/plan once 42A-42G are implemented
- Re-evaluating current model choices in `routing-manifest.json` against the 2026 model landscape (scoped out of 42D's JSON consolidation deliberately — see that task's scope note)
- Actually regenerating `graphify-out/` (42G defers this explicitly, requires a live API call)
- Designing the unified skills-manifest.json schema in full (42D.8 leaves this open, flagged as needing a fresh design pass rather than a mechanical migration)

---

## Task 42 — Consolidated Verification (run after 42A-42G all land)

```bash
cd harnesses/opencode
bun test scripts/tests/                 # full suite — should be net +new installer-adjacent tests, -17 retired installer tests
bun scripts/lint-dispatch-graph.mjs
cd ../../scripts/finance && uv run pytest tests -v
cd ../../packages/cli && bun install && bun run typecheck && bun test   # new installer package
cd ../..
grep -rln "docs/agent-description-rubric.md\|harnesses/opencode/docs/architecture.md\|rules/model-budget.md\|docs/OPERATOR.md\|harnesses/claude-code/scripts/bootstrap.sh\|harnesses/pi-agent/scripts/install-pi-agent.sh\|^scripts/install-vendored-skills\|^scripts/install-external-skills\|^scripts/github-setup-check" . 2>/dev/null | grep -v "docs/superpowers/" | grep -v node_modules
# ^ should be zero hits — every reference to a deleted/relocated path has been fixed
```
Manual round trip (per 42A.13): scratch-`$HOME` install/uninstall of `opencode-fleet` via the new `packages/cli` CLI, both global and project scope.

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — Layers/Fleet Migration (T5-T8, T14), Worker+carve-outs (T7, T13-T14), Dispatch Constraint probes (T1-T4), skills tables (T17-T20), plugins (T21-T23), scripts kept/new (T24-T25, T31-T33), WF1-5 states (T10-T12, T24, T26-T30), docs/Risk #9 file list (T8, T16, T34-T35), Verification Plan (T36), npm-plugin distribution (T37-T41). Future Offerings intentionally have no tasks (deferred by spec).
- **Known judgment points left to execution:** external skill pin SHAs (resolved at run time), nurikabe event choice (T22 investigates against live docs), override-fallback branch (T7 Step 4), hub-and-spoke fallback branch (T2/T4), `npm publish` itself (T41 — user-approved action).
- **Packaging boundary:** enforced mechanically by `package.json` `files` + the T37 boundary test; the never-packaged list lives in the Distribution paragraph of this plan's header.
- **Type consistency:** verdict vocab `ok/warn/critical/escalate` used in T25/T27; state names in T24/T29 come 1:1 from the spec's diagrams; agent names match `agents/<file>.md` basenames everywhere.
- **2026-07-03 addendum:** Task 42 (post-ship consolidation — installer rewrite into `packages/cli/`, `docs/superpowers/` cross-harness alignment, docs/skills deduplication, model-routing consolidation) is a findings + follow-on record from a design session, not yet implemented. It supersedes Task 41's local-directory-installer scaffolding (`harnesses/opencode/scripts/install-fleet.sh` and siblings, retired by 42B) rather than extending it. Sections 42A-42H are now expanded to exact copy-pasteable detail (real TypeScript file content, real shell commands, real diffs against the actual current files) specifically so a small model can execute each step without design judgment calls — see the "Sequencing note" at the top of Task 42 for landing order. All decisions were made with the user across the design session; explicitly deferred items (42H) are `opencode-all`'s own installer, a full 2026 model-choice re-evaluation, actual `graphify-out/` regeneration, and the unified skills-manifest.json schema design. **Approval to begin implementation is pending — nothing in Task 42 has been executed yet.**

