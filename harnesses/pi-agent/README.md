# 🥧 pi-agent/ (friday-furaidee)

[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-pratty010%2FFuraide-8b5cf6)](https://github.com/pratty010/Furaide)
[![Pi](https://img.shields.io/badge/Pi-Extension-00d4aa)](https://pi.dev)

Furaidē's [pi.dev](https://pi.dev) extension package. Five shikigami subsystems: Web-RAG tools, `/usage` analytics, TUI widgets, themes, and GSD skills.

Part of the [F.R.I.D.A.Y.](https://github.com/pratty010/Furaide) monorepo.

---

## ✨ What it provides

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

## ⚙️ What works zero-config vs. what needs API keys

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

Missing keys and binaries emit a clear error message instead of crashing.

---

## ⚡ Install

### One-command (recommended)

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
bash ~/Furaidē/packages/cli/src/targets/pi-agent/install.sh
```

Prerequisites: [bun](https://bun.sh) + [Pi CLI](https://pi.dev) v0.72.1+.

If the shared skill pool (`~/.agents/skills`) is empty, the installer offers to populate it (`install-vendored-skills.sh --global`). Decline and run it later with `--only <names>` (see `--list` for the full menu) to install just a subset. `--yes` skips the prompt and leaves the pool untouched.

### Or from git (once published to npm)

```bash
pi install git:github.com/pratty010/Furaide
```

### Manual

```bash
cd ~/Furaidē/harnesses/pi-agent
bun install
pi install .
```

Restart Pi for the extension to take effect.

---

## ⚙️ Config

After first run, Pi creates the config directory at `~/.pi/agent/extensions/friday/config/`. Two config files auto-generate from defaults:

| File | Purpose |
|------|---------|
| `system.yml` | Model provider settings, quota limits, state paths, timezone |
| `tools.yml` | Web tool and provider on/off toggles, cache settings |

Use `config/system.example.yml` and `config/tools.yml` in this directory as reference starting points. Copy `system.example.yml` → `system.yml` in your runtime config dir and edit quota limits and timezone to match your setup.

### Prerequisites

Minimal setup needs only bun and Pi CLI. Optional shikigami binaries unlock additional providers.

| Tool | Install |
|------|---------|
| [bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` |
| [Pi CLI](https://pi.dev) | See pi.dev |
| `bx` | Brave search binary (optional, for web_search) |
| `tvly` | Tavily binary (optional, for fetch_content crawl/map) |
| `ctx7` | Context7 binary (optional, for code_search) |
| `yt-dlp` | Video transcript extraction (optional, for video_search) |

---

## 🚀 Usage Examples

**Check session costs:**

```
/usage
/usage refresh
```

**Web research with provider fallback:**

```
web_search "latest transformer architectures 2026"
```

**Switch themes:**

```
/theme friday
/theme chimu
```

---

## 🗂️ Structure

```
harnesses/pi-agent/
  package.json                  # Pi package manifest (name: friday-furaidee)
  tsconfig.json                 # NodeNext + allowImportingTsExtensions; typecheck only
  AGENTS.md                     # Dev guide: rules, gates, conventions
  config/
    tools.yml                   # Provider on/off toggles (generic defaults, shipped)
    system.example.yml          # Quota/provider config template (copy → system.yml)
  src/
    index.ts                    # Extension entry point. Registers all features
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
```

---

## 🗑️ Uninstall

No bundled uninstaller. Remove the extension using Pi's extension management:

```bash
pi extensions list
pi uninstall friday-furaidee
```

Or delete the extension directory from Pi's extensions path manually.

---

## 📅 Timeline

- [x] ~~v0.1.0 — **Initial extension**: 4 web tools, semantic cache, /usage tracking~~
- [x] ~~v0.2.0 — **TUI + themes**: animated header, friday/chimu themes, GSD skills~~
- [x] ~~v0.3.0 — **pi-subagents-cc**: 12 agents, teams.yaml~~
- [ ] Native task management
- [ ] Chimu parallel subagent orchestration
- [ ] Expanded knowledge providers
- [ ] TUI telemetry widgets

---

## Part of F.R.I.D.A.Y.

Other components: `harnesses/opencode/` (15-agent core fleet), `harnesses/claude-code/` (Īdisu + Rejion), `harnesses/openclaw/` (stateful assistant personas).
