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

> Invoked by the `hanko--git-seal` subagent. For setup, SSH signing, PAT, rulesets, secret-scrubbing, and troubleshooting see `./GITHUB.md`.

---

## Conventions

**Conventional Commits** — every commit message must match:
```
^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(\(.+\))?: .{1,100}$
```

Type frequency (most → least common in this repo): `feat` > `fix` > `chore` > `docs` > `ci` > `refactor`

Multi-level scopes are allowed: `feat(mekiki/judge): ...`, `fix(mekiki/transcript): ...`

**SSH signing** — commits are automatically signed. Never use `--no-gpg-sign`.

**Co-Authored-By trailer** — append to every commit message body:
```
Co-Authored-By: Claude <active-model-id> <noreply@anthropic.com>
```
Replace `<active-model-id>` with the actual model ID (e.g. `claude-haiku-4-5-20251001`).

**Lefthook gates (pre-commit)**:
- `gitleaks` — blocks secrets in staged files
- `validate-json` / `validate-yaml` — blocks malformed JSON/YAML
- `pytest` — runs on `claude-code/**` changes
- `conventional` — rejects non-Conventional-Commits messages

**Never** `--no-verify` or `--force`. False-positive gitleaks escape: `LEFTHOOK_EXCLUDE=gitleaks git commit -m "..."`.

---

## Approval Rule

- **Read-only ops** (`git status`, `git diff`, `git log`, `gh pr view`, `gh pr list`, `gh pr checks`): run freely, no approval needed.
- **Mutating ops** (`git commit`, `git push`, `gh pr create`, `gh pr merge`): surface the exact command and get explicit user approval before running.

---

## Recipe 1 — Commit → Push to `dev`

```bash
# 1. Inspect
git status
git diff --stat

# 2. Stage named files (never git add -A blindly)
git add <file1> <file2> ...

# 3. Validate message matches Conventional Commits regex above
# 4. ASK: "Ready to commit with message: '<message>'. Approve?"
git commit -m "$(cat <<'EOF'
type(scope): description

Co-Authored-By: Claude <model-id> <noreply@anthropic.com>
EOF
)"

# 5. Verify signature
git log --oneline -1 --show-signature

# 6. ASK: "Ready to push to dev. Approve?"
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
# 1. Commit all changes (Recipe 1, but push to feat/<name> not dev)
git push origin feat/<name>

# 2. ASK: "Ready to create PR from feat/<name> to dev. Approve?"
gh pr create --base dev \
  --title "type(scope): description" \
  --body "$(cat <<'EOF'
## Summary
- bullet points of what changed

## Test plan
- [ ] what was tested
EOF
)"

# 3. Watch CI
gh pr checks --watch

# 4. ASK: "Ready to squash-merge PR #<n>. Approve?"
gh pr merge --squash <pr-number>
```

---

## Recipe 4 — dev → master PR (human merges only)

```bash
# Create the PR — agent stops here
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
# merge commit is allowed on dev
git push origin dev
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

## Footer

For setup (SSH signing key, fine-grained PAT), rulesets, secret-scrubbing, and troubleshooting — read `./GITHUB.md`.
