# Furaidē: Claude Code Config Bundle

Furaidē's global Claude Code configuration, safe to copy into `~/.claude/`. Each file is independent; install all or only the parts you want.

Prerequisites: none beyond claude-code itself.

---

## Install

### Default: install everything

```bash
cp config/CLAUDE.md ~/.claude/CLAUDE.md
cp config/statusline-command.sh ~/.claude/statusline-command.sh
```

---

### Selective install: per component

<details>
<summary><strong>CLAUDE.md</strong>: working guide and Furaidē persona</summary>

The core behavior contract: intent triage rules, delegation thresholds, model selection, workflow decision table, and the Furaidē persona preamble. This is the most impactful file to install.

```bash
# Replace:
cp config/CLAUDE.md ~/.claude/CLAUDE.md

# Or append to an existing CLAUDE.md:
cat config/CLAUDE.md >> ~/.claude/CLAUDE.md
```

</details>

<details>
<summary><strong>keybindings.json</strong>: custom keyboard shortcuts</summary>

Adds shortcuts for transcript toggle, model picker, thinking toggle, stash, and history search.

```bash
cp config/keybindings.json ~/.claude/keybindings.json
```

> [!WARNING]
> This replaces your existing keybindings entirely. Review the file before applying if you have custom bindings.

</details>

<details>
<summary><strong>statusline-command.sh</strong>: custom status line (v2)</summary>

Two-line, width-adaptive status line. Requires `jq` and `python3`; re-runs on
new assistant messages, `/compact`, permission/vim mode changes, and the
`refreshInterval` timer (terminal resize alone does not trigger a re-run).

```
Line 1: 🧠 model │ effort │ 🕐 dur (📡api%)   ↑inΣ⚡r%/↓outΣ⚡w% [⑂in%/out%] │ CTX: [bar] cur/win/+turn
Line 2: 📁 cwd (branch) │ +add/-rem          5hr: % (reset) │ 1wk: % (reset) │ $:cost
```

```bash
cp config/statusline-command.sh ~/.claude/statusline-command.sh
```

Then add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline-command.sh"
  }
}
```

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
  running `in_total`/`out_total`/`cache_read_total`/`cache_creation_total`,
  and extracts completed subagent totals from task-notification records
  (each `task_id` counted once, via its own transcript `.output` file when
  still present, falling back to that record's inline lump-sum token count
  otherwise). This avoids re-scanning the whole transcript every render.

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
- Each rate-limit window and the `[⑂in%/out%]` subagent-share segment are
  independently omitted when their underlying payload data is absent (no
  `⚠`/WARN glyph — that path was removed; ramp color alone signals severity).

</details>

<details>
<summary><strong>settings.json</strong>: Claude Code settings</summary>

Contains: model (`opusplan`), effort level (`high`), theme (`dark-ansi`), editor mode (`normal`), auto-compact, statusline, Codex plugin config.

> [!CAUTION]
> `skipDangerousModePermissionPrompt` and `skipAutoPermissionPrompt` are both `true`. Review before applying if you prefer explicit permission prompts.

**Merge approach**: copy only the keys you want rather than wholesale replacing your settings:

```bash
# View what's in the bundle:
cat config/settings.json

# Then manually add the keys you want to ~/.claude/settings.json
```

The `hooks` block is intentionally absent. The Īdisu plugin ships its own `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}`. No hook wiring is needed.

</details>

---

## Notes

- **Skills** (the symlinks in `~/.claude/skills/`) are not bundled here. Install them from their source repos.
- **Hooks** are handled by the Īdisu plugin (capability analytics shikigami). Install via `bootstrap.sh` or `claude plugin install`. Hooks wire automatically. The plugin hooks write events to `~/.idisu/` (or `$IDISU_HOME`).
- The `CLAUDE.md` in this bundle is Furaidē's full working guide including the persona preamble. The version at `~/.claude/CLAUDE.md` on your machine is the live copy Claude Code reads each session.
- **CLI commands** (Īdisu shikigami): `dream`, `profile`, `backlog`, `report`, `improve <id>`, `mark <id>`, `reset`. Access via `/idisu <command>` in Claude Code or `bun run <cli-path> <command>` from the shell.
- **Smoke testing hooks**: run `IDISU_CAPTURE_HOOK_PAYLOADS=1 claude` to capture raw hook payloads to `~/.idisu/debug/`.
