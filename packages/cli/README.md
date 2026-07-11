# @furaide/cli

Unified installer CLI for the Furaidē monorepo. Orchestrates setup across three harness targets with a single command interface.

## Targets

- **opencode-fleet** — Primary target; native TypeScript installer with wizard support.
- **claude-code** — Claude Code harness; dispatches to shell installer.
- **pi-agent** — Pi.dev agent harness; shell installer only.

## Features

Beyond routing to the right target, `router.ts` and the per-target modules share a few things across all three installers:

- **Receipt tracking**: every install writes a receipt recording what was installed and where, so uninstall knows what to remove without guessing and re-running install is idempotent (skip-if-exists rather than clobber).
- **Scope resolution**: `global` / `project` / `custom` scope, with a directory walk-up so `project` scope resolves correctly from any subdirectory of a checkout, not just the repo root.
- **Backup-before-overwrite**: pre-existing files at the install target are backed up first (timestamped, per-target convention); uninstall restores them.
- **Shared skill-install primitives**: `src/shared/install-vendored-skills.sh` and `src/shared/install-external-skills.sh` are called by all three targets rather than each reimplementing its own skill-copy logic.

`opencode-fleet` additionally resolves an install closure from agent frontmatter (`resolve.ts`) and runs an interactive wizard (`wizard.ts`) when no flags are passed; `claude-code` and `pi-agent` dispatch straight to their own shell scripts under `src/targets/<name>/`.

## Installation

```bash
cd packages/cli
bun install
```

## Usage

### Interactive mode (wizard)

```bash
bun run bin/furaide.ts install opencode-fleet
```

### Non-interactive mode (opencode-fleet)

```bash
bun run bin/furaide.ts install opencode-fleet --scope project --workflows all --yes
```

### Flags (opencode-fleet install)

- `--scope <global|project|custom>` — Install location (default: project)
- `--custom-dir <path>` — Custom directory (required if `--scope custom`)
- `--workflows <wf1,wf2,...|all>` — Workflows to install (default: all)
- `--agents <name,...>` — Advanced: install specific agents (overrides --workflows)
- `--extras <name,name,...>` — Opt-in extra repo-bundled skills beyond each agent's auto-required set (default: none)
- `--web-tools` / `--no-web-tools` — Enable/disable web tools (default: auto-detect)
- `--yes` — Skip confirmation (required for non-interactive)
- `-h`, `--help` — Show help

### Flags (opencode-fleet uninstall)

- `--scope <global|project|custom>` — Uninstall source (default: project)
- `--custom-dir <path>` — Custom directory (required if `--scope custom`)
- `--yes` — Skip confirmation
- `-h`, `--help` — Show help

### Other targets

For `claude-code` and `pi-agent`, run the installer directly:

```bash
bun run bin/furaide.ts install claude-code [flags]
bun run bin/furaide.ts uninstall claude-code [flags]
bun run bin/furaide.ts install pi-agent [flags]
```

Note: `pi-agent` has no uninstaller. Use Pi's extension management:

```bash
pi extensions list
pi uninstall friday-furaidee
```

For the complete flag reference, use `--help` on any command.

## Roadmap

`claude-code` and `opencode-fleet` currently track install state with two different receipt schemas (flat JSON v1 for `claude-code`, a zod-validated v2 for `opencode-fleet`). Unifying them into one schema is documented as future work, not yet scheduled.
