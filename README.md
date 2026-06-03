# F.R.I.D.A.Y.

> *"All systems online. Shikigami assembled. What are we working on today?"*

**F.R.I.D.A.Y.** is Furaidē's AI assistant collection — multi-agent setups for [Claude Code](https://claude.ai/code), [OpenCode](https://opencode.ai), [pi.dev](https://pi.dev), and [OpenCLAW](https://docs.openclaw.ai).

---

## Repository Structure

```
F.R.I.D.A.Y./
├── opencode/          # 29-agent OpenCode fleet (12 specialists + 15 subagents + 4 gate guardians)
├── claude-code/       # Two Claude Code plugins: Mekiki (analytics) + Hanko (git workflow)
├── pi-agent/          # Pi extension: web-RAG tools, /usage analytics, TUI widgets, themes, GSD skills
├── openclaw/          # OpenCLAW persona workspaces (kinyo, koda, kagakusha, tengan)
├── common/            # Shared layer: vendored skills, agent cores, docs, installers
└── graphify-out/      # Knowledge graph of this repo — see "For Agents" below
```

### Component map

| Directory | What it is | Install command |
|-----------|------------|----------------|
| `opencode/` | Multi-agent fleet for OpenCode | `bash <(curl -fsSL .../install-fleet-bootstrap.sh)` |
| `claude-code/` | Mekiki + Hanko plugins for Claude Code | `bash claude-code/scripts/bootstrap.sh` |
| `pi-agent/` | Pi extension package (`friday-furaidee`) | `bash pi-agent/scripts/install-pi-agent.sh` |
| `openclaw/` | Persona configs for OpenCLAW runtime | Point `agentDir` at `openclaw/agents/workspace-*/` |
| `common/` | Shared skills + docs (all components use this) | `bash common/install-common.sh --global` |

---

## Install

### Prerequisites

| Tool | Install |
|------|---------|
| [bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` |
| [uv](https://docs.astral.sh/uv/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

### OpenCode — Furaidē's Fleet

One-command (clone + install):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/F.R.I.D.A.Y/main/opencode/scripts/install-fleet-bootstrap.sh)
```

Or from a local clone:

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/opencode/scripts/install-fleet.sh
```

Flags: `--list` · `--all` · `--global` / `--project` / `--custom <dir>` · `--link` (symlink dev mode) · `-h`

→ [`opencode/README.md`](opencode/README.md)

### Claude Code — Mekiki + Hanko

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

→ [`claude-code/README.md`](claude-code/README.md)

### Pi — friday-furaidee

```bash
bash ~/F.R.I.D.A.Y/pi-agent/scripts/install-pi-agent.sh
```

Prerequisites: bun + Pi CLI v0.72.1+

→ [`pi-agent/README.md`](pi-agent/README.md)

### OpenCLAW — Persona workspaces

Install [OpenCLAW](https://docs.openclaw.ai), then set `agentDir` in your `openclaw.json`:

```
openclaw/agents/workspace-kinyo/      # general assistant + GOSHIN v2 security
openclaw/agents/workspace-koda/       # code-focused
openclaw/agents/workspace-kagakusha/  # deep research specialist
openclaw/agents/workspace-tengan/     # lightweight general
```

→ [`openclaw/README.md`](openclaw/README.md)

### Common shared skills only

```bash
bash common/install-common.sh --global   # → ~/.agents/skills/
# or --project <dir>  --custom <path>
```

Installs: `bx`, `html-preview`, `brave-search`, `plan` skills across all ecosystems.

### Kitsune (Brand Builder) — opt-in, in development

Requires Furaidē's Fleet first. Select the **Brand Builder / Kitsune** component in the Fleet installer, then:

```bash
cd <install-root>/brand-builder-plugin && bun install
```

→ [`opencode/brand-builder-plugin/brand-builder/README.md`](opencode/brand-builder-plugin/brand-builder/README.md)

---

## Update

```bash
cd ~/F.R.I.D.A.Y && git pull origin master
bash opencode/scripts/install-fleet.sh --dry-run   # preview fleet changes
```

---

## Development

Verify GitHub signing, Lefthook, and gitleaks before first commit:

```bash
bash common/scripts/github-setup-check.sh
```

Branch strategy: work on `dev`, merge to `master` via PR only.

```bash
git checkout dev
git commit -m "feat: ..."
git push origin dev
gh pr create
```

→ [`common/docs/GITHUB.md`](common/docs/GITHUB.md)

---

## For Agents: Knowledge Graph

`graphify-out/` contains a pre-built knowledge graph of this entire repo (2,459 nodes · 3,791 edges · 226 communities). Use it to answer questions about code structure, cross-component relationships, and dispatch patterns **before** reading files.

```
graphify-out/
  graph.json       # full graph data (nodes, edges, community assignments)
  graph.html       # interactive visual — open in browser
  GRAPH_REPORT.md  # audit report: god nodes, surprising connections, community cohesion
```

### How to use (requires [graphify](https://github.com/safishamsi/graphify))

```bash
# Install graphify once
uv tool install graphifyy

# Query the graph (no rebuild — graph already exists)
graphify query "how does the mekiki skill analytics pipeline work?"
graphify query "which opencode agents dispatch tsukumo?"
graphify query "what connects pi-agent to the common layer?"
graphify path "TemplateRender" "KnowledgeDB"
graphify explain "workflow-state"

# Rebuild if the codebase has changed significantly
graphify . --update
```

### Key findings from the current graph

| God node | Degree | What it means |
|----------|--------|---------------|
| `colors` (Chimu theme) | 86 | Theme color tokens fan out to every TUI widget |
| `KnowledgeDB` | 40 | Central SQLite store for the pi-agent semantic cache |
| `TemplateRender` | 28 | Single interface coupling the art/template layer to session metrics via `widgets.ts` |
| `AvailableSkillCtx` | 23 | Mekiki judge context shared across all skill analysis paths |
| `pi-agent README` | 21 | Cross-component bridge document (referenced by many nodes) |

### Community map (top clusters)

| Community | Size | What it covers |
|-----------|------|----------------|
| Pi Web Provider Probes | 89 | Quota probes for every API provider |
| Chimu Theme Color System | 86 | Chimu TUI color tokens |
| Mekiki CLI & Judge Engine | 71 | Python CLI entry points + judge interface |
| Pi TUI Art & Templates | 65 | 26 decorative ASCII templates + art field renderers |
| Mekiki Data Ingestion Pipeline | 62 | Event capture, ingest, improve loop |
| Brand Builder Strategy Engine | 59 | Kitsune brand-builder SQLite engine |
| OpenCode Agent Routing Manifest | 46 | Model fallback chains for all 29 agents |
| OpenCode Specialist Agents | 30 | All specialist + subagent .md definitions |
| Pi Subagent Teams | 32 | pi-subagents-cc team groupings |

---

*Furaidē is always watching. The shikigami never sleep.*
