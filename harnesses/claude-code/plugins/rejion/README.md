# Rejion

Rejion delegates code review and general task execution to `opencode` and `pi`, targeting three provider slugs: `opencode-go`, `opencode` (marketed as "OpenCode Zen" — the CLI slug is `opencode`, not `opencode-zen`), and `ollama-cloud` (reachable only through the `opencode` backend). Claude Code stays the orchestrator; Rejion is the bridge.

## Install

Rejion ships as part of this repo's plugin marketplace. Install via Claude Code's plugin manager, pointing at `./harnesses/claude-code/plugins/rejion`.

## First-run setup

```
/rejion:setup
/rejion:setup --default-backend opencode --default-model opencode-go/deepseek-v4-pro
```

This checks that the `opencode` and `pi` binaries are on PATH, checks auth readiness for each provider, and refreshes the local model index.

The `--default-model` and `--model` options accept either a bare model name (resolved via the cached index) or an explicit `provider/model` string.

## Commands

| Command | Purpose |
|---|---|
| `/rejion:setup` | Check backend/auth readiness, refresh the model index, set defaults |
| `/rejion:models` | Show models Rejion can reach right now |
| `/rejion:review` | Run a review (`--mode adversarial` for adversarial framing) |
| `/rejion:task` | Delegate a generic task (implementation, debugging, research, follow-up) |
| `/rejion:status` | Show active/recent jobs for this workspace |
| `/rejion:result` | Show the stored output for a finished job |
| `/rejion:cancel` | Cancel an active job |

## Backend / model matrix

| Target | CLI slug | via `pi` | via `opencode` |
|---|---|---|---|
| OpenCode Go | `opencode-go` | yes | yes |
| OpenCode Zen | `opencode` | yes | yes |
| Ollama Cloud | `ollama-cloud` | no | yes (requires Ollama configured) |

## Examples

```
/rejion:models
/rejion:review --mode adversarial --background
/rejion:task --backend opencode --model opencode-go/deepseek-v4-pro "add input validation to the signup form"
/rejion:status
```

## Future work

Cross-workspace job visibility, additional providers beyond the three v1 targets (many Chinese/European vendors are already supported by the underlying backends), smart routing, `/rejion:transfer`, and llm-council-style multi-model review are all explicitly out of scope for v1 — see the spec's Future Work section.
