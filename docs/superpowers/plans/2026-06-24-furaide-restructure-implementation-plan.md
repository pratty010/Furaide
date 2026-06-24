# Furaidē Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the monorepo into `skills/`, `harnesses/`, `packages/`, `scripts/`, and shared `docs/`, add left-shifted security checks, and isolate the OpenCode brand-builder into gitignored `future-work/` without breaking installers or CI.

**Architecture:** Move shared cross-runtime assets out of `common/`, move each runtime into `harnesses/`, keep runtime-agnostic agent cores in `packages/agent-cores/`, move shared docs to root `docs/`, and keep shared automation in root `scripts/`. Treat the OpenCode brand-builder as shelved local-only work by moving it under `harnesses/opencode/future-work/` and removing its active wiring from runtime config, installer manifest, and docs.

**Tech Stack:** Bash, Bun, Node.js, lefthook, GitHub Actions YAML, shell scripts, Markdown docs, JSON/JSONC, Claude Code/OpenCode config files.

---

## File Map

- `skills/*` — vendored cross-runtime skill packages moved from `common/skills/*`
- `harnesses/opencode/*` — OpenCode source tree, minus active brand-builder files
- `harnesses/claude-code/*` — Claude Code source tree
- `harnesses/pi-agent/*` — Pi agent source tree
- `harnesses/openclaw/*` — OpenClaw source tree
- `packages/agent-cores/*/core.md` — runtime-agnostic agent cores moved from `common/agents/*/core.md`
- `packages/manifests/skills-manifest.json` — external-skill catalog moved from `common/skills-manifest.json`
- `scripts/github-setup-check.sh` — shared GitHub setup verifier moved from `common/scripts/`
- `scripts/install-vendored-skills.sh` — vendored skill installer moved from `common/install-common.sh`
- `scripts/install-external-skills.sh` — external skill installer moved from `common/install-skills.sh`
- `docs/GITHUB.md`, `docs/agent-template.md`, `docs/models/*` — shared docs moved from `common/docs/*`
- `.github/workflows/*.yml`, `.github/dependabot.yml`, `.github/labeler.yml`, `lefthook.yml` — root automation updated for new paths and security checks
- `harnesses/opencode/future-work/**` — gitignored brand-builder assets

---

### Task 1: Create The New Top-Level Layout And Move Shared Assets

**Files:**
- Create: `skills/`, `harnesses/`, `packages/agent-cores/`, `packages/manifests/`, `scripts/`, `docs/models/`
- Modify: `.gitignore`
- Move: `common/skills/*`, `common/agents/*`, `common/docs/*`, `common/scripts/github-setup-check.sh`, `common/install-common.sh`, `common/install-skills.sh`, `common/skills-manifest.json`

- [ ] **Step 1: Create the destination directories**

Run:

```bash
mkdir -p skills harnesses packages/agent-cores packages/manifests scripts docs/models
```

Expected: directories exist with no error output.

- [ ] **Step 2: Move shared skill packages into `skills/`**

Run:

```bash
git mv common/skills/brave-search skills/
git mv common/skills/bx skills/
git mv common/skills/github skills/
git mv common/skills/html-preview skills/
git mv common/skills/plan skills/
```

Expected: `git status` shows the five skill directories renamed into `skills/`.

- [ ] **Step 3: Move runtime-agnostic agent cores into `packages/agent-cores/`**

Run:

```bash
git mv common/agents/planner packages/agent-cores/
git mv common/agents/researcher packages/agent-cores/
git mv common/agents/shiranui packages/agent-cores/
git mv common/agents/strategist packages/agent-cores/
```

Expected: `packages/agent-cores/*/core.md` exists.

- [ ] **Step 4: Move shared docs into root `docs/`**

Run:

```bash
git mv common/docs/GITHUB.md docs/
git mv common/docs/agent-template.md docs/
git mv common/docs/models/openai.md docs/models/
git mv common/docs/models/gemini.md docs/models/
```

Expected: `docs/GITHUB.md`, `docs/agent-template.md`, and `docs/models/*` exist.

- [ ] **Step 5: Move shared scripts and manifests**

Run:

```bash
git mv common/scripts/github-setup-check.sh scripts/
git mv common/install-common.sh scripts/install-vendored-skills.sh
git mv common/install-skills.sh scripts/install-external-skills.sh
git mv common/skills-manifest.json packages/manifests/skills-manifest.json
```

