<memory_contract>
# Auto-Memory Contract

<section name="memory_root">
## Memory root

```
~/.local/share/opencode/memory/<cwd-slug>/
├── MEMORY.md        # index — one entry per line, ≤150 chars
└── <topic>.md       # per-memory files with YAML frontmatter
```
</section>

<section name="cwd_slug">
## `<cwd-slug>` derivation

Replace every `/` in the absolute cwd with `-`, then prefix with `-`.

```bash
echo "-$(pwd | tr '/' '-')"
# /home/ace/.config/opencode → -home-ace--config-opencode
# /home/ace/projects/foo     → -home-ace-projects-foo
```
</section>

<section name="directory_creation">
## Directory creation

`mkdir -p` on first write. Do not pre-check existence.

```bash
mkdir -p ~/.local/share/opencode/memory/<cwd-slug>
```
</section>

<section name="memory_types">
## Memory types

| Type | When to create | Example |
|---|---|---|
| `user` | Stated preference about tools, style, workflow | "prefer bun over npm" |
| `feedback` | Correction or pushback on prior output | "don't use default exports" |
| `project` | Architectural decision, convention, non-obvious constraint | "API auth via Bearer, not cookie" |
| `reference` | Looked-up facts that will be needed again (versions, IDs, URLs) | "Zod v3 schema docs URL" |
</section>

<section name="frontmatter_format">
## Frontmatter format

Each per-topic file opens with:

```yaml
---
name: <short label>
description: <one sentence — what this memory enables>
metadata:
  type: user | feedback | project | reference
  created: <ISO date>
  cwd: <absolute path>
---
```
</section>

<section name="index_discipline">
## MEMORY.md index discipline

- One line per entry: `[[slug]] — <description ≤100 chars>`
- Never exceed 150 chars per line (truncate description).
- Entries after line 200 are dropped on next write; archive old entries to a separate file if needed.
- Keep index sorted by recency (newest first).
</section>

<section name="when_to_read">
## When to read

- Before any project-specific recommendation.
- Whenever the user references "earlier", "last time", "as discussed", "you said", or similar.
- At session start: scan MEMORY.md index; load individual files only when their description matches the current task.
</section>

<section name="when_to_write">
## When to write

- When the user explicitly asks you to remember something.
- When the user corrects a prior output (type: feedback).
- When you discover a non-obvious project convention that will recur (type: project).
- When you look up a version/URL/ID that took >1 tool call to find (type: reference).
</section>

<section name="never_save">
## Never save

- Derivable codebase info (file contents, function signatures, directory structure).
- Ephemeral state (current task details, session context that won't recur).
- Information the user can trivially re-state in one line.
- Anything that belongs in source control, not personal memory.
</section>

<section name="before_recommending">
## Before-recommending verification

Before recommending a pattern or convention found in memory, verify it still applies:
- For `project` type: confirm the relevant file/config still matches the memory.
- For `reference` type: note the `created` date; re-verify if >30 days old.
- For `user`/`feedback` type: apply as-is unless the user has since stated the opposite.
</section>

<section name="round_trip">
## Multi-session round-trip

1. Save: write topic file + update MEMORY.md index in the same session.
2. Load: new session in same cwd → read MEMORY.md → load relevant topic files → proceed.
3. If MEMORY.md is missing: treat as fresh project; do not error.
</section>
</memory_contract>
