# Installation reference for coding agents

Machine-readable reference for setting up and verifying any part of the Furaidē monorepo. Written for an LLM coding agent operating cold in this repo, not for a human reading a tutorial. For narrative detail on any one component, follow the linked README; this file exists so you don't have to read all of them just to run the right command.

## Components

| Component | Path | What it is |
|---|---|---|
| OpenCode fleet | `harnesses/opencode/` | 15-agent OpenCode harness: specialists, subagents, worker-tier overrides, runtime plugins |
| OpenCode companion tool | `harnesses/opencode/tools/opencode-all/` | Standalone OpenTUI session dashboard. Installs independently of the fleet. |
| Claude Code | `harnesses/claude-code/` | Īdisu (capability-analytics) plugin + Rejion (review/task delegation) plugin + `github` skill / `hanko--git-seal` subagent + `config/` (install-target material for `~/.claude/`) |
| pi.dev | `harnesses/pi-agent/` | pi.dev extension package (`friday-furaidee`): web-RAG tools, `/usage` tracking, TUI, themes, GSD skills |
| OpenCLAW | `harnesses/openclaw/` | Persona workspace configs (markdown only, no build step, no installer) |
| CLI router | `packages/cli/` | Shared TypeScript installer all harness installs route through |
| Root scripts | `scripts/` | Thin bash wrappers (`install.sh`, `uninstall.sh`) that bootstrap `packages/cli` and hand off to it |

## Identifying which component a task concerns

Match the task against a path, not a vague description:

- Anything under `harnesses/opencode/agents/`, `harnesses/opencode/plugins/`, `harnesses/opencode/scripts/`, `harnesses/opencode/rules/`, `harnesses/opencode/docs/` → OpenCode fleet.
- `harnesses/opencode/tools/opencode-all/` → the standalone dashboard, a separate package with its own tests. Do not conflate with the fleet.
- `harnesses/claude-code/plugins/idisu/`, `harnesses/claude-code/cli/src/idisu/` → Īdisu.
- `harnesses/claude-code/plugins/rejion/` → Rejion.
- `harnesses/claude-code/config/` → install-target material copied verbatim into `~/.claude/`, not source-only docs. Treat edits here as user-facing config.
- `harnesses/pi-agent/` (anything) → pi.dev extension, one package, one typecheck gate.
- `harnesses/openclaw/agents/workspace-*/` → persona content, markdown only. `harnesses/openclaw/agents/_reference/` is gitignored; never touch it as source of truth, never stage it.
- `packages/cli/` → the installer itself. Changes here affect all three installable harnesses (claude-code, opencode-fleet, pi-agent).
- `scripts/install.sh`, `scripts/uninstall.sh` → root bootstrap wrappers. They detect a JS runtime, install `packages/cli`'s dependencies, then dispatch to `packages/cli/bin/furaide.ts`.
- Root `skills/`, `docs/`, `graphify-out/` → shared across every harness; check all affected READMEs/AGENTS files before editing.

When unsure, run `graphify query "<question>"` if `graphify-out/` exists in the checkout; it is a pre-built architecture graph and faster than grepping cold.

## Installer entry points

```
scripts/install.sh                              # root bootstrap: interactive target picker
scripts/install.sh <target> [flags]             # bypass picker; target = claude-code | opencode-fleet | pi-agent
scripts/uninstall.sh <target> [flags]           # same shape, uninstall path
```

These wrappers detect `bun` (preferred) or `node`+`npm` (fallback), install `packages/cli`'s dependencies, then run:

```
packages/cli/bin/furaide.ts install <target> [flags]
packages/cli/bin/furaide.ts uninstall <target> [flags]
```

Per-target implementation lives under `packages/cli/src/targets/<target>/`:

- `packages/cli/src/targets/claude-code/install.sh`, `uninstall.sh`: shell scripts, dispatched to directly by the router.
- `packages/cli/src/targets/opencode-fleet/install.ts`, `uninstall.ts`, `resolve.ts`, `wizard.ts`, `backup.ts`, `receipt.ts`, `manifest-schema.ts`: native TypeScript, includes an interactive wizard when no flags are passed.
- `packages/cli/src/targets/pi-agent/install.sh`: shell script; there is no `uninstall.sh` for this target (see pi-agent uninstall below).

Shared install primitives (used by more than one target, do not duplicate): `packages/cli/src/shared/install-vendored-skills.sh`, `packages/cli/src/shared/install-external-skills.sh`, `packages/cli/src/shared/github-setup-check.sh`.

## Per-component setup commands

### OpenCode fleet

```bash
git clone https://github.com/pratty010/Furaide.git
cd Furaide/harnesses/opencode
bash ../../scripts/install.sh opencode-fleet --scope project --workflows all --yes
```

Omit all flags to launch the interactive wizard instead. Flags: `--scope <global|project|custom>` · `--custom-dir <path>` (required for `custom`) · `--workflows <wf1,wf2,...|all>` · `--agents <name,name,...>` (advanced, overrides `--workflows`) · `--extras <name,name,...>` · `--web-tools`/`--no-web-tools` · `--yes` (required for non-interactive) · `-h`.

Uninstall:

```bash
bash ../../scripts/uninstall.sh opencode-fleet
```

