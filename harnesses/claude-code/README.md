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
- **jq**: JSON processing in bootstrap hooks and the statusline
- **Claude Code CLI**: registered and authenticated
- **`opencode` and/or `pi` CLIs**: only if you install Rejion, which delegates to whichever of these are on `PATH`

---

## ✨ What ships here

| Piece | What it does |
|-------|-------------|
| **Īdisu plugin** | Capability-analytics + learning platform. Captures skill invocations and session outcomes, mines recurring workflows into skill candidates, tracks their real-world usage, and surfaces staleness/overlap/deprecation proposals |
| **Rejion plugin** | Delegates code review and task execution to `opencode-go`, `opencode` (OpenCode Zen), and `ollama-cloud` via one-shot `opencode`/`pi` CLI backends. Commands: `/rejion:setup`, `/rejion:models`, `/rejion:review`, `/rejion:task`, `/rejion:status`, `/rejion:result`, `/rejion:cancel` |
| **`github` skill** | Git/GitHub workflow recipes for the `hanko--git-seal` subagent |
| **`hanko--git-seal` shikigami** | Quiet executor for all git/GitHub ops; routes through the `github` skill |

Īdisu and the `github` skill share a single engine (`cli/`) installed by `packages/cli/src/targets/claude-code/install.sh`.

---

## Components

| Component | Role |
|-----------|------|
| **Īdisu** (plugin) | Observes work across harnesses, judges outcomes, mines skill candidates, and tracks/curates what's been promoted — a self-improving loop, not just a metrics dashboard |
| **Rejion** (plugin) | Delegates code review and task execution to `opencode-go`, `opencode` (OpenCode Zen), and `ollama-cloud` via one-shot CLI backends |
| **`github` skill** | Git/GitHub workflow recipes for the `hanko--git-seal` subagent |
| **`hanko--git-seal`** (shikigami) | Quiet executor for all git/GitHub ops; routes through the `github` skill |

### Īdisu architecture

Īdisu runs a **dream pass** — the same `/idisu dream` invocation that used to be a simple four-phase loop is now an 8-stage pipeline, run in this actual order:

```
Orient → Gather → Measure → Judge → Track → Curate → Mine → Consolidate (write profile) → Prune
```

- **Orient**: loads config, manifest, previous state from `~/.idisu/`
- **Gather**: scans harness transcripts via adapters (Claude Code, Codex, OpenCode), dedupes hook events against transcript events, writes new events into `idisu.db`
- **Measure**: computes deterministic per-capability metrics (invocation count, model-trigger rate, attribution rate) — no LLM involved
- **Judge**: two-tier outcome labeling — Tier 1 is deterministic (pr-link merged, tool-result failure, clean stop); Tier 2 falls back to a budgeted `claude -p` headless call only for the residual unknowns
- **Track**: imports pre-existing installed skills into the artifact registry, then updates each attributed skill's evidence ledger (`applied`/`win`/`loss`/`score`) from the session's outcome label
- **Curate**: proposes (never auto-applies) staleness flags, score-based deprecation, and BM25-overlap merge candidates for existing active artifacts
- **Mine**: extracts recurring tool-sequence n-grams, filters them into skill candidates (repetition/session/success thresholds + rejection memory + overlap suppression), and stages surviving candidates to `pending/`
- **Consolidate**: writes the reconciled `profile.json`/`profile.md` + state manifest
- **Prune**: evicts evidence past the retention window, reindexes

A directory-based lock (`.dream.lock`) prevents concurrent dream runs. Scheduled runs are triggered by the plugin's `Stop` hook and respect `dream_interval_hours` from config.

**Adapters** implement a `scan(checkpoints): AsyncGenerator<EventEnvelope>` interface to read harness-native session data:

| Adapter | Reads from | Default path |
|---------|-----------|--------------|
| `ClaudeCodeAdapter` | JSONL transcripts (deep: tool calls, skill attribution, turn duration, pr-link outcomes) | `~/.claude/projects/` |
| `CodexAdapter` | Codex session files | `~/.codex/sessions/` |
| `OpenCodeAdapter` | SQLite database | `~/.local/share/opencode/opencode.db` |

