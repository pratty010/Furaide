# Furaidē OpenCode Harness

OpenCode v2 harness for the Furaidē fleet.

Shipped runtime surface:

- 6 workflow specialists
- 6 review/support subagents
- 3 worker-tier built-ins (`general`, `explore`, `scout`)
- 4 always-on runtime plugins (`nio`, `nurikabe`, `komainu`, `migawari`)
- 1 web-tools plugin bucket
- shared rules, reference docs, and the Workflow #5 finance suite

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) collection.

---

## Install

### Remote bootstrap

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/Furaide/main/harnesses/opencode/scripts/install-fleet-bootstrap.sh)
```

### From a local clone

From the repo root:

```bash
bash harnesses/opencode/scripts/install-fleet.sh
```

If you want the pinned external skill set refreshed before install:

```bash
bun harnesses/opencode/scripts/pull-external-skills.mjs --check
bun harnesses/opencode/scripts/pull-external-skills.mjs --pull
```

The fleet installer can also offer the shared-skills install step at the end unless `--no-common-skills` is set.

### Common flags

| Flag | Effect |
|---|---|
| `--list` | Print manifest components only |
| `--dry-run` | Show copy/merge actions without writes |
| `--all` | Install all default-on components non-interactively |
| `--global` | Target `~/.config/opencode/` |
| `--project` | Target `./.opencode/` |
| `--custom <dir>` | Target an absolute config dir |
| `--link` | Symlink to the repo instead of copying |
| `--no-common-skills` | Skip the shared-skills prompt |

---

## What gets installed

| Component | Notes |
|---|---|
| Workflow gates | `nio`, `nurikabe`, hook plugins, and `scripts/workflow-state.mjs` |
| Security + failover | `komainu`, `migawari`, routing manifest |
| Fleet agents | v2 specialists, subagents, and worker entries |
| Agent support scripts | active shipped helpers only |
| Rules | includes the memory contract |
| Reference docs | architecture, OPERATOR, manifest schema, rubric |
| Finance suite | Workflow #5 JS ledgers + `uv` Python compute scripts |
| Web tools | plugin bucket, config, `/tools-config`, pricing file |

`config/fleet-manifest.json` is the installer source of truth.

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

```bash
bash harnesses/opencode/scripts/uninstall-fleet.sh
```

The receipt file `.furaide-install-receipt.json` is used when present; otherwise uninstall falls back to the manifest.
