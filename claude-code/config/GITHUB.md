# GitHub Workflow Guide

> *A reference for Claude Code agents working with F.R.I.D.A.Y.'s git and GitHub operations.*

---

## Branch Strategy

| Branch | Purpose | Merge Path | Merge Strategy |
|--------|---------|-----------|---|
| `master` | Stable, user-facing, always deployable | PR from dev only | Squash or rebase |
| `dev` | Integration — work-in-progress, testing | Direct push or PR from feat/fix/chore | Squash |
| `feat/<name>` | New feature | PR into dev | Squash |
| `fix/<name>` | Bug fix | PR into dev | Squash |
| `chore/<name>` | Maintenance, deps, config | PR into dev | Squash |
| `docs/<name>` | Docs-only changes | PR into dev | Squash |

**Golden rule: master receives changes only via PR. Never push directly to master.**

---

## Commit Message Format

All commits must follow Conventional Commits format:

```
type(scope): description
```

**Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `style`, `revert`

**Examples:**
```
feat(opencode): add mujina brand-strategy specialist
fix(cli): resolve null pointer in pytest runner
chore(deps): update claude-code dependencies
docs: update README installation instructions
ci: add GitHub Actions workflows
```

Lefthook (pre-commit hook) validates this automatically. If your commit message doesn't match, the commit is rejected with the pattern shown.

---

## Workflow: Local Development to Master Merge

### 1. Create a feature branch

```bash
git checkout dev
git pull origin dev
git checkout -b feat/your-feature-name
```

### 2. Make changes, test locally

```bash
bun test  # if in opencode/
uv run pytest  # if in claude-code/cli/
```

### 3. Commit with conventional message

```bash
git add .
git commit -m "feat(opencode): describe your change"
```

Lefthook fires:
- gitleaks: scans for secrets (fails if found)
- JSON/YAML validation
- bun test / pytest (depending on what changed)
- Conventional commit check (fails if format is wrong)

If any hook fails, fix the issue and try again. Don't skip hooks with `--no-verify` in a shared repo.

### 4. Push to dev-based branch

```bash
git push origin feat/your-feature-name
```

### 5. Create a PR

```bash
gh pr create --title "feat: describe the change" --body "Summary of what changed and why"
```

The PR template auto-fills with sections: What / Why / Type / Checklist / Screenshots.

GitHub Actions runs:
- `test-opencode` (if opencode/ changed)
- `test-claude-code` (if claude-code/ changed)
- Labeling workflow (auto-applies labels based on changed files)

### 6. Wait for CI to pass

```bash
gh pr checks --watch
```

Once all checks pass, the PR is mergeable.

### 7. Merge to master (web UI only)

```bash
# THIS WILL FAIL (blocked by ruleset):
gh pr merge --squash

# Correct way: Use GitHub web UI
# → Go to PR → Click "Squash and merge" → Confirm
```

The ruleset on `master` blocks CLI merges entirely — only the GitHub web browser UI can merge. This ensures you (a human) are always reviewing and consciously approving changes to master.

---

## What Lefthook Checks

When you commit, lefthook runs these checks in parallel:

