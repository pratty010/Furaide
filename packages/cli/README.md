# @furaide/cli

Unified installer CLI for the Furaidē monorepo. Orchestrates setup across three harness targets with a single command interface.

## Targets

- **opencode-fleet** — Primary target; native TypeScript installer with wizard support.
- **claude-code** — Claude Code harness; dispatches to shell installer.
- **pi-agent** — Pi.dev agent harness; shell installer only.

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
