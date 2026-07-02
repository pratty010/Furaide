# Session Vault Record & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the broken session-vault system from opencode, delete its user-data implementation, reconcile the fleet's 29-vs-30 agent-count docs, and leave a verified, internally consistent config/doc set behind.

**Architecture:** This is a documentation-and-config cleanup, not a feature build. Execution is split into four bounded work units: delete session-vault repo artifacts, remove user-data, reconcile fleet counts, and verify the final state. All edits are small, file-local, and reversible.

**Tech Stack:** Markdown, JSONC, JSON, JavaScript file deletion, Bun test runner, ripgrep verification, local filesystem cleanup.

---

## Files in scope

### Delete
- `opencode/command/session-vault.md`
- `opencode/plugins/omokage.js`
- `opencode/scripts/session-vault.mjs`
- `opencode/scripts/lib/session-vault-index.mjs`
- `opencode/scripts/tests/session-vault-plugin.test.mjs`
- `opencode/scripts/tests/session-vault-index.test.mjs`
- `opencode/scripts/tests/session-vault-helper.test.mjs`
- `opencode/scripts/tests/install-fleet-session-vault.test.mjs`

### Modify
- `opencode/opencode.jsonc`
- `opencode/fleet-manifest.json`
- `opencode/README.md`
- `opencode/AGENTS.md`
- `opencode/docs/architecture.md`
- `opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md`

### Remove from user data
- `~/.local/share/opencode/session-vault/index.json`
- `~/.local/share/opencode/session-vault/archive/`
- `~/.local/share/opencode/session-vault/vault.py`
- `~/.local/share/opencode/session-vault/`

### Reference spec
- `opencode/docs/superpowers/specs/2026-06-18-session-vault-record-and-cleanup.md`

---

### Task 1: Remove repo session-vault artifacts

**Files:**
- Delete: `opencode/command/session-vault.md`
- Delete: `opencode/plugins/omokage.js`
- Delete: `opencode/scripts/session-vault.mjs`
- Delete: `opencode/scripts/lib/session-vault-index.mjs`
- Delete: `opencode/scripts/tests/session-vault-plugin.test.mjs`
- Delete: `opencode/scripts/tests/session-vault-index.test.mjs`
- Delete: `opencode/scripts/tests/session-vault-helper.test.mjs`
- Delete: `opencode/scripts/tests/install-fleet-session-vault.test.mjs`
- Modify: `opencode/opencode.jsonc`
- Modify: `opencode/fleet-manifest.json`
- Modify: `opencode/README.md`
- Modify: `opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md`

- [ ] **Step 1: Verify the target files still exist before deletion**

Run:

```bash
ls opencode/command/session-vault.md opencode/plugins/omokage.js opencode/scripts/session-vault.mjs opencode/scripts/lib/session-vault-index.mjs opencode/scripts/tests/session-vault-plugin.test.mjs opencode/scripts/tests/session-vault-index.test.mjs opencode/scripts/tests/session-vault-helper.test.mjs opencode/scripts/tests/install-fleet-session-vault.test.mjs
```

Expected: all 8 paths print successfully.

- [ ] **Step 2: Delete the 8 repo files with one patch**

Apply this patch:

```diff
*** Begin Patch
*** Delete File: opencode/command/session-vault.md
*** Delete File: opencode/plugins/omokage.js
*** Delete File: opencode/scripts/session-vault.mjs
*** Delete File: opencode/scripts/lib/session-vault-index.mjs
*** Delete File: opencode/scripts/tests/session-vault-plugin.test.mjs
*** Delete File: opencode/scripts/tests/session-vault-index.test.mjs
*** Delete File: opencode/scripts/tests/session-vault-helper.test.mjs
*** Delete File: opencode/scripts/tests/install-fleet-session-vault.test.mjs
*** End Patch
```

- [ ] **Step 3: Remove `omokage.js` from `opencode/opencode.jsonc`**

Replace:

