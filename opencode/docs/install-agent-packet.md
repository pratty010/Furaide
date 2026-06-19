# LLM Install Packet — Furaidē's Fleet (OpenCode)

> **Goal**: A single-file, executor-ready guide for another LLM agent to install this fleet locally on a user's machine. No external lookups needed.

---

## Goal

Install Furaidē's Fleet (29 agents, 4 gate plugins, opt-in Brand Builder) into the user's OpenCode config directory. The installer handles model resolution, backups, and install receipts automatically.

---

## Safe Commands (run without asking)

```bash
# 1. Verify prerequisites
command -v jq && command -v bun

# 2. Clone repo (shallow, fast)
git clone --depth 1 https://github.com/pratty010/Furaide.git /tmp/furaide-install
cd /tmp/furaide-install/opencode

# 3. Dry-run to show exact plan (no writes)
bash scripts/install-fleet.sh --dry-run

# 4. Actual install (interactive wizard)
bash scripts/install-fleet.sh
```

---

## When to Ask the User (mandatory prompts)

| Moment | Question | Default | Your action |
|--------|----------|---------|-------------|
| Component selection | "Install Brand Builder / Kitsune? (opt-in, default No)" | **No** | Ask explicitly; only proceed on explicit "yes" |
| Scope per component | "Where to install: [1] global ~/.config/opencode/ [2] project ./.opencode/ [3] custom path [s] skip?" | 1 (global) for defaults-on; s (skip) for brand-builder | Present options; accept space-separated numbers |
| Custom path | "Custom absolute path:" | (user input) | Validate absolute path; expand ~ |
| Preflight confirm | "Proceed with above plan? [y/N]" | N | Must get explicit "y" or "yes" |
| Brand Builder post-install | "Run `bun install` in brand-builder-plugin now?" | Ask | Only if brand-builder was installed |

---

## Expected Interactive Answers

| Prompt | Acceptable answers |
|--------|-------------------|
| Component select (default-on) | `1`, `2`, `3`, `1 2`, `s`, `` (empty = default 1) |
| Component select (brand-builder) | `1`, `2`, `3`, `s`, `` (empty = skip) |
| Custom path | `/absolute/path` or `~/expanded/path` |
| Preflight confirm | `y`, `yes` (case-insensitive) |
| Brand Builder bun install | `y`, `yes`, `n`, `no` |
| Extra skills (superpowers, tavily-*) | `y`, `yes`, `n`, `no` |

---

## Verification Commands (run after install, no prompts needed)

```bash
# 1. Verify config exists and has plugins
cat ~/.config/opencode/opencode.jsonc | jq '.plugin'

# 2. Verify agents installed
ls ~/.config/opencode/agents/ | wc -l
# Expect: 30+ (core) or 39+ (with brand-builder)

# 3. Verify model resolution works (dry-run migawari)
bun -e "const m=require('./plugins/migawari.js'); console.log('migawari loads OK')" 2>&1 || true

# 4. Verify install receipt exists
ls ~/.local/share/opencode/install-receipts/ 2>/dev/null | head -5

# 5. Verify backups exist (if any conflicts occurred)
ls ~/.local/share/opencode/kura_backup/ 2>/dev/null | head -5

# 6. Run test suite
cd ~/.config/opencode && bun test scripts/tests/
```

---

## Rollback / Uninstall Commands

```bash
# Dry-run uninstall (see what would be removed)
bash /tmp/furaide-install/opencode/scripts/uninstall-fleet.sh --dry-run

# Full uninstall (interactive, asks per scope)
bash /tmp/furaide-install/opencode/scripts/uninstall-fleet.sh

# Non-interactive purge (all detected scopes, no prompts)
bash /tmp/furaide-install/opencode/scripts/uninstall-fleet.sh --purge

# Uninstall specific scope only
bash /tmp/furaide-install/opencode/scripts/uninstall-fleet.sh --global
bash /tmp/furaide-install/opencode/scripts/uninstall-fleet.sh --project
```

---

## Brand Builder Opt-In Rule (MANDATORY)

> **Brand Builder / Kitsune is opt-in ONLY. Default is OFF. Never auto-select it.**
>
> - The installer defaults `default_on: false` for `brand-builder` component
> - If user runs `--all`, brand-builder is **still skipped** unless explicitly selected
> - Only proceed if user explicitly says "yes", "install brand builder", or selects it in the wizard
> - If user says "install everything", clarify: "Everything except Brand Builder (opt-in). Install that too?"

---

## What the Installer Does Automatically (do not replicate manually)

1. **Model resolution** — Reads `docs/routing-manifest.json` and writes `opencode.jsonc` provider whitelist; presents **one confirmation** showing resolved models before write
2. **Backup** — Existing files at target paths moved to `~/.local/share/opencode/kura_backup/<timestamp>/`
3. **Install receipt** — JSON written to `~/.local/share/opencode/install-receipts/<timestamp>.json` with component list, target paths, file counts, mode, timestamp
4. **Config merge** — Plugins added to `opencode.jsonc` via `merge-config.mjs` (handles .jsonc comments); rules glob wired via `instructions`
5. **`__FLEET_ROOT__` substitution** — In copy mode, plugin files get repo path substituted; skipped in `--link` mode
6. **Post-install notes** — Prints `bun install` command for brand-builder if selected; prints `OPENCODE_CONFIG_DIR` export for custom scopes

---

## Where User Edits Models After Install

**File: `~/.config/opencode/opencode.jsonc`**

```jsonc
{
  "agent": {
    "tsukumogami--code-forgemaster": { "model": "opencode-go/kimi-k2.5" },
    "tsuchigumo--research-weaver": { "model": "opencode-go/kimi-k2.5" },
    // ... per-agent model overrides go here
  },
  "provider": {
    "opencode-go": { "models": ["kimi-k2.5", "kimi-k2.6", "qwen3.7-max", "glm-5.1", ...] }
  }
}
```

**Runtime source of truth**: `docs/routing-manifest.json` (fallback chains, heavy/simple/canary variants). Edit `opencode.jsonc` for per-agent overrides; edit `routing-manifest.json` for fallback chains.

---

## Minimal Verification Checklist (tick all)

- [ ] `jq` and `bun` available
- [ ] Dry-run shows expected components + scopes
- [ ] User confirmed each component scope
- [ ] User explicitly confirmed Brand Builder (or skipped)
- [ ] Preflight summary shown and confirmed
- [ ] Install receipt written
- [ ] Backup directory created (if conflicts existed)
- [ ] `opencode.jsonc` has 4 plugins + rules glob
- [ ] Agents present in `agents/`
- [ ] `bun test` passes

---

## Troubleshooting Quick Reference

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `jq: not found` | Missing dep | `sudo apt install jq` / `brew install jq` |
| `bun: not found` | Missing dep | `curl -fsSL https://bun.sh/install \| bash` |
| `migawari.js` load fail | routing-manifest.json missing | Verify failover component installed |
| `opencode.jsonc` parse error | merge-config.mjs failed | Run `bun scripts/merge-config.mjs ~/.config/opencode/opencode.jsonc --rules` manually |
| Brand Builder `bun install` fails | No network / bun version | Run manually in `brand-builder-plugin/` dir |
| Custom scope not loading | `OPENCODE_CONFIG_DIR` not set | `export OPENCODE_CONFIG_DIR=/your/custom/path` |