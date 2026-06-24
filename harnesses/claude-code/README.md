# 🧠 claude-code/

[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-pratty010%2FFuraide-8b5cf6)](https://github.com/pratty010/Furaide)
[![Satori](https://img.shields.io/badge/Satori-Capability%20Analytics-8b5cf6)](https://github.com/pratty010/Furaide)

> *One plugin, one skill. Furaidē's shikigami for Claude Code.*

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) monorepo.

---

## Prerequisites

- **bun**: runtime for the Satori CLI engine
- **Python 3.11+**: runtime for mekiki event processing
- **jq**: JSON processing in bootstrap hooks
- **Claude Code CLI**: registered and authenticated

---

## ✨ What ships here

| Piece | What it does |
|-------|-------------|
| **Satori plugin** | Capability analytics shikigami. Captures skill invocations, runs dream passes, surfaces improvement suggestions |
| **`github` skill** | Git/GitHub workflow recipes for the `hanko--git-seal` subagent |
| **`hanko--git-seal` shikigami** | Quiet executor for all git/GitHub ops; routes through the `github` skill |

Satori and the `github` skill share a single engine (`cli/`) installed by `scripts/bootstrap.sh`.

---

## Components

| Component | Role |
|-----------|------|
| **Satori** (plugin) | Capability analytics shikigami. Captures skill invocations across harnesses, runs dream passes, surfaces improvement suggestions |
| **`github` skill** | Git/GitHub workflow recipes for the `hanko--git-seal` subagent |
| **`hanko--git-seal`** (shikigami) | Quiet executor for all git/GitHub ops; routes through the `github` skill |

### Satori architecture

Satori runs a four-phase **dream loop** over your session data:

```
Orient → Gather → Consolidate → Prune
```

- **Orient**: loads config, manifest, and previous state
- **Gather**: scans harness transcripts via adapters (Claude Code, Codex, OpenCode), deduplicates hook events against transcript events, appends new events to the log
- **Consolidate**: computes capability metrics, builds intent clusters from BM25 terms, writes profile and backlog projections
- **Prune**: evicts evidence past the retention window, reindexes

The dream loop acquires a directory-based lock (`.dream.lock.d/` with PID/timestamp metadata) to prevent concurrent runs. Scheduled runs (triggered by the `Stop` hook) respect `dream_interval_hours` from config.

**Adapters** implement a `SessionAdapter` interface (`scan(checkpoints): AsyncGenerator<EventEnvelope>`) to read harness-native session data:

| Adapter | Reads from | Default path |
|---------|-----------|--------------|
| `ClaudeCodeAdapter` | JSONL transcripts | `~/.claude/projects/` |
| `CodexAdapter` | Codex session files | `~/.codex/sessions/` |
| `OpenCodeAdapter` | SQLite database | `~/.local/share/opencode/opencode.db` |

Satori deduplicates hook events and transcript events at read time using canonical `event_id` values derived from `source_id` + `source_position`. When a `tool_use_id` exists in transcript data, the adapter emits events with `cc-hook:sessionId` source format so they collide with hook-captured events and deduplicate naturally.

**Projections** are the output artifacts written to `~/.satori/state/`:

- `profile.json`: per-capability metrics (recency, frequency, session spread, intent cluster membership)
- `backlog.json`: open improvement suggestions with priority scoring
- `findings.json`: gap detection results

---

## ⚡ Install

A two-phase process: bootstrap local assets, then register the plugin in Claude Code.

### Phase 1: Clone and bootstrap

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/claude-code/scripts/bootstrap.sh
```

The bootstrap script is interactive by default (Y/n prompt per step). Pass `--yes`/`-y` to run unattended:
1. Archives legacy `~/.mekiki` and creates `~/.satori`
2. Installs the `satori` CLI engine via `bun install`
3. Installs shared common skills (`github`, `bx`, `html-preview`, `brave-search`, `plan`): copies to `~/.agents/skills/`, symlinks `~/.claude/skills/` → `~/.agents/skills/`
4. Copies `config/agents/hanko--git-seal.md` → `~/.claude/agents/`
5. Backs up and copies `config/CLAUDE.md` + `config/statusline-command.sh` → `~/.claude/`

Flags: `--yes`/`-y` (non-interactive), `--minimal` (steps 1-2 only), `--no-config` (skip step 5), `--with-skills` (also install manifest skills), `-h`.

### Phase 2: Register and install Satori plugin in Claude Code

```
/plugin marketplace add pratty010/Furaide
/plugin install satori@fr1d4y
/reload-plugins
```

---

## 🚀 Usage

### Satori: capability analytics

```
/satori                          # overview and latest profile
/satori dream                    # ingest + consolidate
/satori profile                  # print current work-style profile
/satori backlog                  # open improvement suggestions
/satori backlog --status=open    # filter to open suggestions only
/satori report                   # generate HTML report
/satori report --serve           # generate report and open in browser
/satori improve <capability-id>   # print improvement brief for handoff
/satori mark <id> accepted       # record outcome after applying an improvement
/satori reset                    # clear all state (event log preserved)
/satori reset --projections-only # clear projections only, keep events
```

Or call the CLI directly:

```bash
bun run ~/Furaidē/claude-code/cli/src/satori/src/cli/index.ts dream
bun run ~/Furaidē/claude-code/cli/src/satori/src/cli/index.ts dream --scheduled  # respects cadence config
bun run ~/Furaidē/claude-code/cli/src/satori/src/cli/index.ts profile --json
bun run ~/Furaidē/claude-code/cli/src/satori/src/cli/index.ts report --serve
bun run ~/Furaidē/claude-code/cli/src/satori/src/cli/index.ts improve <name>
bun run ~/Furaidē/claude-code/cli/src/satori/src/cli/index.ts mark <id> accepted
bun run ~/Furaidē/claude-code/cli/src/satori/src/cli/index.ts reset --projections-only
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

## 🗂️ Data directory

Runtime data lives in `~/.satori/` (or `$SATORI_HOME`):

```
~/.satori/
  events/claude-code/YYYY-MM-DD.jsonl   # captured events (hook + transcript)
  state/                                  # generated profile, backlog, findings, manifest.json
  cache/                                  # disposable SQLite / report artifacts
  evidence/                               # snapshotted evidence bands
  catalog/                                # capability catalog
  config.json                             # user config (all fields optional)
  checkpoints.json                        # scan progress tracking per source
  cli-path                                # executable path used to launch the Satori CLI
  .dream.lock.d/                           # directory-based dream lock (with owner.json)
  .last_dream                             # Unix timestamp of last completed dream
  debug/                                  # diagnostic logs from hook dependency failures
```

To capture raw hook payloads during smoke testing:

```bash
SATORI_CAPTURE_HOOK_PAYLOADS=1 claude
```

---

## ⚙️ Configuration

Satori reads optional config from `~/.satori/config.json` (or `$SATORI_HOME/config.json`). All fields have defaults:

| Field | Default | Description |
|-------|---------|-------------|
| `dream_interval_hours` | 24 | Minimum hours between scheduled dream passes |
| `harnesses` | `["claude_code"]` | Which session adapters to enable (`claude_code`, `codex`, `opencode`) |
| `lookback_days` | 30 | How far back to scan for events |
| `llm_budget_per_dream` | 50000 | Token budget reserved for future LLM-assisted analysis |
| `evidence_retention_days` | 90 | Days to retain snapshotted evidence |
| `min_sample_threshold` | 5 | Minimum events before a capability appears in projections |

---

## 📚 Docs / Reference

### Workflow skills

Satori observes skills, so you need skills installed for it to observe anything. Bootstrap offers to run the common installer. You can also run it separately:

```bash
bash ~/Furaidē/common/install-common.sh --global      # bx, html-preview, brave-search, plan
bash ~/Furaidē/common/install-skills.sh --ecosystem claude-code  # superpowers, notebooklm, …
```

### Config bundle

`config/` contains Furaidē's sanitized global Claude Code configuration. `bootstrap.sh` offers to copy it for you.

```bash
# Manually:
cp ~/Furaidē/claude-code/config/CLAUDE.md ~/.claude/CLAUDE.md
cp ~/Furaidē/claude-code/config/statusline-command.sh ~/.claude/statusline-command.sh
# Then merge relevant keys from config/settings.json manually
```

See [`config/README.md`](config/README.md) for per-file notes.

> The `hooks` block is intentionally absent from `config/settings.json`. Satori's plugin ships its own hook scripts using `${CLAUDE_PLUGIN_ROOT}`, so no manual hook wiring is required.

### Why `.claude-plugin/` is at the repo root

Claude Code's marketplace command fetches `.claude-plugin/marketplace.json` from the repository root. That path is part of the discovery protocol: `/plugin marketplace add pratty010/Furaide` reads the repo-root copy, and each plugin `source` path is relative to that root (e.g. `./claude-code/plugins/satori`). The file is a small JSON index; the actual plugin code lives in `plugins/` here.

It stays at the root by design. Moving it under `claude-code/` would break the `owner/repo` install shorthand, which only resolves a marketplace at the repository root.

---

## 🗑️ Uninstall

```bash
bash ~/Furaidē/claude-code/scripts/uninstall.sh
```

Default: interactive (prompts for user data). Flags: `--dry-run` (print what would be removed, no changes), `--purge` (remove everything with no prompts).

Then in Claude Code:

```
/plugin uninstall satori@fr1d4y
/plugin marketplace remove fr1d4y
```

---

## 🔧 Development

```bash
cd cli/src/satori
bun test                # run test suite
bun test -x -q          # fail fast
bun run typecheck        # TypeScript type checking
bun run lint             # biome check
bun run fmt              # biome format --write
```

### Experimental `dev` branch

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
   cd ~/furaide-dev/claude-code/cli/src/satori
   bun install
   bun test
   ```

3. **Local Plugin Smoke Testing**
   To test modifications to local plugins/skills before they are merged:
   - **For skills**: modify the source under `common/skills/` and re-run `bootstrap.sh`.
   - **For Claude Code plugins**: because `/plugin marketplace add` fetches the marketplace metadata from the default branch on GitHub, live marketplace commands resolve to the remote repo. For local plugin development, use the checked-out copy with local bootstrap, then run Claude Code while capturing event payloads:

     ```bash
      SATORI_CAPTURE_HOOK_PAYLOADS=1 claude
     ```

**Plugin structure:**
```
plugins/
  satori/
    .claude-plugin/plugin.json   # plugin manifest
    commands/satori.md           # /satori slash command
    commands/mekiki.md           # deprecated alias (forwards to /satori)
    hooks/hooks.json             # event capture hooks (CLAUDE_PLUGIN_ROOT-relative)
    hooks/session_start.sh       # session.start event
    hooks/skill_pre.sh           # skill.invoke (PreToolUse matcher: Skill)
    hooks/skill_post.sh          # skill outcome (PostToolUse matcher: Skill)
    hooks/skill_post_failure.sh  # skill failure outcome
    hooks/user_prompt_expansion.sh # skill.user_typed events
    hooks/stop.sh                # triggers scheduled dream pass on session end
    hooks/_emit.sh               # shared event emitter
    hooks/_capture_payload.sh    # raw payload capture (debug mode)
    hooks/_mark_inactive.sh      # dependency fail-open observability
    bin/mekiki                   # legacy PATH shim → $SATORI_HOME/cli-path
```
config/
  agents/
    hanko--git-seal.md           # git/GitHub subagent (installed → ~/.claude/agents/)
  CLAUDE.md                      # global config (installed → ~/.claude/)
  statusline-command.sh          # statusline helper (installed → ~/.claude/)

**Adding a new skill:** add to `common/skills/`, then update `common/skills-manifest.json`.

**Adding a new plugin:** create `plugins/<name>/.claude-plugin/plugin.json`, then register it in `/.claude-plugin/marketplace.json` at the repo root.

---

## 📚 See also

The full collection lives at [pratty010/Furaide](https://github.com/pratty010/Furaide). Other components: `harnesses/opencode/` (30-shikigami core fleet), `harnesses/pi-agent/`, `harnesses/openclaw/`.
