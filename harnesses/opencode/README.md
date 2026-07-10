# Furaidē OpenCode Harness

OpenCode v2 harness for the Furaidē fleet.

Shipped runtime surface:

- 6 workflow specialists
- 6 review/support subagents
- 3 worker-tier built-ins (`general`, `explore`, `scout`)
- 6 runtime plugins (gates: `nio`, `komainu`; failover: `migawari`; tools: `web-tools`; hooks: `audit-logger`, `compaction-injector`) — plus the delivery gate, now enforced in `scripts/workflow-state.mjs` rather than as a plugin (see `docs/workflows.md`; `nurikabe.js` is retired/superseded)
- shared rules, reference docs, and the Workflow #5 finance suite

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) collection.

---

## Install

The fleet installer only works against a local checkout — clone the repo first, then run it. There is no remote/curl bootstrap.

### Prerequisites

The installer, uninstaller, and standalone web-tools installer all preflight-check for:

- [`bun`](https://bun.sh) — runs the model resolver, config merges, and skills sync
- [`jq`](https://jqlang.org/download/) — JSON parsing throughout install/uninstall
- [`git`](https://git-scm.com/downloads) — required for cloning the repo and the skills pipeline

If any is missing, the scripts exit early with an actionable error instead of failing on the first `bun`/`jq`/`git` invocation.

### Clone + install

```bash
git clone https://github.com/pratty010/Furaide.git
cd Furaide/harnesses/opencode
bash ../../scripts/install.sh opencode-fleet --scope project --workflows all --yes
```

Omit all flags (`bash ../../scripts/install.sh opencode-fleet`) to launch the interactive wizard instead — it walks through scope, workflow, and web-tools selection and shows a summary before writing anything.

### Installation flags

| Flag | Effect |
|---|---|
| `--scope <global\|project\|custom>` | Install scope (default: `project`) |
| `--custom-dir <path>` | Absolute path; required when `--scope custom` |
| `--workflows <wf1,wf2,...\|all>` | Workflows to install (default: `all`) |
| `--agents <name,name,...>` | Advanced mode: install exactly these agents (ignores `--workflows`) |
| `--web-tools` / `--no-web-tools` | Force Web Tools on/off (default: auto-probe env for credentials) |
| `--yes` | Required to confirm a non-interactive run (omit all flags for the interactive wizard instead) |
| `-h`, `--help` | Show this help |

### For LLM agents (non-interactive install)

Use this recipe to install with zero prompts, suitable for agent-driven workflows:

```bash
bash ../../scripts/install.sh opencode-fleet --scope project --workflows all --yes
# or for global scope:
bash ../../scripts/install.sh opencode-fleet --scope global --workflows all --yes
```

`--scope project` (or `--scope global`) selects the install target; `--workflows all` installs every workflow's agent closure; `--yes` is required to confirm the non-interactive run.

### What gets installed

Your OpenCode session receives:

- **15 fleet agents** — 6 workflow specialists, 6 review/support subagents, and 3 overridden worker-tier built-ins (`general`, `explore`, `scout`)
- **Instructions** — `config/AGENTS.md` (runtime fleet guide) plus all files under `rules/*.md`
- **Commands** — any `.md` files under `commands/` (e.g., `/tools-config`)
- **6 runtime plugins** — gates (`nio`, `komainu`), failover/model-error visibility logging (`migawari`), web tools (`web-tools`), and hooks (`audit-logger`, `compaction-injector`). The delivery gate is enforced in `scripts/workflow-state.mjs` instead of as a plugin; `nurikabe.js` is retired/superseded and no longer registered in `config/opencode.jsonc`. The web-tools plugin exposes `web_search`, `fetch_content`, `maps_search`.
- **Shared rules and reference docs** — workflows, routing manifests, model budgets, operator guidance
- **Skills pipeline** — synced external skills (`superpowers`, `mattpocock`, `addyosmani`) plus bundled addenda, idempotent via a version-stamped receipt

### File backup and restore

Pre-existing files at the installation target get backed up before being overwritten:

- Backups are stored in a timestamped directory: `<target>/.furaide-backup/<timestamp>/<relative-path>`
- The install receipt records the backup location
- On uninstall, pre-existing files are automatically restored from the backup
- New files installed by the fleet are removed cleanly without affecting your originals

This ensures nothing is silently lost during install or uninstall.

### Two independent offerings

This fleet installer is separate from `tools/opencode-all`, a standalone CLI dashboard that ships in the same repository. They install independently:

- **Fleet installer** (via `bash ../../scripts/install.sh opencode-fleet`): installs agents, plugins, and rules into your OpenCode config
- **OpenCode-all** (`tools/opencode-all/`): a separate CLI tool with its own installation process

See `tools/opencode-all/README.md` for dashboard-specific setup.

### Future offering: npm distribution

npm package distribution is deferred — see `future-work/npm-package/NOTES.md`.

### Uninstall

```bash
bash ../../scripts/uninstall.sh opencode-fleet
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

`docs/routing-manifest.json` is the single source of truth for model routing: it lists every routable
model with its billing pool and reserve cap under `models`, and every agent's tier, primary model,
fallback chain, and placement rationale under `agents`. There is no separate budget-tier document —
`scripts/model-resolve.mjs` reads this file directly at install time, so the manifest and the installer
can never drift out of sync. Edit `docs/routing-manifest.json` directly to change model assignments.

---

## Web tools

The web-tools bucket exposes:

- `web_search`
- `fetch_content`
- `maps_search`

`/tools-config` edits tool defaults and budgets. `docs/models/gemini-tool-fees.yml` remains shipped because pricing code reads it at runtime.

The new fleet installer supports installing the web-tools bucket as a standalone component (the same files a normal `install opencode-fleet` run includes as part of its `web-tools` manifest component). You don't need it for a standard install; it's there for direct/manual web-tools-only installs. Standalone runs are still covered by the same uninstall process — backups use the same shared `.furaide-backup` convention as the main installer.

---

## Optional: NotebookLM research grounding

The `notebooklm` skill (wraps [`notebooklm-py`](https://github.com/teng-lin/notebooklm-py)) is available as an opt-in "extras" pick in the fleet installer wizard, for agents doing source-grounded, cited synthesis over document-heavy corpora (PDFs, papers, long YouTube, filings). It's a one-time per-machine setup, shared across harnesses:

```bash
uv tool install "notebooklm-py[browser]"   # pulls Playwright + Chromium, ~170MB first run
notebooklm login                            # interactive browser auth (Google account)
notebooklm auth check --test --json         # verify — must show status:"ok" AND checks.token_fetch:true
```

Use `uv`/`pipx`, not system `pip` (PEP 668). The `[cookies]` extra doesn't work on Python 3.13+ — use `notebooklm login` instead. It wraps an unofficial, undocumented Google API; treat it as optional, never a dependency. Full reference: the skill's own `SKILL.md` and the upstream `notebooklm-py` docs. Same setup as `harnesses/claude-code/`'s README — see there for the fuller gotcha list.

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
bash ../../scripts/uninstall.sh opencode-fleet
```

The uninstaller restores pre-existing files from backup and unwires the fleet configuration.
