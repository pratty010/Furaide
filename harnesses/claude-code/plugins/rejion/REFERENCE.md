# Kuma reference notes

Behavioral reference (persistent local clone, gitignored at the repo root):
- `.reference/codex-plugin-cc/plugins/codex/` (cloned from `https://github.com/openai/codex-plugin-cc`)

Locked scope for Kuma v1:
- Public commands: setup, models, review, task, status, result, cancel
- No transfer, no public rescue, no bundled skill, no bundled subagent
- One review command with `--mode adversarial`
- Backends are one-shot CLI processes (`opencode run ...`, `pi -p ...`) — no HTTP server, no stdio-RPC daemon, no broker
- Provider slugs: `opencode-go`, `opencode` (OpenCode Zen — NOT `opencode-zen`), `ollama-cloud` (opencode backend only)
- Model metadata: backend self-report is primary (`opencode models`, `pi --list-models`); BaseLLM/NewAPI is optional enrichment only
- Job status: 5-value set (`queued`/`running`/`done`/`error`/`cancelled`) is authoritative; any finer phase is a cosmetic hint only
- State is stored per-workspace (hashed directory), not one flat file
- Cancel = process-tree kill only (no RPC interrupt — backends aren't servers)