Expected: the shared installers and manifest live in their new paths.

- [ ] **Step 6: Add the future-work ignore rule now**

Add this line to `.gitignore` near the existing OpenCode-specific ignore block:

```gitignore
harnesses/opencode/future-work/
```

Expected: `.gitignore` contains the new rule exactly once.

- [ ] **Step 7: Validate the moved docs and JSON/YAML files**

Run:

```bash
python3 -c "import json; json.load(open('packages/manifests/skills-manifest.json'))"
python3 -c "import yaml; yaml.safe_load(open('.gitignore', 'r')) if False else None"
```

Expected: the JSON command exits 0; the YAML no-op exits 0.

- [ ] **Step 8: Commit the shared asset moves**

```bash
git add skills packages scripts docs .gitignore
git commit -m "refactor: extract shared runtime assets"
```

---

### Task 2: Move Each Runtime Under `harnesses/` And Update Root Automation Paths

**Files:**
- Move: `opencode/`, `claude-code/`, `pi-agent/`, `openclaw/`
- Modify: `.github/workflows/ci.yml`, `.github/workflows/back-merge.yml`, `.github/labeler.yml`, `.github/dependabot.yml`, `.claude-plugin/marketplace.json`, `lefthook.yml`, `package.json`

- [ ] **Step 1: Move the runtime directories**

Run:

```bash
git mv opencode harnesses/
git mv claude-code harnesses/
git mv pi-agent harnesses/
git mv openclaw harnesses/
```

Expected: the four runtimes exist under `harnesses/` and no longer at repo root.

- [ ] **Step 2: Update `lefthook.yml` for the new Claude Code path**

Replace this block:

```yaml
    - name: pytest
      glob: "claude-code/**"
      run: cd claude-code/cli && uv run python -m pytest -x -q --tb=short
```

with:

```yaml
    - name: pytest
      glob: "harnesses/claude-code/**"
      run: cd harnesses/claude-code/cli && uv run python -m pytest -x -q --tb=short
```

Expected: `lefthook.yml` only references `harnesses/claude-code/**`.

- [ ] **Step 3: Update `.github/workflows/ci.yml` path filters and commands**

Make these path substitutions everywhere they appear:

```yaml
'opencode/**' -> 'harnesses/opencode/**'
'claude-code/**' -> 'harnesses/claude-code/**'
cd claude-code/cli -> cd harnesses/claude-code/cli
cache-dependency-glob: "claude-code/cli/uv.lock" -> "harnesses/claude-code/cli/uv.lock"
```

Expected: no `opencode/**` or `claude-code/**` filters remain in `ci.yml`.

- [ ] **Step 4: Update `.github/workflows/back-merge.yml` and `.github/labeler.yml`**

Make these replacements:

```yaml
'claude-code/**' -> 'harnesses/claude-code/**'
'opencode/**' -> 'harnesses/opencode/**'
```

Expected: both files reference only `harnesses/...` paths.

- [ ] **Step 5: Update `.github/dependabot.yml` and `.claude-plugin/marketplace.json`**

Make these replacements:

```yaml
directory: "/opencode" -> directory: "/harnesses/opencode"
directory: "/claude-code/cli" -> directory: "/harnesses/claude-code/cli"
```

```json
"./claude-code/plugins/satori" -> "./harnesses/claude-code/plugins/satori"
```

Expected: Dependabot points at the new package roots; marketplace points at the new plugin path.

- [ ] **Step 6: Verify the moved runtime paths are cleanly updated in root automation**

Run:

```bash
rg -n "\b(opencode|claude-code|pi-agent|openclaw)/" .github .claude-plugin lefthook.yml package.json
```

Expected: only intentional root references remain, and anything path-sensitive points at `harnesses/...`.

- [ ] **Step 7: Commit the harness move and root path rewrites**

```bash
git add harnesses .github .claude-plugin lefthook.yml package.json
git commit -m "refactor: move runtimes under harnesses"
```

---

### Task 3: Rewire Shared Installers And Runtime Bootstrap Scripts

