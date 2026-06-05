# Session Vault Design

Date: 2026-06-05
Status: Approved for implementation planning
Scope: OpenCode setup under `opencode/`

## Goal

Add an OpenCode-native global session vault interaction. The feature should let the user browse, search, inspect, export, archive, restore, delete, and continue global OpenCode sessions from inside an OpenCode session.

This replaces the desire to control the existing shell-oriented `opencode-all` workflow from within the user's OpenCode setup. The feature is not a shell TUI wrapper. It is a chat-native command with a persistent vault index and automatic session-close sync.

## Non-Goals

- Do not replace the existing local `/sessions` command.
- Do not launch the existing `opencode-all` shell TUI from chat.
- Do not merge another session's history into the current session as a fake switch.
- Do not hard-delete session data without explicit confirmation.
- Do not scan the full OpenCode database on every command open.

## Command Name And Scope

The command name is `/session-vault`.

The existing `/sessions` command remains responsible for local workspace sessions. `/session-vault` handles global sessions across workspaces.

The command opens an interactive menu rather than requiring subcommands. The menu should show all indexed global sessions and provide search/filter behavior similar to `/sessions`.

## User Experience

Running `/session-vault` opens a chat-native global session browser. It shows sessions across projects in a compact list with recent sessions first.

Each row should show:

- session ID or short ID
- title or generated label
- workspace/source path
- last updated time
- status: active, archived, deleted, or broken
- optional message count or summary when cached

The user can search/filter the list, select a session, and then choose an action:

- inspect
- export
- archive
- restore
- continue
- delete
- refresh

Non-destructive actions run directly. Destructive actions ask for explicit confirmation.

Destructive actions include:

- delete
- overwrite archive
- hard cleanup
- any irreversible mutation

Export, archive, restore, inspect, list, search, and refresh are allowed without extra confirmation.

## Preferred Continue Behavior

`continue` should attempt to switch or resume the selected global session in-place, matching the spirit of the existing `/sessions` flow.

This is capability-dependent. If OpenCode exposes the same underlying session-switch mechanism used by `/sessions`, `/session-vault continue` should use it.

If direct in-place switching is not exposed, the command must return the safest supported resume/open fallback instead. It must not pretend to switch by importing or copying history into the current session.

## Architecture

The feature has three cooperating parts:

1. `/session-vault` command/controller
2. session-vault helper script
3. session-close plugin/hook

The command/controller is the UI. It renders the interactive menu, asks questions, and enforces destructive confirmation.

The helper script is the single writer for vault files. All index updates, archive status changes, restore bookkeeping, and delete markers go through the helper.

The plugin/hook is automatic persistence. It syncs relevant session metadata when an OpenCode session ends.

## Storage

The default storage directory is:

```text
~/.local/share/opencode/session-vault/
```

The primary fast-read file is:

```text
~/.local/share/opencode/session-vault/index.json
```

The index stores one record per known global session. It points back to the real session store rather than duplicating all content by default.

Example shape:

```json
{
  "version": 1,
  "updated_at": "2026-06-05T00:00:00.000Z",
  "sessions": [
    {
      "id": "ses_...",
      "title": "Fix installer",
      "workspace": "/path/to/project",
      "db_path": "~/.local/share/opencode/opencode.db",
      "created_at": "2026-06-05T00:00:00.000Z",
      "updated_at": "2026-06-05T00:00:00.000Z",
      "message_count": 0,
      "status": "active",
      "archive_path": null,
      "last_synced_at": "2026-06-05T00:00:00.000Z",
      "summary": null
    }
  ]
}
```

The OpenCode database remains the source for live session content. The JSON index is the source for fast listing, filtering, status, archive pointers, and cached metadata.

Archive files live under the same vault directory, for example:

```text
~/.local/share/opencode/session-vault/archives/
```

## Helper Operations

The helper should expose explicit operations:

- `list`: read sessions from `index.json`
- `search`: filter indexed sessions by title, workspace, status, and optionally full text
- `inspect <id>`: show metadata and cached details, with optional DB lookup for selected details
- `refresh`: incrementally sync new or changed sessions from the OpenCode DB
- `sync-session <id>`: update one session's index record from the DB
- `sync-new`: add new DB sessions that are not in the index
- `export <id>`: write session data to the vault and update archive/export metadata
- `archive <id>`: export session data and mark the indexed session archived
- `restore <archive>`: restore or import archived data if supported, then update the index
- `continue <id>`: attempt supported session resume/switch behavior
- `mark-deleted <id>`: mark a session deleted without hard deletion
- `delete <id> --confirmed`: perform confirmed destructive deletion or cleanup

The command/controller must not edit `index.json` directly.

## Automatic Session-Close Sync

OpenCode should update the vault index automatically through a plugin or hook when a session ends.

