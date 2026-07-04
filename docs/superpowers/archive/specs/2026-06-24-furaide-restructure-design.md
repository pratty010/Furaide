# Furaidē Monorepo Restructure + Security Tooling Design Spec

**Date:** 2026-06-24  
**Status:** Approved — ready for implementation plan  
**Scope:** Restructure `/d/Everything/Furaidē` from component-based layout to industry-standard LLM-harness layout; add free security scanning stack plus Snyk free-tier gate.

---

## 1. Goals

1. Restructure the repo so the main product — cross-runtime LLM agent skills and harnesses — is immediately legible to contributors and consumers.
2. Adopt the `skills/` + `harnesses/` + `packages/` layout used by Vercel AI SDK, Superpowers, agentskills.io, and Claude Code plugins.
3. Add a left-shifted, free-preferred security stack that catches secrets, dependency vulns, and static-analysis issues early.
4. Use Snyk's free 200-tests/month tier as a blocking gate only on `dev → master`.
5. Preserve git history, keep installer scripts working, and update all internal references.
6. Move the opt-in/in-development brand-builder feature into a local-only `future-work/` directory so the core fleet is clean.

---

## 2. Target Directory Structure

```
Furaidē/
├── skills/                          # Cross-runtime skill packages
│   ├── bx/
│   ├── brave-search/
│   ├── github/
│   ├── html-preview/
│   └── plan/
│
├── harnesses/                       # Per-runtime configurations
│   ├── opencode/
│   │   ├── agents/                  # 30 non-brand agents (12 specialists + 16 subagents + 2 escape-hatch)
│   │   ├── commands/                # tools-config.md only (brand-builder commands → future-work/)
│   │   ├── config/
│   │   ├── docs/
│   │   ├── future-work/             # gitignored; holds brand-builder assets
│   │   │   ├── brand-builder-plugin/
│   │   │   ├── agents/
│   │   │   ├── commands/
│   │   │   └── skills/
│   │   ├── plugins/
│   │   ├── rules/
│   │   ├── scripts/
│   │   ├── tools/
│   │   └── README.md
│   ├── claude-code/
│   ├── pi-agent/
│   └── openclaw/
│
├── packages/                        # Shared, runtime-agnostic components
│   ├── agent-cores/                 # from common/agents/ (4 cores only)
│   │   ├── planner/
│   │   ├── researcher/
│   │   ├── strategist/
│   │   └── shiranui/
│   └── manifests/
│       └── skills-manifest.json     # from common/skills-manifest.json
│
├── scripts/                         # Repo-level automation
│   ├── github-setup-check.sh        # from common/scripts/
│   ├── install-vendored-skills.sh   # from common/install-common.sh
│   └── install-external-skills.sh   # from common/install-skills.sh
│
├── docs/                            # Repo-level docs + llms.txt
│   ├── llms.txt                     # new
│   ├── GITHUB.md                    # from common/docs/GITHUB.md
│   ├── agent-template.md            # from common/docs/agent-template.md
│   ├── models/
│   │   ├── openai.md                # from common/docs/models/openai.md
│   │   └── gemini.md                # from common/docs/models/gemini.md
│   └── research/
│       └── typescript-7-native-port-report.md
│
├── .github/
├── .claude-plugin/
├── AGENTS.md
├── README.md
├── package.json
├── bun.lock
├── lefthook.yml
├── opencode.json
└── .gitignore
```

### Move mapping

| Current | New |
|---|---|
| `common/skills/*` | `skills/*` |
| `opencode/*` | `harnesses/opencode/*` |
| `claude-code/*` | `harnesses/claude-code/*` |
| `pi-agent/*` | `harnesses/pi-agent/*` |
| `openclaw/*` | `harnesses/openclaw/*` |
| `common/agents/*` | `packages/agent-cores/*` |
| `common/docs/GITHUB.md` | `docs/GITHUB.md` |
| `common/docs/agent-template.md` | `docs/agent-template.md` |
| `common/docs/models/*` | `docs/models/*` |
| `common/scripts/github-setup-check.sh` | `scripts/github-setup-check.sh` |
| `common/install-common.sh` | `scripts/install-vendored-skills.sh` |
| `common/install-skills.sh` | `scripts/install-external-skills.sh` |
| `common/skills-manifest.json` | `packages/manifests/skills-manifest.json` |
| `common/README.md` | merged into root README / packages/README |
| `opencode/docs/agent-template.md` | **deleted** (was already a redirect stub) |
| brand-builder assets under `opencode/` | `harnesses/opencode/future-work/` (gitignored) |

### What stays at root

- `AGENTS.md`, `README.md`, `package.json`, `bun.lock`, `opencode.json`, `lefthook.yml`
- `.github/`, `.claude-plugin/`, `.vscode/`
- `issues/`
- `graphify-out/` — regenerated after structure is stable (see §8)

---

## 3. Security Tooling Integration

### Free stack

