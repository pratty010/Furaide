# Furaidē: Claude Code Config Bundle

Furaidē's global Claude Code configuration, safe to copy into `~/.claude/`. Each file is independent; install all or only the parts you want.

Prerequisites: none beyond claude-code itself.

---

## Install

### Default: install everything

```bash
cp config/CLAUDE.md ~/.claude/CLAUDE.md
cp -r config/rules ~/.claude/rules
cp -r config/agents ~/.claude/agents
cp -r config/skills/research ~/.claude/skills/research
cp config/statusline-command.sh ~/.claude/statusline-command.sh
cp -r config/statusline-lib ~/.claude/statusline-lib
cp config/claude-pricing.json ~/.claude/claude-pricing.json
```

The `packages/cli/src/targets/claude-code/install.sh` installer does all of this plus a per-skill `[Y/n/s/b]` picker, receipt tracking, and idempotent skip-if-exists checks. Prefer it over manual copying unless you're cherry-picking a single file. See the repo-root install docs for flags.

---

### Selective install: per component

#### CLAUDE.md: working guide and Furaidē persona

The lean entry point: Furaidē persona, front-load-alignment behavior, intent triage, the 5-flow routing table (Research, Discussion/Planning/PRD, Development, Bug-hunting, Design/Architecture), Global Constraints (YAGNI/DRY/SLAP/SRP/complexity tiers), and pointers to `rules/`. This is the most impactful file to install.

```bash
# Replace:
cp config/CLAUDE.md ~/.claude/CLAUDE.md

# Or append to an existing CLAUDE.md:
cat config/CLAUDE.md >> ~/.claude/CLAUDE.md
```

#### rules/*.md: model usage, version control, gate policy

Three always-loaded rule files the lean `CLAUDE.md` points to instead of inlining:

- `model-usage.md`: model tiers, subagent selection, delegation thresholds.
- `version-control.md`: git/GitHub conventions, routed through `hanko--git-seal`.
- `gate-policy.md`: auto-proceed / soft-confirm / hard-gate tiers.

```bash
cp -r config/rules ~/.claude/rules
```

#### agents/*.md: hanko--git-seal, kamaitachi--scout

Two subagent definitions the flows in `CLAUDE.md` reference directly:

- `hanko--git-seal.md`: routes all git/GitHub operations (commit/push/branch/PR/merge/CI).
- `kamaitachi--scout.md` (鎌鼬): Haiku-tier web/source collector for the Research flow and quick lookups elsewhere. Writes findings to a file and returns only a path plus a short summary.

```bash
cp -r config/agents ~/.claude/agents
```

#### skills/research/: bundled Research flow skill

`SKILL.md` plus four templates (`scope-card.md`, `outline.md`, `evidence-matrix.md`, `report.md`) implementing the pre-flight → scope-card → outline → collect → evidence-matrix → report flow at quick/medium/deep levels, with an optional gated NotebookLM collect path.

```bash
cp -r config/skills/research ~/.claude/skills/research
```

#### claude-pricing.json: statusline cost-estimate source

Per-model USD/MTok pricing (base + cache tiers + `us` geo multiplier + fast mode + web-search billing), read by `statusline-command.sh` to compute `estimated_cost_cents`. Ships next to the script and self-installs a copy to `~/.claude/claude-pricing.json` on first run if one isn't already there. Copy it manually only if you're installing the statusline script somewhere the two files won't sit side by side.

```bash
cp config/claude-pricing.json ~/.claude/claude-pricing.json
```

#### keybindings.json: custom keyboard shortcuts

Adds shortcuts for transcript toggle, model picker, thinking toggle, stash, and history search.

```bash
cp config/keybindings.json ~/.claude/keybindings.json
```

> [!WARNING]
> This replaces your existing keybindings entirely. Review the file before applying if you have custom bindings.

#### statusline-command.sh + statusline-lib/: custom status line (v2)

Two-line, width-adaptive status line. `statusline-command.sh` is a thin entry
point (mode dispatch, `$HERE` resolution, sourcing order) — all the actual
logic lives in `statusline-lib/` (`util.sh`, `pricing.sh`, `sidecar.sh`,
`transcript-scan.sh`, `subagent-tracking.sh`, `transcript-tail.sh`,
`recompute.sh`, `display.sh`). **The two must be installed together**: the
entry script resolves its own directory (following symlinks) and sources
`$HERE/statusline-lib/*.sh` unconditionally — copying only the entry script
to a location without a sibling `statusline-lib/` makes the statusline exit
silently blank (each `source` is guarded to fail open, not crash).

Requires `jq` and `python3`. `flock` is optional: it powers the fast,
event-driven subagent-completion path (see the queue file below); if it
isn't installed, that path is skipped cleanly and subagent totals still
resolve via the slower legacy retry route on the next render. Re-runs on new
assistant messages, `/compact`, permission/vim mode changes, and the
`refreshInterval` timer (terminal resize alone does not trigger a re-run).