**Files:**
- Modify: `scripts/install-vendored-skills.sh`, `scripts/install-external-skills.sh`, `harnesses/claude-code/scripts/bootstrap.sh`, `harnesses/opencode/scripts/install-fleet.sh`, `harnesses/opencode/scripts/uninstall-fleet.sh`
- Test: `harnesses/opencode/scripts/tests/installer-wiring.test.mjs`, `harnesses/opencode/scripts/tests/installer-receipt.test.mjs`, `harnesses/opencode/scripts/tests/agents-match-manifest.test.mjs`

- [ ] **Step 1: Update the vendored-skill installer source path**

In `scripts/install-vendored-skills.sh`, replace:

```bash
SKILLS_SRC="$SCRIPT_DIR/skills"
```

with:

```bash
SKILLS_SRC="$(cd "$SCRIPT_DIR/../skills" && pwd)"
```

Expected: the installer resolves vendored skills from repo-root `skills/`.

- [ ] **Step 2: Update the external-skill installer manifest path**

In `scripts/install-external-skills.sh`, replace:

```bash
MANIFEST="$SCRIPT_DIR/skills-manifest.json"
```

with:

```bash
MANIFEST="$(cd "$SCRIPT_DIR/../packages/manifests" && pwd)/skills-manifest.json"
```

Expected: the external installer loads the manifest from `packages/manifests/skills-manifest.json`.

- [ ] **Step 3: Update Claude Code bootstrap to use the new shared script locations**

In `harnesses/claude-code/scripts/bootstrap.sh`, replace the old common-dir lookup with:

```bash
ROOT="$(cd "$REPO/../.." && pwd)"
SCRIPTS_DIR="$ROOT/scripts"
DOCS_DIR="$ROOT/docs"
```

and replace calls to `common/install-common.sh` / `common/install-skills.sh` with:

```bash
bash "$SCRIPTS_DIR/install-vendored-skills.sh" ...
bash "$SCRIPTS_DIR/install-external-skills.sh" ...
```

Expected: bootstrap no longer references `common/`.

- [ ] **Step 4: Update the OpenCode installer to use the new shared script and doc locations**

In `harnesses/opencode/scripts/install-fleet.sh`, replace any `../common`-based path discovery with root-based discovery:

```bash
ROOT="$(cd "$FLEET_ROOT/../.." && pwd)"
SCRIPTS_DIR="$ROOT/scripts"
DOCS_DIR="$ROOT/docs"
PACKAGES_DIR="$ROOT/packages"
```

and rewrite any common-file copies to use:

```bash
"$DOCS_DIR/GITHUB.md"
"$SCRIPTS_DIR/github-setup-check.sh"
"$PACKAGES_DIR/manifests/skills-manifest.json"
```

Expected: `install-fleet.sh` no longer references `../common/...`.

- [ ] **Step 5: Update uninstall and related script references if they assume old root layout**

Search and fix:

```bash
rg -n "\.\./common|common/|claude-code/|opencode/" harnesses/opencode/scripts harnesses/claude-code/scripts
```

Expected: remaining path references are intentional and correct for the new layout.

- [ ] **Step 6: Run installer-focused tests before broader verification**

Run:

```bash
bun test harnesses/opencode/scripts/tests/installer-wiring.test.mjs \
  harnesses/opencode/scripts/tests/installer-receipt.test.mjs \
  harnesses/opencode/scripts/tests/agents-match-manifest.test.mjs
```

Expected: all three test files pass.

- [ ] **Step 7: Dry-run both shared installers**

Run:

```bash
bash scripts/install-vendored-skills.sh --global --dry-run
bash scripts/install-external-skills.sh --list
```

Expected: vendored installer prints the copy plan; external installer lists skill sets and exits 0.

- [ ] **Step 8: Commit the installer and bootstrap rewiring**

```bash
git add scripts harnesses/claude-code/scripts harnesses/opencode/scripts packages/manifests
git commit -m "refactor: rewire shared installers"
```

---

### Task 4: Isolate OpenCode Brand-Builder Into `future-work/`

**Files:**
- Create: `harnesses/opencode/future-work/agents/`, `harnesses/opencode/future-work/commands/`, `harnesses/opencode/future-work/skills/`
- Move: brand-builder plugin, 9 brand-builder agents, 10 brand-builder commands, all `harnesses/opencode/skills/*`
- Modify: `harnesses/opencode/config/fleet-manifest.json`, `harnesses/opencode/config/opencode.jsonc`, `harnesses/opencode/docs/routing-manifest.json`, `harnesses/opencode/scripts/tests/agents-match-manifest.test.mjs`, `harnesses/opencode/scripts/tests/agent-reference-integrity.test.mjs`

