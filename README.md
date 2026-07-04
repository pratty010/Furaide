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

This repo is those retainers, wired into every major AI coding harness: Claude Code, OpenCode, pi.dev, and OpenCLAW. Each harness integration lives under `harnesses/<name>/`.

---

## For agents: codebase map

If you are an AI coding agent, this is your fastest orientation path. Start here before reading source files. This repo ships a pre-built knowledge graph in `graphify-out/`, covering 2,459 nodes and 3,791 edges across all harnesses (AST structure plus semantic relationships between agents, skills, configs, and docs).

Three files worth reading:

| File | What it tells you |
|------|-------------------|
| `graphify-out/GRAPH_REPORT.md` | God nodes, surprising cross-component connections, community map. Start here. |
| `graphify-out/graph.json` | Full queryable graph, used by `graphify query` |
| `graphify-out/graph.html` | Interactive visual, open in any browser |

**Note (2026-07-03):** `graphify-out/` was generated against a different branch (`dev`) and is currently
stale for this branch's actual file tree — it references at least one plugin (`kuma`) that does not exist here.
Treat it as historical/reference only until it's regenerated; verify anything it claims against the real source
tree first.

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

Harness integrations and shared resources that wire Furaidē into AI coding harnesses:

| Component | Harness | What it does |
|-----------|---------|-------------|
| `harnesses/opencode/` | [OpenCode](https://opencode.ai) | 15-agent fleet: 6 specialists + 6 subagents + 3 worker-tier, web-tools plugin (3 tools, AI Studio / Vertex AI auto transport) |
| `harnesses/opencode/tools/opencode-all/` | OpenCode | Standalone OpenTUI session dashboard companion tool for OpenCode |
| `harnesses/claude-code/` | [Claude Code](https://claude.ai/code) | Satori plugin (capability analytics) + `github` skill / `hanko--git-seal` agent (git workflow) |
| `harnesses/pi-agent/` | [pi.dev](https://pi.dev) | Extension package: web-RAG tools, `/usage` cost tracking, animated TUI, friday and chimu themes, GSD skills |
| `harnesses/openclaw/` | [OpenCLAW](https://docs.openclaw.ai) | Persona workspace configs for four pre-built identities: kinyo, koda, kagakusha, tengan |
| `docs/` | All of the above | Shared cross-harness docs: GITHUB.md |

---

## Repository structure

```
Furaidē/
├── harnesses/
│   ├── opencode/      # 15-agent OpenCode fleet
│   │   └── tools/     # Standalone companion tools (opencode-all, …)
│   ├── claude-code/   # Satori plugin + github skill / hanko--git-seal agent
│   ├── pi-agent/      # Pi extension (friday-furaidee)
│   └── openclaw/      # OpenCLAW persona workspaces
├── docs/              # Shared cross-harness docs
├── skills/            # Shared cross-ecosystem skills
├── scripts/           # Shared installers and utilities
├── packages/          # Shared packages
└── graphify-out/      # Pre-built knowledge graph (see "For agents" above)
```

`harnesses/opencode/tools/` ships standalone companion tools outside the fleet installer. See each tool's README for install/uninstall.

---

## Prerequisites

- Bun (runtime)
- OpenCode CLI (any version)
- git

---

## ⚡ Install

Choose your harness below. Each component has its own installer. Pick what you need.

### OpenCode: Furaidē's fleet

From a local clone:

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/scripts/install.sh opencode-fleet
```

Or non-interactively:

```bash
bash ~/Furaidē/scripts/install.sh opencode-fleet --scope project --workflows all --yes
```

Flags: `--scope <global|project|custom>` · `--custom-dir <path>` · `--workflows <wf1,wf2,...|all>` · `--agents <name,name,...>` · `--web-tools` / `--no-web-tools` · `--yes` · `-h`

See [harnesses/opencode/README.md](harnesses/opencode/README.md).

### OpenCode companion tool: opencode-all

Standalone OpenTUI session dashboard for OpenCode session management. Sits outside the fleet. No agent wiring, no plugin loading.

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/harnesses/opencode/tools/opencode-all/scripts/install.sh
```

See [harnesses/opencode/tools/opencode-all/README.md](harnesses/opencode/tools/opencode-all/README.md).

### Claude Code: Satori

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/packages/cli/src/targets/claude-code/install.sh
```

Then in Claude Code:

```
/plugin marketplace add pratty010/Furaide
/plugin install satori@fr1d4y
/reload-plugins
```

To uninstall: `bash ~/Furaidē/packages/cli/src/targets/claude-code/uninstall.sh`

See [harnesses/claude-code/README.md](harnesses/claude-code/README.md).

### Pi: friday-furaidee

```bash
bash ~/Furaidē/packages/cli/src/targets/pi-agent/install.sh
```

Requires bun and Pi CLI v0.72.1+. See [harnesses/pi-agent/README.md](harnesses/pi-agent/README.md).

### OpenCLAW: persona workspaces

Install [OpenCLAW](https://docs.openclaw.ai), then point `agentDir` at a workspace directory:

```
harnesses/openclaw/agents/workspace-kinyo/      # general assistant + GOSHIN v2 security
harnesses/openclaw/agents/workspace-koda/       # code-focused
harnesses/openclaw/agents/workspace-kagakusha/  # deep research specialist
harnesses/openclaw/agents/workspace-tengan/     # lightweight general
```

See [harnesses/openclaw/README.md](harnesses/openclaw/README.md).

### Shared skills only

```bash
bash packages/cli/src/shared/install-vendored-skills.sh --global   # installs to ~/.agents/skills/
# or: --project <dir>  --custom <path>
```

Installs `bx`, `html-preview`, `brave-search`, and `plan` across all ecosystems.

---

## 🗺️ Roadmap

- **`harnesses/opencode/tools/opencode-all/`**: shipped standalone session dashboard companion tool
- **`web-tools v0.1`**: planning-stage native OpenCode web tools plugin (search/fetch/maps with provider fallback and budgets)
- **Brand Builder / Kitsune**: opt-in profile/portfolio optimization domain, still in development and intentionally excluded from the default fleet install; assets parked at `harnesses/opencode/future-work/`

---

## ⚡ Update

```bash
cd ~/Furaidē && git pull origin master
bash scripts/install.sh opencode-fleet
```

---

## 🔧 Development

Before your first commit, verify SSH signing, Lefthook, and gitleaks are configured:

```bash
bash packages/cli/src/shared/github-setup-check.sh
```

Work on `dev`, merge to `master` via PR:

```bash
git checkout dev
git commit -m "feat: ..."
git push origin dev
gh pr create
```

See [docs/GITHUB.md](docs/GITHUB.md) for the full workflow.

---

*式神は眠らない。*
*The shikigami never sleep.*