Session-end cases include:

- normal quit
- exit
- Ctrl-C, if the relevant hook fires

The hook should call the helper with `sync-session <current_session_id>` when the current session ID is available.

If the hook cannot resolve the current session ID, it should perform a bounded incremental sync instead of scanning everything.

The hook is not the UI. It only keeps the vault index current.

## Manual Command Control

`/session-vault` remains the user-facing control surface for listing and mutations.

Manual mutations use the same helper script as the close hook. This creates one mutation path for index and archive data.

The command can also offer `refresh now` when the index appears stale or when a close hook did not run.

## Latency Rules

The command should avoid unnecessary calls and expensive scans.

- Read `index.json` first.
- Do not scan message content unless the user requests full-text search.
- Do not export content until the user chooses export or archive.
- Use incremental sync by session ID and `updated_at`, not full rebuild, whenever possible.
- Cache stable metadata in `index.json`.
- Show a stale-index warning and offer refresh instead of auto-refreshing on every open.
- Avoid LLM summarization unless the user asks for it or a summary is missing and useful.

## Error Handling

If the OpenCode DB is unavailable, the command should show the cached index and mark it stale.

If `index.json` is missing, the command should offer to initialize it from the global OpenCode DB.

If `index.json` is corrupt, the helper should preserve the corrupt file as a timestamped backup and rebuild from the DB after confirmation.

If the close hook missed a session, the command should offer `refresh now`.

If direct session continue is unsupported, the command should return the safest supported resume/open fallback.

If an archive path is missing, the command should mark the record broken and offer re-export.

## Permissions

The command/controller should have tightly scoped permissions.

It should not receive broad unrestricted shell access.

If shell execution is needed, it should be restricted to the session-vault helper script and its allowed operations.

Destructive actions require explicit user confirmation before helper execution.

The helper should avoid direct writes outside the vault directory except where OpenCode's supported restore/import mechanism requires it.

## Installer Requirements

The installer should add session vault as a controlled component.

The umbrella setup profile should include session vault by default because it is core session-management infrastructure. Users must still be able to exclude it explicitly. Installing or updating the component must never overwrite existing vault data.

Installer preflight should detect:

- existing `/session-vault` command file
- existing session-vault plugin/hook
- existing helper script
- existing `~/.local/share/opencode/session-vault/index.json`
- existing archive/export directory

If target files already exist and differ, installer behavior should be explicit: skip, overwrite, backup, or link. Installing or updating the command must not mutate existing vault data.

## Testing Plan

Helper tests should cover:

- index initialization from fixture data
- fast list from `index.json`
- incremental sync of new sessions
- one-session sync updates metadata
- archive/export updates status and archive path
- delete requires a confirmed flag
- corrupt index backup and rebuild behavior
- missing archive path detection

Plugin/hook tests should cover:

- session-close event calls helper with the current session ID
- unknown current session falls back to bounded incremental sync
- hook failure does not break OpenCode shutdown

Command behavior tests should cover:

- menu renders from the index without DB scan
- search/filter uses the index first
- stale index offers refresh
- destructive actions ask for confirmation
- unsupported direct continue returns a fallback instead of faking a switch

Installer tests should cover:

- component preflight detects existing command/plugin/helper/index
- dry-run makes no changes
- umbrella install includes the configured session-vault component
- existing vault data is never overwritten by install

## Open Implementation Decisions

These decisions should be resolved during implementation planning:

- Which OpenCode hook reliably fires on normal quit, exit, and Ctrl-C.
- Whether OpenCode exposes an in-place session switch mechanism to user commands or plugins.
- Whether summaries are generated automatically on close or only on demand.

## Addendum: Agent Fleet And Installer Fixes

This addendum captures the approved setup-wide fixes that should be planned alongside the session vault work. These changes are about fleet correctness, agent discoverability, routing quality, and installer safety.

### Agent Naming Convention

Rename all 38 agent files to this format:

```text
<japanese-persona>--<english-role>.md
```

Rules:

- Use `--` as the separator between persona and role.
- Use ASCII-safe filenames only.
- Normalize non-ASCII names, for example `sojobō` becomes `sojobo`.
- Keep the Japanese/anime persona first and the operational English role second.
- Use the full filename stem in every `@mention` and `permission.task` entry.
- Do not keep compatibility shim agents for old names.
- Update all references everywhere: prompts, frontmatter, manifests, docs, tests, commands, plugins, installer scripts, and routing references.

### Approved Agent Rename Map

Use this mapping as the implementation target:

