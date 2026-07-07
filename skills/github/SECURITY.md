# GitHub Security Setup & Inventory

> Progressive disclosure: read this when doing signing/PAT setup or auditing the actual security surface — not on every `Skill(github)` workflow lookup.

---

## SSH Signing Key (Required)

Commits are cryptographically signed using SSH to prove you created them. GitHub enforces this via the `required_signatures` ruleset on master — no merge is allowed unless commits carry valid signatures.

**Local signing** (one-time setup):
```bash
git config --global gpg.format ssh                                  # use SSH keys instead of GPG
git config --global commit.gpgsign true                             # sign every commit automatically
git config --global user.signingkey ~/.ssh/id_ed25519.pub           # your public key
echo "~/.ssh/id_ed25519.pub" | xargs -I{} git config --global gpg.ssh.allowedSignersFile {}
```

**GitHub registration** (one-time manual step):
1. Go to `github.com → Settings → SSH and GPG keys`
2. Click **New SSH key**
3. Set **Key type: Signing Key** (NOT Authentication Key — they are different)
4. Title: your machine name
5. Paste your public key
6. Save

After this, your commits will show a "Verified" badge and satisfy the merge gate.

**Why signing key is separate from auth key**: the same physical SSH key can serve both roles, but GitHub registers them separately — **auth key** authenticates pushes over SSH, **signing key** cryptographically signs commits (works over HTTPS too). This repo uses an HTTPS remote, so only the signing key registration matters here.

## Fine-Grained PAT (Optional but Recommended)

The `gh` CLI authenticates with a broad OAuth token by default. Fine-grained PATs are industry-standard: scoped to a single repo (`pratty010/Furaide` only), only the exact permissions needed (Contents, Pull requests, Workflows), time-limited (90 days), revokable.

**Setup**:
1. `github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens`
2. Generate new token, name `friday-monorepo`, expiration 90 days
3. Repository access: only `F.R.I.D.A.Y`
4. Permissions: Contents (RW), Pull requests (RW), Workflows (RW), Metadata (R, mandatory)
5. `echo "<YOUR_TOKEN>" | gh auth login --with-token`

---

## Setup Check Script

