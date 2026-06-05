# Furaidē's Fleet: OpenCode Setup

> *"Twenty-nine spirits. Four gate-guardians. The fleet is ready."*

Furaidē's [OpenCode](https://opencode.ai) configuration: a 29-agent fleet of named shikigami specialists, four gate plugins enforcing workflow integrity, and Kitsune's brand-builder domain (opt-in, in development). Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) collection.

There is no marketplace: the installer is the distribution. One command clones and installs:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/Furaide/main/opencode/scripts/install-fleet-bootstrap.sh)
```

Or if you already have the repo:

```bash
bash opencode/scripts/install-fleet.sh
```

The installer presents a redesigned, independent-choice flow:

1. **Core bundle** (always default on): workflow gates, model failover, security gate, session vault, specialist agents, agent support scripts, rules, and reference docs.
2. **Brand Builder / Kitsune** (optional, default **No**): the opt-in 9-agent brand domain. Skip unless you want it.
3. **Location** (independent choice): global (`~/.config/opencode/`), project (`./.opencode/`), or a custom absolute path.
4. **Mode** (independent choice): copy (default; writable, self-contained) or link (`ln -sfn` from the repo; useful for development).
5. **Preflight summary**: before any write, the installer prints the resolved paths, file counts, mode, and per-component coupling. Confirm to proceed.
6. **Conflict handling**: existing files at the target path are moved to `kura_backup/<timestamp>/` by default, so nothing is silently overwritten.

### Flags

| Flag | Effect |
|------|--------|
| `--list` | Print all components with descriptions and coupling. No writes. |
| `--dry-run` | Show planned copy + config-merge actions. No writes. |
| `--all` | Install all default-on components without prompting. |
| `--global` | Pre-select `~/.config/opencode/` for all components. |
| `--project` | Pre-select `./.opencode/` for all components. |
| `--custom <dir>` | Pre-select an absolute path for all components. |
| `--link` | Symlink mode: `ln -sfn` instead of `cp`; keeps the repo as source, skips `__FLEET_ROOT__` substitution. Useful for development. |
| `-h` | Show help. |

### Scopes

| Scope | Path | Activation |
|-------|------|------------|
| Global | `~/.config/opencode/` | Always active for the current user. |
| Project | `<project>/.opencode/` | Active only when `opencode` runs in that project. |
| Custom | Any absolute path | Set `export OPENCODE_CONFIG_DIR=<dir>` before running `opencode`. |

---

## Components

| # | Component | Atomic | Default | Description |
|---|-----------|--------|---------|-------------|
| 1 | Workflow Gates | yes | on | Nio + Nurikabe gate plugins + workflow state engine. Tightly coupled; cannot be split. |
| 2 | Model Failover | yes | on | Migawari plugin + routing manifest. Tightly coupled; cannot be split. |
| 3 | Security Gate | no | on | Komainu plugin: 35+ dangerous-pattern checks on every Edit/Write. Standalone. |
| 4 | Session Vault | yes | on | Global session vault command, close-hook plugin, helper, and tests. |
| 5 | Specialist Agents | no | on | 29 core shikigami: 12 domain specialists + 2 general agents + 15 shared subagents. |
| 6 | Agent Support Scripts | no | on | Verification and safety scripts called by agents via Karakuri. |
| 7 | Rules | no | on | Memory contract and other rules wired via `instructions` glob. |
| 8 | Reference Docs | no | off | OPERATOR guide, architecture overview, manifest schema, model family guides. |
| 9 | Brand Builder / Kitsune | yes | off | Opt-in; in development. 9 brand agents + plugin + commands + skills. Needs `bun install`. |

Run `bash opencode/scripts/install-fleet.sh --list` for the full machine-readable view.

> **Superpowers** (the @obra skill collection) is **not** auto-loaded. It was removed from `opencode.jsonc` to avoid third-party network hits on install. Install it manually via `bash common/install-skills.sh --ecosystem opencode` if you want it.

---

## The Fleet

### 12 Domain Specialists

| Shikigami | Role |
|-----------|------|
| Tsukumo(Coder) | Multi-file implementation and refactor |
| Tsuchigumo(Deep Researcher) | Deep multi-source research with citations |
| Mujina(Brand Strategist) | Brand positioning, messaging, and GTM narrative |
| Soroban(Data Analyst) | Quantitative analysis (dispatched) |
| Daidarabotchi(DevOps/SRE) | Infrastructure and reliability |
| Enma(Legal/Compliance) | Regulatory compliance and contract review |
| Tsukuyomi(PM/Spec) | Product requirements and specifications |
| Daikoku(Financial) | Financial modeling and investment analysis |
| Yumemi(Writer) | Long-form content and editorial writing |
| Fudō(Security) | Security audit and threat modeling |
| Mizuchi(Data Architect) | Schema design, SQL, dbt models, ETL/ELT pipelines |
| Sōjōbō(Strategist) | Architecture decisions (ADRs, options tables) and implementation plans |

### 2 General Agents

| Shikigami | Role |
|-----------|------|
| Tanuki(General) | Cost-aware generalist for tasks that fit no specialist |
| Karasu-tengu(Scout) | Library and dependency lookup; ctx7 protocol baked in |

### 15 Shared Subagents

| Shikigami | Role |
|-----------|------|
| Karakuri(Code Runner) | Command and script execution; the only agent with bash access |
| Bakeneko(Debugger) | Root-cause analysis → ExecutionPacket |
| Oni(Reviewer) | Adversarial review at premium judgment |
| Yamabiko(Source Retriever) | External doc and source fetch |
| Kagami(Fact-Checker) | Claim verification before delivery |
| Azukiarai(Extractor) | Bulk structured data extraction |
| Kotodama(Prose Wordsmith) | Elevate draft to publication quality |
| Jorogumo(Synthesizer) | Evidence corpus → narrative deliverable |
| Tengu(Designer) | Diagrams, SVG, HTML mockups |
| Makimono(Technical Writer) | API docs, changelogs, inline comments |
| Henge(Formatter) | Bulk format and transform |
| Mikoshi(Explorer) | Read-only codebase navigation |
| Hanko(GitHub Workflow) | Git commits, pushes, PR creation, and CI monitoring with human-in-the-loop approval |
| Planner(Implementation Planner) | Turns a goal into an executor-ready plan with exact file paths and verification commands |
| Shiranui(Migrator) | Migration and codemod orchestrator for dependency upgrades and large-scale refactors |

### 4 Gate Shikigami (always active)

| Shikigami | Role |
|-----------|------|
| Nio(Gate Enforcer) | Blocks tools when workflow verdict is critical |
| Nurikabe(Delivery Gate) | Holds replies at checkpoint until verdict clears |
| Komainu(Security Patterns) | Screens edits for dangerous patterns |
| Migawari(Model Failover) | Cross-vendor fallback chain from routing-manifest.json |

### Brand Builder / Kitsune Domain (opt-in, in development)

Install with `scripts/install-fleet.sh` (brand-builder component). Not loaded by default.

| Shikigami | Role |
|-----------|------|
| Kitsune(Brand Builder) | Brand-builder orchestrator |
| Kuda-gitsune(Diagnostician) | Current-state scoring and role-fit judgment |
| Akashi(GitHub Proof) | GitHub portfolio evaluation |
| Hyakume(ATS Discoverability) | ATS keyword coverage audit |
| Kodama(Growth Planner) | Growth roadmap and gap analysis |
| Kurabokko(Knowledge Steward) | Artifact intake and memory hygiene |
| Migaki(LinkedIn Optimizer) | LinkedIn section diagnosis and rewrite |
| Kataribe(Narrative Brand) | Brand strategy and website brief |
| Amanojaku(Anti-Voice Reviewer) | Adversarial claim-grounding reviewer |

---

## Tests

```bash
bun test scripts/tests/
```

---

## Uninstall

The OpenCode uninstaller removes OpenCode-owned shikigami files, gate plugins, and configs. It can also clean up shared `common/` skills used across harnesses.

```bash
bash opencode/scripts/uninstall-fleet.sh
```

### Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Print planned deletions and config edits without making any filesystem writes. |
| `--purge` | Non-interactive mode; auto-approves deletions across detected active scopes. |
| `--global` | Run uninstall on global scope (`~/.config/opencode/`). |
| `--project` | Run uninstall on project-local scope (`./.opencode/`). |
| `--custom <dir>` | Run uninstall on a custom absolute directory. |
| `--include-shared-skills` | Directly remove shared `common/` skills without prompting. |

---

## Experimental `dev` Branch

For testing upcoming features on the `dev` branch:

### 1. Clone and Install
Check out the `dev` branch and run the installer in symlink mode:

```bash
git clone -b dev https://github.com/pratty010/Furaide.git ~/furaide-dev
cd ~/furaide-dev/opencode
bash scripts/install-fleet.sh --project --link
```

Using `--link` symlinks configuration files to your checked-out repository instead of copying them, allowing you to test modifications instantly.

Alternatively, run the remote bootstrap installer pointing to the `dev` branch:

```bash
FURAIDE_BRANCH=dev bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/Furaide/dev/opencode/scripts/install-fleet-bootstrap.sh)
```

### 2. Running Tests
Verify the fleet configuration and scripts:

```bash
bun test scripts/tests/
```

---

## Part of F.R.I.D.A.Y.

This config is one of Furaidē's domains. The full collection lives at [pratty010/Furaide](https://github.com/pratty010/Furaide).