| Current file | New file stem | Reason |
| --- | --- | --- |
| `tsukumo.md` | `tsukumogami--code-forgemaster` | Tsukumogami are long-used tools awakened into agency; this fits multi-file implementation over existing code. `code-forgemaster` signals coordinated creation/refactoring rather than command execution. |
| `tsuchigumo.md` | `tsuchigumo--research-weaver` | Spider/web imagery fits deep research that connects sources, claims, and evidence into a structured synthesis. |
| `tsukuyomi.md` | `tsukuyomi--spec-oracle` | Moon/illumination imagery fits product specs, acceptance criteria, and hidden requirement discovery. |
| `daikoku.md` | `daikoku--finance-steward` | Daikoku's wealth association fits financial modeling; `steward` keeps the role professional and judgment-focused. |
| `enma.md` | `enma--compliance-judge` | Enma as judge maps cleanly to legal/compliance verdicts, obligations, and risk calls. |
| `fudo.md` | `fudo--security-guardian` | Fudo's immovable protective role fits security audit, threat modeling, and defensive review. |
| `daidarabotchi.md` | `daidarabotchi--infra-shaper` | The landscape-shaping giant is a strong metaphor for infrastructure, deployment, and SRE systems. |
| `yumemi.md` | `yumemi--story-smith` | Dream/story association fits long-form writing where narrative is the deliverable. |
| `mujina.md` | `mujina--brand-shapeshifter` | Shapeshifter identity fits brand positioning, tone adaptation, and messaging strategy. |
| `kitsune.md` | `kitsune--brand-orchestrator` | Kitsune's clever, persuasive persona fits brand coordination and narrative orchestration. |
| `planner.md` | `chizu--implementation-planner` | `chizu` means map; the role turns goals into execution maps. |
| `shiranui.md` | `shiranui--migration-guide` | Guiding fire imagery fits migrations, codemods, and transformation paths. |
| `sojobō.md` | `sojobo--system-strategist` | ASCII-normalized tengu strategist identity fits architecture and system tradeoff decisions. |
| `tanuki.md` | `tanuki--general-trickster` | Tanuki adaptability fits bounded generalist escape-hatch work. |
| `karasutengu.md` | `karasutengu--docs-scout` | Agile crow-tengu imagery fits external docs and library scouting. |
| `karakuri.md` | `karakuri--command-runner` | Mechanical automaton identity fits executing command packets; `command-runner` is more accurate than `code-runner`. |
| `mikoshi.md` | `mikoshi--code-pathfinder` | The role carries users through codebase paths and symbol maps; pathfinder makes read-only navigation clear. |
| `bakeneko.md` | `bakeneko--bug-hunter` | Supernatural cat agility fits root-cause investigation and bug hunting. |
| `makimono.md` | `makimono--docs-scribe` | Scroll identity fits technical writing and documentation structure. |
| `jorogumo.md` | `jorogumo--synthesis-weaver` | Web/weaving imagery fits synthesizing many inputs into one coherent output. |
| `oni.md` | `oni--red-team-reviewer` | Oni as harsh gatekeeper fits adversarial review and finding hard issues. |
| `kotodama.md` | `kotodama--prose-polisher` | Word-spirit identity fits prose refinement, voice, and line editing. |
| `yamabiko.md` | `yamabiko--source-echo` | Mountain echo identity fits retrieving, reflecting, and returning sourced evidence. |
| `kagami.md` | `kagami--truth-mirror` | Mirror identity fits checking claims against evidence and reflecting verdicts. |
| `soroban.md` | `soroban--number-sage` | Abacus identity fits quantitative analysis and evidence matrices. |
| `azukiarai.md` | `azukiarai--data-sifter` | Sifting/washing imagery fits structured extraction from noisy sources. |
| `henge.md` | `henge--format-shifter` | Transformation identity fits format conversion and output reshaping. |
| `tengu.md` | `tengu--visual-artisan` | Skilled elevated figure fits visual design, HTML reports, diagrams, and identity work. |
| `mizuchi.md` | `mizuchi--data-current` | Water-current imagery fits data flow and data architecture. |
| `akashi.md` | `akashi--proof-keeper` | Proof/evidence association fits validation records, GitHub proof, and receipts. |
| `hanko.md` | `hanko--git-seal` | Seal/stamp identity fits commits, PR workflow, and approval artifacts. |
| `amanojaku.md` | `amanojaku--voice-contrarian` | Contrary spirit identity fits challenging generic voice and weak writing choices. |
| `hyakume.md` | `hyakume--ats-watchman` | Many-eyes identity fits ATS/resume scanning and audit. |
| `kataribe.md` | `kataribe--narrative-teller` | Storyteller meaning fits narrative construction and brand/content storytelling. |
| `kodama.md` | `kodama--growth-echo` | Tree-spirit/echo identity fits growth feedback loops and resonance. |
| `kudagitsune.md` | `kudagitsune--fit-diviner` | Divining fox-spirit identity fits fit diagnosis and role matching. |
| `kurabokko.md` | `kurabokko--knowledge-keeper` | Storehouse/house-spirit identity fits memory and knowledge stewardship. |
| `migaki.md` | `migaki--profile-polisher` | `migaki` means polish/refinement; this fits profile and LinkedIn optimization. |

