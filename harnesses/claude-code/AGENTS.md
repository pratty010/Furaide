# 🧠 claude-code/, Repo Agent Guide

## What this directory is

Satori plugin and `github` skill support bundle for Claude Code. The Satori engine lives in `cli/` (Bun/TypeScript plus a Python `mekiki` package). `scripts/bootstrap.sh` installs the bundle.

## Commands

Satori engine, run from `cli/src/satori/`:

- `bun test` for the test suite
- `bun run typecheck` (must pass with 0 errors)
- `bun run lint` (biome check)
- `bun run fmt` (biome format)

Mekiki Python package, run from `cli/`:

- `uv sync --frozen` to install the dev env
- `uv run pytest -x -q --tb=short` for tests

Installer:

- `bash scripts/bootstrap.sh --help` for flags (`--yes`, `--minimal`, `--no-config`, `--with-skills`)

## Directory map

- `cli/`: Satori engine. `src/satori/` is the TypeScript code area; `pyproject.toml` and `uv.lock` define the `mekiki` Python package
- `plugins/satori/`: Claude Code plugin. Hooks, commands, and manifest, all resolved via `${CLAUDE_PLUGIN_ROOT}`
- `config/`: install-target material. `CLAUDE.md`, `settings.json`, `statusline-command.sh`, `agents/hanko--git-seal.md`
- `scripts/`: `bootstrap.sh`, `uninstall.sh`
- `docs/`: reference docs

## Workflow

- Two test surfaces. Run `bun test` and `bun run typecheck` after Satori TS changes. Run `uv run pytest` after `mekiki` Python changes.
- CI runs both. `.github/workflows/ci.yml` triggers on `harnesses/claude-code/**` and runs `uv sync --frozen` plus `uv run pytest`.
- Repo-root pre-push hooks apply (shellcheck, semgrep-diff, trivy-quick), sequential, about 8 minutes.

## Editing rules

- `.claude-plugin/marketplace.json` at repo root is the plugin discovery protocol. Path expectations in hooks and the plugin manifest are relative to `CLAUDE_PLUGIN_ROOT`.
- `config/` is install-target material, not source-only docs. Don't confuse the two.
- `config/statusline-sidecar.json` is written by hooks at runtime. Don't commit it (root `.gitignore` already excludes it).
- `cli/.satori/` is runtime scratch. Gitignored.

## Always / Ask first / Never

**Always**: Run Satori `bun test` and `bun run typecheck` when touching CLI or plugin code. Run `uv run pytest` when touching `mekiki` Python.

**Ask first**: Before changing marketplace or distribution assumptions, or plugin manifest paths.

**Never**: Commit captured payloads from `SATORI_CAPTURE_HOOK_PAYLOADS` debugging. Commit real user data as test fixtures. Patch `node_modules`.