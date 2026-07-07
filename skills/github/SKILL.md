---
name: github
description: "GitHub/git workflow recipes — the F.R.I.D.A.Y. conventions and the user's everyday commit/push/PR flows"
trigger:
  - commit
  - push
  - branch
  - PR
  - CI
  - gh
  - merge
trigger_negative:
  - code review → use Skill(code-review)
  - git concepts or how-to questions → answer directly without this skill
---

# GitHub Skill — F.R.I.D.A.Y. Git Workflows

> Invoked by the `hanko--git-seal` subagent. For setup, SSH signing, PAT, rulesets, and troubleshooting see `./GITHUB.md`. For signing/PAT setup specifically see `./SECURITY.md`.

---

## Conventions

**Conventional Commits** — every commit message must match:
```
^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(\(.+\))?: .{1,100}$
```

Type frequency (most → least common in this repo): `feat` > `fix` > `chore` > `docs` > `ci` > `refactor`

Multi-level scopes are allowed: `feat(idisu/judge): ...`, `fix(idisu/mine): ...`

**SSH signing** — commits are automatically signed. Never use `--no-gpg-sign`.

**`Assisted-by:` trailer** — append to every agent-made commit message body (not `Co-Authored-By:` — that trailer legally implies copyright standing an LLM can't hold; `Assisted-by:` keeps the human as author/committer). Format:
```
Assisted-by: <agent/model identity> <noreply@...>
```
Examples: `Assisted-by: OpenCode openai/gpt-5.5 <noreply@agents.local>`, `Assisted-by: Claude Code claude-haiku-4-5-20251001 <noreply@anthropic.com>`. Use the current harness/model when known; otherwise use the invoking harness name and best available model identifier.

**Lefthook gates (pre-commit)**:
- `gitleaks` — blocks secrets in staged files
- `validate-json` / `validate-yaml` — blocks malformed JSON/YAML
- `conventional` (commit-msg) — rejects non-Conventional-Commits messages

Full hook inventory (including pre-push and CI security jobs) is in `SECURITY.md`, not repeated here.

**Never** `--no-verify` or `--force`. False-positive gitleaks escape: `LEFTHOOK_EXCLUDE=gitleaks git commit -m "..."`.

---

## Approval Rule

- **Read-only ops** (`git status`, `git diff`, `git log`, `gh pr view`, `gh pr list`, `gh pr checks`): run freely, no approval needed.
- **Commits**: run autonomously — local and reversible, not yet shared state. Still run `git status`/`git diff --stat` first, still validate the Conventional Commits format, still verify the SSH signature after.
- **Requires two-hop approval** (subagents can't call `AskUserQuestion` directly — see `hanko--git-seal.md`'s approval protocol): `git push` to origin (any branch), `gh pr create`, `gh pr merge`, worktree merge-backs (Recipe 7).
- **Always forbidden, never merely "ask"**: push to master, `--force`, `--no-verify`, `git add -A`/`git add .`.

---

## Commit Body Template

```
type(scope): description

Why: <1-3 sentences — the problem/prior behavior this fixes, or the
requirement driving it. Not what the diff shows — why it was needed.>

<optional bullets, only if multiple distinct changes/reasons>

Refs: #123                              (only if an issue/PR exists)
Assisted-by: <agent/model identity> <noreply@...>
```

## PR Body Template

Generate the Summary from `git merge-base <target> HEAD` → `git log <base>..HEAD --format=%s --no-merges`, grouped by Conventional Commit type — not hand-narrated from memory.

```markdown
## Summary
1-3 bullets: what changed, at a glance.

## Why / Context
(Omit if the title/summary already makes it obvious.)

## Approach
Key design decisions and rejected alternatives. (Omit if no real fork in approach.)

## Testing
Commands run / cases covered.

## Breaking changes
(Omit if none — don't write "None" as boilerplate.)

## Review focus
(Omit unless something is genuinely risky/uncertain.)

Closes #123                             (only if applicable)
```

Both templates are conditional-section, not fixed-checklist — omit sections that don't apply rather than filling boilerplate. Sections exist so a future dream-pass or agent session can reconstruct context from `git log`/PR history without re-reading full diffs.

---

## Recipe 1 — Commit → Push to `dev`

```bash
# 1. Inspect
git status
git diff --stat

# 2. Stage named files (never git add -A blindly)
git add <file1> <file2> ...

# 3. Validate message matches Conventional Commits regex above, commit autonomously (no approval needed)
git commit -m "$(cat <<'EOF'
type(scope): description

Why: <reason>

Assisted-by: <agent/model identity> <noreply@...>
EOF
)"

# 4. Verify signature
git log --oneline -1 --show-signature

# 5. Push requires approval — return "NEEDS APPROVAL: git push origin dev — ..." and wait for re-dispatch
git push origin dev
```

---

## Recipe 2 — Start a Feature Branch

```bash
git checkout dev
git pull origin dev
git checkout -b feat/<name>
```

Branch naming: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`. Never branch off master.

---

## Recipe 3 — Finish Feature → PR into `dev`

```bash
# 1. Commit all changes (Recipe 1, autonomous)

# 2. Push requires approval — return "NEEDS APPROVAL: git push origin feat/<name> — ..."
git push origin feat/<name>

# 3. PR creation requires approval — return "NEEDS APPROVAL: gh pr create --base dev ... — ..."
gh pr create --base dev \
  --title "type(scope): description" \
  --body "$(cat <<'EOF'
## Summary
- ...

## Testing
- ...
EOF
)"

