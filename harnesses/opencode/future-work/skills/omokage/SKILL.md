---
name: omokage
description: Progress comparison playbook — meaningful delta threshold, arrow notation, trend window, and safe-redirect rules when no snapshot history exists.
---

## Meaningful Delta

A score change is meaningful when it is ≥10 points in any dimension (signal, evidence, visibility, narrative) or ≥5 points in fit_score. Changes below these thresholds are noise — note them but do not headline them.

## Arrow Notation

| Arrow | Meaning |
|---|---|
| ↑ | Improved (delta ≥ +10) |
| → | Stable (delta < ±10) |
| ↓ | Declined (delta ≤ -10) |

Use one arrow per dimension in the summary table. Do not use percentages — use raw point deltas.

## Trend Window

Default comparison: latest snapshot vs immediately prior snapshot. For trend analysis: use all available snapshots in the same role-family cluster. Note the number of snapshots in the window.

## Surface Events

Report surface events that occurred between snapshots (new artifact ingested, artifact updated, embedding provider changed). These explain score movements.

## Safe Redirect Rules

If zero snapshots exist: do not fabricate progress output. Offer to redirect:
- To `kudagitsune` to create the first assessment snapshot
- To `kurabokko` to ingest artifacts before assessment

If exactly one snapshot exists: report the baseline only. Note that trend analysis requires at least two snapshots.

## Recommended Next Workflow

Always close the progress report with the `recommended_next_workflow` from the latest snapshot's metadata. If no recommendation is stored, default to "awase" when fit context is available, or "kudagitsune" otherwise.
