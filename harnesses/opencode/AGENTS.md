# ⛩️ opencode/, Repo Agent Guide

## What this directory is

Source tree for the OpenCode fleet. Three deliverables: fleet config (install-target source under `config/`, plus agent, plugin, and rule definitions), a standalone TUI companion under `tools/opencode-all/`, and shelved domain experiments under `future-work/`.

## Directory map

- `config/`: install-target source. `opencode.jsonc` (runtime plugin registry), `AGENTS.md` (installed user guide), `web-tools.yml`
- `agents/`: 30 shikigami agent definitions (`.md` with frontmatter)
- `plugins/`: 4 gate plugins (`nio.js`, `nurikabe.js`, `komainu.js`, `migawari.js`), plus `web-tools.ts` and its `web-tools/` subdir
- `scripts/`: installers (`install-fleet.sh`, `uninstall-fleet.sh`, `install-web-tools.sh`), `workflow-state.mjs`, support modules (`model-resolve.mjs`, `sync-skills.mjs`)
- `scripts/tests/`: harness test suite (Node `.test.mjs`)
- `rules/`: memory contract and other rules
- `docs/`: architecture, workflows, operator guide, manifest schema, agent template, `routing-manifest.json`, model guides, `superpowers/specs/` design docs
- `commands/`: `tools-config.md` only
- `tools/opencode-all/`: standalone TUI (`src/tui.tsx`), shipped independently as `@furaide/opencode-all`
- `future-work/`: gitignored. Has its own `agents/`, `brand-builder-plugin/`, `commands/`, `skills/`

## Commands

Run from this directory (`harnesses/opencode/`):

- `bun test scripts/tests/` for harness installer, config, and agent-integration tests
- `bash scripts/install-fleet.sh --list` to list installable components
- `bash scripts/install-fleet.sh --dry-run` to preview the install plan
- `bash scripts/install-fleet.sh [--global|--project|--custom <dir>] [--link] [--all] [--no-common-skills] [-y]` to install

Run from `tools/opencode-all/` (separate package, own test suite):

- `bun test tests` for the full opencode-all suite
- `bun run test:sanitize`, `test:db`, `test:tui`, or `test:index` for focused runs

## Workflow

- Run `bun test scripts/tests/` after touching installer, manifest, `opencode.jsonc`, agent inventory, or plugin wiring.
- There is no CI job for opencode tests. CI only runs `harnesses/claude-code/cli` pytest. Opencode correctness is gated by repo-root lefthook pre-push hooks: `shellcheck`, `semgrep-diff`, `trivy-quick`, run sequentially. Pushes take about 8 minutes.
- GitHub push protection blocks commits containing secrets. Never stage anything under `harnesses/openclaw/_reference/` or `future-work/`.

## Editing rules

- `config/fleet-manifest.json` is the installer source of truth. Add or remove components here, never patch installer code to special-case them.
- Manifest component flags that matter: `atomic` (installed as a group), `requires_bun` (skipped when bun is missing), `non-atomic` (independent).
- `config/opencode.jsonc` registers all 5 plugins (`nio`, `nurikabe`, `komainu`, `migawari`, `web-tools`). Order is runtime-sensitive.
- `config/AGENTS.md` is the installed fleet guide copied into user installs, not a repo guide. This file is the repo guide.
- `plugins/gates/nio.js` and `plugins/gates/nurikabe.js` exec `scripts/workflow-state.mjs` at runtime via `bun scriptPath read --cwd process.cwd() --workflow <id>`. Moving those paths breaks the workflow gates silently.
- `docs/routing-manifest.json` defines fallback chains for the migawari failover gate. Keep it in sync with `opencode.jsonc`.
- When moving paths, update `install-fleet.sh`, `fleet-manifest.json`, `scripts/tests/`, and relevant READMEs together.
- `docs/superpowers/specs/` are planning-stage docs, not shipped runtime behavior.

## Always / Ask first / Never

**Always**: Run `bun test scripts/tests/` after edits to installer, manifest, `opencode.jsonc`, agents, plugins, or `workflow-state.mjs`. Re-run the `tools/opencode-all` tests after touching that subtree.

**Ask first**: Before removing docs, rules, plugins, or any path used by `routing-manifest.json`.

**Never**: Patch `node_modules`. Edit installed user paths as source. Re-enable parallel pre-push hooks (sequential is required to avoid trivy plus semgrep worktree races).

## Cross-component

- Shared `skills/` and `docs/` live at repo root, not here. `install-fleet.sh --no-common-skills` skips the shared-skills installation prompt.
- `harnesses/claude-code/cli/` is a separate harness with its own pytest tests and `uv` toolchain. Do not mix into opencode changes.
- Repo root `lefthook.yml`, `.shellcheckrc`, and `trivy.yaml` apply across all harnesses. Changing them affects pi-agent, openclaw, and claude-code too.
