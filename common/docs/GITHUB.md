# GitHub Workflow Guide

> *Shared reference for Claude Code agents (via Hanko plugin), OpenCode agents (via @hanko subagent), and the F.R.I.D.A.Y. developer.*

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

You normally don't touch this. To reconcile a divergence by hand: `git checkout dev && git merge origin/master`, resolve toward dev, then push.

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

Lefthook (pre-commit hook) validates this automatically. If your commit message doesn't match, the commit is rejected.

---

## Security Setup

### SSH Signing Key (Required)

Commits are cryptographically signed using SSH to prove you created them. GitHub enforces this via the `required_signatures` ruleset on master — no merge is allowed unless commits carry valid signatures.

**Local signing** (one-time setup):
- `git config --global gpg.format ssh` — use SSH keys instead of GPG
- `git config --global commit.gpgsign true` — sign every commit automatically
- `git config --global user.signingkey ~/.ssh/id_ed25519.pub` — your public key
- `~/.ssh/allowed_signers` file — tells git which keys to trust

**GitHub registration** (one-time manual step):
1. Go to `github.com → Settings → SSH and GPG keys`
2. Click **New SSH key**
3. Set **Key type: Signing Key** (NOT Authentication Key — they are different)
4. Title: "WSL2 signing" (or your machine name)
5. Paste your public key (displayed by the setup check script)
6. Save

After this, your commits will show a "Verified" badge and satisfy the merge gate.

**Why signing key is separate from auth key:** The same physical SSH key (`~/.ssh/id_ed25519`) can serve both roles, but GitHub registers them separately:
- **Auth key** — authenticates pushes over SSH (`git@github.com` remote)
- **Signing key** — cryptographically signs commits (works with any remote, SSH or HTTPS)

This repo uses an HTTPS remote, so the auth key is unused here. Only the signing key registration matters.

### Fine-Grained PAT (Optional but Recommended)

The `gh` CLI authenticates using a broad OAuth token by default. **Fine-grained PATs** are industry-standard:
- Scoped to a single repository (`pratty010/Furaide` only)
- Only the exact permissions needed: Contents, Pull requests, Workflows
- Time-limited (90 days) and revokable
- Blast radius if leaked: only this repo, not your whole account

**Setup** (optional but recommended):
1. Go to `github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens`
2. Click **Generate new token**
3. Token name: `friday-monorepo`
4. Expiration: 90 days
5. Repository access: Only select `F.R.I.D.A.Y`
6. Permissions: Contents (RW), Pull requests (RW), Workflows (RW), Metadata (R, mandatory)
7. Generate → copy the token
8. `echo "<YOUR_TOKEN>" | gh auth login --with-token`

The setup check script warns if you're using a broad token. Existing auth works; fine-grained tokens follow best practices.

---

## Agent Delegation

### Claude Code (Hanko plugin)

Use the `/github` command (Hanko plugin) to spawn a Haiku subagent for git operations:

```
/github create a PR for my feature branch with the standard template
```

The Haiku subagent reads this guide, validates conventional commit format, uses `gh` CLI, and **asks you before every push or PR operation**. Never pushes to `master`.

### OpenCode (@hanko subagent)

Dispatch to `@hanko` when a specialist needs git operations:

```
Dispatch to @hanko with task: "git commit the changes to dev"
```

**@hanko's constraints:**
- `bash: allow` — can run git and gh commands
- `question: ask` — **always asks you before commit, push, or PR creation**
- `task: { "*": deny }` — cannot dispatch to other subagents
- Never pushes to `master` (blocked by branch ruleset anyway)

**How @hanko operates:**
1. Runs `git status` to confirm staged changes
2. Validates commit message format (conventional)
3. Asks: "Ready to commit with message: 'feat(opencode): ...'. Approve?"
4. Commits
5. Asks: "Ready to push to dev. Approve?"
6. Pushes

Read-only ops (`git log`, `git status`, `gh pr view`) run without asking.

**Specialist → @hanko pattern:**
1. Specialist does the work (design, write, refactor)
2. At completion, dispatches to @hanko: stage + commit + push + PR
3. @hanko asks approval at each critical step
4. Human merges via GitHub web UI (ruleset blocks CLI merge)

**Never commit directly from a specialist.** Always delegate to @hanko.

### Workflow State Is Separate

