# Install Agent Packet

Use this file when another local LLM agent needs to install the OpenCode fleet safely.

## Goal

Install Furaide's OpenCode fleet into a user-selected scope without touching unrelated config, while preserving backups and letting the user confirm any model remaps.

## Safe Commands

From the repo root:

```bash
bash opencode/scripts/install-fleet.sh
```

For a non-writing preview:

```bash
bash opencode/scripts/install-fleet.sh --dry-run
```

## Interaction Policy

- Ask the user before selecting a non-default scope if they did not specify one.
- Do not enable Brand Builder unless the user explicitly asks for it.
- If the installer reports model remaps, summarize them once and ask for confirmation.
- If backups are about to be created, mention the `kura_backup/<timestamp>/` path in your summary.

## Expected Answers For Normal Install

- Core bundle: accept default install.
- Brand Builder / Kitsune: skip by default.
- Scope: choose the user-requested scope, otherwise ask.
- Model remap prompt: ask the user once if any remap is shown; otherwise continue.
- Shared common skills prompt: ask only if the user wants them.

## Verification

After install, run:

```bash
opencode debug config
bun test opencode/scripts/tests/
```

Check:

- installed target has `opencode.json` or `opencode.jsonc`
- installed target has `.furaide-install-receipt.json`
- installed target has `docs/routing-manifest.json`
- fleet plugins are present in the target config
- `agent.<name>.model` exists for fleet agents in the target config

## Rollback / Uninstall

Uninstall from a custom target:

```bash
bash opencode/scripts/uninstall-fleet.sh --purge --custom /absolute/target/path
```

If the user wants to restore overwritten files manually, use the backup tree:

```bash
<target>/kura_backup/<timestamp>/
```

## Brand Builder Rule

Brand Builder is opt-in only. Do not install or enable it unless the user explicitly requests it.