- [ ] **Step 1: Create the future-work directories**

Run:

```bash
mkdir -p harnesses/opencode/future-work/agents \
  harnesses/opencode/future-work/commands \
  harnesses/opencode/future-work/skills
```

Expected: the three destination directories exist.

- [ ] **Step 2: Move the brand-builder plugin and brand-only agents**

Run:

```bash
git mv harnesses/opencode/brand-builder-plugin harnesses/opencode/future-work/
git mv harnesses/opencode/agents/akashi--proof-keeper.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/amanojaku--voice-contrarian.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/hyakume--ats-watchman.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/kataribe--narrative-teller.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/kitsune--brand-orchestrator.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/kodama--growth-echo.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/kudagitsune--fit-diviner.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/kurabokko--knowledge-keeper.md harnesses/opencode/future-work/agents/
git mv harnesses/opencode/agents/migaki--profile-polisher.md harnesses/opencode/future-work/agents/
```

Expected: the 9 brand-specific agent files are no longer in the active `agents/` directory.

- [ ] **Step 3: Move the brand-builder commands and skills, leaving `tools-config.md` in place**

Run:

```bash
git mv harnesses/opencode/commands/akashi.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/awase.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/hakari.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/kataribe.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/kodama.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/kudagitsune.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/kurabokko.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/migaki.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/omokage.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/commands/tsumugi.md harnesses/opencode/future-work/commands/
git mv harnesses/opencode/skills/* harnesses/opencode/future-work/skills/
```

Expected: `harnesses/opencode/commands/` contains `tools-config.md` only.

- [ ] **Step 4: Remove the brand-builder component from `fleet-manifest.json`**

Delete the entire component block starting at:

```json
{
  "id": "brand-builder",
```

through its closing `}` entry in `harnesses/opencode/config/fleet-manifest.json`.

Expected: `rg -n '"id": "brand-builder"' harnesses/opencode/config/fleet-manifest.json` returns no matches.

- [ ] **Step 5: Remove active brand-builder runtime wiring**

In `harnesses/opencode/config/opencode.jsonc` and `harnesses/opencode/docs/routing-manifest.json`, remove any entries for:

```text
kitsune--brand-orchestrator
akashi--proof-keeper
amanojaku--voice-contrarian
hyakume--ats-watchman
kataribe--narrative-teller
kodama--growth-echo
kudagitsune--fit-diviner
kurabokko--knowledge-keeper
migaki--profile-polisher
```

Expected: those files contain no active brand-builder agent mappings.

- [ ] **Step 6: Update integrity tests to reflect the active fleet**

Adjust any assertions in these tests that still expect brand-builder to be part of the active manifest or active agent directory:

```text
harnesses/opencode/scripts/tests/agents-match-manifest.test.mjs
harnesses/opencode/scripts/tests/agent-reference-integrity.test.mjs
```

Required behavior after the edit:

```js
// active fleet excludes future-work assets
assert.equal(activeBrandBuilderEntries.length, 0)
assert.ok(existsSync('harnesses/opencode/future-work/agents'))
```

Expected: tests validate only the active fleet, not gitignored future-work.

- [ ] **Step 7: Run the OpenCode integrity tests**

Run:

```bash
bun test harnesses/opencode/scripts/tests/agents-match-manifest.test.mjs \
  harnesses/opencode/scripts/tests/agent-reference-integrity.test.mjs \
  harnesses/opencode/scripts/tests/routing-manifest.test.mjs
```

Expected: all three tests pass.

- [ ] **Step 8: Commit the brand-builder isolation**

```bash
git add harnesses/opencode .gitignore
git commit -m "refactor(opencode): shelve brand builder under future-work"
```

---

### Task 5: Add Left-Shifted Security Tooling

**Files:**
- Create: `.gitleaks.toml`, `trivy.yaml`, `.shellcheckrc`, `.github/workflows/security.yml`
- Modify: `lefthook.yml`

- [ ] **Step 1: Add `.gitleaks.toml` with targeted allowlists**

Create `/.gitleaks.toml` with:

```toml
[allowlist]
paths = [
  "(.*)/test(s)?/fixtures/.*",
  "docs/examples/.*",
  "graphify-out/.*",
  "harnesses/opencode/future-work/.*",
]
```

