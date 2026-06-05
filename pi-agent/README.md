# pi-agent/ (friday-furaidee)

Furaidē's [pi.dev](https://pi.dev) extension package. Web-RAG tools, `/usage` analytics, TUI widgets, themes, and GSD skills.

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) monorepo.

---

## What it provides

| Feature | Details |
|---------|---------|
| **4 Web tools** | `web_search` (5-provider tiered), `fetch_content` (extract/crawl/map), `code_search` (ctx7 + GitHub), `video_search` (Brave + yt-dlp + Gemini) |
| **Semantic cache** | Embedding-backed dedup across searches; `@xenova/transformers` local embedder (zero-config) or Google/OpenAI |
| **`/usage` command** | Session cost, tool quota tracking, model pricing. Subcommands: `/usage refresh`, `/usage update <tool> <n>`, `/usage setup <provider>` |
| **TUI** | Animated ASCII header (8 animated field renderers, 26 decorative templates), session-metrics footer, status bar |
| **Themes** | `friday` (neon pink/violet, `#ff0080` accent) and `chimu` (neon cyan/magenta cyberpunk) |
| **GSD Skills** | `commit`, `plan`, `research`, `review` |
| **pi-subagents-cc agents** | 12 agents + `teams.yaml`: coding-agent, researcher, reviewer, planner, deep-research-agent, synthesizer, context-builder, finance-research-agent, gsd-agent, worker, delegate, scout |

---

## What works zero-config vs. what needs API keys

| Feature | Needs |
|---------|-------|
| `fetch_content` (extract mode) | Nothing; uses builtin Readability+fetch |
| Semantic cache (local embedder) | Nothing; `@xenova/transformers` downloads the model on first use |
| `/usage` tracking | Nothing |
| TUI, themes, GSD skills | Nothing |
| `web_search` | `GEMINI_API_KEY` **or** `bx`/`tvly` binaries **or** `EXA_API_KEY`/`SERPER_API_KEY` |
| `fetch_content` (crawl/map) | Tavily (`tvly` binary) |
| `code_search` | `ctx7` binary and/or authenticated `gh` CLI |
| `video_search` | `bx` binary + `yt-dlp`; Gemini fallback needs `GEMINI_API_KEY` |

All missing keys/binaries degrade gracefully with a clear error rather than crashing.

---

## Install

### One-command (recommended)

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/pi-agent/scripts/install-pi-agent.sh
```

Prerequisites: [bun](https://bun.sh) + [Pi CLI](https://pi.dev) v0.72.1+.

### Or from git (once published to npm)

```bash
pi install git:github.com/pratty010/Furaide
```

### Manual

```bash
cd ~/Furaidē/pi-agent
bun install
pi install .
```

Restart Pi for the extension to take effect.

---

## Config

After first run, Pi creates the config directory at `~/.pi/agent/extensions/friday/config/`. Two config files are auto-generated from defaults:

| File | Purpose |
|------|---------|
| `system.yml` | Model provider settings, quota limits, state paths, timezone |
| `tools.yml` | Web tool and provider on/off toggles, cache settings |

Use `config/system.example.yml` and `config/tools.yml` in this directory as reference starting points. Copy `system.example.yml` → `system.yml` in your runtime config dir and edit quota limits and timezone to match your setup.

---

## Prerequisites

| Tool | Install |
|------|---------|
| [bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` |
| [Pi CLI](https://pi.dev) | See pi.dev |
| `bx` | Brave search binary (optional, for web_search) |
| `tvly` | Tavily binary (optional, for fetch_content crawl/map) |
| `ctx7` | Context7 binary (optional, for code_search) |
| `yt-dlp` | Video transcript extraction (optional, for video_search) |

---

## Structure

```
pi-agent/
  package.json                  # Pi package manifest (name: friday-furaidee)
  tsconfig.json                 # NodeNext + allowImportingTsExtensions; typecheck only
  AGENTS.md                     # Dev guide: rules, gates, conventions
  config/
    tools.yml                   # Provider on/off toggles (generic defaults, shipped)
    system.example.yml          # Quota/provider config template (copy → system.yml)
  src/
    index.ts                    # Extension entry point — registers all features
    web.ts                      # Web subsystem registration shim
    theme.ts                    # Theme + TUI widget registration
    system-prompt.ts            # System prompt injector (APPEND_SYSTEM.md)
    APPEND_SYSTEM.md            # Injected tool/UI guidance
    art/                        # Animated header art engine + 8 field generators
      data.ts                   # MODES array for template selection
    templates/                  # 26 decorative ASCII panel templates
    ui/                         # TUI widgets: header, footer, session-metrics, status
      types.ts                  # ExtensionContextTheme interface
    runtime/                    # Usage tracking, model pricing, quota store
    shared/web-bridge.ts        # Decoupling singleton (index ↔ web ↔ ui)
    web/                        # Web tools, providers, semantic cache, quota probes
  themes/
    friday.json                 # Neon pink/violet dark theme
    chimu.json                  # Neon cyan/magenta cyberpunk theme
  skills/                       # GSD skills: commit, plan, research, review
  agents/                       # pi-subagents-cc: 12 agents + teams.yaml
  scripts/install-pi-agent.sh
```

---

## Future work (archived, not shipped)

- **Native task management**: Todo system (surgically removed; see `knowledge/future_work/friday_archive/` in Experimental repo if needed)
- **Chimu orchestration**: Parallel subagent orchestration layer (archived; see `knowledge/future_work/pi_chimu_archive/`)
- **Expanded knowledge providers**: Local document ingestion, additional enterprise search
- **TUI enhancements**: Live session telemetry widgets

---

## Part of F.R.I.D.A.Y.

Other components: `opencode/` (30-agent core fleet), `claude-code/` (Mekiki + Hanko plugins), `common/` (shared skills + docs), `openclaw/` (stateful assistant personas).
