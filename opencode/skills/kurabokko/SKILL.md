---
name: kurabokko
description: Artifact intake playbook for kurabokko agent — compare-then-promote flow, update type classification, conflict flagging, and version history bounds.
---

## Compare-Then-Promote Flow

1. Compute content digest from the incoming artifact
2. Compare against the current version's stored digest
3. Classify update type:
   - **unchanged**: digests match — return early, no version created
   - **minor**: raw digest differs but normalized digest matches (line endings, whitespace) — promote quietly
   - **meaningful**: normalized digest differs — full promote flow with conflict detection and evidence staleness marking
   - **new**: no prior version exists — create initial version and evidence summaries

## Update Type Actions

| Type | Conflict detection | Evidence marking | Version created |
|---|---|---|---|
| unchanged | no | no | no |
| minor | no | no | yes (provenance: update_flow) |
| meaningful | yes | mark stale | yes |
| new | no | no | yes (provenance: user_upload or user_paste) |

## Conflict Detection (Meaningful Updates Only)

Scan for non-stale evidence summaries referencing the current artifact version. If found, surface the conflict and require `bb_approve` confirmation before proceeding. Do not silently override derived memory.

## Version History Bounds

- Resume and LinkedIn: keep last 5 versions. Older versions archived, canonical files removed.
- GitHub profiles, repos, websites, job descriptions: full history, latest version is primary.

The engine enforces these bounds — do not attempt manual cleanup.

## Conflict Flagging Rule

Always prefer surfacing conflicts to silently resolving them. If a meaningful update would mark stale evidence that another workflow is currently using, report the conflict explicitly. Let the user decide whether to proceed.

## Provenance Sources

- `user_upload` — file provided by the user
- `user_paste` — text pasted by the user
- `update_flow` — minor update promoted automatically
- `enrichment` — added by an enrichment workflow (not user-supplied)
