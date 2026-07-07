# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

Two independent Claude Code plugins, plus install-target config, bundled under `harnesses/claude-code/` in the Furaidē monorepo:

- **Īdisu** (`plugins/idisu/`): capability-analytics shikigami. Hooks capture skill invocations; a Bun/TypeScript CLI (`cli/src/idisu/`) plus a Python package (`cli/src/mekiki/`) run a "dream loop" that consolidates events into a work-style profile and improvement backlog.
- **Rejion** (`plugins/rejion/`): delegates code review and task execution to `opencode-go`, `opencode` (OpenCode Zen), and `ollama-cloud`, invoked as one-shot `opencode`/`pi` CLI processes (no server, no RPC daemon).
- **`config/`**: install-target material copied into `~/.claude/` by `scripts/bootstrap.sh` (global `CLAUDE.md`, `settings.json`, statusline, the `hanko--git-seal` subagent definition).

Both plugins are registered in the repo-root `.claude-plugin/marketplace.json` (source paths `./harnesses/claude-code/plugins/idisu` and `./harnesses/claude-code/plugins/rejion`). That file must stay at the repo root: `/plugin marketplace add owner/repo` only resolves a marketplace there.

## Directory map

- `cli/`: Īdisu engine. `src/idisu/` is the TypeScript code area; `pyproject.toml` and `uv.lock` define the `mekiki` Python package
- `plugins/idisu/`: Claude Code plugin. Hooks, commands, and manifest, all resolved via `${CLAUDE_PLUGIN_ROOT}`
- `plugins/rejion/`: Claude Code plugin. One-shot `opencode`/`pi` CLI backend adapters, per-workspace state, seven slash commands
- `config/`: install-target material. `CLAUDE.md`, `settings.json`, `statusline-command.sh`, `agents/hanko--git-seal.md`
- `scripts/`: `bootstrap.sh`, `uninstall.sh`

## Commands

### Īdisu (Bun/TypeScript), run from `cli/src/idisu/`

```bash
bun install               # first time / after dependency changes
bun test                  # test suite
bun test path/to.test.ts  # single test file
bun run typecheck         # tsc --noEmit, must pass with 0 errors
bun run lint              # biome check . (biome pinned via devDependencies, ^1.8.3)
bun run fmt               # biome format --write .
```

### Mekiki (Python), run from `cli/`

```bash
uv sync --frozen                              # install the dev env
uv run pytest -x -q --tb=short                # full suite, fail fast
uv run pytest path/to/test_file.py::test_name # single test
```

### Rejion plugin, run from `plugins/rejion/`

```bash
bun install                # installs the pinned @biomejs/biome (^1.8.3)
bun test                   # test suite (bun's runner; package.json's `test` script uses node --test but bun test is what's verified working)
bun run lint               # biome check . (run from plugins/rejion/; a global/newer bunx biome fails on this repo's 1.8.3-schema biome.json)
```

### Installer

```bash
bash scripts/bootstrap.sh --help   # --yes, --minimal, --no-config, --with-skills
bash scripts/uninstall.sh --help   # --dry-run, --purge
```

## Architecture

### Īdisu: four-phase dream loop

```
Orient → Gather → Consolidate → Prune
```

- **Orient**: loads config, manifest, previous state from `~/.idisu/` (or `$IDISU_HOME`)
- **Gather**: scans harness transcripts through adapters (`ClaudeCodeAdapter` reads `~/.claude/projects/` JSONL, `CodexAdapter` reads `~/.codex/sessions/`, `OpenCodeAdapter` reads a SQLite DB), dedupes hook events against transcript events by `event_id` (`source_id` + `source_position`), appends new events to the log
- **Consolidate**: computes capability metrics, builds intent clusters from BM25 terms, writes `profile.json` / `backlog.json` / `findings.json` projections
- **Prune**: evicts evidence past the retention window, reindexes

A directory-based lock (`.dream.lock.d/` with PID/timestamp metadata) prevents concurrent dream runs. Scheduled runs are triggered by the plugin's `Stop` hook (`plugins/idisu/hooks/stop.sh`) and respect `dream_interval_hours` from `~/.idisu/config.json`.