| Check | Scope | Fails if |
|-------|-------|----------|
| `gitleaks` | All staged files | A secret pattern is detected (e.g., API key, private key, password) |
| `validate-json` | `*.json` files | JSON is malformed |
| `validate-yaml` | `*.yml` / `*.yaml` files | YAML is malformed |
| `bun test` | opencode/** changes | Tests fail with `--bail` (stops on first failure) |
| `pytest` | claude-code/** changes | Tests fail (returns non-zero) |
| `conventional` | Commit message | Message doesn't match Conventional Commits pattern |

### Skipping a check for a false positive

If gitleaks incorrectly flags a file (e.g., a test fixture that looks like a secret but isn't):

```bash
LEFTHOOK_EXCLUDE=gitleaks git commit -m "chore: add test fixtures"
```

This skips gitleaks for just this commit. Don't use `--no-verify` to bypass all hooks.

---

## Pre-commit Hooks Setup

If hooks aren't running on commit:

```bash
bunx lefthook install
```

Verify:

```bash
lefthook run pre-commit
```

If you see "no hooks installed", re-run `bunx lefthook install`.

---

## CI Gates: What Runs on a PR to Master

When you create a PR targeting master, GitHub Actions runs:

1. **`test-opencode`** — if opencode/ or `.github/` changed
   - Runs `bun install --frozen-lockfile`
   - Runs `bun test scripts/tests/`
   - Caches `~/.bun/install/cache` for speed

2. **`test-claude-code`** — if claude-code/ or `.github/` changed
   - Runs `uv sync --frozen`
   - Runs `uv run pytest -x -q --tb=short`
   - Uses astral-sh/setup-uv with built-in caching

3. **`security-scan`** — always on PRs to master
   - `gitleaks/gitleaks-action`: full history scan for leaked secrets
   - `actions/dependency-review-action`: checks for vulnerable dependencies (fails if severity >= moderate)

4. **Auto-labeling** — applies labels based on changed files
   - `opencode` label if opencode/ changed
   - `claude-code` label if claude-code/ changed
   - `ci` label if .github/ or lefthook.yml changed
   - `docs` label if any .md changed
   - `dependencies` label if any lockfile changed

If any check fails, the PR shows red ✗. Click "Details" to see the failure output.

### Debugging CI failures

**`test-opencode` fails:**
```bash
cd opencode && bun install --frozen-lockfile && bun test scripts/tests/
```

**`test-claude-code` fails:**
```bash
cd claude-code/cli && uv sync --frozen && uv run pytest -x -q --tb=short
```

**`security-scan` fails:**
- If gitleaks: check the failure message; if it's a false positive, add to `.gitleaksignore` (not yet created; skip for now)
- If dependency review: run `pip list` or `bun pm list` to check for known vulnerable versions

---

## Delegating GitHub Tasks to Agents

For most git/PR operations, use the `/github` skill to spawn a Haiku subagent:

```
/github create a PR for my feature branch with the standard template
```

The Haiku subagent:
- Reads this guide (`claude-code/config/GITHUB.md`)
- Validates conventional commit format
- Uses `gh` CLI to create commits, push, open PRs
- **Asks you before every push or PR operation** (human-in-the-loop for critical ops)
- Never pushes to `master`

The subagent has `bash: allow` and `question: ask`, so it can run git/gh commands but must get your approval first.

---

## Security Rules (Never Break These)

1. **No secrets in commits.** gitleaks blocks them at pre-commit time.
2. **No `--no-verify`.** Don't bypass hooks in a shared repo.
3. **No force push to master.** The ruleset blocks it; there's no bypass.
4. **No direct push to master.** Only PRs are allowed.
5. **Commit messages must be conventional.** It's not just style; it enables automation.

If you accidentally commit a secret:
1. Rotate the secret immediately (assume it's compromised).
2. Use `git filter-repo` to scrub it from history (complex; ask for help).
3. Force push the cleaned branch (only safe if nobody has pulled it yet).

---

## Quick Reference: Git Commands

```bash
# Status and diff
git status
git diff --stat
git log --oneline -5 --show-signature

# Branch management
git checkout dev
git checkout -b feat/feature-name
git branch -d feat/merged-feature

# Commit workflow
git add .
git commit -m "type(scope): message"
git push origin feat/feature-name

# PR workflow
gh pr create --title "Title" --body "Description"
gh pr view
gh pr checks --watch
gh pr list

# Only via web UI:
# → Navigate to PR on github.com
# → Click "Squash and merge"
# → Confirm
```

---

## Reference

- **Full rules:** `claude-code/config/CLAUDE.md` (primary working guide for all Claude Code tasks)
- **OpenCode equivalent:** `opencode/docs/GITHUB.md` (for Furaidē's Fleet agents)
- **GitHub Subagent:** Use `@hanko` in OpenCode to delegate git/PR work with human-in-the-loop
- **Setup checks:** `bash claude-code/scripts/github-setup-check.sh` (verify SSH signing, GitHub key registration, lefthook, gitleaks)
