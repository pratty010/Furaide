---
description: Compare profile snapshots over time and show progress with score deltas, trend direction, and recommended next workflow
argument-hint: "[baseline-snapshot-id] [current-snapshot-id]"
agent: kitsune
---

Set intent to progress_feedback and proceed.

Use latest-vs-previous as the default comparison baseline. If no snapshot history exists, do not fabricate output — offer to redirect to kudagitsune or kurabokko instead.

$ARGUMENTS