Expected: `gitleaks` can read the config without syntax errors.

- [ ] **Step 2: Add `trivy.yaml` for repo-wide skip policy**

Create `/trivy.yaml` with:

```yaml
scan:
  skip-dirs:
    - node_modules
    - .git
    - .worktrees
    - graphify-out
  scanners:
    - vuln
    - secret
    - misconfig
  severity: HIGH,CRITICAL
```

Expected: `trivy fs --config trivy.yaml .` parses the config successfully.

- [ ] **Step 3: Add `.shellcheckrc` for intentional local exclusions**

Create `/.shellcheckrc` with:

```text
external-sources=true
source-path=SCRIPTDIR
```

Expected: `shellcheck --rcfile .shellcheckrc scripts/github-setup-check.sh` exits 0 or reports only actionable findings.

- [ ] **Step 4: Extend `lefthook.yml` with pre-push checks**

Append this block after `commit-msg`:

```yaml
pre-push:
  parallel: true
  jobs:
    - name: shellcheck
      glob: "*.sh"
      run: shellcheck --rcfile .shellcheckrc {push_files}

    - name: semgrep-diff
      run: semgrep scan --config=r/bash --config=r/typescript --baseline-commit origin/dev

    - name: trivy-quick
      run: trivy fs --config trivy.yaml --scanners vuln --severity CRITICAL .
```

Expected: `lefthook run pre-push` executes the three new jobs.

- [ ] **Step 5: Add `.github/workflows/security.yml`**

Create `.github/workflows/security.yml` with these jobs:

```yaml
name: security

on:
  pull_request:
    branches: [master]
  schedule:
    - cron: '0 3 * * *'

jobs:
  trivy-full:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@0.24.0
        with:
          scan-type: fs
          scan-ref: .
          trivy-config: trivy.yaml

  semgrep-full:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pipx run semgrep scan --config=r/bash --config=r/typescript .

  snyk-master-gate:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          command: test
```

Expected: the workflow file parses and uses the repo-root config files.

- [ ] **Step 6: Run the fast local security checks**

Run:

```bash
lefthook run pre-commit
lefthook run pre-push
shellcheck --rcfile .shellcheckrc scripts/github-setup-check.sh scripts/install-vendored-skills.sh scripts/install-external-skills.sh
```

Expected: local hooks complete successfully.

- [ ] **Step 7: Commit the security tooling**

```bash
git add .gitleaks.toml .shellcheckrc trivy.yaml lefthook.yml .github/workflows/security.yml
git commit -m "ci: add left-shifted security checks"
```

---

### Task 6: Rewrite Docs And Delete The Stale OpenCode Template Redirect

**Files:**
- Modify: `README.md`, `AGENTS.md`, `harnesses/opencode/README.md`, `harnesses/opencode/AGENTS.md`, `harnesses/opencode/config/AGENTS.md`, `docs/GITHUB.md`, `docs/agent-template.md` (path references only as needed)
- Delete: `harnesses/opencode/docs/agent-template.md`

- [ ] **Step 1: Update the root `README.md` repo map and install examples**

Apply these content changes:

```text
opencode/ -> harnesses/opencode/
claude-code/ -> harnesses/claude-code/
pi-agent/ -> harnesses/pi-agent/
openclaw/ -> harnesses/openclaw/
common/docs/GITHUB.md -> docs/GITHUB.md
common/docs/agent-template.md -> docs/agent-template.md
```

Remove any active-feature wording that still advertises Kitsune brand-builder as part of the active fleet.

- [ ] **Step 2: Update root `AGENTS.md` repo map**

Replace the component map section so it points at:

```markdown
| `harnesses/opencode/` | 30-agent OpenCode fleet + installer | `harnesses/opencode/AGENTS.md` |
| `harnesses/claude-code/` | Satori plugin + github skill bundle | `harnesses/claude-code/AGENTS.md` |
| `harnesses/pi-agent/` | Pi coding-agent extension package | `harnesses/pi-agent/AGENTS.md` |
| `harnesses/openclaw/` | OpenCLAW persona workspace configs | `harnesses/openclaw/AGENTS.md` |
```

Expected: root `AGENTS.md` describes the new top-level layout only.

- [ ] **Step 3: Update OpenCode README and repo guide**

