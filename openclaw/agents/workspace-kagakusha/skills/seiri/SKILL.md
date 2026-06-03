---
name: seiri
description: Report distillation only. Distills report cards into RESEARCH_NOTES.md and updates distilled state in reports/index.json.
user-invocable: true
metadata: {"openclaw":{"emoji":"🧹"}}
---

# Seiri (整理) - Report Distillation

This skill handles only report distillation. It does not perform memory maintenance.

## Mode

- `report_distillation` (only mode)

## Inputs

- `report_paths` (optional array): specific report file paths to refresh (from card variants).
- `force_refresh` (optional, default `false`): allow re-distillation of already distilled cards.

## Selection Rules (Always Full-Index First)

1. Read full `reports/index.json.cards` every run.
2. Build baseline candidates from card status:
   - default: cards where `distilled.status != true`
   - if `force_refresh=true` and `report_paths` omitted: all cards
3. If `report_paths` is provided:
   - normalize and dedupe paths
   - map each path to owning card via `variants.*[].path`
   - ignore unknown paths and include them in summary warnings
   - if `force_refresh=true`: process mapped cards regardless of current status
   - if `force_refresh=false`: process mapped cards only when `distilled.status != true`
4. If `report_paths: []`: return no-op summary with `cards_scanned=0` and `cards_updated=0`.

## Data Sources

- `reports/index.json` topic cards and variants
- report markdown files under `reports/YYYY-MM-DD/*.md`

## Outputs

- `RESEARCH_NOTES.md` updates
- card-level `distilled` status updates in `reports/index.json`
- concise run summary including:
  - `requestedReportPaths` (normalized list)
  - `resolvedReportPaths`
  - `unknownReportPaths`
  - `resolvedCards`
  - `cards_scanned`
  - `cards_updated`
  - `status_transitions`
  - `warnings`
  - files touched

## Distilled Status Rules

For each card:

- `true`: all required variant report paths for the card are represented in `RESEARCH_NOTES.md`
- `false`: otherwise

`distilledAt` rules:

- set ISO timestamp when status is `true` on successful write
- set `null` when status is `false`

Required paths are inferred from coverage + variants:

- if `coverage.hasSokkou=true`, include all `variants.sokkou[].path`
- if `coverage.hasKensho=true`, include all `variants.kensho[].path`
- if coverage flags and variant arrays disagree, mark warning and keep card `distilled.status=false`

## Edge Case Handling

1. Missing `distilled` object on card: initialize to `{ "status": false, "distilledAt": null }`.
2. Legacy status values (including `"partial"`/string values): treat as not distilled and normalize to boolean on write.
3. Unknown `report_paths`: ignore and report in `unknownReportPaths`.
4. `report_paths` outside `reports/` namespace: ignore and warn.
5. Missing report files on disk for selected cards: warn, keep card `distilled.status=false`.
6. Card with no required variant paths: warn, skip card update.
7. Corrupt `index.json` shape: abort safely with error summary, no writes.
8. Duplicate paths/cards in input: dedupe before processing.

## Safety Rules

- Do not modify report markdown files.
- Do not modify `MEMORY.md` or `memory/*`.
- Do not delete files.
- Restrict writes to `RESEARCH_NOTES.md` and `reports/index.json` only.

## Triggering

Use manually or via cron when you want to distill report cards into `RESEARCH_NOTES.md`.
