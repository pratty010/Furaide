# Security Tooling Integration Research — Furaidē Monorepo

**Date:** 2026-06-24  
**Source:** Subagent research + synthesis for Furaidē restructure

---

## 1. Tool Landscape

| Tool | License/Cost | Scans | Ease of Setup | Strengths | Weaknesses |
|---|---|---|---|---|---|
| **Trivy** | OSS (Apache 2.0), free | SCA (npm, pip, Go, etc.), IaC (TF, K8s, Dockerfile), secrets, container images, SBOM, licenses | One binary; single `trivy fs .` command | Fastest cold-cache scan, low false-positive rate, unified CLI, monorepo-friendly with `--scanners` flags | No SAST for custom application logic; no web dashboard |
| **Gitleaks** | OSS (MIT), free | Git secrets (committed + staged) | Single binary; `gitleaks protect --staged` for pre-commit | De facto OSS standard for secrets; staged-only mode; zero network | Secrets only; not a general-purpose scanner |
| **Semgrep** | OSS (LGPL) free; Team tier paid | SAST (custom code rules, 30+ languages), SCA (limited), secrets | `pip install semgrep`; rules via `--config=r/bash` or custom YAML | Best OSS SAST; shell/bash ruleset exists; diff-aware CI mode | SCA weaker than Trivy/Snyk; OSS rules need curation |
| **Snyk** | Free tier (200 tests/mo); Team $25/dev/mo; Enterprise custom | SAST (DeepCode AI), SCA (proprietary DB), containers, IaC, secrets, fix PRs | CLI + GitHub Action; web dashboard auto-configures | Best-in-class SCA database; auto-fix PRs; unified dashboard | Expensive at scale; SaaS dependency; noisy auto-PR without triage |
| **GitHub Advanced Security** | Free on public repos; Enterprise for private | CodeQL SAST, Dependabot SCA, secret scanning | Built into GitHub; enable via org settings | Zero setup on public repos; deep semantic analysis | No container/IaC scanning; GitHub-only; Enterprise for private |
| **CodeQL** | Free for public repos; GHAS license for private | Deep semantic SAST (15+ languages) | GitHub Action; query packs via GHAS | Most powerful SAST for complex taint flows | No SCA/secrets/containers; slow database build |
| **OSV-Scanner** | OSS (Apache 2.0), free | SCA (polyglot) | Single binary; `osv-scanner scan .` | Google-maintained; queries OSV.dev | No SAST, secrets, IaC, or containers |
| **OWASP Dependency-Check** | OSS (Apache 2.0), free | SCA (Java, .NET, Node, Python, Ruby, etc.) | CLI or Maven/Gradle plugin; NVD feed | OWASP standard; broad language support | Slower than Trivy; weaker Node/TypeScript coverage |
| **Checkov** | OSS (Apache 2.0), free; Prisma Cloud paid | IaC (TF, CF, K8s, ARM, Dockerfile); secrets | `pip install checkov` | 1,000+ IaC policies | IaC only; no SCA/SAST for application code |

---

## 2. Integration Points and Granularity

### Stages

| Stage | Latency budget | Bypass risk | Good for |
|---|---|---|---|
| **Pre-commit (lefthook)** | <10 sec | `git commit --no-verify` | Fast secrets scan, linting, YAML/JSON validation |
| **Lefthook pre-push** | <60 sec | `git push --no-verify` | Heavier local checks on changed files |
| **PR check (GitHub Actions)** | 1–10 min | Branch protection + required checks | SCA diff scan, SAST diff scan, license compliance |
| **Nightly cron** | No human waiting | Not blocking | Full dependency scan, full-history secrets scan |
| **Release gate** | Variable | Blocks release | Container scan, SBOM, reachability analysis |

### Granularity risks

**Too granular (bad):**
- Full `trivy fs .` on every pre-commit → developers use `--no-verify`
- Snyk auto-fix PRs without triage → ignored noise
- Blocking medium-severity findings → bypass culture

**Too coarse (bad):**
- No pre-commit secrets check → credentials committed
- Only nightly scanning → 24-hour exposure window
- Only release-time scanning → late discovery, expensive fixes

---

## 3. Recommended Stack for Furaidē

### Free stack

| Tool | When | What it checks | Blocking |
|---|---|---|---|
| **Gitleaks** | Pre-commit (staged) + nightly | Secrets | Pre-commit: yes; nightly: report-only |
| **ShellCheck** | Pre-push | Changed `.sh` files | Yes |
| **Semgrep** | Pre-push + PR `dev → master` | Changed files / full repo | Yes |
| **Trivy** | Pre-push quick + PR full + nightly | Dependency vulns, misconfigs, licenses | Yes |
| **Dependabot** | GitHub-native | Dependency updates | Existing, keep |

### Snyk free-tier gate

- **Trigger:** PR from `dev` to `master`.
- **Command:** `snyk test` against repo root.
- **Cost:** 1 of 200 monthly tests per PR.
- **Blocking:** Yes, from day one.
- **Failure handling:** Agent analyzes findings, proposes fixes, asks user approval, applies fixes, re-runs Snyk.
- **Auth:** `SNYK_TOKEN` repository secret.

### Burn-in plan

- **Weeks 1–4:** Pre-commit and pre-push checks are blocking. PR Trivy full and Semgrep full run informative (exit-code 0) to tune false positives. Snyk is blocking.
- **After week 4:** PR Trivy full and Semgrep full become blocking.

---

## 4. Config File Locations

| File | Purpose |
|---|---|
| `.gitleaks.toml` | Allowlist for test fixtures, docs examples, `graphify-out/` |
| `trivy.yaml` | Skip `node_modules/`, `.git/`, `.worktrees/`, `graphify-out/`; severity HIGH/CRITICAL |
| `.shellcheckrc` | ShellCheck exclusions for intentional patterns |
| `lefthook.yml` | Pre-commit Gitleaks; pre-push ShellCheck + Semgrep diff + Trivy quick |
| `.github/workflows/security.yml` | PR `dev → master` + nightly jobs |

---

## 5. Gotchas for This Repo

- **Markdown-heavy:** Trivy/Semgrep ignore `.md` by default. Gitleaks still scans markdown for embedded secrets; allowlist docs examples.
- **Shell scripts:** Semgrep `r/bash` is the only scanner that adds value over vulnerability scanning. Highest-value target is hook scripts.
- **TypeScript but not an application:** Agent harnesses, not a web app. OWASP Top 10 mostly irrelevant; focus on command injection, file traversal, secret exposure in logs.
- **Monorepo scanning time:** `trivy fs .` must skip `node_modules/`, `.git/`, `.worktrees/`, `graphify-out/`.
- **Low SCA value components:** `openclaw/` and `pi-agent/` may have minimal lockfiles. Use path filtering where needed.
- **False positives:** Gitleaks flags `.env.example`, test fixtures, placeholder tokens. Use per-path allowlist, not global skips.
- **Worktree support:** Ensure `.worktrees/` is handled correctly in skip lists.

---

## 6. Summary

Start with the free stack (Gitleaks + Trivy + Semgrep + Dependabot) in pre-commit, pre-push, PR, and nightly workflows. Add Snyk free tier only at the `dev → master` PR gate for its deeper SCA and blocking enforcement. No paid tool is required to close the current gaps.