```jsonc
  "plugin": [
    "./plugins/nio.js",
    "./plugins/nurikabe.js",
    "./plugins/komainu.js",
    "./plugins/migawari.js",
    "./plugins/omokage.js"
  ],
```

With:

```jsonc
  "plugin": [
    "./plugins/nio.js",
    "./plugins/nurikabe.js",
    "./plugins/komainu.js",
    "./plugins/migawari.js"
  ],
```

- [ ] **Step 4: Remove the `session-vault` component from `opencode/fleet-manifest.json`**

Delete this exact object block:

```json
    {
      "id": "session-vault",
      "label": "Session Vault",
      "description": "Global session vault command, close-hook plugin, helper, and tests.",
      "atomic": true,
      "coupling": "command/session-vault.md depends on plugins/omokage.js and scripts/session-vault.mjs",
      "requires_bun": false,
      "default_on": true,
      "target_subdirs": [
        "command",
        "plugins",
        "scripts"
      ],
      "files": [
        "command/session-vault.md",
        "plugins/omokage.js",
        "scripts/session-vault.mjs"
      ],
      "globs": [
        "scripts/lib/session-vault-*.mjs",
        "scripts/tests/session-vault-*.test.mjs"
      ]
    },
```

- [ ] **Step 5: Remove session-vault mentions from `opencode/README.md` core bundle + components table**

Make these two replacements:

1. Replace:

```md
1. **Core bundle** (always default on): workflow gates, model failover, security gate, session vault, specialist agents, agent support scripts, rules, and reference docs.
```

With:

```md
1. **Core bundle** (always default on): workflow gates, model failover, security gate, specialist agents, agent support scripts, rules, and reference docs.
```

2. Replace the components rows:

```md
| 4 | Session Vault | yes | on | Global session vault command, close-hook plugin, helper, and tests. |
| 5 | Specialist Agents | no | on | 29 core shikigami: 12 domain specialists + 2 general agents + 15 shared subagents. |
| 6 | Agent Support Scripts | no | on | Verification and safety scripts called by agents via Karakuri. |
| 7 | Rules | no | on | Memory contract and other rules wired via `instructions` glob. |
| 8 | Reference Docs | no | off | OPERATOR guide, architecture overview, manifest schema, model family guides. |
| 9 | Brand Builder / Kitsune | yes | off | Opt-in; in development. 9 brand agents + plugin + commands + skills. Needs `bun install`. |
```

With:

```md
| 4 | Specialist Agents | no | on | 29 core shikigami: 12 domain specialists + 2 general agents + 15 shared subagents. |
| 5 | Agent Support Scripts | no | on | Verification and safety scripts called by agents via Karakuri. |
| 6 | Rules | no | on | Memory contract and other rules wired via `instructions` glob. |
| 7 | Reference Docs | no | off | OPERATOR guide, architecture overview, manifest schema, model family guides. |
| 8 | Brand Builder / Kitsune | yes | off | Opt-in; in development. 9 brand agents + plugin + commands + skills. Needs `bun install`. |
```

- [ ] **Step 6: Update the `opencode-all` design doc's compatibility note**

Replace:

```md
- Existing session-vault metadata may be read for compatibility, but v1 does not depend on it as source of truth.
```

With:

```md
- Existing session-vault code and user-data have been fully removed (see `2026-06-18-session-vault-record-and-cleanup.md`); `opencode-all` reads `opencode.db` directly.
```

- [ ] **Step 7: Run the first verification sweep**

Run:

```bash
bun test opencode/scripts/tests/ && rg -i 'session.?vault|omokage\.js|sync-session|sync-new' opencode/ --glob '!docs/superpowers/specs/2026-06-18-session-vault-record-and-cleanup.md' --glob '!docs/superpowers/specs/2026-06-18-opencode-all-design.md'
```

Expected:
- `bun test` passes
- `rg` returns no matches

- [ ] **Step 8: Stop for review**

Do not commit. Git operations require explicit user request and route through `hanko--git-seal` in this repo.

