# Satori (Skill Overseer)

> *A shikigami in Furaidē's service, the eye on your Claude Code skills.*

Satori is a [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code/plugins) that captures every skill invocation and judges its effectiveness offline. Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/F.R.I.D.A.Y) collection.

---

## What it does

- **Captures**: lightweight JSONL event log in `~/.satori/events/` (hooks fire on every skill invoke, session start, and turn stop; the plugin stores no conversation content)
- **Judges**: an LLM-as-judge pipeline reads Claude Code transcripts and classifies each invocation as triggered correctly, triggered unnecessarily, or a gap where no skill fired but one should have
- **Reports**: Jinja2 HTML reports served locally: a fleet overview and per-skill deep-dives
- **Improves**: builds evidence packs for individual skills so you (or `skill-creator`) can rewrite a skill's description with data

---

## Install

### Default: full install (plugin + CLI)

**Option A: Claude Code marketplace** (once listed):

```bash
claude plugin install satori@pratty010
cd ~/.claude/plugins/satori/cli && uv sync
```

**Option B: direct from git:**

```bash
claude plugin install https://github.com/pratty010/claude-code.git
cd ~/.claude/plugins/satori/cli && uv sync
```

**Option C: local dev-link** (for contributors):

```bash
git clone https://github.com/pratty010/claude-code.git ~/satori
bash ~/satori/scripts/dev-link-plugin.sh   # prompts to install workflow skills
cd ~/satori/cli && uv sync
```

---

### Workflow skills

Satori observes skills — but you need skills installed for it to observe. `dev-link-plugin.sh` offers to run the skill installer automatically. You can also run it separately at any time:

```bash
bash ~/satori/scripts/install-skills.sh          # interactive, category-by-category
bash ~/satori/scripts/install-skills.sh --all    # install everything, no prompts
bash ~/satori/scripts/install-skills.sh --list   # preview what would be installed
bash ~/satori/scripts/install-skills.sh --project  # project-local install only
```

The installer reads `skills-manifest.json`, clones source repos into `~/.agents/skill-repos/`, and creates a two-level symlink chain:

```
~/.agents/skill-repos/superpowers/skills/brainstorming/   ← cloned once
~/.agents/skills/brainstorming                            ← aggregated view
~/.claude/skills/brainstorming                            ← Claude Code
```

To update all skills later:

```bash
git -C ~/.agents/skill-repos/superpowers pull
```

---

### Selective install: pick what you need

<details>
<summary><strong>Plugin only</strong>: capture hooks, no analytics CLI</summary>

The plugin registers hooks automatically on install. The `/satori` skill will shell out to the CLI; you can add the CLI later without reinstalling the plugin.

```bash
claude plugin install https://github.com/pratty010/claude-code.git
```

</details>

<details>
<summary><strong>CLI only</strong>: analytics without the plugin</summary>

The CLI can ingest existing event logs even if the plugin hooks weren't running when they were captured (useful if you have data from the old Puraguin setup).

```bash
git clone https://github.com/pratty010/claude-code.git ~/satori
cd ~/satori/cli && uv sync
satori --help

# If migrating from ~/.puraguin/:
mv ~/.puraguin ~/.satori
```

</details>

<details>
<summary><strong>Config bundle only</strong>: Furaidē's global Claude Code config</summary>

No plugin required. Copy the files you want into `~/.claude/`:

```bash
git clone https://github.com/pratty010/claude-code.git ~/satori

# All at once:
cp ~/satori/config/CLAUDE.md ~/.claude/CLAUDE.md
cp ~/satori/config/keybindings.json ~/.claude/keybindings.json
cp ~/satori/config/statusline-command.sh ~/.claude/statusline-command.sh
# Then merge relevant keys from ~/satori/config/settings.json manually
```

See [`config/README.md`](config/README.md) for per-file notes.

</details>

---

## Usage

Once the plugin and CLI are installed, the `/satori` skill is available in every Claude Code session:

```
/satori                          # overview: which skills fired this week
/satori deep-dive /<skill>       # per-skill analysis
/satori improve /<skill>         # build evidence pack → hand off to skill-creator
```

Or call the CLI directly:

```bash
satori run                        # ingest + judge + aggregate
satori report --overview          # build + serve overview.html
satori report --skill <name>      # build + serve skill detail
satori improve --skill <name>     # build evidence pack
satori improve --skill <name> --mark applied
```

---

## Data directory

Runtime data lives in `~/.satori/` (or `$SATORI_HOME`):

```
~/.satori/
  events/claude-code/YYYY-MM-DD.jsonl   # captured events
  state.db                               # SQLite analyzer state
  reports/                               # generated HTML
  evidence/                              # evidence packs for skill improvement
  debug/                                 # raw hook payloads (opt-in)
```

To capture raw hook payloads during smoke testing:

```bash
SATORI_CAPTURE_HOOK_PAYLOADS=1 claude
```

---

## Config bundle

`config/` contains Furaidē's sanitized global Claude Code configuration. See [`config/README.md`](config/README.md) for install instructions.

> [!NOTE]
> The `hooks` block is intentionally absent from `config/settings.json`. Satori's plugin ships its own `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}`, no hook wiring required.

---

## Development

```bash
cd cli
uv run pytest          # run test suite
uv run pytest -x -q    # fail fast
```

The plugin follows the [Claude Code plugin spec](https://docs.anthropic.com/en/docs/claude-code/plugins): `.claude-plugin/plugin.json` declares the plugin, `hooks/hooks.json` wires events using `${CLAUDE_PLUGIN_ROOT}`, and `skills/satori/SKILL.md` defines the `/satori` slash command.

---

## Part of F.R.I.D.A.Y.

This plugin is one of Furaidē's shikigami. The full collection lives at [pratty010/F.R.I.D.A.Y](https://github.com/pratty010/F.R.I.D.A.Y).