Īdisu deduplicates hook events and transcript events at read time using canonical `event_id` values derived from `source_id` + `source_position`. When a `tool_use_id` exists in transcript data, the adapter emits events with the `cc-hook:sessionId` source format hooks use, so they collide and dedupe naturally.

**Storage**: everything lands in a single `idisu.db` (SQLite, WAL mode) — `events`, `sessions`, `outcome_labels`, `workflow_ngrams`, `artifacts`, `evidence_ledger`, `nodes`/`edges` (a lightweight evidence graph), `rejected_signatures`, `metric_rollups`, plus FTS5 virtual tables for BM25 lookups. The legacy JSONL event-log and its separate SQLite cache were removed once ingest fully moved onto `idisu.db`.

**Artifact lifecycle** (never hard-deletes): mined signal → staged candidate (`pending/<id>/draft.md` + `evidence.md`) → human review (`/idisu review`) → `promoted` (moved to a real `~/.agents/skills/` directory) or `rejected` (moved to `archive/`, signature remembered so it's never re-proposed) → tracked via the evidence ledger → eventually flagged `stale`/`deprecated` by Curate, again as a proposal, never automatically.

---

## ⚡ Install

A two-phase process: bootstrap local assets, then register the plugin in Claude Code.

### Phase 1: Clone and bootstrap

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/packages/cli/src/targets/claude-code/install.sh
```

The bootstrap script is interactive by default (Y/n prompt per step; the skills step also offers `s` to pick a subset individually). Pass `--yes`/`-y` to run unattended:
1. Creates `~/.idisu`
2. Installs the `idisu` CLI engine via `bun install`
3. Installs CC's skill boundary: `github`, `html-preview`, `handoff-furaide-addendum`, `post-mortem`, `regression-test-recipe` (repo-vendored, copied to `~/.agents/skills/` + symlinked into `~/.claude/skills/`) plus the bundled `research` skill (`config/skills/research/` → `~/.claude/skills/research/`, a direct copy) plus the canonical external set (superpowers/mattpocock subset, `ponytail` — via `install-external-skills.sh --ecosystem claude-code --all`; `notebooklm` stays manual/hand-install, see below)
4. Copies `config/agents/*.md` (`hanko--git-seal`, `kamaitachi--scout`) → `~/.claude/agents/`
5. Backs up and copies `config/CLAUDE.md` + `config/rules/*.md` + `config/statusline-command.sh` + `config/statusline-lib/` → `~/.claude/`, and merges `config/settings.json` (including its `SubagentStop`/`SessionEnd`/`SessionStart` statusline hooks) into `~/.claude/settings.json`

Flags: `--yes`/`-y` (non-interactive), `--minimal` (steps 1-2 only), `--no-config` (skip step 5), `--with-skills` (deprecated no-op — the canonical external set installs by default now), `-h`.

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

### Īdisu: capability analytics + learning

```
/idisu                                # overview and latest profile
/idisu dream                          # run a dream pass (gather + measure + judge + track/curate + mine)
/idisu dream --force                  # ignore dream_interval_hours, run now
/idisu profile                        # print current work-style profile
/idisu profile --json                 # same, machine-readable
/idisu report                         # generate HTML report
/idisu report --serve                 # generate report and open in browser
/idisu review                         # list candidates pending review (read-only)
/idisu review --json                  # same, machine-readable
/idisu promote <id> --to <path>       # move a staged candidate into an installed skill
/idisu reject <id> --reason "<text>"  # archive a candidate, remember its signature
/idisu learn --source <dir|file|url|session:id>  # assemble evidence + standards into a skill-authoring prompt
/idisu reset                          # clear all state (event log preserved)
/idisu reset --projections-only       # clear projections only, keep events
```

`/idisu review` is a conversational approval gate, not just a listing command: it presents each pending candidate with its evidence, and on approval hands off to `Skill(skill-creator)` conventions to author the real `SKILL.md` before calling `promote`. `/idisu learn` follows the same author-then-promote handoff for an explicit, user-directed skill request rather than a mined candidate.

Or call the CLI directly:

```bash
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts dream
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts dream --force
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts profile --json
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts report --serve
bun run ~/Furaidē/harnesses/claude-code/cli/src/idisu/src/cli/index.ts review --json
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

Commits are autonomous (local, reversible); push/PR-create/PR-merge/worktree-merge-back require two-hop approval — the subagent returns `NEEDS APPROVAL: <command> — <details>` to the main agent, which asks you before re-dispatching to execute (subagents can't prompt you directly). See `skills/github/SKILL.md` for the 7 workflow recipes, `GITHUB.md` for branch strategy/troubleshooting, and `SECURITY.md` for signing/PAT setup and the full hook/CI security inventory.

---

## 🗂️ Data directory

Runtime data lives in `~/.idisu/` (or `$IDISU_HOME`):

```
~/.idisu/
  idisu.db                 # SQLite (WAL): events, sessions, outcome_labels, workflow_ngrams,
                            #   artifacts, evidence_ledger, nodes/edges, rejected_signatures,
                            #   metric_rollups, FTS5 tables
  spool/                    # JSONL event spool, drained into idisu.db each dream pass
  pending/<id>/              # staged candidates awaiting review: draft.md + evidence.md
  archive/<id>/               # rejected/deprecated candidates (draft + evidence preserved, never deleted)
  reports/                  # generated HTML reports
  state/                     # profile.json / profile.md / manifest.json projections
  cache/index.sqlite        # disposable BM25/capability cache
  config.json                # user config (all fields optional)
  checkpoints.json           # scan progress tracking per source
  cli-path                   # executable path used to launch the Īdisu CLI
  .dream.lock                # single-file dream-pass lock
  .last_dream                # Unix timestamp of last completed dream
  debug/                     # diagnostic logs from hook dependency failures
```

To capture raw hook payloads during smoke testing:

```bash
IDISU_CAPTURE_HOOK_PAYLOADS=1 claude
```

---

## ⚙️ Configuration

Īdisu reads optional config from `~/.idisu/config.json` (or `$IDISU_HOME/config.json`). All fields have defaults:

| Field | Default | Description |
|-------|---------|--------------|
| `dream_interval_hours` | 24 | Minimum hours between scheduled dream passes |
| `harnesses` | `["claude_code"]` | Which session adapters to enable (`claude_code`, `codex`, `opencode`) |
| `lookback_days` | 30 | How far back to scan for events |
| `llm_budget_per_dream` | 50000 | Token budget for the Tier-2 LLM judge per dream pass |
| `judge_backend` | `claude_cli` | Judge backend — `claude_cli` or `none` (Tier-1 deterministic labeling still runs either way) |
| `judge_model` | `claude-haiku-4-5` | Model used for Tier-2 judge calls |
| `evidence_retention_days` | 90 | Days to retain snapshotted evidence before pruning |
| `min_sample_threshold` | 5 | Minimum events before a capability appears in projections |
| `min_repetition` | 3 | Minimum total occurrences of a tool-sequence n-gram before it's mining-eligible |
| `min_candidate_sessions` | 2 | Minimum distinct sessions contributing to a mined candidate |
| `min_candidate_successes` | 1 | Minimum success-labeled sessions among those |
| `candidate_overlap_bm25_max` | 2.0 | BM25 distance ceiling below which a candidate is suppressed as a near-duplicate of an existing artifact (untuned — the artifact corpus is small pre-adoption) |
| `stale_after_sessions` | 30 | Intended threshold for "no hits in N sessions" staleness; current implementation flags zero-hit artifacts only — a documented interim gap, not a silent bug |
| `merge_overlap_threshold` | 0.6 | Token-overlap ratio above which two active artifacts get a merge proposal |

---

## 📚 Docs / Reference

### Workflow skills

Īdisu observes skills, so you need skills installed for it to observe anything. Bootstrap offers to run the common installer. You can also run it separately:

```bash
bash ~/Furaidē/packages/cli/src/shared/install-vendored-skills.sh --global --only github,html-preview,handoff-furaide-addendum,post-mortem,regression-test-recipe
bash ~/Furaidē/packages/cli/src/shared/install-external-skills.sh --ecosystem claude-code --all  # superpowers, mattpocock, ponytail ("manual"-tagged sets like notebooklm are excluded from --all by design)
```

Run `install-vendored-skills.sh --list` to see every repo-vendored skill with its description (used internally by the `s` picker in `install.sh`); drop `--only` to install the full shared pool instead of just CC's boundary set.

### Config bundle

`config/` contains Furaidē's sanitized global Claude Code configuration. `bootstrap.sh` offers to copy it for you.

```bash
# Manually:
cp ~/Furaidē/harnesses/claude-code/config/CLAUDE.md ~/.claude/CLAUDE.md
cp ~/Furaidē/harnesses/claude-code/config/statusline-command.sh ~/.claude/statusline-command.sh
cp -r ~/Furaidē/harnesses/claude-code/config/statusline-lib ~/.claude/statusline-lib
# Then merge relevant keys from config/settings.json manually
```

See [`config/README.md`](config/README.md) for per-file notes, including the statusline's per-session sidecar (`~/.claude/statusline-state/`) and its `SubagentStop`/`SessionEnd`/`SessionStart` hooks.

> `config/settings.json`'s `hooks` block wires the statusline's live subagent-tracking hooks (`SubagentStop`/`SessionEnd`/`SessionStart`), not Īdisu's — Īdisu's plugin ships its own separate hook scripts using `${CLAUDE_PLUGIN_ROOT}` and needs no manual wiring here. If you're merging `settings.json` by hand into a file that already has its own `hooks` key, merge the event arrays rather than overwriting the whole key.

### Optional: NotebookLM research grounding

The `research` skill (see `config/skills/research/SKILL.md`) can optionally use [NotebookLM](https://notebooklm.google.com) via the `notebooklm` skill (wraps [`notebooklm-py`](https://github.com/teng-lin/notebooklm-py)) for source-grounded, cited synthesis over document-heavy corpora — PDFs, papers, long YouTube, filings. It's never required: the research flow silently falls back to native `WebSearch`/`WebFetch` if NotebookLM isn't set up or its availability gate fails.

Quick path:

```bash
uv tool install "notebooklm-py[browser]"   # pulls Playwright + Chromium, ~170MB first run
notebooklm login                            # interactive browser auth (Google account)
notebooklm auth check --test --json         # verify — must show status:"ok" AND checks.token_fetch:true
```

Gotchas:
- **Use `uv`/`pipx`, not system `pip`** — PEP 668 blocks it on most distros.
- First `notebooklm login` triggers the Playwright/Chromium download; budget a few minutes and ~170MB.
- The `[cookies]` extra (rookiepy-based cookie import) doesn't work on Python 3.13+ — use interactive `notebooklm login` instead.
- This wraps an **unofficial, undocumented Google API** — it can break without notice. Treat it as a nice-to-have, not a dependency.
- Rate limits and per-source-tier caps apply; heavy corpora may hit them.

Full command reference and troubleshooting: the `notebooklm` skill's own `SKILL.md`, and the upstream [`notebooklm-py` docs](https://github.com/teng-lin/notebooklm-py). This same setup also applies to `harnesses/opencode/` — NotebookLM is a one-time per-machine setup shared across harnesses.

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
bun test                 # run test suite
bun test -x -q           # fail fast
bun run typecheck        # TypeScript type checking
bun run lint              # biome check
bun run fmt               # biome format --write
```

Rejion plugin:

```bash
cd plugins/rejion
bun install              # installs the pinned @biomejs/biome
bun test                  # run test suite
bun run lint              # biome check, run from here so the pinned version resolves
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
    commands/idisu.md            # /idisu slash command
    hooks/hooks.json              # event capture hooks (CLAUDE_PLUGIN_ROOT-relative)
    hooks/session_start.sh        # session.observed event
    hooks/skill_post.sh           # skill outcome (PostToolUse matcher: Skill)
    hooks/stop.sh                 # triggers scheduled dream pass on session end
    hooks/_emit.sh                # shared event emitter (writes to spool/)
    hooks/_capture_payload.sh     # raw payload capture (debug mode)
    hooks/_mark_inactive.sh       # dependency fail-open observability
  rejion/
    .claude-plugin/plugin.json    # plugin manifest
    commands/*.md                  # setup, models, review, task, status, result, cancel
    scripts/rejion-companion.mjs   # entry point all commands shell out to
    scripts/lib/                  # backend adapters, state, git diff collection, rendering
    schemas/                       # review-output and bridge-event JSON schemas
    tests/                         # bun test suite
```
config/
  agents/
    hanko--git-seal.md           # git/GitHub subagent (installed → ~/.claude/agents/)
    kamaitachi--scout.md          # Haiku research-collection subagent (installed → ~/.claude/agents/)
  rules/
    model-usage.md                # model tiers + delegation (installed → ~/.claude/rules/)
    version-control.md            # git/GitHub conventions (installed → ~/.claude/rules/)
    gate-policy.md                # auto-proceed/soft-confirm/hard-gate tiers (installed → ~/.claude/rules/)
  skills/
    research/                     # bundled research-flow skill (installed → ~/.claude/skills/research/, direct copy)
  CLAUDE.md                       # global config, lean entry/routing (installed → ~/.claude/)
  statusline-command.sh           # statusline entry point (installed → ~/.claude/)
  statusline-lib/                 # statusline logic, 8 files (installed → ~/.claude/statusline-lib/)

**Adding a new skill:** add to `skills/`, then update `packages/manifests/skills-manifest.json`.

**Adding a new plugin:** create `plugins/<name>/.claude-plugin/plugin.json`, then register it in `/.claude-plugin/marketplace.json` at the repo root.

---

## 📅 Timeline

- [x] ~~v0.1.0 — **Īdisu initial**: skills-only capture, 4-phase dream loop~~
- [x] ~~v0.2.0 — **Īdisu v2**: 8-stage pipeline, /idisu learn~~
- [x] ~~v0.3.0 — **Rejion v1**: seven slash commands, opencode/pi delegation~~
- [x] ~~v0.4.0 — **Statusline v1–v4**: sidecar, token dedup, externalized pricing~~
- [x] ~~v0.5.0 — **Security + git tooling**: lefthook, gitleaks, trivy, semgrep, SECURITY.md; hanko--git-seal, github skill, two-hop approval, SSH-signed commits~~
- [x] ~~v0.6.0 — **Config bundle v1–v3**: 5-flow restructure, rules/, research skill~~
- [x] ~~v0.7.0 — **Workflow flows v1**: Research, Planning, Dev, Bug-hunting, Design~~
- [ ] Īdisu: memory mining, judge expansion, instruction-edit candidates
- [ ] Īdisu: deep Codex/OpenCode adapters, cross-harness skill sync
- [ ] Rejion: smart backend routing, llm-council, cross-workspace job visibility
- [ ] Statusline: cost-per-subscription-window view
- [ ] Workflows: law, financial, OC-parity multi-subagent
- [ ] Security: Trivy-full CI integration, supply-chain audit
- [ ] Git tooling: root installer entry-point fix

---

## 📚 See also

The full collection lives at [pratty010/Furaide](https://github.com/pratty010/Furaide). Other components: `harnesses/opencode/` (30-shikigami core fleet), `harnesses/pi-agent/`, `harnesses/openclaw/`.
