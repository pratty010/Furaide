# F.R.I.D.A.Y.

> *"All systems online. Shikigami assembled. What are we working on today?"*

**F.R.I.D.A.Y.** is Furaidē's collection: an AI assistant setup for [Claude Code](https://claude.ai/code) and [OpenCode](https://opencode.ai). Each component is a named shikigami (式神), a spirit-familiar named for its function.

Two components. Install one, the other, or both.

| Directory | Component | What it is |
|-----------|-----------|------------|
| `claude-code/` | **Satori** (Skill Overseer) | Claude Code plugin that watches every skill invocation and judges effectiveness offline. Includes Furaidē's global `~/.claude` config bundle. |
| `opencode/` | **Furaidē's Fleet** | OpenCode multi-agent setup: 9 specialists, 13 subagents, 4 gate guardians, and Kitsune's brand-builder domain (opt-in, in development). |

---

## Install

### Full install: both components

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
cd ~/F.R.I.D.A.Y
```

Then set up each component:

```bash
# Furaidē's Fleet (OpenCode)
bash opencode/scripts/install-fleet.sh

# Satori (Claude Code)
bash claude-code/scripts/dev-link-plugin.sh
cd claude-code/cli && uv sync
```

---

### Selective install

<details>
<summary><strong>Furaidē's Fleet only</strong> — OpenCode agents and gate plugins</summary>

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/opencode/scripts/install-fleet.sh
```

The installer walks through each component (gate plugins, agents, rules, scripts) and lets you choose scope per component: global (`~/.config/opencode/`), project (`./.opencode/`), or a custom path.

```bash
# Preview components without installing
bash ~/F.R.I.D.A.Y/opencode/scripts/install-fleet.sh --list

# Non-interactive: install all defaults to project scope
bash ~/F.R.I.D.A.Y/opencode/scripts/install-fleet.sh --all --project
```

See [`opencode/README.md`](opencode/README.md) for full flag reference and component details.

</details>

<details>
<summary><strong>Satori only</strong> — Claude Code skill observability</summary>

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
bash ~/F.R.I.D.A.Y/claude-code/scripts/dev-link-plugin.sh
cd ~/F.R.I.D.A.Y/claude-code/cli && uv sync
```

See [`claude-code/README.md`](claude-code/README.md) for usage and the `/satori` skill.

</details>

<details>
<summary><strong>Config bundle only</strong> — Furaidē's global Claude Code config</summary>

No plugin required. Copy the files you want into `~/.claude/`:

```bash
git clone https://github.com/pratty010/F.R.I.D.A.Y.git ~/F.R.I.D.A.Y
cp ~/F.R.I.D.A.Y/claude-code/config/CLAUDE.md ~/.claude/CLAUDE.md
cp ~/F.R.I.D.A.Y/claude-code/config/statusline-command.sh ~/.claude/statusline-command.sh
# Merge relevant keys from claude-code/config/settings.json manually
```

See [`claude-code/config/README.md`](claude-code/config/README.md) for per-file notes.

</details>

<details>
<summary><strong>Kitsune (Brand Builder) only</strong> — opt-in per project, in development</summary>

> [!NOTE]
> Requires Furaidē's Fleet to be installed first. Kitsune opens a per-project SQLite DB and is not loaded globally by default.

Run the Fleet installer and select the **Brand Builder / Kitsune** component, then:

```bash
cd <your-install-root>/brand-builder-plugin && bun install
```

Add to your project's `.opencode/opencode.json`:

```json
{
  "plugin": ["<your-install-root>/brand-builder-plugin/plugin/brand-builder.mjs"]
}
```

</details>

---

## Update

```bash
cd ~/F.R.I.D.A.Y
git pull origin master
```

Both components update together. Re-run the component installer if new files were added:

```bash
bash opencode/scripts/install-fleet.sh --dry-run   # preview changes
```

---

## Development

First-time setup: run the GitHub environment check to verify SSH signing, Lefthook, and gitleaks are configured.

```bash
bash claude-code/scripts/github-setup-check.sh
```

Work on the `dev` branch. Master receives changes only via pull request.

```bash
git checkout dev
# make changes in opencode/ or claude-code/
git add .
git commit -m "feat: ..."
# Lefthook hooks validate automatically (gitleaks, tests, conventional commits)
git push origin dev
gh pr create --title "feat: ..." --body "Summary"
# CI runs tests + labeling; merge via GitHub web UI
```

See [`claude-code/config/GITHUB.md`](claude-code/config/GITHUB.md) for the full workflow reference.

---

## The Shikigami

### Furaidē's Fleet: OpenCode

**9 Specialists**

| Shikigami | Role |
|-----------|------|
| Tanuki(General) | Cost-aware generalist |
| Tsukumo(Coder) | Multi-file implementation |
| Tsuchigumo(Deep Researcher) | Multi-source research with citations |
| Mujina(Brand Strategist) | Brand positioning and GTM narrative |
| Daidarabotchi(DevOps/SRE) | Infrastructure and reliability |
| Enma(Legal/Compliance) | Regulatory compliance and contracts |
| Tsukuyomi(PM/Spec) | Product requirements and specifications |
| Daikoku(Financial) | Financial modeling and analysis |
| Yumemi(Writer) | Long-form content and editorial writing |

**13 Shared Subagents** (dispatched by specialists)

Karakuri(Code Runner), Bakeneko(Debugger), Oni(Reviewer), Yamabiko(Source Retriever), Kagami(Fact-Checker), Azukiarai(Extractor), Kotodama(Prose Wordsmith), Jorogumo(Synthesizer), Tengu(Designer), Makimono(Technical Writer), Henge(Formatter), Mikoshi(Explorer), Karasu-tengu(Scout)

**4 Gate Guardians** (always active)

| Shikigami | Role |
|-----------|------|
| Nio(Gate Enforcer) | Blocks tools when workflow verdict is critical |
| Nurikabe(Delivery Gate) | Holds replies at checkpoint until verdict clears |
| Komainu(Security Patterns) | Screens edits for dangerous patterns |
| Migawari(Model Failover) | Cross-vendor model failover |

**Brand Builder Domain** (Kitsune + 8 sub-familiars — opt-in, in development)

### Satori: Claude Code

| Shikigami | Role |
|-----------|------|
| Satori(Skill Overseer) | Watches every skill invocation; judges effectiveness offline; reports via HTML |

---

*Furaidē is always watching. The shikigami never sleep.*
