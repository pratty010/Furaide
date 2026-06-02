# GitHub Workflow Guide: Furaidē's Fleet

> *A reference for OpenCode agents (specialists and subagents) working with F.R.I.D.A.Y.'s git and GitHub operations.*

---

## Branch Strategy

| Branch | Purpose | Who pushes | Merge path |
|--------|---------|-----------|-----------|
| `master` | Stable, user-facing | Humans via web UI | PR only, no CLI merge allowed |
| `dev` | Integration, agent testing | Humans + agents (hanko subagent) | Direct push allowed for agents; PR for complex changes |
| `feat/*`, `fix/*`, `chore/*` | Atomic work units | Agents, humans | PR into dev |

**Rule:** `master` is web-UI-only. No agent can merge to master directly.

---

## Commit Message Format

Conventional Commits, always:

```
type(scope): description
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `style`, `revert`

**Lefthook validates this.** If your message doesn't match, the commit fails.

---

## Security Setup

### SSH Signing Key (Required)

Commits are cryptographically signed using SSH. GitHub enforces this via the `required_signatures` ruleset on master — merges are blocked unless commits carry valid signatures.

**Local signing** (one-time setup):
- `git config --global gpg.format ssh` — use SSH keys
- `git config --global commit.gpgsign true` — sign every commit
- `git config --global user.signingkey ~/.ssh/id_ed25519.pub` — your public key
- `~/.ssh/allowed_signers` file — trusted keys

**GitHub registration** (one-time manual step):
1. `github.com → Settings → SSH and GPG keys`
2. Click **New SSH key**
3. **Key type: Signing Key** (NOT Authentication Key)
4. Title: "WSL2 signing" (or your machine)
5. Paste your public key
6. Save

After registration, commits show "Verified" and satisfy the merge gate.

**Auth key vs signing key:** The same SSH key can serve both:
- **Auth key** — authenticates pushes over SSH (not used in this repo; remote is HTTPS)
- **Signing key** — cryptographically signs commits (needed for merge approval)

Only signing key registration matters for this setup.

### Fine-Grained PAT (Optional but Recommended)

The `gh` CLI uses broad OAuth tokens by default. Fine-grained PATs are industry-standard:
- Scoped to this repo only
- Only exact permissions needed: Contents, Pull requests, Workflows
- Time-limited (90 days)
- Safe if leaked: only this repo access, not the whole account

**Setup** (optional):
1. `github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens`
2. Token name: `friday-monorepo`
3. Expiration: 90 days
4. Repository: Only `F.R.I.D.A.Y`
5. Permissions: Contents (RW), Pull requests (RW), Workflows (RW), Metadata (R)
6. Generate → copy token
7. `echo "<TOKEN>" | gh auth login --with-token`

The setup check script warns if you're using a broad token. The choice is yours — existing auth works; fine-grained tokens follow best practices.

---

## Agent Delegation: When to Use @hanko

`@hanko` is the OpenCode GitHub Workflow executor subagent. Dispatch to hanko when you need:

- Git commits (`git add` + `git commit`)
- Pushing to dev or feature branches (`git push origin dev`)
- Creating PRs (`gh pr create`)
- Monitoring PR status (`gh pr checks`, `gh pr view`)
- Checking branch status (`git log`, `git status`)

**@hanko's constraints:**
- `bash: allow` — can run git and gh commands
- `question: ask` — **always asks you before commit, push, or PR creation**
- `task: { "*": deny }` — cannot dispatch to other subagents
- Never pushes to `master` (blocked by branch ruleset anyway)

**How to delegate:**

From a specialist agent, in your workflow:

```
Dispatch to @hanko with task: "git commit the changes to dev"
```

Hanko will:
1. Run `git status` to confirm staged changes
2. Validate commit message format
3. Ask you before committing: "Ready to commit with message: 'feat(opencode): ...'. Approve?"
4. Commit
5. Ask before pushing: "Ready to push to dev. Approve?"
6. Push

Read-only ops (`git log`, `git status`, `gh pr view`, `gh pr list`) run without asking.

---

## How Specialists Use GitHub Features

Specialists (e.g., Tsukumo, Daikoku) that need GitHub operations:

1. **Do the work** (design, write, refactor, analyze)
2. **At the end, if changes are ready:**
   ```
   Dispatch to @hanko to:
   - Stage all files
   - Commit with message "type(scope): description"
   - Push to dev
   - Create a PR with the standard template
   ```
3. **Hanko asks for approval at each critical step**
4. **User merges the PR via GitHub web UI** (ruleset blocks CLI merge)

**Never commit directly from a specialist.** Always delegate to @hanko.

---

## Security Rules for Agents

1. **No secrets in code.** gitleaks blocks them at pre-commit. Don't try to work around it.
2. **No `--no-verify`.** Don't bypass lefthook checks.
3. **No force push.** The ruleset blocks it at the GitHub side.
4. **No direct push to master.** Only PRs allowed, and only humans can merge.
5. **Always ask before critical ops.** @hanko's `question: ask` enforces this.

---

## Workflow State Is Separate

**GitHub operations have nothing to do with `workflow-state.mjs`.** They are orthogonal:

- Workflow state (`scripts/workflow-state.mjs`, `state.json`) tracks the agent's task progression and decision points
- GitHub operations (git commits, PRs) are how changes reach the repository

Agents don't call `workflow-state.mjs` for GitHub tasks. The GitHub workflow is its own thing: work → commit → push → PR → review → merge.

---

## Setup Checks

Before running any GitHub operation:

```bash
bash opencode/scripts/github-setup-check.sh
```

This verifies:
- SSH signing configured
- GitHub Signing Key registered (not just auth key)
- Lefthook hooks installed
- gitleaks available
- SSH agent running
- Master ruleset active

If anything is missing, the script outputs fix commands.

---

## Quick Git Reference (for agents)

```bash
# Status
git status
git log --oneline -5

# Commit workflow
git add <files>
git commit -m "feat(scope): message"
git push origin dev

# PR workflow (via gh)
gh pr create --title "feat: ..." --body "Summary"
gh pr view
gh pr checks
gh pr list

# Merge (humans only, web UI):
# Open PR on github.com → Click "Squash and merge"
```

---

## Reference

- **Branch protection rules:** Sole developer standard stored in memory at `github-branch-protection.md`
- **Claude Code equivalent:** `claude-code/config/GITHUB.md` (for Claude Code skill reference)
- **Hanko agent:** This subagent (`opencode/agents/hanko.md`) is your primary for GitHub operations
- **Parent rule set:** See `opencode/AGENTS.md` for hanko's role and dispatch table