---

### Task 2: Remove session-vault user data

**Files:**
- Delete: `~/.local/share/opencode/session-vault/index.json`
- Delete: `~/.local/share/opencode/session-vault/archive/`
- Delete: `~/.local/share/opencode/session-vault/vault.py`
- Delete: `~/.local/share/opencode/session-vault/`

- [ ] **Step 1: Verify the directory contents before deletion**

Run:

```bash
ls -la ~/.local/share/opencode/session-vault/
```

Expected: `index.json`, `archive/`, and `vault.py` are present.

- [ ] **Step 2: Delete the user-data directory recursively**

Run:

```bash
rm -rf ~/.local/share/opencode/session-vault/
```

Expected: command exits 0.

- [ ] **Step 3: Verify the directory is gone**

Run:

```bash
ls ~/.local/share/opencode/session-vault/ 2>&1
```

Expected: `No such file or directory`.

- [ ] **Step 4: Stop for review**

Do not commit. User explicitly approved the deletion earlier; no further git step here.

---

### Task 3: Reconcile the 29-vs-30 agent-count docs

**Files:**
- Modify: `opencode/README.md`
- Modify: `opencode/AGENTS.md`
- Modify: `opencode/docs/architecture.md`
- Reference: `opencode/agents/tanuki--codemod-runner.md`

- [ ] **Step 1: Update the 3 numeric references in `opencode/README.md`**

Make these exact replacements:

1. Replace:

```md
> *"Twenty-nine spirits. Four gate-guardians. The fleet is ready."*
```

With:

```md
> *"Thirty spirits. Four gate-guardians. The fleet is ready."*
```

2. Replace:

```md
Furaidē's [OpenCode](https://opencode.ai) configuration: a 29-agent fleet of named shikigami specialists, four gate plugins enforcing workflow integrity, and Kitsune's brand-builder domain (opt-in, in development). Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) collection.
```

With:

```md
Furaidē's [OpenCode](https://opencode.ai) configuration: a 30-agent fleet of named shikigami specialists, four gate plugins enforcing workflow integrity, and Kitsune's brand-builder domain (opt-in, in development). Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) collection.
```

3. Replace:

```md
| 4 | Specialist Agents | no | on | 29 core shikigami: 12 domain specialists + 2 general agents + 15 shared subagents. |
```

With:

```md
| 4 | Specialist Agents | no | on | 30 core shikigami: 12 domain specialists + 2 general agents + 16 shared subagents. |
```

- [ ] **Step 2: Update `opencode/AGENTS.md` fleet counts**

Make these exact replacements:

1. Replace:

```md
The fleet: 12 domain specialists, 15 shared subagents dispatched by specialists, 2 general escape-hatch agents (Tanuki, Karasu-tengu), 4 gate plugins always active. The brand-builder bundle (Kitsune + 8 sub-familiars) is opt-in and in development; not loaded by default.
```

With:

```md
The fleet: 12 domain specialists, 16 shared subagents dispatched by specialists, 2 general escape-hatch agents (Tanuki, Karasu-tengu), 4 gate plugins always active. The brand-builder bundle (Kitsune + 8 sub-familiars) is opt-in and in development; not loaded by default.
```

2. Replace:

```md
This is the opencode config dir (`~/.config/opencode/`) for a 12-specialist + 15-subagent fleet. No build step, no app entrypoint; the product is the agent definitions, plugins, scripts, and docs. Tests live in `scripts/tests/` (`bun test`).
```

With:

```md
This is the opencode config dir (`~/.config/opencode/`) for a 12-specialist + 16-subagent fleet. No build step, no app entrypoint; the product is the agent definitions, plugins, scripts, and docs. Tests live in `scripts/tests/` (`bun test`).
```

3. Replace heading:

```md
### 15 Shared Subagents (`mode: subagent`, dispatched BY specialists; not called directly by user)
```

With:

```md
### 16 Shared Subagents (`mode: subagent`, dispatched BY specialists; not called directly by user)
```