### Description And Parameter Review

Before rewriting agent descriptions, run a dedicated research phase on current OpenCode agent guidance and best practices for descriptions, routing triggers, exclusions, and invocation behavior.

Each description must optimize correct routing. It should prioritize:

- purpose
- when to use the agent
- when not to use the agent
- expected behavior or output contract
- critical rules that affect safe routing

Yokai/anime flavor should not lead the description. It may be omitted entirely, or kept to one short connection line only when it improves understanding.

Use this description shape as a starting point, then adapt per agent:

```yaml
description: >
  <Role Name>: <Primary routing trigger and purpose>.
  Use for: <specific task types and user phrases>.
  Not for: <common misroutes and exclusions>.
  Behavior: <output contract or critical operational rule>.
```

During the planning phase, review every agent file and every configurable parameter against official OpenCode documentation. The review must cover:

- `description`
- `mode`
- `model`
- `temperature`
- `top_p`
- `steps`
- `hidden`
- `permission`
- `disable`
- `color`
- provider-specific options passed through to the model

### Agent Fleet Review Phase

Review all 38 agent files before making content or parameter edits. Review order:

1. specialists
2. shared subagents
3. escape hatches, brand-builder agents, and other agents

For each agent, inspect:

- purpose and routing intent
- description quality
- body instructions
- workflow obligations
- `@...` references
- `permission.task` targets
- allowed skills and tools
- model choice
- temperature, top-p, and step limits
- mode and hidden state
- permission boundaries
- provider-specific options

Cross-check against:

- official OpenCode agents documentation
- official OpenCode permissions documentation
- local `docs/routing-manifest.json`
- local workflow/state/gate documentation
- actual invocation graph across agent prompts and task permissions

The review must look for wider structure issues, not only local field edits:

- specialists invoking other specialists
- task permissions that do not match intended routes
- T1 subagents invoking more than permitted T2 leaves
- agents that should be merged, split, promoted, demoted, hidden, or renamed
- overpowered or underpowered model choices
- overly broad or insufficient permissions
- stale workflow or gate obligations

Structural changes require a review gate. Present findings first, wait for user approval, update the implementation plan with only approved structural changes, then apply approved changes in the same implementation pass.

### Installer UX Addendum

The installer should use a simple install-set model rather than many profiles.

Install sets:

- Core: essential OpenCode fleet setup.
- Full: Core plus Brand Builder.

Interactive flow should phrase this as:

1. install Core
2. optionally include Brand Builder

Brand Builder is optional and defaults to No. The installer should explain what Brand Builder installs before asking.

Install location and install mode are independent choices:

- location: global, project, or custom
- mode: copy or link

CLI automation should expose the same choices, for example:

```text
--core
--with-brand-builder
--scope global|project|custom
--target <path>
--mode copy|link
--include <component[,component...]>
--exclude <component[,component...]>
--dry-run
--on-conflict backup|skip|overwrite|abort
```

Installer transparency is required. Before mutation, show paths and summaries only, not inline file contents or diffs. For each component, show:

- component ID
- short description
- source path or paths
- target path or paths
- install mode
- whether it is required, optional, or selected by dependency

Preflight must classify targets as:

- `missing`: will install
- `same`: already installed, no-op
- `different`: conflict
- `extra`: exists but is not managed by the fleet
- `blocked`: cannot write or unsafe

The installer must show a final apply plan before writing anything. `--dry-run` prints the same plan non-interactively and exits without mutation.

Default conflict policy is `backup` in both interactive and non-interactive flows. On conflict, preserve the existing target under:

```text
<install-root>/kura_backup/<timestamp>/<relative-target-path>
```

Examples:

```text
~/.config/opencode/kura_backup/2026-06-05T120000Z/agents/...
./kura_backup/2026-06-05T120000Z/plugins/...
<custom-root>/kura_backup/2026-06-05T120000Z/...
```

The installer summary must report backup paths. `skip`, `overwrite`, and `abort` remain available explicit choices. The installer must never silently overwrite.

### Validation Rules

After the rename, stale old-name references are hard failures across all surfaces:

- agent prompts
- agent frontmatter
- `permission.task`
- manifests
- docs
- installer scripts
- tests
- command files
- plugin references

All docs must reflect the latest hybrid names. Old names should not remain in docs unless explicitly approved as historical context.

The implementation plan should add validation checks for:

- old file stems that remain in text
- unresolved `@...` references
- `permission.task` entries that do not match agent file stems
- invalid agent modes
- stale manifest or routing references

Any stale reference blocks completion until fixed or explicitly approved as an intentional exception.
