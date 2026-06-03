# openclaw/

OpenCLAW persona configurations for Furaidē's stateful assistant runtime.

OpenCLAW is a separate runtime from opencode and claude-code. It's a persistent, Discord/gateway-connected agent that holds memory across sessions via markdown files. See the [OpenCLAW documentation](https://docs.openclaw.ai) for the full reference.

---

## What's in this directory

```
openclaw/
  agents/
    workspace-kinyo/      # Kinyo persona — general assistant with GOSHIN v2 security
    workspace-koda/       # Koda persona — code-focused
    workspace-kagakusha/  # Kagakusha persona — research specialist
    workspace-tengan/     # Tengan persona — lightweight general
  _reference/             # GITIGNORED — full experimental config with live secrets (local only)
```

The workspace directories are safe to commit; they contain only personality/behavior markdown files. The `_reference/` directory is gitignored; it holds the actual `openclaw.json` and `openclaw_default.json` config files which contain live API keys. **Never commit `_reference/`.**

---

## Install OpenCLAW

```bash
npm install -g @openclaw/openclaw
openclaw configure
```

Or via brew (macOS):

```bash
brew install openclaw/tap/openclaw
```

---

## Config schema (`openclaw.json`)

Create your own `openclaw.json` in `~/.config/openclaw/` or a path of your choice. The structure below uses placeholders; never commit real keys:

```json
{
  "auth": {
    "profiles": [
      {
        "name": "default",
        "provider": "anthropic",
        "apiKey": "YOUR_ANTHROPIC_API_KEY"
      },
      {
        "name": "openai",
        "provider": "openai",
        "apiKey": "YOUR_OPENAI_API_KEY"
      }
    ]
  },
  "agents": {
    "list": [
      {
        "name": "kinyo",
        "agentDir": "/path/to/openclaw/agents/workspace-kinyo",
        "model": "claude-opus-4-8",
        "profile": "default"
      }
    ]
  },
  "tools": {
    "web": {
      "enabled": true,
      "provider": "perplexity",
      "apiKey": "YOUR_PERPLEXITY_API_KEY"
    }
  },
  "gateway": {
    "enabled": true,
    "token": "YOUR_GATEWAY_TOKEN"
  },
  "channels": {
    "discord": {
      "enabled": true,
      "token": "YOUR_DISCORD_BOT_TOKEN",
      "guildId": "YOUR_GUILD_ID"
    }
  }
}
```

---

## Persona workspace structure (SOUL/IDENTITY/MEMORY pattern)

Each workspace directory (`agents/workspace-*/`) holds markdown files that define the persona's behavior and memory:

| File | Purpose |
|------|---------|
| `SOUL.md` | Core identity: who the agent is, values, voice, boundaries |
| `IDENTITY.md` | Public persona: how it presents, catchphrases, interaction style |
| `MEMORY.md` | Persistent memory: what the agent remembers across sessions |
| `AGENTS.md` | Agent roster and dispatch rules |
| `TOOLS.md` | Available tools and their use |
| `HEARTBEAT.md` | Session startup ritual: what to load, check, and surface |
| `USER.md` (optional) | Per-user context and preferences |
| `RESEARCH.md` (optional) | Research notes and findings |

The agent reads all files in its `agentDir` at session start. `MEMORY.md` and `USER.md` are updated during sessions. All other files are relatively static.

---

## Authoring a new persona

1. Copy an existing workspace as a template:
   ```bash
   cp -r openclaw/agents/workspace-kinyo openclaw/agents/workspace-myagent
   ```
2. Edit `SOUL.md` to define the core identity, values, and voice.
3. Edit `IDENTITY.md` to define the public persona and interaction style.
4. Clear `MEMORY.md` to start with an empty or minimal state.
5. Update `AGENTS.md` and `TOOLS.md` to match the new persona's capabilities.
6. Add the workspace to `openclaw.json` under `agents.list`:
   ```json
   { "name": "myagent", "agentDir": "/path/to/openclaw/agents/workspace-myagent", "model": "claude-sonnet-4-6", "profile": "default" }
   ```
7. Restart OpenCLAW.

---

## GOSHIN v2 security protocol (from workspace-kinyo)

GOSHIN v2 is a behavioral security protocol embedded in the `workspace-kinyo` persona. Key principles:

1. Private information stays private; never echo credentials or tokens.
2. Any action affecting external systems (send, post, delete) requires explicit user confirmation first.
3. Only request permissions needed for the current task.
4. Log significant actions to MEMORY.md.
5. Decline requests that violate boundaries without being preachy about it.

To adapt GOSHIN v2 for a new persona: copy the relevant sections from `workspace-kinyo/SOUL.md` and `workspace-kinyo/HEARTBEAT.md` into your new workspace, then adjust the persona-specific language.

---

## Reference

- Full OpenCLAW documentation: [docs.openclaw.ai](https://docs.openclaw.ai)
- Config schema reference: see `openclaw/_reference/openclaw_default.json` (local only, gitignored)
- Related: `common/docs/models/gemini.md` and `common/docs/models/openai.md` for model-specific prompting guides used by OpenCLAW personas