- [ ] **Step 3: Add `tanuki--codemod-runner` to the subagent delegation table**

Insert this row after the `hanko--git-seal` row and before `mizuchi--data-current`:

```md
| tanuki--codemod-runner (T2) | Tanuki(Codemod Runner) | opencode-go/mimo-v2.5 | Bulk code transforms (jscodeshift, ast-grep, sed-based); dispatched by shiranui--migration-guide + tsukumogami--code-forgemaster; dispatches shell to karakuri--command-runner |
```

Reference source for the wording: `opencode/agents/tanuki--codemod-runner.md:2-7`.

- [ ] **Step 4: Clarify the plugin-count sentence in `opencode/docs/architecture.md`**

Replace:

```md
| `opencode.jsonc` | Provider whitelist + plugin list + permissions | Plugin array must include all 4 plugins; provider whitelists must not include `gemini-2.5-*` |
```

With:

```md
| `opencode.jsonc` | Provider whitelist + plugin list + permissions | Plugin array must include all 4 gate plugins; provider whitelists must not include `gemini-2.5-*` |
```

- [ ] **Step 5: Run the agent-count verification sweep**

Run:

```bash
grep -n 'Twenty-nine\|29-agent\|29 core\|15 shared subagents\|15-subagent\|15 Shared Subagents' opencode/README.md opencode/AGENTS.md && true
```

Expected: no matches.

- [ ] **Step 6: Stop for review**

Do not commit. Keep the diff unstaged for review.

---

### Task 4: Final verification and review packet

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Run the full final verification set**

Run:

```bash
bun test opencode/scripts/tests/ && rg -i 'session.?vault|omokage\.js|sync-session|sync-new' opencode/ --glob '!docs/superpowers/specs/2026-06-18-session-vault-record-and-cleanup.md' --glob '!docs/superpowers/specs/2026-06-18-opencode-all-design.md' && grep -c '"./plugins/' opencode/opencode.jsonc && grep -c '"id":' opencode/fleet-manifest.json && ls ~/.local/share/opencode/session-vault/ 2>&1
```

Expected:
- `bun test` passes
- `rg` returns no matches
- plugin count prints `4`
- manifest component count prints `8`
- final `ls` prints `No such file or directory`

- [ ] **Step 2: Run the count-specific verification**

Run:

```bash
grep -n 'Twenty-nine\|29-agent\|29 core\|15 shared subagents\|15-subagent\|15 Shared Subagents' opencode/README.md opencode/AGENTS.md && true
```

Expected: no matches.

- [ ] **Step 3: Produce the review packet**

Run:

```bash
git diff -- opencode/command/session-vault.md opencode/plugins/omokage.js opencode/scripts/session-vault.mjs opencode/scripts/lib/session-vault-index.mjs opencode/scripts/tests/session-vault-plugin.test.mjs opencode/scripts/tests/session-vault-index.test.mjs opencode/scripts/tests/session-vault-helper.test.mjs opencode/scripts/tests/install-fleet-session-vault.test.mjs opencode/opencode.jsonc opencode/fleet-manifest.json opencode/README.md opencode/AGENTS.md opencode/docs/architecture.md opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md opencode/docs/superpowers/specs/2026-06-18-session-vault-record-and-cleanup.md
```

Expected: diff shows only the scoped deletions/edits documented in the spec.

- [ ] **Step 4: Stop for human review**

No commit, no push, no PR. User review required first.

---

## Self-review notes

- **Spec coverage:** This plan covers all 18 scoped operations in the spec: 8 file deletions, 7 repo edits, 3 user-data deletes, plus verification.
- **Placeholder scan:** No TODO/TBD placeholders remain; every edit has exact replacement text or exact patch content.
- **Type/name consistency:** The plan consistently uses `tanuki--codemod-runner`, `omokage.js`, `session-vault`, and the 30-agent / 16-subagent counts from the source-of-truth manifest.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-18-session-vault-record-and-cleanup-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
