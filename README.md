# F.R.I.D.A.Y.

> *"All systems online. Shikigami assembled. What are we working on today?"*

**F.R.I.D.A.Y.** is Furaidē's collection: AI assistant setups for [Claude Code](https://claude.ai/code), [OpenCode](https://opencode.ai), [pi.dev](https://pi.dev), and [OpenCLAW](https://docs.openclaw.ai). Each component is a named shikigami (式神), a spirit-familiar named for its function.

Five components. Install one, some, or all.

| Directory | Component | What it is |
|-----------|-----------|------------|
| `opencode/` | **Furaidē's Fleet** | OpenCode multi-agent fleet: 12 specialists, 15 subagents, 4 gate guardians, Kitsune brand-builder (opt-in). |
| `claude-code/` | **Mekiki + Hanko** | Two Claude Code plugins: Mekiki (skill analytics) + Hanko (git workflow). Includes Furaidē's `~/.claude` config bundle. |
| `pi-agent/` | **friday-furaidee** | Pi package: web-RAG tools, /usage command, TUI widgets, friday + chimu themes. |
| `openclaw/` | **OpenCLAW Personas** | Persona workspace configs for the OpenCLAW stateful runtime (kinyo, koda, kagakusha, tengan). |
| `common/` | **Shared Layer** | Vendored skills, agent cores, docs (GITHUB.md, model guides), and installers shared across all ecosystems. |

---

## Install

### One-command bootstrap

```bash
# OpenCode — Furaidē's Fleet
bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/F.R.I.D.A.Y/main/opencode/scripts/install-fleet-bootstrap.sh)

# Claude Code — Mekiki + Hanko + engine
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/claude-code/scripts/bootstrap.sh
# Then in Claude Code: /plugin marketplace add pratty010/F.R.I.D.A.Y
#                      /plugin install mekiki@5h1nch4n
#                      /plugin install hanko@5h1nch4n

# Pi — friday-furaidee
bash ~/F.R.I.D.A.Y/pi-agent/scripts/install-pi-agent.sh
```

---

### Selective install

<details>
<summary><strong>OpenCode: Furaidē's Fleet</strong> — 29-agent fleet + gate plugins</summary>

```bash
# One-command (clone + install)
bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/F.R.I.D.A.Y/main/opencode/scripts/install-fleet-bootstrap.sh)

# Or from local clone
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/opencode/scripts/install-fleet.sh
```

Flags: `--list` (preview), `--all` (non-interactive), `--global`/`--project`/`--custom <dir>` (scope), `--link` (symlink mode for dev), `-h` (help).

See [`opencode/README.md`](opencode/README.md) for full details.

</details>

<details>
<summary><strong>Claude Code: Mekiki + Hanko plugins</strong></summary>

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/claude-code/scripts/bootstrap.sh
```

Then in Claude Code:
```
/plugin marketplace add pratty010/F.R.I.D.A.Y
/plugin install mekiki@5h1nch4n
/plugin install hanko@5h1nch4n
/reload-plugins
```

See [`claude-code/README.md`](claude-code/README.md) for plugin details, CLI usage, and config bundle.

</details>

<details>
<summary><strong>Pi: friday-furaidee package</strong></summary>

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/pi-agent/scripts/install-pi-agent.sh
```

