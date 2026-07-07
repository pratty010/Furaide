# GitHub Workflow Guide

> *Shared reference for Claude Code agents (via `hanko--git-seal` subagent + `github` skill), OpenCode agents (via @hanko subagent), and the F.R.I.D.A.Y. developer.*
>
> For conventions, the approval rule, commit/PR templates, and the 7 workflow recipes, see `./SKILL.md` — the canonical source, not repeated here. For SSH signing/PAT setup and the full security inventory, see `./SECURITY.md`.

---

## Branch Strategy

| Branch | Purpose | Merge Path | Merge Strategy |
|--------|---------|-----------|---|
| `master` | Stable, user-facing, always deployable | PR from dev only — web UI only | Squash or rebase |
| `dev` | Integration — work-in-progress, testing | Direct push or PR from feat/fix/chore | Squash |
| `feat/<name>` | New feature | PR into dev | Squash |
| `fix/<name>` | Bug fix | PR into dev | Squash |
| `chore/<name>` | Maintenance, deps, config | PR into dev | Squash |
| `docs/<name>` | Docs-only changes | PR into dev | Squash |

**Golden rule: master receives changes only via PR. No agent can merge to master directly. Web UI only.**

### Keeping dev in sync with master (automated)

master requires linear history, so dev→master PRs are **squashed**. A squash creates a commit on master with no parent link back to dev, so the two branches drift apart on identical content and the next dev→master PR conflicts across every file the squash touched. That is the recurring "this branch has conflicts" problem.

`.github/workflows/back-merge.yml` heals it automatically. On every push to master it merges master back into dev:

- **Clean merge:** it pushes the back-merge to dev directly, so the next dev→master PR diffs only genuinely new work.
- **Conflicts:** it opens a `sync: back-merge master into dev` PR for manual resolution. Resolve toward dev (the newer side) and merge it with a **merge commit**. dev allows merge commits; only master forbids them.

You normally don't touch this. To reconcile a divergence by hand: `git checkout dev && git merge origin/master`, resolve toward dev, then push. For a worktree branch merging back (not master↔dev), see `SKILL.md` Recipe 7.

---

## Agent Delegation

### Claude Code (github skill + hanko--git-seal agent)