Real path: `packages/cli/src/shared/github-setup-check.sh` (not `scripts/github-setup-check.sh` — that path doesn't exist).

```bash
bash packages/cli/src/shared/github-setup-check.sh          # cached (24h TTL)
bash packages/cli/src/shared/github-setup-check.sh --force  # bypass cache
```

Checks 7 categories:
1. **Local signing config** — `gpg.format=ssh`, `user.signingkey`, `commit.gpgsign=true`, `allowed_signers` file present
2. **GitHub-registered signing key** — queries `gh api user/ssh_signing_keys`, compares against local pubkey (trimmed via `xargs` — pubkey files often carry trailing whitespace that breaks exact match)
3. **GitHub repo security API fields** — `secret_scanning`, `secret_scanning_push_protection` status via `gh api repos/pratty010/Furaide`
4. **Local tool presence** — `lefthook` pre-commit hook installed, `gitleaks` binary on PATH
5. **SSH agent** — `ssh-add -l` succeeds
6. **PAT type** — warns (not blocking) if the current `gh auth token` isn't a fine-grained (`github_pat_*`) token
7. **API connectivity** — confirms `gh api repos/pratty010/Furaide` resolves, and checks the `master`/`master-protection` ruleset exists

A `gh` token missing the `admin:ssh_signing_key` scope returns a 404 from the signing-key API, not an empty list — the script distinguishes this ("scope" state) from genuinely-unregistered so it doesn't report a false "not registered." Fix: `gh auth refresh -h github.com -s admin:ssh_signing_key`, then re-run with `--force`. A fresh `gh auth login` does NOT grant this scope by default — most new users hit this.

**First-time setup**: run the script → it prints a numbered [1/7]..[7/7] guide for anything failing → remediate each finding → re-run with `--force` to confirm.

---

## Full Hook Inventory (ground-truth, from `lefthook.yml`)

**pre-commit** (parallel):
| Job | Scope | Fails if |
|---|---|---|
| `gitleaks` | staged files | secret pattern detected (`gitleaks protect --staged --redact`) |
| `validate-json` | `*.json` | malformed JSON |
| `validate-yaml` | `*.yml`/`*.yaml` | malformed YAML |

**commit-msg**:
| Job | Fails if |
|---|---|
| `conventional` | message doesn't match the Conventional Commits regex |

**pre-push** (sequential, ~8 min total — not documented anywhere else in `skills/github/`):
| Job | Command | Fails if |
|---|---|---|
| `shellcheck` | `shellcheck --rcfile .shellcheckrc {push_files}` (`*.sh`) | shell script lint errors |
| `semgrep-diff` | `semgrep scan --config=r/bash --config=r/typescript --baseline-commit origin/dev` | new findings vs. dev baseline |
| `trivy-quick` | `trivy fs --config trivy.yaml --scanners vuln --severity CRITICAL .` | critical vulnerability found |

`gitleaks` false-positive escape: `LEFTHOOK_EXCLUDE=gitleaks git commit -m "..."`. Never `--no-verify` (bypasses everything, including the pre-push checks — a push that "would have failed" pre-push still won't have been scanned).

---

## CI Security Jobs (`.github/workflows/security.yml` — previously undocumented entirely)

Runs on PR-to-master and a daily 3am UTC cron:

| Job | What it does |
|---|---|
| `trivy-full` | `trivy fs` against the full `trivy.yaml` config — `vuln,secret,misconfig` scanners at `HIGH,CRITICAL` severity, whole repo (not diff-scoped) |
| `semgrep-full` | same rulesets as the pre-push `semgrep-diff` job (`r/bash`, `r/typescript`), but full-repo instead of diff-scoped |
| `snyk-master-gate` | `snyk test`, PR-only gate, requires `SNYK_TOKEN` secret |

**Quick-vs-full Trivy split is intentional, not an oversight**: `trivy-quick` (pre-push, local, `CRITICAL` only, `vuln` scanner only) is a fast local gate; `trivy-full` (CI, `HIGH,CRITICAL`, `vuln,secret,misconfig`) is the comprehensive periodic sweep. Documenting this here so it reads as a documented tradeoff, not a silently narrower local scanner.

---

## GitHub Server-Side Controls

Checked by the setup script's API calls but not previously explained as controls:
- **Secret scanning** (`security_and_analysis.secret_scanning`) — GitHub-side detection of committed secrets, independent of local `gitleaks`
- **Push protection** (`security_and_analysis.secret_scanning_push_protection`) — blocks a push server-side if it contains a recognized secret pattern, even if local gitleaks somehow missed it
- **Master `required_signatures` ruleset** — enforces the SSH-signing requirement server-side; local signing alone doesn't satisfy the merge gate without this

**Branch protection is unmanaged as code** — no ruleset JSON checked into `.github/`, configured only via the web UI. This is a known, accepted limitation (not silently absent) — if the ruleset ever needs reproducing on a new repo, it must be recreated by hand via the web UI, not restored from a file.

---

## Not Implemented (explicit, not an oversight)

- **CodeQL** — Semgrep + Trivy cover overlapping ground (SAST + vuln scanning); not added to avoid redundant CI cost
- **SBOM generation** — no software bill of materials pipeline
- **Signed tags** — only commits are signed, not tags
- **`dependency-review-action`** — no PR-time dependency diff review beyond Snyk's gate

These are candidates for future hardening work, not gaps discovered by accident — listed here so they don't get "rediscovered" as a mystery.

---

## Reference

- Setup checks: `bash packages/cli/src/shared/github-setup-check.sh`
- Claude Code git agent: `hanko--git-seal` subagent + `github` skill (`harnesses/claude-code/config/agents/`, `skills/github/`)
- OpenCode git agent: `@hanko` subagent (`harnesses/opencode/agents/hanko.md`)
