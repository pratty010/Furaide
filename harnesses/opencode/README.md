# Furaidē OpenCode Harness

OpenCode v2 harness for the Furaidē fleet.

Shipped runtime surface:

- 6 workflow specialists
- 6 review/support subagents
- 3 worker-tier built-ins (`general`, `explore`, `scout`)
- 3 always-on runtime plugins (`nio`, `komainu`, `migawari`) — plus the delivery gate, now enforced in `scripts/workflow-state.mjs` rather than as a plugin (see `docs/workflows.md`; `nurikabe.js` is retired/superseded)
- 1 web-tools plugin bucket
- shared rules, reference docs, and the Workflow #5 finance suite

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) collection.

---

## Install

The fleet installer supports remote bootstrap (no clone needed) or local-clone installation. Both paths result in the same configuration merged into your OpenCode config.

### Prerequisites

The installer, uninstaller, and standalone web-tools installer all preflight-check for:

- [`bun`](https://bun.sh) — runs the model resolver, config merges, and skills sync
- [`jq`](https://jqlang.org/download/) — JSON parsing throughout install/uninstall
- [`git`](https://git-scm.com/downloads) — required for the remote bootstrap clone and skills pipeline

If any is missing, the scripts exit early with an actionable error instead of failing on the first `bun`/`jq`/`git` invocation.

### Remote bootstrap (one-liner)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/Furaide/main/harnesses/opencode/scripts/install-fleet-bootstrap.sh) -- --all --project -y
```

This clones the fleet repository into `~/.furaidee-fleet/` and runs the installer with specified flags. Omit the `--` and flags to run interactively, or see the flags table below to customize scopes and behavior.

### Local clone + install

```bash
git clone https://github.com/pratty010/Furaide.git
cd Furaide/harnesses/opencode
bash scripts/install-fleet.sh --all --project -y
```

### Installation flags

| Flag | Effect |
|---|---|
| `--list` | Print all components and exit (no install) |
| `--dry-run` | Show planned actions without writing files |
| `--all` | Install all components, including opt-in (default_on: false) ones |
| `--global` | Pre-select global scope (`~/.config/opencode/`) for all components |
| `--project` | Pre-select project scope (`./.opencode/`) for all components |
| `--custom <dir>` | Pre-select a custom absolute directory for all components |
| `--link` | Symlink mode: ln -sfn instead of cp (keeps repo as the source) |
| `--no-common-skills` | Skip the shared skills sync prompt |
| `-y`, `--yes` | Auto-confirm model mapping changes (non-interactive safe) |
| `-h`, `--help` | Show this help |

### For LLM agents (non-interactive install)

Use this recipe to install with zero prompts, suitable for agent-driven workflows:

```bash
bash scripts/install-fleet.sh --all --project -y
# or for global scope:
bash scripts/install-fleet.sh --all --global -y
```

The `--all` flag installs all components including opt-in ones; `--project` (or `--global`) pre-selects the scope; `-y` auto-confirms model mappings without prompts.

### What gets installed

Your OpenCode session receives:

- **15 fleet agents** — 6 workflow specialists, 6 review/support subagents, and 3 overridden worker-tier built-ins (`general`, `explore`, `scout`)
- **Instructions** — `config/AGENTS.md` (runtime fleet guide) plus all files under `rules/*.md`
- **Commands** — any `.md` files under `commands/` (e.g., `/tools-config`)
- **3 always-on runtime plugins** — gates (`nio`, `komainu`), model-error visibility logging (`migawari`). The delivery gate is enforced in `scripts/workflow-state.mjs` instead of as a plugin; `nurikabe.js` is retired/superseded and no longer registered in `config/opencode.jsonc`.
- **1 web-tools plugin** bucket — `web_search`, `fetch_content`, `maps_search`
- **Shared rules and reference docs** — workflows, routing manifests, model budgets, operator guidance
- **Skills pipeline** — synced external skills (`superpowers`, `mattpocock`, `addyosmani`) plus bundled addenda, idempotent via a version-stamped receipt

### File backup and restore

Pre-existing files at the installation target get backed up before being overwritten:

- Backups are stored in a timestamped directory: `<target>/.kura_backup/<timestamp>/<relative-path>`
- The install receipt records the backup location
- On uninstall, pre-existing files are automatically restored from the backup
- New files installed by the fleet are removed cleanly without affecting your originals

This ensures nothing is silently lost during install or uninstall.

### Two independent offerings

This fleet installer is separate from `tools/opencode-all`, a standalone CLI dashboard that ships in the same repository. They install independently:

- **Fleet installer** (`scripts/install-fleet.sh`): installs agents, plugins, and rules into your OpenCode config
- **OpenCode-all** (`tools/opencode-all/`): a separate CLI tool with its own installation process

See `tools/opencode-all/README.md` for dashboard-specific setup.

### Future offering: npm distribution

npm package distribution is deferred — see `future-work/npm-package/NOTES.md`.

### Uninstall

```bash
bash scripts/uninstall-fleet.sh
```

The uninstaller:
- Removes all fleet-installed files from your chosen scope
- Restores any pre-existing files that were backed up during install
- Unwires the fleet configuration from your OpenCode config
- Deletes the installation receipt

Pre-existing files are never silently lost.

---

## Fleet summary

### Specialists

- `kantoku--workflow-director`
- `kyakuhon--spec-planner`
- `tsukumogami--code-forgemaster`
- `fudo--security-guardian`
- `tsuchigumo--research-weaver`
- `daikoku--finance-steward`

### Subagents

- `kagami--verifier`
- `hanko--git-seal`
- `hansei--lesson-keeper`
- `kura--knowledge-banker`
- `bakeneko--bug-hunter`
- `oni--red-team-reviewer`

### Worker tier

- `general`
- `explore`
- `scout`

See `docs/OPERATOR.md` for budget tiers and `docs/routing-manifest.json` for exact model assignments.

---

## Web tools

The web-tools bucket exposes:

- `web_search`
- `fetch_content`
- `maps_search`

`/tools-config` edits tool defaults and budgets. `docs/models/gemini-tool-fees.yml` remains shipped because pricing code reads it at runtime.

`scripts/install-web-tools.sh` installs just this bucket standalone (the same files a normal `install-fleet.sh` run already installs as part of its `web-tools` manifest component). You don't need it for a standard install; it's there for direct/manual web-tools-only installs. Standalone runs are still covered by `uninstall-fleet.sh --purge` — backups use the same shared `.kura_backup` convention as the main installer.

---

## Verification

Run from `harnesses/opencode/`:

```bash
bun test scripts/tests/
```

Finance Python checks run from `scripts/finance/`:

```bash
uv run pytest tests
```

---

## Uninstall

See the [Uninstall](#uninstall) section in [Install](#install) above. In brief:

```bash
bash scripts/uninstall-fleet.sh
```

The uninstaller restores pre-existing files from backup and unwires the fleet configuration.