# 4. Watch CI (read-only, no approval needed)
gh pr checks --watch

# 5. Merge requires approval — return "NEEDS APPROVAL: gh pr merge --squash <pr-number> — ..."
gh pr merge --squash <pr-number>
```

---

## Recipe 4 — dev → master PR (human merges only)

```bash
# PR creation still requires approval even though only humans can merge it
# Return "NEEDS APPROVAL: gh pr create --base master ... — ..."
gh pr create --base master \
  --title "chore: merge dev into master" \
  --body "Regular dev→master sync."

# Report the PR URL. NEVER run gh pr merge for master.
# Human merges via GitHub web UI (branch ruleset blocks CLI merge).
```

---

## Recipe 5 — Back-Merge Conflict (`sync: back-merge master into dev`)

When the auto back-merge workflow opens a conflict PR:
```bash
git checkout dev
git merge origin/master   # resolve conflicts toward dev (the newer side)
# merge commit is allowed on dev, commit autonomously
git push origin dev       # requires approval — return "NEEDS APPROVAL: ..."
```

---

## Recipe 6 — Status / CI Checks (no approval needed)

```bash
gh pr list
gh pr view [<number>]
gh pr checks [<number>] --watch
git log --oneline -5 --show-signature
git status
```

---

## Recipe 7 — Worktree Merge-Back

Covers `isolation: "worktree"` subagent work landing back into the main line. Two paths:

**(a) From inside the worktree** — push the worktree's branch, then open/merge a PR via Recipe 3 (same feature-branch flow, just run from the worktree's checkout).

**(b) From the main repo** — merge the worktree branch directly:
```bash
git checkout <target-branch>   # e.g. dev
git merge <worktree-branch>    # or: git rebase <worktree-branch> if a linear history is wanted
# resolve conflicts if any — prefer the newer/worktree side unless it regresses target-branch-only work
git push origin <target-branch>   # requires approval — return "NEEDS APPROVAL: ..."
```

**Cleanup, after either path merges successfully:**
```bash
git worktree remove <path>
git branch -d <worktree-branch>
```

Conflict guidance (generalizes Recipe 5's rule beyond the automated back-merge PR): prefer the newer/target side for divergent doc or config content; prefer neither blindly for code — read both hunks and merge intent, don't just pick a side. A plain `git push` rejected by remote divergence, or a manual `git merge`/`git rebase` conflict on a feature branch, follows this same resolve-then-push shape.

---

## Footer

For setup (SSH signing key, fine-grained PAT), rulesets, and troubleshooting — read `./GITHUB.md`. For signing/PAT setup specifically — read `./SECURITY.md`.
