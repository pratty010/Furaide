# Architecture & Internals

Not auto-loaded. Pull when editing fleet wiring, scripts, or file relationships.

---

## File Relationships

| File | Role | Synced with |
|---|---|---|
| `agents/<name>.md` | Agent definition (frontmatter + body) | `permission.task` must match manifest `permitted_subagents`; no `model:` field — model lives in `opencode.jsonc` |
| `docs/routing-manifest.json` | Canonical model routing (primary + fallback chains) | Routing + fallback source of truth; installer may write a resolved copy into the target install |
| `docs/OPERATOR.md` | Tier discipline, model budget, reserve justification | `routing-manifest.json` should respect tier assignments here |
| `opencode.jsonc` | Provider whitelist + plugin list + permissions + `agent` model mappings | Plugin array must include all 4 gate plugins plus `web-tools.ts`; provider whitelists must not include `gemini-2.5-*`; `agent.<name>.model` is the runtime assignment |
| `plugins/gates/*.js / plugins/failover/*.js / plugins/tools/web-tools.ts` | Runtime gates and tools plugins (fail-closed on load error) | Gate plugins are `.js`; web-tools is `.ts` loaded directly by opencode; `migawari.js` reads `routing-manifest.json` at runtime |
| `scripts/workflow-state.mjs` | Sole writer of `state.json` | Specialists call at phase boundaries; never write state directly |
| `scripts/lib/state-lock.mjs` | File-based locking for workflow state | Used by `workflow-state.mjs` for CAS safety |
| `docs/manifest-schema.md` | Schema for agent frontmatter manifest fields | `permission.task` allow-list is generated from `permitted_subagents` |
| `plugins/tools/web-tools/providers/gemini-ai-studio.ts` | AI Studio REST transport | `google.transport: ai-studio` in plugin YAML |
| `plugins/tools/web-tools/providers/gemini-vertex.ts` | Vertex AI REST transport (Bearer ADC) | `google.transport: vertex` in plugin YAML |
| `plugins/tools/web-tools/providers/vertex-auth.ts` | Vertex OAuth helper (google-auth-library) | Called by `gemini-vertex.ts` on 401 |
| `plugins/tools/web-tools/providers/vertex-endpoint.ts` | Vertex URL builder (global vs regional) | Called by `gemini-vertex.ts`; reads model region |
| `plugins/tools/web-tools/providers/transport-select.ts` | auto / vertex / ai-studio selector | Reads `google.transport` from plugin YAML |
| `commands/tools-config.md` | Interactive web-tools config editor | Writes tool budgets and transport to plugin runtime |

**After editing routing or runtime model config:** run `bun test` to verify model consistency.

---

## Key Scripts

| Script | Purpose | When to call |
|---|---|---|
| `scripts/workflow-state.mjs` | Sole writer of workflow state (init/read/advance/gate) | Every specialist phase boundary |
| `scripts/citation-verify.mjs` | Check flagged claims have source IDs; verdict ok/warn/critical | Writer, deep-researcher: before advancing past draft |
| `scripts/voice-check.mjs` | Token overlap between output and voice profile; ok/warn | Writer: before advancing past voicecheck |
| `scripts/humanize-check.mjs` | AI-tell density gate; ok/warn/critical | Writer: final polish pass |
| `scripts/security-severity.mjs` | Weighted severity scoring (0-15) for security findings | Security specialist: scoring findings |
| `scripts/sql-safety-check.mjs` | Classify SQL (read/write/ddl) + safety gate | Data-analyst: before executing SQL |
| `scripts/ctx7-docs.mjs` | Fetch library docs via ctx7 CLI (falls back to bunx) | Scout, any agent needing versioned API docs |
| `scripts/memory-path.mjs` | Compute + validate MEMORY.md path for a cwd | Before reading/writing project memory |
| `scripts/state-path.mjs` | Compute state directory paths for a workflow | Before accessing state files |
| `scripts/verify-run.mjs` | Execute a verify.json command sequence, report per-command results | Coding: verification step |
| `scripts/playbook-check.mjs` | Validate obligations map to playbook clauses | Legal-compliance: before final obligation map |
| `scripts/action-allowlist.mjs` | Gate: proposed action must be in allowlist + have rollback | Devops-sre, @karakuri--command-runner: before destructive ops |

---

## Extending the Fleet

For a new repeating workflow not covered by the current roster, consult `agency-agents` (see memory `[[agency-agents-source]]`), pick the closest match, adapt it to v9.1 frontmatter + routing conventions (`docs/manifest-schema.md`), and add it under `agents/`.