Prerequisites: [bun](https://bun.sh) + [Pi CLI](https://pi.dev).

See [`pi-agent/README.md`](pi-agent/README.md) for extensions, themes, and skills.

</details>

<details>
<summary><strong>OpenCLAW: Persona workspaces</strong></summary>

Install [OpenCLAW](https://docs.openclaw.ai), then point `agentDir` in your `openclaw.json` at any of the persona directories:

```
openclaw/agents/workspace-kinyo/      # general assistant + GOSHIN v2 security
openclaw/agents/workspace-koda/       # code-focused assistant
openclaw/agents/workspace-kagakusha/  # deep research specialist
openclaw/agents/workspace-tengan/     # lightweight general
```

See [`openclaw/README.md`](openclaw/README.md) for full config schema and persona authoring guide.

</details>

<details>
<summary><strong>Common shared skills only</strong></summary>

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/common/install-common.sh --global   # → ~/.agents/skills/
# or --project <dir>  --custom <path>
```

Installs: `bx`, `html-preview`, `brave-search`, `plan` skills.

</details>

<details>
<summary><strong>Kitsune (Brand Builder) only</strong> — opt-in, in development</summary>

> Requires Furaidē's Fleet first. Kitsune opens a per-project SQLite DB; not loaded globally by default.

Run the Fleet installer and select the **Brand Builder / Kitsune** component, then:

```bash
cd <your-install-root>/brand-builder-plugin && bun install
```

Add to your project's `.opencode/opencode.json`:

```json
{ "plugin": ["<your-install-root>/brand-builder-plugin/plugin/brand-builder.mjs"] }
```

</details>

---

## Update

```bash
cd ~/F.R.I.D.A.Y
git pull origin master
bash opencode/scripts/install-fleet.sh --dry-run   # preview fleet changes
```

---

## Development

First-time: verify GitHub signing, Lefthook, and gitleaks are configured:

```bash
bash common/scripts/github-setup-check.sh
```

Work on `dev`; master receives changes via PR only.

```bash
git checkout dev
# make changes
git commit -m "feat: ..."
git push origin dev
gh pr create
```

See [`common/docs/GITHUB.md`](common/docs/GITHUB.md) for the full git workflow reference.

---

## The Shikigami

### Furaidē's Fleet: OpenCode (29 core)

**12 Specialists**

| Shikigami | Role |
|-----------|------|
| Tanuki(General) | Cost-aware generalist |
| Tsukumo(Coder) | Multi-file implementation + test loops |
| Tsuchigumo(Deep Researcher) | Multi-source research with citations, market/academic/intel |
| Sōjōbō(Strategist) | ARCHITECT: ADRs + options tables; PLAN: executor-ready implementation plans |
| Shiranui(Migrator) | Phased codemod/migration orchestrator with rollback plans |
| Planner(Implementation Planner) | Executor-ready plans with exact file paths + verification commands |
| Mujina(Brand Strategist) | Brand positioning and GTM narrative |
| Daidarabotchi(DevOps/SRE) | Infrastructure and reliability |
| Enma(Legal/Compliance) | Regulatory compliance and contracts |
| Tsukuyomi(PM/Spec) | Product requirements and specifications |
| Daikoku(Financial) | Financial modeling and analysis |
| Yumemi(Writer) | Long-form content and editorial writing |

**15 Shared Subagents** (dispatched by specialists)

Karakuri(Code Runner), Bakeneko(Debugger), Oni(Reviewer), Yamabiko(Source Retriever), Kagami(Fact-Checker), Azukiarai(Extractor), Kotodama(Prose Wordsmith), Jorogumo(Synthesizer), Tengu(Designer), Makimono(Technical Writer), Henge(Formatter), Mikoshi(Explorer), Soroban(Data Analyst), Mizuchi(Data Architect), Hanko(GitHub Workflow) — + Karasu-tengu(Scout) as escape hatch

**4 Gate Guardians** (always active)

Nio(Gate Enforcer) · Nurikabe(Delivery Gate) · Komainu(Security Patterns) · Migawari(Model Failover)

**Brand Builder Domain** (Kitsune + 8 sub-familiars — opt-in, in development)

---

### Claude Code: Mekiki + Hanko

| Plugin | Shikigami | Role |
|--------|-----------|------|
| Mekiki | Mekiki(目利き · Skill Appraiser) | Watches every skill invocation; judges effectiveness offline; `/mekiki overview/skill/improve` commands |
| Hanko | Hanko(判子 · Git Seal) | Git commits, push, PR creation, CI monitoring with human-in-the-loop approval |

---

### Common Layer

Single source of truth for shared skills (`bx`, `html-preview`, `brave-search`, `plan`), agent cores (researcher, planner, strategist, shiranui), reference docs (GITHUB.md, model guides), and installers.

---

*Furaidē is always watching. The shikigami never sleep.*
