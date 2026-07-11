# ⛩️ opencode/, Repo Agent Guide

## What this directory is

Source tree for the OpenCode fleet. Three deliverables: fleet config (install-target source under `config/`, plus agent, plugin, and rule definitions), a standalone TUI companion under `tools/opencode-all/`, and shelved domain experiments under `future-work/`.

## Directory map

- `config/`: install-target source. `opencode.jsonc` (runtime plugin registry), `AGENTS.md` (installed user guide), `web-tools.yml`
- `agents/`: 15 shikigami agent definitions (`.md` with frontmatter)
- `plugins/`: 6 runtime plugins (gates: `nio.js`, `komainu.js`; failover: `migawari.js`; tools: `web-tools.ts`; hooks: `audit-logger.js`, `compaction-injector.js`)
- `scripts/`: `workflow-state.mjs`, support modules (`model-resolve.mjs`, `pull-external-skills.mjs`); installer now lives at `packages/cli/src/targets/opencode-fleet/install.ts`
- `scripts/tests/`: harness test suite (Node `.test.mjs`)
- `rules/`: memory contract and other rules
- `docs/`: workflows, manifest schema, `routing-manifest.json`, model guides, `superpowers/specs/` design docs
- `commands/`: `tools-config.md` only
- `tools/opencode-all/`: standalone TUI (`src/tui.tsx`), shipped independently as `@furaide/opencode-all`
- `future-work/`: gitignored. Has its own `agents/`, `brand-builder-plugin/`, `commands/`, `skills/`

## Commands

Run from this directory (`harnesses/opencode/`):

- `bun test scripts/tests/` for harness installer, config, and agent-integration tests
- `bash ../../scripts/install.sh opencode-fleet` (no flags) to launch the interactive wizard, which shows the resolved agent/plugin closure before writing anything
- `bash ../../scripts/install.sh opencode-fleet --scope <global|project|custom> [--custom-dir <path>] [--workflows <wf1,wf2,...|all>] [--agents <name,name,...>] [--extras <name,name,...>] [--web-tools|--no-web-tools] --yes` to install non-interactively

Run from `tools/opencode-all/` (separate package, own test suite):

- `bun test tests` for the full opencode-all suite
- `bun run test:sanitize`, `test:db`, `test:tui`, or `test:index` for focused runs

## Workflow

- Run `bun test scripts/tests/` after touching installer, manifest, `opencode.jsonc`, agent inventory, or plugin wiring.
- There is no CI job for opencode tests. CI only runs `harnesses/claude-code/cli` pytest. Opencode correctness is gated by repo-root lefthook pre-push hooks: `shellcheck`, `semgrep-diff`, `trivy-quick`, run sequentially. Pushes take about 8 minutes.
- GitHub push protection blocks commits containing secrets. Never stage anything under `harnesses/openclaw/_reference/` or `future-work/`.

## Editing rules

- `packages/cli/src/targets/opencode-fleet/install.ts` hardcodes the installable file lists (`CORE_INFRA_FILES`, `FINANCE_FILES`, `WEB_TOOLS_FILES`, etc.) — add or remove components there. `config/fleet-manifest.json` is kept as a legacy reference snapshot, not read at install time.
- `config/opencode.jsonc` registers 6 plugins (`nio`, `komainu`, `migawari`, `web-tools`, `audit-logger`, `compaction-injector`). Order is runtime-sensitive.
- `config/AGENTS.md` is the installed fleet guide copied into user installs, not a repo guide. This file is the repo guide.
- `plugins/gates/nio.js` execs `scripts/workflow-state.mjs` at runtime via `bun scriptPath read --cwd process.cwd() --workflow <id>`. Moving that path breaks the workflow gates silently. (`nurikabe.js` is superseded and no longer registered.)
- `docs/routing-manifest.json` defines the primary/fallback model chains that `scripts/model-resolve.mjs` consults at install time to substitute unavailable models. `migawari.js` no longer reads this manifest at runtime — it only logs `session.error` events for operator visibility. Keep the manifest in sync with `opencode.jsonc`.
- When moving paths, update `scripts/tests/` and relevant READMEs together.
- `docs/superpowers/specs/` are planning-stage docs, not shipped runtime behavior.

## Always / Ask first / Never

**Always**: Run `bun test scripts/tests/` after edits to installer, manifest, `opencode.jsonc`, agents, plugins, or `workflow-state.mjs`. Re-run the `tools/opencode-all` tests after touching that subtree.

**Ask first**: Before removing docs, rules, plugins, or any path used by `routing-manifest.json`.

**Never**: Patch `node_modules`. Edit installed user paths as source. Re-enable parallel pre-push hooks (sequential is required to avoid trivy plus semgrep worktree races).

## Cross-component

- Shared `skills/` and `docs/` live at repo root, not here. Bundled skills required by the selected agents are copied automatically at install time; pinned external skills are not auto-pulled — install prints a follow-up command (`pull-external-skills.mjs`) to sync them manually. There's no flag to skip this.
- `harnesses/claude-code/cli/` is a separate harness with its own pytest tests and `uv` toolchain. Do not mix into opencode changes.
- Repo root `lefthook.yml`, `.shellcheckrc`, and `trivy.yaml` apply across all harnesses. Changing them affects pi-agent, openclaw, and claude-code too.
