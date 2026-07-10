# rules/version-control.md

All git and GitHub operations route to the `hanko--git-seal` subagent (model: Haiku):

- **Recipes:** `hanko--git-seal` invokes `Skill(github)` which encodes the 7 standard workflows (commit→push to dev, feature branch, finish feature → PR to dev, dev→master PR, back-merge conflict, status/CI checks, worktree merge-back).
- **Edge cases:** for SSH signing setup, fine-grained PAT, branch rulesets, and troubleshooting, `hanko--git-seal` reads the bundled `GITHUB.md`; for signing/PAT setup specifically, `SECURITY.md`.
- **Approval gates (two-hop):** read-only ops (status/diff/log/pr view) run freely; commits run autonomously (local, reversible). Push/PR-create/PR-merge/worktree-merge-back require approval — since subagents can't call `AskUserQuestion` directly, `hanko--git-seal` returns `NEEDS APPROVAL: <command> — <details>` to the main agent, which calls `AskUserQuestion` before re-dispatching.
- **Hard gate:** push/PR-create/PR-merge/worktree-merge-back are a hard gate (see `rules/gate-policy.md`) — always require explicit user approval, no timeout auto-proceed.
- **Conventions:** Conventional Commits format, SSH-signed, `Assisted-by:` trailer, never `--force`/`--no-verify`, never push to master.