Adapters implement `scan(checkpoints): AsyncGenerator<EventEnvelope>`. Hook-captured and transcript-derived events collide and dedupe naturally because the adapter emits transcript events with the same `cc-hook:sessionId` source format hooks use.

Plugin hook wiring (`plugins/idisu/hooks/hooks.json`) is `${CLAUDE_PLUGIN_ROOT}`-relative. Don't hardcode paths.

### Rejion: one-shot CLI delegation, no persistent process

Every backend call is a fresh spawned process; there is no long-lived server or broker to keep in sync:

- `scripts/rejion-companion.mjs` is the entry point for all seven commands (`setup`, `models`, `review`, `task`, `status`, `result`, `cancel`); each `commands/*.md` slash command shells out to it via `Bash(node ...)`.
- `scripts/lib/opencode-backend.mjs` and `scripts/lib/pi-backend.mjs` both spawn `detached: true` (own process group) so `terminateProcessTree` can `kill(-pid)` on cancel, falling back to `kill(pid)` if the group lookup fails.
- Jobs are persisted per-workspace in `scripts/lib/state.mjs`: state dir is `sha256(realpath(workspaceRoot)).slice(0,16)`-keyed under `$REJION_PLUGIN_DATA/state/` (or `~/.rejion/state/`), writes go through a temp-file-then-rename for atomicity. Job lifecycle is `queued → running → (done | error | cancelled)`, plus an optional cosmetic `phase` hint.
- `scripts/lib/git.mjs#collectDiffPatch` builds the actual diff sent to the backend (staged + unstaged + untracked text files for working-tree reviews, `merge-base..HEAD` for branch reviews), capped at 20k chars with a 20MB `maxBuffer` safety net and a 24KB per-untracked-file cap.
- `scripts/lib/render.mjs#renderResult` parses backend output as JSON-lines event streams (`opencode --format json` / `pi --mode json` both emit event envelopes, not the raw review schema directly) and extracts the final message before validating it against `schemas/review-output.schema.json`.
- Provider slugs are `opencode-go`, `opencode` (display name "OpenCode Zen"), and `ollama-cloud`. `pi` cannot reach `ollama-cloud`, so `rejion-companion.mjs` rejects that backend/provider pairing before creating a job.
- At most one active job (any kind) runs per workspace at a time; `rejion-companion.mjs` checks this across `review` and `task` jobs together, not per-kind.

### Marketplace / distribution mechanics

`.claude-plugin/marketplace.json` at the repo root is the discovery protocol Claude Code's `/plugin marketplace add` command reads. Each plugin's `source` path there is relative to the repo root, not to `harnesses/claude-code/`. `${CLAUDE_PLUGIN_ROOT}` inside hooks/commands resolves relative to the installed plugin directory, independent of repo layout.

## Editing rules

- `config/` is install-target material (copied verbatim into `~/.claude/`), not source-only documentation. Treat changes there as user-facing config, not docs.
- `config/statusline-sidecar.json` is written by hooks at runtime; don't commit it (root `.gitignore` excludes it).
- `cli/.idisu/` is Īdisu runtime scratch; gitignored.
- Rejion's `biome.json` targets schema `1.8.3` to match its pinned `@biomejs/biome` devDependency. Always run `bun run lint`/`bunx biome check .` from inside `plugins/rejion/` (or `cli/src/idisu/`) so the pinned version resolves, not a global/newer `bunx biome`.
- CI (`.github/workflows/ci.yml`) triggers on `harnesses/claude-code/**` and runs `uv sync --frozen` + `uv run pytest` for the mekiki package.
- Repo-root pre-push hooks (shellcheck, semgrep-diff, trivy-quick) run sequentially, ~8 minutes.

## Always / Ask first / Never

**Always**: run Īdisu's `bun test` + `bun run typecheck` when touching `cli/src/idisu/` or `plugins/idisu/`. Run `uv run pytest` when touching `cli/src/mekiki/`. Run Rejion's `bun test` + `bun run lint` (from `plugins/rejion/`) when touching `plugins/rejion/`.

**Ask first**: before changing marketplace registration, plugin manifest paths, or either plugin's on-disk state-directory layout (breaks existing users' persisted state).

**Never**: commit captured payloads from `IDISU_CAPTURE_HOOK_PAYLOADS` debugging. Commit real user data as test fixtures. Patch `node_modules`.
