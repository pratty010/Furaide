# Furaidē: Claude Code Config Bundle

Furaidē's global Claude Code configuration, safe to copy into `~/.claude/`. Each file is independent; install all or only the parts you want.

---

## Install

### Default: install everything

```bash
cp config/CLAUDE.md ~/.claude/CLAUDE.md
cp config/statusline-command.sh ~/.claude/statusline-command.sh
```

---

### Selective install: per component

<details>
<summary><strong>CLAUDE.md</strong>: working guide and Furaidē persona</summary>

The core behavior contract: intent triage rules, delegation thresholds, model selection, workflow decision table, and the Furaidē persona preamble. This is the most impactful file to install.

```bash
# Replace:
cp config/CLAUDE.md ~/.claude/CLAUDE.md

# Or append to an existing CLAUDE.md:
cat config/CLAUDE.md >> ~/.claude/CLAUDE.md
```

</details>

<details>
<summary><strong>keybindings.json</strong>: custom keyboard shortcuts</summary>

Adds shortcuts for transcript toggle, model picker, thinking toggle, stash, and history search.

```bash
cp config/keybindings.json ~/.claude/keybindings.json
```

> [!WARNING]
> This replaces your existing keybindings entirely. Review the file before applying if you have custom bindings.

</details>

<details>
<summary><strong>statusline-command.sh</strong>: custom status line</summary>

Displays `user@host:cwd` in the Claude Code status line.

```bash
cp config/statusline-command.sh ~/.claude/statusline-command.sh
```

Then add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline-command.sh"
  }
}
```

</details>

<details>
<summary><strong>settings.json</strong>: Claude Code settings</summary>

Contains: model (`opusplan`), effort level (`high`), theme (`dark-ansi`), editor mode (`normal`), auto-compact, statusline, Codex plugin config.

> [!CAUTION]
> `skipDangerousModePermissionPrompt` and `skipAutoPermissionPrompt` are both `true`. Review before applying if you prefer explicit permission prompts.

**Merge approach**: copy only the keys you want rather than wholesale replacing your settings:

```bash
# View what's in the bundle:
cat config/settings.json

# Then manually add the keys you want to ~/.claude/settings.json
```

The `hooks` block is intentionally absent. Satori's plugin ships its own `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}`, no hook wiring is needed.

</details>

---

## Notes

- **Skills** (the symlinks in `~/.claude/skills/`) are not bundled here. Install them from their source repos.
- **Hooks** are handled by the Satori plugin. Install the plugin via `dev-link-plugin.sh` or `claude plugin install`, hooks wire automatically.
- The `CLAUDE.md` in this bundle is Furaidē's full working guide including the persona preamble. The version at `~/.claude/CLAUDE.md` on your machine is the live copy Claude Code reads each session.
