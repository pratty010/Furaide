# Furaidē — F.R.I.D.A.Y.

> *フライデー。すべてのシステムオンライン。式神、整列。今日は何をしますか？*
> *Furaidē. All systems online. Shikigami assembled. What are we working on today?*

---

## The name

**F.R.I.D.A.Y.** is Tony Stark's AI (*Female Replacement Intelligent Digital Assistant Youth*), brought in after J.A.R.V.I.S. in *Avengers: Age of Ultron*. Short answers, no theatre.

**Furaidē** (フライデー) is the version where Stark grew up in Japan. Same precision, but every agent is a *shikigami* (式神, a spirit-familiar bound to its summoner), named after a yokai for what it does. Tsuchigumo spins research webs. Karakuri runs your code. Oni tears it apart. Not just a chatbot fleet; more like a retainer who already knows what you need before you finish the sentence.

This repo is those retainers, wired into every major AI coding harness: Claude Code, OpenCode, pi.dev, and OpenCLAW.

---

## For agents: codebase map

Start here before reading source files. This repo ships a pre-built knowledge graph in `graphify-out/`, covering 2,459 nodes and 3,791 edges across all five components (AST structure plus semantic relationships between agents, skills, configs, and docs).

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
graphify query "how does the mekiki skill analytics pipeline work end to end?"
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

Five components that wire Furaidē into AI coding harnesses:

| Component | Harness | What it does |
|-----------|---------|-------------|
| `opencode/` | [OpenCode](https://opencode.ai) | 29-agent fleet: 12 domain specialists, 15 shared subagents, 4 always-on gate guardians, Kitsune brand-builder (opt-in) |
| `claude-code/` | [Claude Code](https://claude.ai/code) | Two plugins: Mekiki (目利き, skill-usage analytics) and Hanko (判子, git workflow with human-in-the-loop approval) |
| `pi-agent/` | [pi.dev](https://pi.dev) | Extension package: web-RAG tools, `/usage` cost tracking, animated TUI, friday and chimu themes, GSD skills |
| `openclaw/` | [OpenCLAW](https://docs.openclaw.ai) | Persona workspace configs for four pre-built identities: kinyo, koda, kagakusha, tengan |
| `common/` | All of the above | Single source of truth: vendored skills, agent cores, shared docs, cross-ecosystem installers |

---

## Repository structure

```
Furaidē/
├── opencode/          # 29-agent OpenCode fleet
├── claude-code/       # Mekiki + Hanko Claude Code plugins
├── pi-agent/          # Pi extension (friday-furaidee)
├── openclaw/          # OpenCLAW persona workspaces
├── common/            # Shared skills, agent cores, docs, installers
└── graphify-out/      # Pre-built knowledge graph (see "For agents" above)
```

---

## Install

### Prerequisites

| Tool | Install |
|------|---------|
| [bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` |
| [uv](https://docs.astral.sh/uv/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

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

### Claude Code: Mekiki + Hanko

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/claude-code/scripts/bootstrap.sh
```

Then in Claude Code:

```
/plugin marketplace add pratty010/Furaide
/plugin install mekiki@5h1nch4n
/plugin install hanko@5h1nch4n
/reload-plugins
```

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

## Update

```bash
cd ~/Furaidē && git pull origin master
bash opencode/scripts/install-fleet.sh --dry-run
```

---

## Development

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
