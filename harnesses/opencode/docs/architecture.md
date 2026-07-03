# Architecture & Internals

Not auto-loaded. Pull when editing fleet wiring, docs, manifest entries, or script ownership.

---

## Runtime pair and reference set

| Path | Role | Keep in sync with |
|---|---|---|
| `config/opencode.jsonc` | Runtime plugin registry, provider whitelist, per-agent overrides, scoped permissions for built-ins | `docs/routing-manifest.json`, active plugin paths, agent stems |
| `docs/routing-manifest.json` | v10 routing source of truth for specialists, subagents, and workers | `config/opencode.jsonc`, `docs/OPERATOR.md`, `scripts/lib/agent-fleet-map.mjs` |
| `config/fleet-manifest.json` | Installer source of truth for shipped components and file lists | any moved/retired docs, scripts, or plugin paths |
| `config/skills-manifest.json` | Pinned external-skills source list | `scripts/pull-external-skills.mjs`, `scripts/apply-patches.mjs`, README install steps |
| `docs/manifest-schema.md` | v2 frontmatter and scoped-permission contract | `docs/agent-description-rubric.md`, active agent files |
| `docs/agent-description-rubric.md` | Authoring rubric for v2 agent files | `agents/*.md`, `scripts/dev/agent-fleet-audit.mjs` |

---

## Plugin buckets

The active plugin tree is bucketed by responsibility:

| Bucket | Paths | Notes |
|---|---|---|
| Gates | `plugins/gates/nio.js`, `plugins/gates/komainu.js` | Workflow/tool gates and edit screening |
| Failover | `plugins/failover/migawari.js` | Passive `session.error` logger for operator visibility — no runtime retry/swap; automatic model substitution happens at install time via `scripts/model-resolve.mjs` |
| Tools | `plugins/tools/web-tools.ts`, `plugins/tools/web-tools/**` | Web search/fetch/maps plus pricing/runtime helpers |
| Hooks | `plugins/hooks/audit-logger.js`, `plugins/hooks/compaction-injector.js` | Audit log append + compaction prompt injection |

`config/opencode.jsonc` must point at the bucketed paths exactly. `scripts/install-fleet.sh`, `scripts/merge-config.mjs`, tests, and README must agree on those paths.

`plugins/gates/nurikabe.js` (SUPERSEDED 2026-07-03) is no longer in the `Gates` bucket above or registered in `config/opencode.jsonc` — it bound to a `deliver` tool that never existed and never fired at runtime. The delivery gate it attempted is now enforced in `scripts/workflow-state.mjs`'s `cmdAdvance` (exit code `6` on an unresolved critical gate verdict at a workflow's terminal/delivery-adjacent state). The file itself remains on disk with a `SUPERSEDED` header for institutional memory.

---

## Skills pipeline

The harness no longer relies on a bundled third-party skills snapshot in `opencode.jsonc`.

| Path | Role |
|---|---|
| `config/skills-manifest.json` | Pins upstream repos and commits |
| `scripts/pull-external-skills.mjs` | `--check` verifies pins; `--pull` refreshes the install target |
| `scripts/apply-patches.mjs` | Re-applies local patch overlays after a pull |
| repo-root `skills/` | Shared installed skill destination used across harnesses |

README install steps should mention both the fleet installer and the external-skills pull path.

---

## Finance suite

Workflow #5 has its own shipped compute surface.

| Path group | Role |
|---|---|
| `scripts/knowledge-bank-finance.mjs` | Bank status/query/propose/write CLI |
| `scripts/finance-artifact-registry.mjs` | Artifact ledger and durable promotion |
| `scripts/finance-source-registry.mjs` | Source registry add/list |
| `scripts/finance/*.py` | Deterministic finance compute, normalization, and verification CLIs run with `uv run` |
| `research/financial/**` | Durable outputs and ledgers owned by the finance workflow |

Installer packaging for the finance suite lives in the `finance` component of `config/fleet-manifest.json`.

---

## Dispatch and verification lint

| Path | Role |
|---|---|
| `scripts/lint-dispatch-graph.mjs` | Enforces DAG edges, depth cap, and scoped-permission invariants |
| `scripts/lib/agent-fleet-map.mjs` | Canonical active-stem map used by tests and audit helpers |
| `scripts/tests/dispatch-graph.test.mjs` | Guards dispatch graph rules |
| `scripts/tests/agent-reference-integrity.test.mjs` | Guards stale-token drift in active docs/config/agents |
| `scripts/dev/agent-fleet-audit.mjs` | Generates a human audit table from current v2 frontmatter |

Run `bun test scripts/tests/` after touching agent inventory, manifest files, plugin paths, or runtime docs.

---

## Active helper scripts

Only the scripts below remain active in the v2 shipped reference set:

| Script | Purpose |
|---|---|
| `scripts/workflow-state.mjs` | Sole workflow-state writer |
| `scripts/citation-verify.mjs` | Citation gate |
| `scripts/humanize-check.mjs` | AI-tell density check for WF4 deliverables |
| `scripts/security-severity.mjs` | Security finding scoring |
| `scripts/ctx7-docs.mjs` | Local ctx7 wrapper for doc retrieval |
| `scripts/memory-path.mjs` | Memory index location + validation helper |
| `scripts/state-path.mjs` | Workflow tmp/state path helper |
| `scripts/verify-run.mjs` | Verification command runner |

Retired workflow-owned helpers and old model-family guides move under `future-work/` when kept only as local reference.
