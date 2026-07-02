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

---

## Part 7 — Package & Publish (`@furaide/opencode-harness`)

Deliverable: the entire harness (minus the never-packaged list) installs on a user machine with one config line; installer-era scaffolding retired.

### Task 37: Package skeleton

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

**Files:**
- Create: `src/load-agents.ts`, `src/index.ts` (hook body)
- Test: `scripts/tests/config-hook.test.mjs`

- [ ] **Step 1:** Failing tests: calling the plugin's `config` hook with an empty `Config` object results in — (a) 15 `agent` entries whose mode/model/temperature/steps/permission match the `.md` frontmatter; (b) scoped-bash patterns rewritten to absolute package paths (`bun ${pkgDir}/scripts/workflow-state.mjs *`); (c) `instructions` containing the package-absolute paths of `config/AGENTS.md` and every `rules/*.md`; (d) `command` entries from `commands/*.md`; (e) user-defined config wins — if the input already has `agent["kantoku--workflow-director"].model`, the hook must not overwrite it (merge, don't clobber).
- [ ] **Step 2:** `src/load-agents.ts`: factor the frontmatter parser out of `scripts/lint-dispatch-graph.mjs` into `scripts/lib/agent-md.mjs` (single parser, both consumers import it); parse each bundled `agents/*.md` into `{description, mode, model, temperature, steps, permission, prompt}`; resolve models through the bundled `docs/routing-manifest.json` (frontmatter `model:` is not source of truth — same rule as the repo config).
- [ ] **Step 3:** `src/index.ts`: export the plugin function; its `config` hook merges agents/instructions/commands per Step 1 semantics and calls `scripts/sync-skills.mjs` (Task 20) once per version (receipt-gated) for skill delivery.
- [ ] **Step 4:** `bun test scripts/tests/config-hook.test.mjs` → PASS. Commit — `git commit -am "feat(package): config hook registers fleet from bundled md"`

### Task 39: Fold gates, failover, hooks, and web-tools into the package export

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

- [ ] **Step 1:** README for the package consumer surface: install line, what gets registered, skill sync behavior, how to override models/permissions in user config (the merge-don't-clobber rule from Task 38), uninstall (remove plugin line + delete skills receipt). This lands in the harness-root `README.md` (repo-only) AND a trimmed `config/AGENTS.md` pointer — do not create a second packaged readme.
- [ ] **Step 2:** Publish dry-run: `npm publish --dry-run --access public` from `harnesses/opencode/`; verify name/version/files. Actual `npm publish` is a user-approved action — stop and ask before running it.
- [ ] **Step 3:** Re-run the Task 36 verification sweep plus: package-boundary test, config-hook parity test (hook output ⊇ repo `opencode.jsonc` agent declarations), local install test. All green → hand off for branch finish per repo git conventions.

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — Layers/Fleet Migration (T5-T8, T14), Worker+carve-outs (T7, T13-T14), Dispatch Constraint probes (T1-T4), skills tables (T17-T20), plugins (T21-T23), scripts kept/new (T24-T25, T31-T33), WF1-5 states (T10-T12, T24, T26-T30), docs/Risk #9 file list (T8, T16, T34-T35), Verification Plan (T36), npm-plugin distribution (T37-T41). Future Offerings intentionally have no tasks (deferred by spec).
- **Known judgment points left to execution:** external skill pin SHAs (resolved at run time), nurikabe event choice (T22 investigates against live docs), override-fallback branch (T7 Step 4), hub-and-spoke fallback branch (T2/T4), `npm publish` itself (T41 — user-approved action).
- **Packaging boundary:** enforced mechanically by `package.json` `files` + the T37 boundary test; the never-packaged list lives in the Distribution paragraph of this plan's header.
- **Type consistency:** verdict vocab `ok/warn/critical/escalate` used in T25/T27; state names in T24/T29 come 1:1 from the spec's diagrams; agent names match `agents/<file>.md` basenames everywhere.

