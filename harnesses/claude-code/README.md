# 🧠 claude-code/

[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-pratty010%2FFuraide-8b5cf6)](https://github.com/pratty010/Furaide)
[![Īdisu](https://img.shields.io/badge/Īdisu-Capability%20Analytics-8b5cf6)](https://github.com/pratty010/Furaide)
[![Rejion](https://img.shields.io/badge/Rejion-Review%20%26%20Task%20Delegation-8b5cf6)](https://github.com/pratty010/Furaide)

> *Two plugins, one skill. Furaidē's shikigami for Claude Code.*

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) monorepo.

---

## Prerequisites

- **bun**: runtime for the Īdisu CLI engine and the Rejion plugin
- **Python 3.11+**: runtime for mekiki event processing
- **jq**: JSON processing in bootstrap hooks
- **Claude Code CLI**: registered and authenticated
- **`opencode` and/or `pi` CLIs**: only if you install Rejion, which delegates to whichever of these are on `PATH`

---

## ✨ What ships here

| Piece | What it does |
|-------|-------------|
| **Īdisu plugin** | Capability analytics shikigami. Captures skill invocations, runs dream passes, surfaces improvement suggestions |
| **Rejion plugin** | Delegates code review and task execution to `opencode-go`, `opencode` (OpenCode Zen), and `ollama-cloud` via one-shot `opencode`/`pi` CLI backends. Commands: `/rejion:setup`, `/rejion:models`, `/rejion:review`, `/rejion:task`, `/rejion:status`, `/rejion:result`, `/rejion:cancel` |
| **`github` skill** | Git/GitHub workflow recipes for the `hanko--git-seal` subagent |
| **`hanko--git-seal` shikigami** | Quiet executor for all git/GitHub ops; routes through the `github` skill |

Īdisu and the `github` skill share a single engine (`cli/`) installed by `packages/cli/src/targets/claude-code/install.sh`.

---

## Components

| Component | Role |
|-----------|------|
| **Īdisu** (plugin) | Capability analytics shikigami. Captures skill invocations across harnesses, runs dream passes, surfaces improvement suggestions |
| **Rejion** (plugin) | Delegates code review and task execution to `opencode-go`, `opencode` (OpenCode Zen), and `ollama-cloud` via one-shot CLI backends |
| **`github` skill** | Git/GitHub workflow recipes for the `hanko--git-seal` subagent |
| **`hanko--git-seal`** (shikigami) | Quiet executor for all git/GitHub ops; routes through the `github` skill |

### Īdisu architecture

Īdisu runs a four-phase **dream loop** over your session data:

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

Īdisu deduplicates hook events and transcript events at read time using canonical `event_id` values derived from `source_id` + `source_position`. When a `tool_use_id` exists in transcript data, the adapter emits events with `cc-hook:sessionId` source format so they collide with hook-captured events and deduplicate naturally.

**Projections** are the output artifacts written to `~/.idisu/state/`:

- `profile.json`: per-capability metrics (recency, frequency, session spread, intent cluster membership)
- `backlog.json`: open improvement suggestions with priority scoring
- `findings.json`: gap detection results

---

## ⚡ Install

A two-phase process: bootstrap local assets, then register the plugin in Claude Code.

### Phase 1: Clone and bootstrap

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/packages/cli/src/targets/claude-code/install.sh
```

The bootstrap script is interactive by default (Y/n prompt per step). Pass `--yes`/`-y` to run unattended:
1. Archives legacy `~/.mekiki` and creates `~/.idisu`
2. Installs the `idisu` CLI engine via `bun install`
3. Installs shared common skills (`github`, `bx`, `html-preview`, `brave-search`, `plan`): copies to `~/.agents/skills/`, symlinks `~/.claude/skills/` → `~/.agents/skills/`
4. Copies `config/agents/hanko--git-seal.md` → `~/.claude/agents/`
5. Backs up and copies `config/CLAUDE.md` + `config/statusline-command.sh` → `~/.claude/`

Flags: `--yes`/`-y` (non-interactive), `--minimal` (steps 1-2 only), `--no-config` (skip step 5), `--with-skills` (also install manifest skills), `-h`.

### Phase 2: Register and install plugins in Claude Code

```
/plugin marketplace add pratty010/Furaide
/plugin install idisu@fr1d4y
/plugin install rejion@fr1d4y
/reload-plugins
```

Install just one of the two if you only need capability analytics (Īdisu) or only need review/task delegation (Rejion). Neither depends on the other.

---

## 🚀 Usage

### Īdisu: capability analytics

```
/idisu                          # overview and latest profile
/idisu dream                    # ingest + consolidate
/idisu profile                  # print current work-style profile
/idisu backlog                  # open improvement suggestions
/idisu backlog --status=open    # filter to open suggestions only
/idisu report                   # generate HTML report
/idisu report --serve           # generate report and open in browser
/idisu improve <capability-id>   # print improvement brief for handoff
/idisu mark <id> accepted       # record outcome after applying an improvement
/idisu reset                    # clear all state (event log preserved)
/idisu reset --projections-only # clear projections only, keep events
```

Or call the CLI directly:

```bash
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts dream
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts dream --scheduled  # respects cadence config
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts profile --json
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts report --serve
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts improve <name>
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts mark <id> accepted
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts reset --projections-only
```

### Rejion: review and task delegation

```
/rejion:setup                          # detect opencode/pi binaries, cache the model index
/rejion:models                         # list models reachable across opencode-go, opencode, ollama-cloud
/rejion:review                         # review the working-tree diff (or --base <ref> for a branch diff)
/rejion:task "implement X"             # delegate an implementation/debugging/research task
/rejion:status                         # list jobs for this workspace, or /rejion:status <job-id> for one job
/rejion:result <job-id>                # print a completed job's structured result
/rejion:cancel <job-id>                # kill a running backend process
```

Each command accepts `--backend opencode|pi` and `--model <model>` (either a bare cached model name or an explicit `provider/model` string) to override the defaults set by `/rejion:setup`. `/rejion:review` and `/rejion:task` also accept `--wait`/`--background` to control whether Claude Code blocks on the result; if neither is passed, Rejion asks once. At most one review or task job runs per workspace at a time.

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

Runtime data lives in `~/.idisu/` (or `$IDISU_HOME`):

```
~/.idisu/
  events/claude-code/YYYY-MM-DD.jsonl   # captured events (hook + transcript)
  state/                                  # generated profile, backlog, findings, manifest.json
  cache/                                  # disposable SQLite / report artifacts
  evidence/                               # snapshotted evidence bands
  catalog/                                # capability catalog
  config.json                             # user config (all fields optional)
  checkpoints.json                        # scan progress tracking per source
  cli-path                                # executable path used to launch the Īdisu CLI
  .dream.lock.d/                           # directory-based dream lock (with owner.json)
  .last_dream                             # Unix timestamp of last completed dream
  debug/                                  # diagnostic logs from hook dependency failures
```

To capture raw hook payloads during smoke testing:

```bash
IDISU_CAPTURE_HOOK_PAYLOADS=1 claude
```

---

## ⚙️ Configuration

Īdisu reads optional config from `~/.idisu/config.json` (or `$IDISU_HOME/config.json`). All fields have defaults:

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

Īdisu observes skills, so you need skills installed for it to observe anything. Bootstrap offers to run the common installer. You can also run it separately:

```bash
bash ~/Furaidē/packages/cli/src/shared/install-vendored-skills.sh --global      # bx, html-preview, brave-search, plan
bash ~/Furaidē/packages/cli/src/shared/install-external-skills.sh --ecosystem claude-code  # superpowers, notebooklm, …
```

### Config bundle

`config/` contains Furaidē's sanitized global Claude Code configuration. `bootstrap.sh` offers to copy it for you.

```bash
# Manually:
cp ~/Furaidē/harnesses/claude-code/config/CLAUDE.md ~/.claude/CLAUDE.md
cp ~/Furaidē/harnesses/claude-code/config/statusline-command.sh ~/.claude/statusline-command.sh
# Then merge relevant keys from config/settings.json manually
```

See [`config/README.md`](config/README.md) for per-file notes.

> The `hooks` block is intentionally absent from `config/settings.json`. Īdisu's plugin ships its own hook scripts using `${CLAUDE_PLUGIN_ROOT}`, so no manual hook wiring is required.

### Why `.claude-plugin/` is at the repo root

Claude Code's marketplace command fetches `.claude-plugin/marketplace.json` from the repository root. That path is part of the discovery protocol: `/plugin marketplace add pratty010/Furaide` reads the repo-root copy, and each plugin `source` path is relative to that root (e.g. `./harnesses/claude-code/plugins/idisu`). The file is a small JSON index; the actual plugin code lives in `plugins/` here.

It stays at the root by design. Moving it under `claude-code/` would break the `owner/repo` install shorthand, which only resolves a marketplace at the repository root.

---

## 🗑️ Uninstall

```bash
bash ~/Furaidē/packages/cli/src/targets/claude-code/uninstall.sh
```

Default: interactive (prompts for user data). Flags: `--dry-run` (print what would be removed, no changes), `--purge` (remove everything with no prompts).

Then in Claude Code:

```
/plugin uninstall idisu@fr1d4y
/plugin uninstall rejion@fr1d4y
/plugin marketplace remove fr1d4y
```

---

## 🔧 Development

Īdisu engine:

```bash
cd cli/src/idisu
bun test                # run test suite
bun test -x -q          # fail fast
bun run typecheck        # TypeScript type checking
bun run lint             # biome check
bun run fmt              # biome format --write
```

Rejion plugin:

```bash
cd plugins/rejion
bun install              # installs the pinned @biomejs/biome
bun test                 # run test suite
bun run lint             # biome check, run from here so the pinned version resolves
```

### Experimental `dev` branch

For testing upcoming features on the `dev` branch:

1. **Clone and Bootstrap**
   Check out the `dev` branch of Furaidē and run the installer:

   ```bash
   git clone -b dev https://github.com/pratty010/Furaide.git ~/furaide-dev
   bash ~/furaide-dev/packages/cli/src/targets/claude-code/install.sh
   ```

2. **Run Tests**
   Ensure dependencies are synced and the test suite passes:

   ```bash
   cd ~/furaide-dev/harnesses/claude-code/cli/src/idisu
   bun install
   bun test
   ```

3. **Local Plugin Smoke Testing**
   To test modifications to local plugins/skills before they are merged:
   - **For skills**: modify the source under `skills/` and re-run `bootstrap.sh`.
   - **For Claude Code plugins**: because `/plugin marketplace add` fetches the marketplace metadata from the default branch on GitHub, live marketplace commands resolve to the remote repo. For local plugin development, use the checked-out copy with local bootstrap, then run Claude Code while capturing event payloads:

     ```bash
      IDISU_CAPTURE_HOOK_PAYLOADS=1 claude
     ```

**Plugin structure:**
```
plugins/
  idisu/
    .claude-plugin/plugin.json   # plugin manifest
    commands/idisu.md           # /idisu slash command
    commands/mekiki.md           # deprecated alias (forwards to /idisu)
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
    bin/mekiki                   # legacy PATH shim → $IDISU_HOME/cli-path
  rejion/
    .claude-plugin/plugin.json   # plugin manifest
    commands/*.md                 # setup, models, review, task, status, result, cancel
    scripts/rejion-companion.mjs   # entry point all commands shell out to
    scripts/lib/                 # backend adapters, state, git diff collection, rendering
    schemas/                     # review-output and bridge-event JSON schemas
    tests/                       # bun test suite
```
config/
  agents/
    hanko--git-seal.md           # git/GitHub subagent (installed → ~/.claude/agents/)
  CLAUDE.md                      # global config (installed → ~/.claude/)
  statusline-command.sh          # statusline helper (installed → ~/.claude/)

**Adding a new skill:** add to `skills/`, then update `packages/manifests/skills-manifest.json`.

**Adding a new plugin:** create `plugins/<name>/.claude-plugin/plugin.json`, then register it in `/.claude-plugin/marketplace.json` at the repo root.

---

## 📚 See also

The full collection lives at [pratty010/Furaide](https://github.com/pratty010/Furaide). Other components: `harnesses/opencode/` (30-shikigami core fleet), `harnesses/pi-agent/`, `harnesses/openclaw/`.