| Tool | Stage | Scope | Blocking |
|---|---|---|---|
| **Gitleaks** | Pre-commit | Staged files | Yes |
| **ShellCheck** | Pre-push | Changed `.sh` files | Yes |
| **Semgrep** | Pre-push | Changed files (`--baseline-commit`) | Yes |
| **Trivy quick** | Pre-push | Changed lockfiles, CRITICAL only | Yes |
| **Trivy full** | PR `dev → master` | Full repo, HIGH+CRITICAL | Yes after 4-week burn-in |
| **Semgrep full** | PR `dev → master` | Full repo | Yes after 4-week burn-in |
| **Snyk** | PR `dev → master` | Full repo | Yes, from day one |
| **Gitleaks tree** | Nightly | Full working tree | No, report-only |
| **Dependabot** | GitHub-native | Dependency updates | Existing, keep |

### Snyk free-tier gate

- **Trigger:** PR from `dev` to `master`.
- **Command:** `snyk test` against repo root — 1 of 200 monthly tests per PR.
- **Blocking:** Yes, from day one.
- **On failure:** Agent analyzes output, proposes fixes, asks user approval, applies fixes, re-runs Snyk.
- **Auth:** `SNYK_TOKEN` added to repository secrets as part of implementation.

### Config files to add/update

| File | Purpose |
|---|---|
| `.gitleaks.toml` | Allowlist for fixtures, examples, `graphify-out/` |
| `trivy.yaml` | Skip `node_modules/`, `.git/`, `.worktrees/`, `graphify-out/` |
| `.shellcheckrc` | ShellCheck exclusions for intentional patterns |
| `lefthook.yml` | Pre-commit Gitleaks; pre-push ShellCheck + Semgrep diff + Trivy quick |
| `.github/workflows/security.yml` | Pre-push-style fast jobs + PR gate + nightly |

### Burn-in plan

- **Weeks 1–4:** Trivy full and Semgrep full run on PR but exit-code 0 (informative). Snyk is blocking. Pre-commit/pre-push checks are blocking.
- **After week 4:** Trivy full and Semgrep full become blocking.

---

## 4. Files Requiring Path Updates

| File | Updates |
|---|---|
| `scripts/install-vendored-skills.sh` | `SKILLS_SRC` → `../skills/` |
| `scripts/install-external-skills.sh` | `MANIFEST` → `../packages/manifests/skills-manifest.json` |
| `harnesses/claude-code/scripts/bootstrap.sh` | `COMMON` path → `../../packages/` / `../../scripts/` |
| `harnesses/opencode/scripts/install-fleet.sh` | `COMMON_DIR` path → `../../packages/` / `../../scripts/` |
| `harnesses/opencode/config/opencode.jsonc` | Plugin relative paths; remove brand-builder agent entries |
| `harnesses/opencode/config/AGENTS.md` | `common/agents/` → `packages/agent-cores/`; remove brand-builder references |
| `harnesses/claude-code/config/CLAUDE.md` | `common/` → `packages/` / `docs/` |
| `harnesses/opencode/config/fleet-manifest.json` | Remove `brand-builder` component; update paths if any |
| `harnesses/opencode/docs/routing-manifest.json` | Remove brand-builder routing entries |
| `lefthook.yml` | `claude-code/**` → `harnesses/claude-code/**`; `cd claude-code/cli` → `cd harnesses/claude-code/cli` |
| `.github/workflows/ci.yml` | Path filters + `cd` commands |
| `.github/workflows/back-merge.yml` | `claude-code/` → `harnesses/claude-code/` |
| `.github/labeler.yml` | Path filters |
| `.github/dependabot.yml` | `/opencode` → `/harnesses/opencode`; `/claude-code/cli` → `/harnesses/claude-code/cli` |
| `.claude-plugin/marketplace.json` | `./claude-code/plugins/satori` → `./harnesses/claude-code/plugins/satori` |
| `README.md` | Repo map, install commands, remove brand-builder from active list |
| `AGENTS.md` | Repo map, directory references |
| `harnesses/opencode/README.md` | Update directory map; remove brand-builder section |
| `harnesses/opencode/AGENTS.md` | Update directory map; remove brand-builder references |
| `.gitignore` | Add `harnesses/opencode/future-work/`; keep existing brand-builder data ignores or move them |

### Do-not-edit / ignore

- `node_modules/`, `.venv/`, installed state directories
- `graphify-out/` — stop and discuss before regenerating

---

## 5. Brand-Builder Future-Work Isolation

The brand-builder feature is opt-in and in development. To keep the core fleet clean, move it into a gitignored `future-work/` directory under `harnesses/opencode/`.

### Files to move