Route any git or GitHub operation to the `hanko--git-seal` subagent — the main orchestrator delegates all git/GitHub work there automatically. It invokes `Skill(github)` for the 7 workflow recipes and the two-hop approval rule (commits autonomous; push/PR-create/PR-merge/worktree-merge-back require the subagent to return `NEEDS APPROVAL: ...` to the parent, since subagents can't call `AskUserQuestion` directly). Full constraints in `hanko--git-seal.md`'s own frontmatter/contract — not restated here.

### OpenCode (@hanko subagent)

Dispatch to `@hanko` when a specialist needs git operations:

```
Dispatch to @hanko with task: "git commit the changes to dev"
```

**@hanko's constraints:**
- `bash: allow` — can run git and gh commands
- `question: ask` — always asks before push, PR creation, or merge (OpenCode's `@hanko` retains direct-ask behavior; it isn't a Claude Code subagent, so the two-hop constraint above is Claude-Code-specific)
- `task: { "*": deny }` — cannot dispatch to other subagents
- Never pushes to `master` (blocked by branch ruleset anyway)

**Specialist → @hanko pattern:** the specialist does the work (design, write, refactor), then at completion dispatches to @hanko for stage + commit + push + PR. @hanko asks approval at each critical step. Human merges via GitHub web UI (ruleset blocks CLI merge). **Never commit directly from a specialist** — always delegate to @hanko.

### Workflow State Is Separate

GitHub operations are orthogonal to `workflow-state.mjs`: that tracks agent task progression and decision points, while git commits/PRs are how changes reach the repository. Agents don't call `workflow-state.mjs` for GitHub tasks.

---

## What Lefthook Checks (summary — full inventory + pre-push jobs + CI security jobs in `SECURITY.md`)

| Check | Scope | Fails if |
|-------|-------|----------|
| `gitleaks` | All staged files | A secret pattern is detected |
| `validate-json` | `*.json` files | JSON is malformed |
| `validate-yaml` | `*.yml` / `*.yaml` files | YAML is malformed |
| `conventional` | Commit message | Doesn't match Conventional Commits pattern |

Pre-push (`shellcheck`, `semgrep-diff`, `trivy-quick`) and CI security jobs (`trivy-full`, `semgrep-full`, `snyk-master-gate`) are documented in full in `SECURITY.md`, not repeated here.

**Reinstall hooks:**
```bash
bunx lefthook install
lefthook run pre-commit   # verify
```

---

## CI Gates: What Runs on a PR to Master

`test-claude-code`, gated on changes to `harnesses/claude-code/**` or `.github/**`/`lefthook.yml`:
```bash
cd harnesses/claude-code/cli/src/idisu && bun install && bun test && bun run typecheck
cd harnesses/claude-code/plugins/rejion && bun install && bun test
```

`security.yml` runs separately (PR-to-master + daily cron) — see `SECURITY.md` for its 3 jobs.

---

## Troubleshooting

### "Merging is blocked — Commits must have verified signatures"

Two independent causes — check both:

1. **Signing key not registered on GitHub.** Local signing produces the `gpgsig` header, but GitHub only shows "Verified" once your public key is registered as a **Signing Key** (Settings → SSH and GPG keys → Key type: **Signing Key**, not Authentication Key).

2. **Setup script wrongly reports "not registered".** Your `gh` token lacks the `admin:ssh_signing_key` scope. Fix:
   ```bash
   gh auth refresh -h github.com -s admin:ssh_signing_key
   bash packages/cli/src/shared/github-setup-check.sh --force
   ```
   A fresh `gh auth login` does NOT grant this scope — most new users hit this.

### Setup check fails on a key with trailing whitespace

`~/.ssh/id_ed25519.pub` files frequently carry a trailing space or newline. The script trims with `| xargs` before comparing — if you fork the script, keep that trim.

### "Cannot force-push to this branch" on dev

The `dev` ruleset blocks force pushes. Rebase instead:
```bash
git fetch origin dev && git rebase origin/dev && git push origin dev
```

### "This branch must not contain merge commits" when targeting master

Master requires linear history. Don't `git merge master` into your branch. Rebase instead:
```bash
git checkout dev && git rebase origin/master
```

### gitleaks blocks a legitimate file (false positive)

```bash
LEFTHOOK_EXCLUDE=gitleaks git commit -m "chore: add test fixtures"
```

### bun tests fail in pre-commit but `harnesses/opencode/` has no test runner

`harnesses/opencode/` is agent definitions — there is no bun-test job in `lefthook.yml`'s pre-commit stage for it; only `test-claude-code`'s CI job runs `bun test`, and only for `harnesses/claude-code/`. If you see a pre-commit bun-test job, it was added in error.

### Worktree branch push rejected by remote divergence, or a manual merge/rebase conflict on a feature branch

Not previously documented — see `SKILL.md` Recipe 7 (Worktree Merge-Back) for the resolve-then-push shape and conflict-preference guidance. Same underlying pattern as the automated back-merge conflict above, generalized to any two-branch divergence, not just master↔dev.

---

## Quick Reference

Common commands are in `SKILL.md`'s recipes (not duplicated here). For status/CI checks specifically:
```bash
gh pr list
gh pr view [<number>]
gh pr checks [<number>] --watch
git log --oneline -5 --show-signature
git status
```

---

## Reference

- **Branch protection standard:** `github-branch-protection.md` in project memory
- **Setup checks / security inventory:** `./SECURITY.md`
- **Conventions, approval rule, recipes:** `./SKILL.md`
- **Claude Code git agent:** `hanko--git-seal` subagent + `github` skill (`harnesses/claude-code/config/agents/`, `skills/github/`)
- **OpenCode git agent:** `@hanko` subagent (`harnesses/opencode/agents/hanko.md`)