```
Line 1: 🧠 model │ effort │ 🕐 dur (📡api-dur)   ~↑inΣ⚡r%/↓outΣ[turn] [⫂ subin/subout] │ CTX: [bar] cur/win
Line 2: 📁 cwd (branch) │ +add/-rem            5hr/1wk: pct%(reset)/pct%(reset) │ ~$:cost [sub%]
```

The leading `~` on the token total and on `$:` is independent of each other
and only appears while at least one subagent completion for this session is
still genuinely unresolved (`pending_subagents` — see below); it should now
be rare and brief given the `SubagentStop` hook. `5hr/1wk:` merges into one
composite segment (each side keeping its own independent color ramp) only
when both rate-limit windows are present in the payload; with just one
window present, that window still renders under its own `5hr:`/`1wk:` label.

```bash
cp config/statusline-command.sh ~/.claude/statusline-command.sh
cp -r config/statusline-lib ~/.claude/statusline-lib
```

Then add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline-command.sh"
  },
  "hooks": {
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "bash ~/.claude/statusline-command.sh --subagent-stop", "timeout": 10 } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "bash ~/.claude/statusline-command.sh --recompute", "timeout": 15 } ] }
    ],
    "SessionStart": [
      { "matcher": "resume", "hooks": [ { "type": "command", "command": "bash ~/.claude/statusline-command.sh --recompute", "timeout": 15 } ] }
    ]
  }
}
```

The three hooks are what make subagent totals track live instead of only
catching up whenever the statusline itself next renders: `SubagentStop`
fires the instant any subagent finishes; `SessionEnd` best-effort-finalizes a
session that ends normally; `SessionStart` (`matcher: "resume"` only)
backstops a resumed session against a hard kill/crash, since `SessionEnd` is
documented as unreliable in that case. Merging this `hooks` block into an
`~/.claude/settings.json` that already defines its own top-level `hooks` key
needs care: a naive object merge that replaces whole top-level keys (as
opposed to merging each hook event array) will drop any hooks you already
had wired to `SubagentStop`/`SessionEnd`/`SessionStart` — reconcile those
arrays by hand rather than overwriting.

`packages/cli/src/targets/claude-code/install.sh` handles the
`statusline-lib/` pairing correctly without change: global scope symlinks
`statusline-command.sh` into `~/.claude/`, and project scope points
`settings.json` at the script's absolute path in this repo — both keep
`$HERE` resolving back to `config/`, where `statusline-lib/` already lives.
It also already wires the three hooks above via its existing `settings.json`
merge step. The one caveat is that merge step's shallow `dict.update`
behavior described above — if you already have your own `hooks` key in the
target `settings.json`, re-running the installer replaces it wholesale
instead of merging event arrays. This is a pre-existing installer
limitation, not one introduced here, but it now has a real trigger case
since the bundled `settings.json` carries a `hooks` key for the first time.

**CLI modes**, all from the same entry script:

- `--recompute all` (alias `--recompute-all`): full batch recompute — rebuild
  every local session's sidecar from a full-file, dedup-correct rescan of its
  transcript.
- `--recompute <session_id>`: recompute just that one session (resolve its
  transcript path, full rescan-rebuild, drain any stale subagent-queue file
  clean).
- `--recompute` with no further argument: same single-session recompute, but
  reads `session_id` from stdin hook JSON instead of argv — this is the form
  the `SessionEnd`/`SessionStart(resume)` hooks above invoke, since hooks
  deliver context via stdin, not argv.
- `--subagent-stop`: reads a `SubagentStop` hook payload from stdin and
  enqueues that subagent's completion into its session's subagent-queue file
  (see below), then opportunistically drains the queue into the sidecar.
  Fails open — a hook callback must never surface a non-zero exit.

**Sidecar state** (`~/.claude/statusline-state/<session_id>.json` by default;
override with `STATUSLINE_STATE_DIR`): one JSON file per session, atomically
written (temp file + rename). Stale files (>30 days) are pruned on each run.
It holds:

- **Duration fold across resume**: Claude Code's own `total_duration_ms` /
  `total_api_duration_ms` reset to near-zero when a session resumes. The
  sidecar remembers the last-seen value and, when the new value is lower
  than the last one (a reset), folds the old value into a running base so
  the displayed clock keeps counting up across resumes instead of jumping
  backward.
- **Transcript tail-cursor token totals**: a byte offset into the session
  transcript (`transcript_offset`). Each run re-reads only the bytes appended
  since the last run, sums main-thread assistant `message.usage` fields into
  running `in_total`/`out_total`/`cache_read_total`/`cache_creation_total`.
- **Cumulative subagent totals, not a per-agent map**: `subagent_in_total` /
  `_out_total` / `_cr_total` / `_cc_total`, `subagent_rate_sum` / `_rate_turns`,
  and a per-model `subagent_models` bucket (all folded in once a subagent's
  transcript resolves). Only genuinely unresolved subagents get an entry, under
  `pending_subagents` (keyed by task id, carrying a fallback estimate + model);
  `counted_subagents` guards against re-folding the same id after a cursor
  reset. A 136-subagent session that used to carry a 58KB done+pending map now
  runs about 3KB, since cumulative sums are all the display ever read anyway.
  Older sidecars self-migrate on first load (`_migrate_sidecar`).
- **Subagent-queue file** (`<session_id>.subagent-queue.json`, next to the
  sidecar, pruned on the same >30-day schedule): a single JSON object keyed
  by agent id (`{"<id>": {"transcript_path": ..., "agent_type": ...}, ...}`),
  the hand-off point between the `SubagentStop` hook (which enqueues a
  just-finished subagent) and the fold into the sidecar (which happens on the
  next drain, either from the same hook call or opportunistically at the top
  of the next render). One file per session, no separate lock file — it's
  locked directly via its own file descriptor with `flock`, and only ever
  mutated in place (read → transform → truncate-and-rewrite), never replaced
  via temp-file-plus-rename, since a rename would swap in a new inode a
  concurrent locker wouldn't be contending against. This is what makes
  concurrent/parallel subagent completions (fanning out 3-5 agents at once)
  trackable without losing or corrupting anything. If `flock` isn't present,
  the queue is skipped entirely and completions fall back to the slower
  legacy retry route inside the transcript tail pass.
- **Cost estimate**: transcripts carry no cost field at all; `total_cost_usd`
  only exists in the live hook payload. `estimated_cost_cents` is computed
  every render from the token buckets (main + subagent + pending fallback +
  web-search) through `claude-pricing.json`'s per-model rates, and is what's
  displayed whenever a session hasn't had a real cost payload rendered live
  yet. `--recompute-all` writes this field too, so every session shows a cost.
- **Web search / fetch counts**: `web_search_total` / `web_fetch_total`,
  scanned from `usage.server_tool_use` the same dedup-aware way as token
  fields, priced via `claude-pricing.json`'s `modifiers` block.

**Fail-open discipline**: every field this script reads from the payload or
the sidecar is null/missing-guarded. A corrupt sidecar, an absent
`transcript_path`, a missing `jq`, or any parse failure degrades that one
value (falls back to 0 / the raw payload field / an omitted display segment)
rather than crashing the whole status line.

**Color ramps** (locked thresholds):

- CTX bar/percentage: window > 300K tokens → green 0–20%, yellow 20–50%, red
  above 50%. Window ≤ 300K → green 0–50%, yellow 50–75%, red above 75%.
- Rate-limit percentages (5hr and 1wk, each independent): green 0–50%,
  yellow 50–75%, orange (256-color `\033[38;5;208m`) 75–90%, red above 90%.
- Each rate-limit window and the `[⫂ subin/subout]` subagent-token segment are
  independently omitted when their underlying payload data is absent (no
  `⚠`/WARN glyph — that path was removed; ramp color alone signals severity).

#### settings.json: Claude Code settings

Contains: model (`opusplan`), effort level (`high`), theme (`dark-ansi`), editor mode (`normal`), auto-compact, statusline, Codex plugin config.

> [!CAUTION]
> `skipDangerousModePermissionPrompt` and `skipAutoPermissionPrompt` are both `true`. Review before applying if you prefer explicit permission prompts.

**Merge approach**: copy only the keys you want rather than wholesale replacing your settings:

```bash
# View what's in the bundle:
cat config/settings.json

# Then manually add the keys you want to ~/.claude/settings.json
```

The `hooks` block wires the statusline's `SubagentStop`/`SessionEnd`/`SessionStart(resume)` hooks (see the `statusline-command.sh` entry above) — it does not overlap with the Īdisu plugin, which ships its own separate `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}` and needs no manual wiring here.

---

## Notes

- **Skills**: `skills/research/` ships as part of this bundle (see above). Everything else under `~/.claude/skills/` (the external superpowers/mattpocock/ponytail set and the rest of the repo's shared skill pool) installs from source repos via `install-external-skills.sh` / `install-vendored-skills.sh`, not from this directory.
- **Īdisu hooks** are handled by the Īdisu plugin (capability analytics shikigami) itself, separate from this bundle's `settings.json` hooks. Install via `bootstrap.sh` or `claude plugin install`. Hooks wire automatically. The plugin hooks write events to `~/.idisu/` (or `$IDISU_HOME`).
- The `CLAUDE.md` in this bundle is Furaidē's full working guide including the persona preamble. The version at `~/.claude/CLAUDE.md` on your machine is the live copy Claude Code reads each session.
- **CLI commands** (Īdisu shikigami): `dream`, `profile`, `backlog`, `report`, `improve <id>`, `mark <id>`, `reset`. Access via `/idisu <command>` in Claude Code or `bun run <cli-path> <command>` from the shell.
- **Smoke testing hooks**: run `IDISU_CAPTURE_HOOK_PAYLOADS=1 claude` to capture raw hook payloads to `~/.idisu/debug/`.
