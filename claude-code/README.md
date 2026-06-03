# claude-code/

> *Two plugins, one engine. Furaidē's shikigami for Claude Code.*

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) monorepo.

---

## Plugins

| Plugin | Japanese | Role |
|--------|----------|------|
| **Mekiki** | 目利き ("appraiser") | Skill-usage analytics: captures every skill invocation and judges its effectiveness offline |
| **Hanko** | 判子 ("signing seal") | Git workflow: Haiku subagent for commits, pushes, PR creation, and CI monitoring with human-in-the-loop approval |

Both plugins share a single engine (`cli/`) installed by `scripts/bootstrap.sh`.

---

## Install

### 1. Clone and bootstrap

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/claude-code/scripts/bootstrap.sh
```

The bootstrap script:
- Installs the `mekiki` CLI engine via `uv sync` (creates `.venv` in `cli/`)
- Offers to install shared skills (bx, html-preview, brave-search, plan) from `common/skills/`
- Offers to install other skills from the manifest (superpowers, notebooklm, …)
- Offers to copy the global config bundle into `~/.claude/`

### 2. Register and install plugins in Claude Code

```
/plugin marketplace add pratty010/Furaide
/plugin install mekiki@5h1nch4n
/plugin install hanko@5h1nch4n
/reload-plugins
```

---

## Usage

### Mekiki: skill analytics

```
/mekiki                          # overview: which skills fired this week
/mekiki skill <name>             # per-skill deep-dive
/mekiki improve <name>           # build evidence pack → hand off to skill-creator
/mekiki mark <name> applied      # record that you applied the rewrite
/mekiki run                      # ingest + judge + aggregate only (no report)
```

Or call the CLI directly:

```bash
mekiki run                        # ingest + judge + aggregate
mekiki report --overview          # build + serve overview.html
mekiki report --skill <name>      # build + serve skill detail
mekiki improve --skill <name>     # build evidence pack
mekiki improve --skill <name> --mark applied
```

### Hanko: git workflow

```
/github commit with "feat(opencode): add hanko subagent"
/github create a PR to dev
/github check CI status for my current branch
/github push to dev and create a PR
```

The Haiku subagent reads `GITHUB.md` (bundled in the plugin), validates conventional commit format, uses `gh` CLI, and **asks you before every commit, push, or PR creation**.

---

## Data directory

Runtime data lives in `~/.mekiki/` (or `$MEKIKI_HOME`):

```
~/.mekiki/
  events/claude-code/YYYY-MM-DD.jsonl   # captured events
  state.db                               # SQLite analyzer state
  reports/                               # generated HTML
  evidence/                              # evidence packs for skill improvement
  cli-path                               # path to the installed mekiki binary
```

To capture raw hook payloads during smoke testing:

```bash
MEKIKI_CAPTURE_HOOK_PAYLOADS=1 claude
```

---

## Workflow skills

Mekiki observes skills, so you need skills installed for it to observe anything. Bootstrap offers to run the common installer. You can also run it separately:

```bash
bash ~/Furaidē/common/install-common.sh --global      # bx, html-preview, brave-search, plan
bash ~/Furaidē/common/install-skills.sh --ecosystem claude-code  # superpowers, notebooklm, …
```

---

## Config bundle

`config/` contains Furaidē's sanitized global Claude Code configuration. `bootstrap.sh` offers to copy it for you.

```bash
# Manually:
cp ~/Furaidē/claude-code/config/CLAUDE.md ~/.claude/CLAUDE.md
cp ~/Furaidē/claude-code/config/statusline-command.sh ~/.claude/statusline-command.sh
# Then merge relevant keys from config/settings.json manually
```

See [`config/README.md`](config/README.md) for per-file notes.

> The `hooks` block is intentionally absent from `config/settings.json`. Mekiki's plugin ships its own `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}`, so no manual hook wiring is required.

---

## Development

```bash
cd cli
uv run pytest          # run test suite
uv run pytest -x -q    # fail fast
```

**Plugin structure:**
```
plugins/
  mekiki/
    .claude-plugin/plugin.json   # plugin manifest
    commands/mekiki.md           # /mekiki slash command
    hooks/hooks.json             # event capture hooks (CLAUDE_PLUGIN_ROOT-relative)
    bin/mekiki                   # PATH shim → cli/.venv/bin/mekiki
  hanko/
    .claude-plugin/plugin.json   # plugin manifest
    skills/github/SKILL.md       # /github skill
    GITHUB.md                    # git/GitHub workflow reference
    bin/github-setup-check       # SSH + gh CLI setup verification
```

**Adding a new plugin:** create `plugins/<name>/.claude-plugin/plugin.json`, then register it in `/.claude-plugin/marketplace.json` at the repo root.

### Why `.claude-plugin/` is at the repo root

Claude Code's marketplace command fetches `.claude-plugin/marketplace.json` from the repository root. That path is part of the discovery protocol: `/plugin marketplace add pratty010/Furaide` reads the repo-root copy, and `marketplace.json` already points `pluginRoot` at `./claude-code/plugins`. The file is a small JSON index; the actual plugin code lives in `plugins/` here.

It stays at the root by design. Moving it under `claude-code/` would break the `owner/repo` install shorthand, which only resolves a marketplace at the repository root.

---

## Part of F.R.I.D.A.Y.

The full collection lives at [pratty010/Furaide](https://github.com/pratty010/Furaide). Other components: `opencode/` (29-agent core fleet), `common/` (shared skills + docs), `pi-agent/`, `openclaw/`.
