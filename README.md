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

## 🗺️ Codebase Map (Local Setup)

To navigate this codebase efficiently, you can build your own local knowledge graph using **Graphify**. This builds an AST structure and semantic relationship map across all agents, skills, configs, and docs:

1. **Install Graphify**:
   ```bash
   uv tool install graphifyy
   ```

2. **Generate the Map**:
   ```bash
   graphify .
   ```

3. **Query/Explore**:
   - Interactive Visual (Open in browser): `graphify-out/graph.html`
   - God nodes/Community map report: `graphify-out/GRAPH_REPORT.md`
   - Querying the graph:
     ```bash
     graphify query "what is the overall architecture and how do the five components relate?"
     graphify query "how does the idisu learning pipeline work end to end?"
     ```

---

## What this is

Harness integrations and shared resources that wire Furaidē into AI coding harnesses:

| Component | Harness | What it does |
|-----------|---------|-------------|
| `harnesses/opencode/` | [OpenCode](https://opencode.ai) | 15-agent fleet: 6 specialists + 6 subagents + 3 worker-tier, web-tools plugin (3 tools, AI Studio / Vertex AI auto transport) |
| `harnesses/opencode/tools/opencode-all/` | OpenCode | Standalone OpenTUI session dashboard companion tool for OpenCode |
| `harnesses/claude-code/` | [Claude Code](https://claude.ai/code) | Īdisu plugin (session learning platform), Rejion plugin (delegates review/task to opencode-go, opencode, ollama-cloud) + `github` skill / `hanko--git-seal` agent (git workflow) |
| `harnesses/pi-agent/` | [pi.dev](https://pi.dev) | Extension package: web-RAG tools, `/usage` cost tracking, animated TUI, friday and chimu themes, GSD skills |
| `harnesses/openclaw/` | [OpenCLAW](https://docs.openclaw.ai) | Persona workspace configs for four pre-built identities: kinyo, koda, kagakusha, tengan |
| `docs/` | All of the above | Shared cross-harness docs: research notes, superpowers plans/specs, `installation.md` (agent-facing setup reference) |

---

## Repository structure

```
Furaidē/
├── harnesses/
│   ├── opencode/      # 15-agent OpenCode fleet
│   │   └── tools/     # Standalone companion tools (opencode-all, …)
│   ├── claude-code/   # Īdisu + Rejion plugins + github skill / hanko--git-seal agent
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

### Claude Code: Īdisu & Rejion

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/packages/cli/src/targets/claude-code/install.sh
```

Then in Claude Code:

```
/plugin marketplace add pratty010/Furaide
/plugin install idisu@fr1d4y
/plugin install rejion@fr1d4y
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

## 🚀 Usage

Once a harness is installed, day-to-day interaction stays inside that harness's own command surface:

- **Claude Code**: slash commands after installing the plugins (`/idisu`, `/idisu dream`, `/idisu report`, `/rejion:review`, `/rejion:task "..."`). Git and GitHub work (commit/push/branch/PR/CI) routes automatically through the `hanko--git-seal` subagent, so you don't run `git`/`gh` directly once it's wired in. Full command reference: [harnesses/claude-code/README.md](harnesses/claude-code/README.md).
- **OpenCode**: the fleet's agents become available under their shikigami names (`kantoku--workflow-director`, `tsuchigumo--research-weaver`, `hanko--git-seal`, and so on); OpenCode's own routing dispatches between them. `/tools-config` edits web-tools defaults. Full agent roster and workflow map: [harnesses/opencode/README.md](harnesses/opencode/README.md).
- **pi.dev**: native tools (`web_search`, `fetch_content`, `code_search`, `video_search`) plus `/usage` for session cost and quota tracking, and `/theme friday` / `/theme chimu` to switch themes. Full reference: [harnesses/pi-agent/README.md](harnesses/pi-agent/README.md).
- **OpenCLAW**: point `agentDir` in `openclaw.json` at one of the four persona workspaces (`workspace-kinyo`, `workspace-koda`, `workspace-kagakusha`, `workspace-tengan`); the persona's `SOUL.md`/`IDENTITY.md`/`MEMORY.md` drive its behavior from there. Full reference: [harnesses/openclaw/README.md](harnesses/openclaw/README.md).

For architecture or "where does X live" questions, run a `graphify query` (see "For agents" above) before reading source directly.

---

## 📅 Timeline

- [x] ~~v0.1.0 — **Monorepo scaffold**: superpowers, docs, graphify-out, initial skills~~
- [x] ~~v0.2.0 — **Fleet v2**: 15-agent OpenCode fleet, web-tools plugin, fleet installer v1~~
- [x] ~~v0.3.0 — **pi-agent + web-tools**: friday-furaidee extension, OpenCode web-tools plugin~~
- [x] ~~v0.4.0 — **Claude Code overhaul**: Īdisu v1 + Rejion plugins, statusline, OpenCLAW personas~~
- [x] ~~v0.5.0 — **Īdisu v2 + security + git tooling**: 8-stage dream pipeline; lefthook, gitleaks, trivy, semgrep, CI security; hanko--git-seal, two-hop approval, GOSHIN v2~~
- [x] ~~v0.6.0 — **Shared installer + committing standards**: unified receipt, zod-v2 schema, --dry-run / --skip-checks, Conventional Commits hook~~
- [ ] v0.7.0 — **Install UX**: statusline install flow, unified bootstrap, --yes across all harnesses
- [ ] npm package distribution
- [ ] Brand Builder / Kitsune opt-in domain
- [ ] Workflow flows: law, financial, OC-parity multi-subagent
- [ ] Unified installer receipt schemas (flat v1 ↔ zod v2)
- [ ] Security: supply-chain audit, expanded CI scanning, fudo--security-guardian enhancement

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

See [skills/github/GITHUB.md](skills/github/GITHUB.md) for branch strategy and troubleshooting, and [skills/github/SECURITY.md](skills/github/SECURITY.md) for signing/PAT setup.

---

*式神は眠らない。*
*The shikigami never sleep.*
