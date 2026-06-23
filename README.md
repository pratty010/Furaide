# 🌸 Furaidē: F.R.I.D.A.Y.

[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-pratty010%2FFuraide-8b5cf6)](https://github.com/pratty010/Furaide)
[![Fleet](https://img.shields.io/badge/F.R.I.D.A.Y.-Furaidē-ff0080)](https://github.com/pratty010/Furaide)

> *フライデー。すべてのシステムオンライン。式神、整列。今日は何をしますか？*
> *Furaidē. All systems online. Shikigami assembled. What are we working on today?*

---

## The name

**F.R.I.D.A.Y.** is Tony Stark's AI (*Female Replacement Intelligent Digital Assistant Youth*), brought in after J.A.R.V.I.S. in *Avengers: Age of Ultron*. Short answers, no theatre.

**Furaidē** (フライデー) is the version where Stark grew up in Japan. Same precision, but every agent is a *shikigami* (式神, a spirit-familiar bound to its summoner), named after a yokai for what it does. Tsuchigumo spins research webs. Karakuri runs your code. Oni tears it apart. Not just a chatbot fleet; more like a retainer who already knows what you need before you finish the sentence.

This repo is those retainers, wired into every major AI coding harness: Claude Code, OpenCode, pi.dev, and OpenCLAW.

---

## For agents: codebase map

If you are an AI coding agent, this is your fastest orientation path. Start here before reading source files. This repo ships a pre-built knowledge graph in `graphify-out/`, covering 2,459 nodes and 3,791 edges across all five components (AST structure plus semantic relationships between agents, skills, configs, and docs).

Three files worth reading:

| File | What it tells you |
|------|-------------------|
| `graphify-out/GRAPH_REPORT.md` | God nodes, surprising cross-component connections, community map. Start here. |
| `graphify-out/graph.json` | Full queryable graph, used by `graphify query` |
| `graphify-out/graph.html` | Interactive visual, open in any browser |

Copy any of these into your Claude Code or OpenCode session:

```
# Architecture overview
graphify query "what is the overall architecture and how do the five components relate?"

# Per-component deep dives
graphify query "how does the satori capability analytics pipeline work end to end?"
graphify query "how does the opencode fleet route tasks between specialist agents?"
graphify query "what does the pi-agent extension register and how does web search work?"

# Trace a path between two nodes
graphify path "TemplateRender" "KnowledgeDB"
graphify path "tsuchigumo" "yamabiko"

# Explain a specific node
graphify explain "workflow-state"
graphify explain "KnowledgeDB"

# Rebuild after large changes
graphify . --update
```

To install graphify: `uv tool install graphifyy`

---

## What this is

Five components and one companion tool that wire Furaidē into AI coding harnesses:

| Component | Harness | What it does |
|-----------|---------|-------------|
| `opencode/` | [OpenCode](https://opencode.ai) | 30-agent fleet: 12 domain specialists, 16 shared subagents, 4 always-on gate guardians, web-tools plugin (3 tools, AI Studio / Vertex AI auto transport), Kitsune brand-builder (opt-in) |
| `opencode/tools/opencode-all/` | OpenCode | Standalone OpenTUI session dashboard companion tool for OpenCode |
| `claude-code/` | [Claude Code](https://claude.ai/code) | Satori plugin (capability analytics) + `github` skill / `hanko--git-seal` agent (git workflow) |
| `pi-agent/` | [pi.dev](https://pi.dev) | Extension package: web-RAG tools, `/usage` cost tracking, animated TUI, friday and chimu themes, GSD skills |
| `openclaw/` | [OpenCLAW](https://docs.openclaw.ai) | Persona workspace configs for four pre-built identities: kinyo, koda, kagakusha, tengan |
| `common/` | All of the above | Single source of truth: vendored skills, agent cores, shared docs, cross-ecosystem installers |

---

## Repository structure

```
Furaidē/
├── opencode/          # 30-agent OpenCode fleet
│   └── tools/         # Standalone companion tools (opencode-all, …)
├── claude-code/       # Satori plugin + github skill / hanko--git-seal agent
├── pi-agent/          # Pi extension (friday-furaidee)
├── openclaw/          # OpenCLAW persona workspaces
├── common/            # Shared skills, agent cores, docs, installers
└── graphify-out/      # Pre-built knowledge graph (see "For agents" above)
```

`opencode/tools/` ships standalone companion tools outside the fleet installer. See each tool's README for install/uninstall.

---

## Prerequisites

- Bun (runtime)
- OpenCode CLI (any version)
- git

---

## ⚡ Install

Choose your harness below. Each component has its own installer. Pick what you need.

### OpenCode: Furaidē's fleet

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/Furaide/main/opencode/scripts/install-fleet-bootstrap.sh)
```

Or from a local clone:

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/opencode/scripts/install-fleet.sh
```

Flags: `--list` · `--all` · `--global` / `--project` / `--custom <dir>` · `--link` (symlink dev mode) · `-h`

See [opencode/README.md](opencode/README.md).

### OpenCode companion tool: opencode-all

Standalone OpenTUI session dashboard for OpenCode session management. Sits outside the fleet. No agent wiring, no plugin loading.

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/opencode/tools/opencode-all/scripts/install.sh
```

See [opencode/tools/opencode-all/README.md](opencode/tools/opencode-all/README.md).

### Claude Code: Satori

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/claude-code/scripts/bootstrap.sh
```

Then in Claude Code:

```
/plugin marketplace add pratty010/Furaide
/plugin install satori@fr1d4y
/reload-plugins
```

To uninstall: `bash ~/Furaidē/claude-code/scripts/uninstall.sh`

See [claude-code/README.md](claude-code/README.md).

### Pi: friday-furaidee

```bash
bash ~/Furaidē/pi-agent/scripts/install-pi-agent.sh
```

Requires bun and Pi CLI v0.72.1+. See [pi-agent/README.md](pi-agent/README.md).

### OpenCLAW: persona workspaces

Install [OpenCLAW](https://docs.openclaw.ai), then point `agentDir` at a workspace directory:

```
openclaw/agents/workspace-kinyo/      # general assistant + GOSHIN v2 security
openclaw/agents/workspace-koda/       # code-focused
openclaw/agents/workspace-kagakusha/  # deep research specialist
openclaw/agents/workspace-tengan/     # lightweight general
```

See [openclaw/README.md](openclaw/README.md).

### Shared skills only

```bash
bash common/install-common.sh --global   # installs to ~/.agents/skills/
# or: --project <dir>  --custom <path>
```

Installs `bx`, `html-preview`, `brave-search`, and `plan` across all ecosystems.

### Kitsune (brand builder): opt-in, in development

Select **Brand Builder / Kitsune** in the Fleet installer, then:

```bash
cd <install-root>/brand-builder-plugin && bun install
```

See [the brand-builder README](opencode/brand-builder-plugin/brand-builder/README.md).

---

## 🗺️ Roadmap

- **`opencode/tools/opencode-all/`**: shipped standalone session dashboard companion tool
- **`web-tools v0.1`**: planning-stage native OpenCode web tools plugin (search/fetch/maps with provider fallback and budgets)
- **Brand Builder / Kitsune**: opt-in profile/portfolio optimization domain, still in development and intentionally excluded from the default fleet install

---

## ⚡ Update

```bash
cd ~/Furaidē && git pull origin master
bash opencode/scripts/install-fleet.sh --dry-run
```

---

## 🔧 Development

Before your first commit, verify SSH signing, Lefthook, and gitleaks are configured:

```bash
bash common/scripts/github-setup-check.sh
```

Work on `dev`, merge to `master` via PR:

```bash
git checkout dev
git commit -m "feat: ..."
git push origin dev
gh pr create
```

See [common/docs/GITHUB.md](common/docs/GITHUB.md) for the full workflow.

---

*式神は眠らない。*
*The shikigami never sleep.*
