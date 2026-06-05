# claude-code/

> *One plugin, one skill. Furaidē's shikigami for Claude Code.*

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) monorepo.

---

## Components

| Component | Role |
|-----------|------|
| **Mekiki** (plugin) | Skill-usage analytics: captures every skill invocation and judges its effectiveness offline |
| **`github` skill** | Git/GitHub workflow recipes for the `hanko--git-seal` subagent |
| **`hanko--git-seal`** (agent) | Quiet executor for all git/GitHub ops; routes through the `github` skill |

Mekiki and the `github` skill share a single engine (`cli/`) installed by `scripts/bootstrap.sh`.

---

## Install

### 1. Clone and bootstrap

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/claude-code/scripts/bootstrap.sh
```

The bootstrap script is interactive by default (Y/n prompt per step). Pass `--yes`/`-y` to run unattended:
1. Migrates `~/.satori` → `~/.mekiki` (one-time, unconditional)
2. Installs the `mekiki` CLI engine via `uv sync`
3. Installs shared common skills (`github`, `bx`, `html-preview`, `brave-search`, `plan`) — copies to `~/.agents/skills/`, symlinks `~/.claude/skills/` → `~/.agents/skills/`
4. Copies `config/agents/hanko--git-seal.md` → `~/.claude/agents/`
5. Backs up and copies `config/CLAUDE.md` + `config/statusline-command.sh` → `~/.claude/`

Flags: `--yes`/`-y` (non-interactive), `--minimal` (steps 1–2 only), `--no-config` (skip step 5), `--with-skills` (also install manifest skills), `-h`.

### 2. Register and install Mekiki plugin in Claude Code

```
/plugin marketplace add pratty010/Furaide
/plugin install mekiki@fr1d4y
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

### Git/GitHub: hanko--git-seal + github skill

All git and GitHub work routes to the `hanko--git-seal` subagent automatically:

```
commit these changes to dev
create a PR from feat/my-feature
check CI status for my branch
push to dev
```

The subagent invokes `Skill(github)` for the six standard workflow recipes and reads `GITHUB.md` for setup, SSH signing, PAT config, rulesets, and troubleshooting. It **asks before every commit, push, or PR creation**.

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

## Uninstall

```bash
bash ~/Furaidē/claude-code/scripts/uninstall.sh
```

Default: interactive (prompts for user data). Flags: `--dry-run` (print what would be removed, no changes), `--purge` (remove everything with no prompts).

Then in Claude Code:
```
/plugin uninstall mekiki@fr1d4y
/plugin marketplace remove fr1d4y
```

---

## Development

```bash
cd cli
uv run pytest          # run test suite
uv run pytest -x -q    # fail fast
```

### Experimental `dev` Branch

For testing upcoming features on the `dev` branch:

1. **Clone and Bootstrap**
   Check out the `dev` branch of Furaidē and run the installer:

   ```bash
   git clone -b dev https://github.com/pratty010/Furaide.git ~/furaide-dev
   bash ~/furaide-dev/claude-code/scripts/bootstrap.sh
   ```

2. **Run Tests**
   Ensure dependencies are synced and the test suite passes:

   ```bash
   cd ~/furaide-dev/claude-code/cli
   uv run pytest
   ```

3. **Local Plugin Smoke Testing**
   To test modifications to local plugins/skills before they are merged:
   - **For skills**: modify the source under `common/skills/` and re-run `bootstrap.sh`.
   - **For Claude Code plugins**: because `/plugin marketplace add` fetches the marketplace metadata from the default branch on GitHub, live marketplace commands resolve to the remote repo. For local plugin development, use the checked-out copy with local bootstrap, then run Claude Code while capturing event payloads:

     ```bash
     MEKIKI_CAPTURE_HOOK_PAYLOADS=1 claude
     ```

**Plugin structure:**
```
plugins/
  mekiki/
    .claude-plugin/plugin.json   # plugin manifest
    commands/mekiki.md           # /mekiki slash command
    hooks/hooks.json             # event capture hooks (CLAUDE_PLUGIN_ROOT-relative)
    bin/mekiki                   # PATH shim → cli/.venv/bin/mekiki
config/
  agents/
    hanko--git-seal.md           # git/GitHub subagent (installed → ~/.claude/agents/)
  CLAUDE.md                      # global config (installed → ~/.claude/)
  statusline-command.sh          # statusline helper (installed → ~/.claude/)
```

**Adding a new skill:** add to `common/skills/`, then update `common/skills-manifest.json`.

**Adding a new plugin:** create `plugins/<name>/.claude-plugin/plugin.json`, then register it in `/.claude-plugin/marketplace.json` at the repo root.

### Why `.claude-plugin/` is at the repo root

Claude Code's marketplace command fetches `.claude-plugin/marketplace.json` from the repository root. That path is part of the discovery protocol: `/plugin marketplace add pratty010/Furaide` reads the repo-root copy, and each plugin `source` path is relative to that root (e.g. `./claude-code/plugins/mekiki`). The file is a small JSON index; the actual plugin code lives in `plugins/` here.

It stays at the root by design. Moving it under `claude-code/` would break the `owner/repo` install shorthand, which only resolves a marketplace at the repository root.

---

## Part of F.R.I.D.A.Y.

The full collection lives at [pratty010/Furaide](https://github.com/pratty010/Furaide). Other components: `opencode/` (30-agent core fleet), `common/` (shared skills + docs), `pi-agent/`, `openclaw/`.
