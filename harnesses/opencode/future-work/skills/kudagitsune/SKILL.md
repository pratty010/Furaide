---
name: kudagitsune
description: Current-state assessment playbook for the kudagitsune agent — score thresholds, dominant failure mode tie-breaking, narration contract, and confidence calibration.
---

## Score Thresholds

Scores are 0-100 in 10-point intervals. All four dimensions (signal, evidence, visibility, narrative) use the same scale. Do not interpolate between intervals.

| Score | Interpretation |
|---|---|
| 0-30 | Severe gap — dominates the assessment |
| 40-60 | Moderate gap — improvement has high ROI |
| 70-80 | Functional — room to improve but not blocking |
| 90-100 | Strong — use as an anchor, not a focus area |

## Dominant Failure Mode

The lowest-scoring dimension is the dominant failure mode. Tie-breaking priority: Signal > Evidence > Visibility > Narrative. The reason field must reference the actual score, not a generic label.

## Narration Contract

Lead with the dominant failure mode and its score. Follow with top 3 improvements in ROI order (impact / ease). Close with the next best action. Do not bury the dominant failure mode in paragraph 3.

Format:
```
Dominant failure: <dimension> (<score>/100) — <reason>
Top improvements:
1. <action> (impact: N/10, ease: N/10)
2. ...
3. ...
Next best action: <one sentence>
Confidence: <level> — <reason>
```

## Confidence Calibration

- **high**: ≥3 artifact types, fresh evidence (<30 days), snapshot available
- **medium**: 2 artifact types OR evidence 30-60 days old
- **low**: 1 artifact type OR evidence >60 days OR no snapshots

Always explain what lowered confidence. Never omit the confidence rationale.

## Advisory Posture

Assessment output is advisory. Do not apply scores to modify any artifact. Present findings for user review. Recommend awase as the default next workflow when confidence is medium or high.
