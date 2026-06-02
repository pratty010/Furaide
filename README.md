# Puraguin

Skill-usage observability for Claude Code (v1) and future agentic platforms.

Runtime data defaults to `~/.puraguin/` unless `PURAGUIN_HOME` is set. That directory holds event logs, `state.db`, reports, evidence packs, and optional hook payload captures.

For local Claude Code development, point the existing Puraguin plugin path at this repo with:

```bash
bash scripts/dev-link-plugin.sh
```

To capture one session's raw hook payloads during smoke testing, set `PURAGUIN_CAPTURE_HOOK_PAYLOADS=1` before launching Claude Code. Raw payload files will be written under `~/.puraguin/debug/claude-code-hook-payloads/`.

See `docs/superpowers/specs/` for the design spec and `docs/superpowers/plans/` for the implementation plan.