GitHub operations are orthogonal to `workflow-state.mjs`:
- `workflow-state.mjs` / `state.json` — tracks agent task progression and decision points
- Git commits, PRs — how changes reach the repository

Agents don't call `workflow-state.mjs` for GitHub tasks.

---

## Local Development Workflow

### 1. Create a feature branch

```bash
git checkout dev
git pull origin dev
git checkout -b feat/your-feature-name
```

### 2. Make changes, test locally

```bash
bun test          # if in opencode/
uv run pytest     # if in claude-code/cli/
```

### 3. Commit with conventional message

```bash
git add .
git commit -m "feat(opencode): describe your change"
```

Lefthook fires: gitleaks, JSON/YAML validation, bun test / pytest, conventional commit check.

### 4. Push and create a PR

```bash
git push origin feat/your-feature-name
gh pr create --title "feat: describe the change" --body "Summary of what changed and why"
```

### 5. Wait for CI, then merge via web UI

```bash
gh pr checks --watch
```

Once checks pass: GitHub web UI → PR → "Squash and merge" → Confirm.

`gh pr merge --squash` is blocked by the master ruleset — use the web UI.

---

## What Lefthook Checks

| Check | Scope | Fails if |
|-------|-------|----------|
| `gitleaks` | All staged files | A secret pattern is detected |
| `validate-json` | `*.json` files | JSON is malformed |
| `validate-yaml` | `*.yml` / `*.yaml` files | YAML is malformed |
| `bun test` | opencode/** changes | Tests fail with `--bail` |
| `pytest` | claude-code/** changes | Tests fail |
| `conventional` | Commit message | Doesn't match Conventional Commits pattern |

**Skipping a check for a false positive:**
```bash
LEFTHOOK_EXCLUDE=gitleaks git commit -m "chore: add test fixtures"
```
Never use `--no-verify` (disables all hooks).

**Reinstall hooks:**
```bash
bunx lefthook install
lefthook run pre-commit   # verify
```

---

## CI Gates: What Runs on a PR to Master

1. **`test-claude-code`** — if `claude-code/` or `.github/` changed
   - Runs `uv sync --frozen`
   - Runs `uv run pytest -x -q --tb=short`

2. **Auto-labeling** — applies labels based on changed files

**Debugging:**
```bash
cd claude-code/cli && uv sync --frozen && uv run pytest -x -q --tb=short
```

---

## Security Rules (Never Break These)

1. **No secrets in commits.** gitleaks blocks them at pre-commit time.
2. **No `--no-verify`.** Don't bypass hooks.
3. **No force push to master.** Blocked by ruleset; no bypass.
4. **No direct push to master.** Only PRs allowed.
5. **Commit messages must be conventional.**
6. **Agents always ask before critical ops** (commit, push, PR creation).

If you accidentally commit a secret:
1. Rotate the secret immediately (assume it's compromised).
2. Use `git filter-repo` to scrub it from history.
3. Force push the cleaned branch (only if nobody has pulled it yet).

---

## Troubleshooting

### "Merging is blocked — Commits must have verified signatures"

Two independent causes — check both:

1. **Signing key not registered on GitHub.** Local signing produces the `gpgsig` header, but GitHub only shows "Verified" once your public key is registered as a **Signing Key** (Settings → SSH and GPG keys → Key type: **Signing Key**, not Authentication Key).

2. **Setup script wrongly reports "not registered".** Your `gh` token lacks the `admin:ssh_signing_key` scope. Fix:
   ```bash
   gh auth refresh -h github.com -s admin:ssh_signing_key
   bash <scope>/scripts/github-setup-check.sh --force
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

### bun tests fail in pre-commit but `opencode/` has no test runner

`opencode/` is agent definitions — there is no `bun-tests` job in `lefthook.yml`. Only `pytest` runs (for `claude-code/`). If you see a bun-test job, it was added in error.

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

# Merge (humans only, web UI):
# → Navigate to PR on github.com
# → Click "Squash and merge" → Confirm
```

---

## Reference

- **Branch protection standard:** `github-branch-protection.md` in project memory
- **Setup checks:** `bash <scope>/scripts/github-setup-check.sh`
- **Claude Code git agent:** `/github` (Hanko plugin)
- **OpenCode git agent:** `@hanko` subagent (`opencode/agents/hanko.md`)