Deep detail: `harnesses/opencode/README.md`.

### OpenCode companion tool (opencode-all)

Separate from the fleet installer; installs independently.

```bash
bash harnesses/opencode/tools/opencode-all/scripts/install.sh
```

Manual path:

```bash
cd harnesses/opencode/tools/opencode-all
bun install
chmod +x src/tui.tsx
mkdir -p ~/.local/bin
ln -sfn "$PWD/src/tui.tsx" ~/.local/bin/opencode-all
```

Uninstall:

```bash
rm -f ~/.local/bin/opencode-all
rm -rf ~/.local/share/opencode/tools/opencode-all
```

Deep detail: `harnesses/opencode/tools/opencode-all/README.md`.

### Claude Code (Īdisu + Rejion)

Two-phase: bootstrap local assets, then register plugins inside a running Claude Code session (the second phase cannot be scripted from outside Claude Code).

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/packages/cli/src/targets/claude-code/install.sh
```

Flags: `--yes`/`-y` (non-interactive) · `--minimal` (bootstrap only, skip config copy) · `--no-config` (skip step 5, config copy) · `-h`.

Then, inside Claude Code:

```
/plugin marketplace add pratty010/Furaide
/plugin install idisu@fr1d4y
/plugin install rejion@fr1d4y
/reload-plugins
```

Uninstall:

```bash
bash ~/Furaidē/packages/cli/src/targets/claude-code/uninstall.sh
```

Flags: `--dry-run` (print only) · `--purge` (remove everything, no prompts). Then in Claude Code: `/plugin uninstall idisu@fr1d4y`, `/plugin uninstall rejion@fr1d4y`, `/plugin marketplace remove fr1d4y`.

Deep detail: `harnesses/claude-code/README.md`, `harnesses/claude-code/config/README.md` (per-file config notes).

### pi.dev (friday-furaidee)

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/packages/cli/src/targets/pi-agent/install.sh
```

Requires bun and Pi CLI v0.72.1+. Manual path:

```bash
cd ~/Furaidē/harnesses/pi-agent
bun install
pi install .
```

No bundled uninstaller for this target. Remove via Pi's own extension management:

```bash
pi extensions list
pi uninstall friday-furaidee
```

Deep detail: `harnesses/pi-agent/README.md`.

### OpenCLAW

Not installed through `packages/cli`. From this repo's side it is configured, not installed: a separate runtime.

```bash
npm install -g @openclaw/openclaw
openclaw configure
```

Then point `agentDir` in your `openclaw.json` at one of the four persona workspaces: `harnesses/openclaw/agents/workspace-kinyo/`, `workspace-koda/`, `workspace-kagakusha/`, `workspace-tengan/`. No build step, no test suite; content is markdown, validated by reading.

Deep detail: `harnesses/openclaw/README.md`.

### Shared skills only (no harness install)

```bash
bash packages/cli/src/shared/install-vendored-skills.sh --global   # → ~/.agents/skills/
# or: --project <dir>  |  --custom <path>
```

## Verification per component

Run these after making changes in the corresponding path. Each command below is what that harness's own CLAUDE.md/README documents as its correctness gate, not a generic "run tests" placeholder.

```bash
# Īdisu (Claude Code), from harnesses/claude-code/cli/src/idisu/
bun install
bun test
bun run typecheck
bun run lint

# Claude Code Python scaffold (placeholder, no active package yet), from harnesses/claude-code/cli/
uv sync --frozen
uv run pytest -x -q --tb=short

# Rejion plugin (Claude Code), from harnesses/claude-code/plugins/rejion/
bun install
bun test
bun run lint

# OpenCode fleet harness tests, from harnesses/opencode/
bun test scripts/tests/

# OpenCode finance suite, from harnesses/opencode/scripts/finance/
uv run pytest tests

# opencode-all, from harnesses/opencode/tools/opencode-all/
bun test
bunx tsc --noEmit
bash scripts/test-fixture.sh

# pi-agent, from harnesses/pi-agent/
bun run typecheck        # primary gate, must pass with 0 errors
bun pm pack --dry-run    # verify package contents before publish

# openclaw
# no build, no tests; validate persona edits by reading the changed workspace files
```

Repo-wide, not component-specific: `lefthook.yml` runs pre-commit checks (gitleaks, JSON/YAML validation, pytest glob) and pre-push checks (`shellcheck`, `semgrep-diff`, `trivy-quick`, sequential, ~8 minutes) on every push. `.github/workflows/ci.yml` runs `harnesses/claude-code/cli` pytest on `dev` pushes and PRs to `master`; opencode and pi-agent have no CI job, so their correctness gate is the local commands above plus the lefthook pre-push hooks. `.github/workflows/security.yml` runs trivy, semgrep, and snyk scans.

## Git and GitHub operations

Do not run `git commit`/`git push`/`gh pr` directly in this repo's intended workflow. See `skills/github/SKILL.md` (recipes), `skills/github/GITHUB.md` (branch strategy, troubleshooting), and `skills/github/SECURITY.md` (SSH signing, PAT setup) for the full convention set. Branches: only `dev` and `master` persist; feature work goes on `dev`, stable releases on `master`; commits are Conventional Commits format, SSH-signed, with a trailer identifying the assisting agent.