In `harnesses/opencode/README.md` and `harnesses/opencode/AGENTS.md`:

```text
Remove the brand-builder section from the active component list.
Replace `brand-builder-plugin/` references with `future-work/brand-builder-plugin/` only if a roadmap note is kept.
Update `command/` / `skills/` descriptions to clarify that active runtime keeps `commands/tools-config.md` only and brand-builder assets are shelved under `future-work/`.
```

Expected: these docs no longer present brand-builder as installable current behavior.

- [ ] **Step 4: Update `harnesses/opencode/config/AGENTS.md`**

Make these content changes:

```text
Remove “brand-builder bundle (Kitsune + 8 sub-familiars)” from the fleet summary.
Keep web-tools wording intact.
Update any references to docs/models/ and runtime paths if they changed after the move.
```

Expected: the installed fleet guide matches the active runtime.

- [ ] **Step 5: Delete the stale redirect stub**

Run:

```bash
git rm harnesses/opencode/docs/agent-template.md
```

Expected: the file is removed from git; the single source of truth is `docs/agent-template.md`.

- [ ] **Step 6: Sweep remaining references to old layout and removed brand-builder paths**

Run:

```bash
rg -n "common/docs/agent-template\.md|common/docs/GITHUB\.md|brand-builder-plugin|Kitsune|kitsune--brand-orchestrator|opencode/docs/agent-template\.md" README.md AGENTS.md harnesses docs
```

Expected: only intentional `future-work/` roadmap references remain.

- [ ] **Step 7: Commit the docs cleanup**

```bash
git add README.md AGENTS.md harnesses/opencode/README.md harnesses/opencode/AGENTS.md harnesses/opencode/config/AGENTS.md docs
git commit -m "docs: align repo docs with new layout"
```

---

### Task 7: Full Verification, Then Stop Before Graphify

**Files:**
- Verify only; no new file creation in this task

- [ ] **Step 1: Run the OpenCode test suite that covers config and path-sensitive behavior**

Run:

```bash
bun test harnesses/opencode/scripts/tests
```

Expected: all OpenCode script/config tests pass.

- [ ] **Step 2: Run the Claude Code CLI tests from the new path**

Run:

```bash
cd harnesses/claude-code/cli && uv run python -m pytest -x -q --tb=short
```

Expected: pytest exits 0.

- [ ] **Step 3: Validate root JSON/YAML and docs references one last time**

Run:

```bash
python3 -c "import json; json.load(open('package.json')); json.load(open('packages/manifests/skills-manifest.json'))"
python3 -c "import yaml; yaml.safe_load(open('lefthook.yml')); yaml.safe_load(open('.github/workflows/ci.yml')); yaml.safe_load(open('.github/workflows/security.yml')); yaml.safe_load(open('.github/dependabot.yml'))"
rg -n "\bcommon/|\bopencode/|\bclaude-code/|\bpi-agent/|\bopenclaw/" README.md AGENTS.md .github harnesses scripts docs packages
```

Expected: JSON/YAML parsing exits 0; ripgrep only finds intentional historical mentions or code strings already updated for `harnesses/...`.

- [ ] **Step 4: Capture the verification snapshot before graph regeneration**

Run:

```bash
git status --short
```

Expected: only intended tracked changes remain.

- [ ] **Step 5: Stop and ask the user before touching `graphify-out/`**

Use this exact handoff text:

```text
Core restructure, security checks, installer rewiring, docs cleanup, and verification are complete. `graphify-out/` still reflects the old layout. Before I regenerate it, confirm whether you want to archive the old graph artifacts first and whether any docs should preserve links to the old graph outputs.
```

Expected: no graphify command runs until the user answers.

- [ ] **Step 6: Commit the verified restructure work after the graph decision is resolved**

```bash
git add -A
git commit -m "refactor: restructure monorepo for shared skills and harnesses"
```

Expected: one final implementation commit exists after graph work is settled.

---

## Spec Coverage Check

- Layout migration: covered by Tasks 1–3
- Shared docs migration: covered by Tasks 1 and 6
- Security stack + Snyk gate: covered by Task 5
- Brand-builder future-work isolation: covered by Task 4
- README / AGENTS cleanup + delete stale redirect: covered by Task 6
- Graphify pause-before-regenerate rule: covered by Task 7
- Verification before any integration to `master`: covered by Task 7