| Source | Destination |
|---|---|
| `harnesses/opencode/brand-builder-plugin/` | `harnesses/opencode/future-work/brand-builder-plugin/` |
| `harnesses/opencode/agents/akashi--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/amanojaku--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/hyakume--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/kataribe--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/kitsune--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/kodama--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/kudagitsune--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/kurabokko--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/agents/migaki--*.md` | `harnesses/opencode/future-work/agents/` |
| `harnesses/opencode/commands/akashi.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/awase.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/hakari.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/kataribe.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/kodama.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/kudagitsune.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/kurabokko.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/migaki.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/omokage.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/commands/tsumugi.md` | `harnesses/opencode/future-work/commands/` |
| `harnesses/opencode/skills/*` | `harnesses/opencode/future-work/skills/` |

### Files to keep in place

- `harnesses/opencode/commands/tools-config.md` — belongs to web-tools, not brand-builder.

### Configuration cleanup

- Remove the `brand-builder` component entry from `harnesses/opencode/config/fleet-manifest.json`.
- Remove brand-builder agent entries from `harnesses/opencode/config/opencode.jsonc`.
- Remove brand-builder routing entries from `harnesses/opencode/docs/routing-manifest.json`.
- Add `harnesses/opencode/future-work/` to root `.gitignore`.

### Documentation cleanup

- Remove brand-builder/Kitsune references from root `README.md`.
- Remove brand-builder references from `harnesses/opencode/README.md`.
- Remove brand-builder references from `harnesses/opencode/AGENTS.md`.
- Remove brand-builder references from `harnesses/opencode/config/AGENTS.md`.
- Delete `harnesses/opencode/docs/agent-template.md` (it is already a redirect stub pointing to the shared template).

---

## 6. Implementation Sequence

1. **Branch from `dev`**.
2. **Add security tooling configs first:** `.gitleaks.toml`, `trivy.yaml`, `.shellcheckrc`, update `lefthook.yml`, add `.github/workflows/security.yml`.
3. **Move directories with `git mv`** using the mapping in §2.
4. **Move brand-builder assets** into `harnesses/opencode/future-work/` and add the directory to `.gitignore`.
5. **Update cross-references** per §4.
6. **Clean up brand-builder** in `fleet-manifest.json`, `opencode.jsonc`, `routing-manifest.json`, READMEs, and AGENTS.md files.
7. **Delete** `harnesses/opencode/docs/agent-template.md`.
8. **Update root documentation** (`README.md`, `AGENTS.md`).
9. **Run verification:**
   - `lefthook run pre-commit`
   - `lefthook run pre-push`
   - Dry-run `scripts/install-vendored-skills.sh`
   - Dry-run `scripts/install-external-skills.sh`
   - CI workflow syntax check
10. **Stop and discuss `graphify-out/` regeneration** with user (see §8).
11. **Run full CI on the branch.**

Integration to `master` is deferred to a later session.

---

## 7. `graphify-out/` Regeneration Protocol

Before regenerating the knowledge graph:

1. Confirm the graphify command/config to run.
2. Decide whether to archive old `graphify-out/` artifacts first.
3. Identify any docs that embed graphify outputs and update them.
4. Use the default Gemini path (`gemini-3-flash-preview`) with `GEMINI_API_KEY` or `GOOGLE_API_KEY` set; do not use `--mode deep` or extra exports.
5. Run graphify from the new structure and review the outputs.

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Missing a hardcoded path | Use the exact inventory from the explore subagent; grep for old paths after moves |
| Installers break | Dry-run both install scripts before CI |
| CI path filters miss changes | Update `.github/labeler.yml` and workflow paths together |
| Pre-push checks become friction | Start informative for full scans; only pre-commit + pre-push quick scans block immediately |
| Snyk free tier exceeded | Run Snyk only on `dev → master` PRs |
| Brand-builder references left behind | Grep for `kitsune`, `brand-builder`, and the 9 agent names after cleanup |
| `graphify-out/` stale | Stop and discuss before regenerating |

---

## 9. Verification Checklist

- [ ] `lefthook run pre-commit` passes
- [ ] `lefthook run pre-push` passes
- [ ] `scripts/install-vendored-skills.sh --global` dry-run succeeds
- [ ] `scripts/install-external-skills.sh --list` succeeds
- [ ] No remaining references to `common/`, old top-level component paths, or deleted brand-builder paths in source/config/docs
- [ ] `.github/workflows/ci.yml` path filters match new structure
- [ ] `.github/dependabot.yml` directories match new structure
- [ ] `.claude-plugin/marketplace.json` points to new plugin path
- [ ] `harnesses/opencode/future-work/` is in `.gitignore`
- [ ] `harnesses/opencode/config/fleet-manifest.json` has no `brand-builder` component
- [ ] `harnesses/opencode/config/opencode.jsonc` has no brand-builder agents
- [ ] `harnesses/opencode/docs/routing-manifest.json` has no brand-builder entries
- [ ] CI passes on the restructure branch
- [ ] `graphify-out/` regenerated and reviewed

---

## 10. Deferred Items

1. **Integration to `master`:** Step after CI pass; method to be confirmed by user / `hanko--git-seal`.
2. **`packages/cli/`:** Future `npx furaide` installer; out of scope for this restructure.
