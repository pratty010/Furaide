# common/

Shared layer for the F.R.I.D.A.Y. monorepo. Single source of truth for everything that crosses ecosystem boundaries (opencode, claude-code, pi-agent).

## Structure

```
common/
  agents/                    # Runtime-agnostic agent cores (A+B architecture)
  docs/                      # Shared reference documentation
  scripts/                   # Shared scripts (github-setup-check)
  skills/                    # Vendored lightweight skills
  install-common.sh          # Copy common/skills → chosen scope
  install-skills.sh          # Clone-install heavier/3rd-party skills from manifest
  skills-manifest.json       # Catalog of all skills, ecosystem-tagged
```

---

## agents/ — A+B architecture

`common/agents/<name>/core.md` holds the **runtime-agnostic body** for each agent that is used across ecosystems. The body contains XML sections only — no frontmatter, no runtime-specific tool names.

Each ecosystem's agent file wraps the core:
- **opencode** → `opencode/agents/<name>.md` = YAML frontmatter (mode/model/permissions) + `prompt: "{file:../common/agents/<name>/core.md}"` (native `{file:}` injection — no build step)
- **claude-code** → body is copied in via `common/sync-agents.sh` (only if/when claude-code grows agents; not needed in the current plan)
- **pi-agent** → same copy pattern as claude-code if needed

Current cores:

| Agent | Role |
|-------|------|
| `researcher/` | Multi-source research with citation quality tagging |
| `planner/` | Executor-ready implementation plans |
| `strategist/` | Architecture decisions (ADRs + options tables) + implementation plans |
| `shiranui/` | Migration orchestrator — dependency upgrades, codemods, rollback plans |

See `docs/agent-template.md` for the XML body authoring standard and per-runtime injection rules.

---

## docs/ — Shared reference

| File | Purpose |
|------|---------|
| `GITHUB.md` | Git + GitHub workflow guide (replaces diverged copies in claude-code/config/ and opencode/docs/) |
| `agent-template.md` | XML body format standard + per-runtime frontmatter schemas |
| `models/openai.md` | GPT-5.x-codex prompting specifics |
| `models/gemini.md` | Gemini temperature=1.0 rules |

---

## scripts/ — Shared scripts

| Script | Purpose |
|--------|---------|
| `github-setup-check.sh` | Verify SSH signing, GitHub key registration, lefthook, gitleaks |

---

## skills/ — Vendored lightweight skills

Installed by `install-common.sh`. These are self-contained (no external deps beyond what's documented in the SKILL.md):

| Skill | Deps |
|-------|------|
| `bx/` | `bx` binary on PATH |
| `html-preview/` | none (uses python3 -m http.server) |
| `brave-search/` | Python 3, `BRAVE_API_KEY` env var |
| `plan/` | none |

---

## install-common.sh

Copies `common/skills/*` to a user-chosen scope:

```bash
bash common/install-common.sh --global              # → ~/.agents/skills/ + ~/.claude/skills/
bash common/install-common.sh --project <dir>       # → <dir>/skills/
bash common/install-common.sh --custom <path>       # → <path>/skills/
```

Copy mode (not symlink) — users own the installed copy. Re-run to update.

Called by both `claude-code/scripts/bootstrap.sh` and `opencode/scripts/install-fleet.sh`.

---

## install-skills.sh + skills-manifest.json

For heavier / third-party skills that are clone-installed rather than vendored:

```bash
bash common/install-skills.sh                       # interactive
bash common/install-skills.sh --all                 # install all without prompts
bash common/install-skills.sh --ecosystem claude-code  # only claude-code-tagged sets
bash common/install-skills.sh --ecosystem opencode     # only opencode-tagged sets
bash common/install-skills.sh --list                # show available sets, then exit
```

`skills-manifest.json` is the catalog. Each skill set has an `ecosystem` tag so installers pull only what they need.
